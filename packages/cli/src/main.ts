#!/usr/bin/env node
import * as path from 'node:path';
import * as fs from 'node:fs';
import {parseArgs} from 'node:util';
import {init, prepare, importResponse, diagnostic, sourcePath} from '@margin/core';
import {mockProvider} from './providers';

export async function main(args = process.argv.slice(2)): Promise<void> {
  const {values, positionals} = parseArgs({args, allowPositionals: true, strict: true, options: {project: {type: 'boolean'}, brief: {type: 'string'}, 'max-comments': {type: 'string'}, provider: {type: 'string'}, model: {type: 'string'}, root: {type: 'string'}, json: {type: 'boolean'}, help: {type: 'boolean'}, version: {type: 'boolean', short: 'v'}}});
  const output = (data: unknown, human: string) => process.stdout.write(values.json ? JSON.stringify(data) + '\n' : human + '\n');
  if (values.version) { const version: string = require('../package.json').version; output({version}, `margin ${version}`); return; }
  const root = fs.realpathSync(path.resolve(values.root ?? process.cwd())); const [command, ...rest] = positionals;
  if (values.help || !command) { output({commands: ['init', 'prepare', 'review', 'import', 'doctor']}, 'Margin — source-first, comment-only review\n\nmargin init\nmargin prepare <file> | --project [--brief TEXT] [--max-comments N] [--json]\nmargin review <file> | --project --provider mock|codex [--model NAME]\nmargin import <request-id> <response.json> [--json]\nmargin doctor [--json] (macOS connection diagnostics; no model call)\n\nAll commands accept --root DIR. Reviews read saved disk contents; save deliberately in your editor first. Margin never saves or edits drafts.'); return; }
  if (command === 'doctor') {
    if (rest.length) throw new Error('doctor takes no file arguments');
    const controller = new AbortController(), cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
      const {doctor} = await import('./doctor.js');
      const report = await doctor(root, {signal: controller.signal, onProgress: message => process.stderr.write(values.json ? JSON.stringify({type: 'progress', message}) + '\n' : message + '\n')});
      output(report, `macOS ${report.macos} (${report.arch}); Node ${report.node}; ${report.codex}\nEnvironment overrides omitted: ${report.ignored_environment.join(', ') || 'none detected'}\n${report.hints.join('\n')}`);
    } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
    return;
  }
  if (command === 'init') {
    if (rest.length) throw new Error('init takes no file arguments'); init(root);
    output({config: '.reviews/config.json'}, 'Initialized .reviews/config.json. Reviews and full-text snapshots are private via .reviews/.gitignore.'); return;
  }
  if (command === 'import') {
    if (rest.length !== 2) throw new Error('Usage: margin import <request-id> <response.json>');
    const file = path.resolve(process.cwd(), rest[1]);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Response must be a regular JSON file of at most 1 MiB');
    const session = importResponse(root, rest[0], fs.readFileSync(file, 'utf8'));
    output({project_root: root, review_id: session.id, session: `.reviews/sessions/${session.id}.json`}, `Imported ${session.id} (${session.comments.length} comments). Draft untouched.\nProject folder: ${root}\nIn VS Code, open this folder and run Margin: Select Review.`); return;
  }
  if (command !== 'prepare' && command !== 'review') throw new Error(`Unknown command: ${command}`);
  if (rest.length > 1) throw new Error('Use one positional source file or --project');
  if (rest[0]) {
    try { sourcePath(rest[0]); }
    catch (error) {
      throw new Error(`${(error as Error).message}\nProject folder: ${root}\nSource file arguments must be relative to the project folder; hidden folders and build/dependency paths are excluded.\nUse --root DIR to choose your writing project's folder, then pass the file path relative to it. Open that same folder in VS Code.`);
    }
  }
  process.stderr.write('Margin reviews SAVED DISK CONTENTS. Unsaved editor buffers are not captured; Margin never saves drafts.\n');
  const location = `Project folder: ${root}\nReviews directory: ${path.join(root, '.reviews')}`;
  process.stderr.write(values.json ? JSON.stringify({type: 'progress', message: location, project_root: root}) + '\n' : location + '\n');
  const prepared = prepare(root, {file: rest[0], project: values.project, brief: values.brief, maxComments: values['max-comments'] === undefined ? undefined : Number(values['max-comments'])});
  const data = {project_root: root, request_id: prepared.request.id, snapshot_id: prepared.snapshot.id, ...prepared.paths};
  if (command === 'prepare') { output(data, `${prepared.request.id}\n${Object.entries(prepared.paths).map(([k, v]) => `${k}: ${path.join(root, v)}`).join('\n')}`); return; }
  const provider = values.provider ?? 'mock';
  if (provider !== 'mock' && provider !== 'codex') throw new Error('Provider must be mock or codex; request retained for prepare/import');
  const started = Date.now(); let stage = `Starting ${provider}.`;
  const progress = (message: string) => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    process.stderr.write(values.json ? JSON.stringify({type: 'progress', provider, elapsed_seconds: elapsed, message}) + '\n' : `[margin +${elapsed}s] ${message}\n`);
  };
  progress(`Prepared ${prepared.request.id}. Packet: ${prepared.paths.packet}`);
  const heartbeat = setInterval(() => progress(`Still waiting. Last status: ${stage}`), 10000);
  const controller = new AbortController(); const cancel = () => { progress('Cancelling reviewer; prepared request will be retained.'); controller.abort(); };
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const adapter = provider === 'mock' ? mockProvider : (await import('./codex.js')).codexProvider;
    const result = await adapter.run(prepared.request, {model: values.model, signal: controller.signal, projectRoot: root, onProgress: message => { stage = message; progress(message); }});
    const session = importResponse(root, prepared.request.id, result.response, result.provenance);
    output({...data, review_id: session.id, session: `.reviews/sessions/${session.id}.json`}, `${session.id}: ${session.comments.length} comments\nRequest: ${prepared.request.id}\nSession: ${path.join(root, '.reviews/sessions', `${session.id}.json`)}\nIn VS Code, open ${root} and run Margin: Select Review. Draft untouched.`);
  } catch (e) {
    diagnostic(root, prepared.request.id, `Review orchestration failed (${provider}). The request is retained. Consult the CLI error; provider logs are not persisted because they can contain private runtime information.`);
    throw new Error(`${(e as Error).message}\nPrepared request retained: ${prepared.request.id}\nPacket (relative to the project root): ${prepared.paths.packet}\nFrom the project root, use margin import ${prepared.request.id} <response.json>${provider === 'codex' ? '\nFor connection diagnostics without a model call: margin doctor' : ''}`);
  }
  finally { clearInterval(heartbeat); process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
if (require.main === module) main().catch(error => { process.stderr.write(process.argv.includes('--json') ? JSON.stringify({error: error.message}) + '\n' : `Margin: ${error.message}\n`); process.exitCode = 1; });
