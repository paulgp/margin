#!/usr/bin/env node
import * as path from 'node:path';
import * as fs from 'node:fs';
import {parseArgs} from 'node:util';
import {init, prepare, importResponse, diagnostic} from '@margin/core';
import {mockProvider} from './providers';

export async function main(args = process.argv.slice(2)): Promise<void> {
  const {values, positionals} = parseArgs({args, allowPositionals: true, strict: true, options: {project: {type: 'boolean'}, brief: {type: 'string'}, 'max-comments': {type: 'string'}, provider: {type: 'string'}, model: {type: 'string'}, root: {type: 'string'}, json: {type: 'boolean'}, help: {type: 'boolean'}}});
  const root = fs.realpathSync(path.resolve(values.root ?? process.cwd())); const [command, ...rest] = positionals;
  const output = (data: unknown, human: string) => process.stdout.write(values.json ? JSON.stringify(data) + '\n' : human + '\n');
  if (values.help || !command) { output({commands: ['init', 'prepare', 'review', 'import']}, 'Margin — source-first, comment-only review\n\nmargin init\nmargin prepare <file> | --project [--brief TEXT] [--max-comments N] [--json]\nmargin review <file> | --project --provider mock|codex [--model NAME]\nmargin import <request-id> <response.json> [--json]\n\nAll commands accept --root DIR. Reviews read saved disk contents; save deliberately in your editor first. Margin never saves or edits drafts.'); return; }
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
    output({review_id: session.id, session: `.reviews/sessions/${session.id}.json`}, `Imported ${session.id} (${session.comments.length} comments). Draft untouched.`); return;
  }
  if (command !== 'prepare' && command !== 'review') throw new Error(`Unknown command: ${command}`);
  if (rest.length > 1) throw new Error('Use one positional source file or --project');
  process.stderr.write('Margin reviews SAVED DISK CONTENTS. Unsaved editor buffers are not captured; Margin never saves drafts.\n');
  const prepared = prepare(root, {file: rest[0], project: values.project, brief: values.brief, maxComments: values['max-comments'] === undefined ? undefined : Number(values['max-comments'])});
  const data = {request_id: prepared.request.id, snapshot_id: prepared.snapshot.id, ...prepared.paths};
  if (command === 'prepare') { output(data, `${prepared.request.id}\n${Object.entries(prepared.paths).map(([k, v]) => `${k}: ${path.join(root, v)}`).join('\n')}`); return; }
  const provider = values.provider ?? 'mock';
  if (provider !== 'mock' && provider !== 'codex') throw new Error('Provider must be mock or codex; request retained for prepare/import');
  const controller = new AbortController(); const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const adapter = provider === 'mock' ? mockProvider : (await import('./codex.js')).codexProvider;
    const result = await adapter.run(prepared.request, {model: values.model, signal: controller.signal, projectRoot: root});
    const session = importResponse(root, prepared.request.id, result.response, result.provenance);
    output({...data, review_id: session.id, session: `.reviews/sessions/${session.id}.json`}, `${session.id}: ${session.comments.length} comments\nRequest: ${prepared.request.id}\nOpen Margin: Select Review in VS Code. Draft untouched.`);
  } catch (e) {
    diagnostic(root, prepared.request.id, `Review orchestration failed (${provider}). The request is retained. Consult the CLI error; provider logs are not persisted because they can contain private runtime information.`);
    throw new Error(`${(e as Error).message}\nPrepared request retained: ${prepared.request.id}\nPacket: ${prepared.paths.packet}\nUse margin import ${prepared.request.id} <response.json>`);
  }
  finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
if (require.main === module) main().catch(error => { process.stderr.write(process.argv.includes('--json') ? JSON.stringify({error: error.message}) + '\n' : `Margin: ${error.message}\n`); process.exitCode = 1; });
