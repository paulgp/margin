import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {repositoryRoot} from './release.mjs';

const require = createRequire(import.meta.url), core = require('../packages/core/dist');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-screenshots-'));
const root = path.join(temp, 'The quiet interval'), userData = path.join(temp, 'user-data');
const destination = path.join(repositoryRoot, 'docs/images');
const executable = process.env.MARGIN_VSCODE_EXECUTABLE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, browser;
const stop = () => { if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
const deadline = setTimeout(stop, 120000);
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  fs.accessSync(executable, fs.constants.X_OK);
  fs.mkdirSync(root); fs.mkdirSync(path.join(userData, 'User'), {recursive:true});
  fs.mkdirSync(destination, {recursive:true});
  const source = fs.readFileSync(path.join(repositoryRoot, 'examples/markdown/draft.md'));
  fs.writeFileSync(path.join(root, 'draft.md'), source);
  fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
    'workbench.colorTheme':'Default Light Modern', 'editor.fontSize':16, 'editor.lineHeight':26,
    'editor.wordWrap':'on', 'diffEditor.wordWrap':'on',
    'comments.openView':'never', 'comments.openPanel':'neverOpen', 'editor.minimap.enabled':false, 'editor.renderWhitespace':'none',
    'editor.stickyScroll.enabled':false, 'editor.selectionHighlight':false, 'editor.occurrencesHighlight':'off', 'editor.scrollBeyondLastLine':false,
    'workbench.startupEditor':'none', 'workbench.tips.enabled':false,
    'workbench.secondarySideBar.defaultVisibility':'hidden', 'chat.disableAIFeatures':true,
    'window.title':'The quiet interval · Margin example', 'window.restoreWindows':'none',
    'window.newWindowDimensions':'default', 'breadcrumbs.enabled':false,
    'files.exclude':{'**/.reviews':true}, 'telemetry.telemetryLevel':'off',
    'update.mode':'none', 'extensions.autoCheckUpdates':false, 'extensions.autoUpdate':false,
  }, null, 2));
  const {request} = core.prepare(root, {file:'draft.md', brief:'Focus on argument and pacing. Preserve my voice; let the opening breathe.'});
  const observations = [
    {quote:'A longer day would make the library more useful.', category:'argument', body:'Which residents would benefit from later hours? A concrete example would connect the closing time to the case for a longer day.'},
    {quote:'a place to sit without buying anything', category:'keep', body:'Keep this phrase. It makes the library’s public value concrete without interrupting the reflective pace.'},
    {quote:'The quiet matters too.', category:'structure', body:'This returns to the opening’s quiet mood. Could the link between quiet space and evening access be clearer?'},
  ];
  const comments = observations.map(c => {
    const block = request.blocks.find(b => b.role === 'source' && b.text.includes(c.quote));
    assert.ok(block, `Example quotation missing: ${c.quote}`);
    return {...c, file:block.file, block_id:block.id};
  });
  core.importResponse(root, request.id, JSON.stringify({schema_version:1, request_id:request.id,
    summary:'Illustrative offline review written for the documentation. These comments are fixtures, not model output.', comments}),
  {provider:'demo', requested_model:null, reported_model:null});
  const env = {...process.env};
  for (const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','VSCODE_IPC_HOOK_CLI','VSCODE_PORTABLE']) delete env[key];
  child = spawn(executable, [root, '--new-window', '--user-data-dir',userData,
    '--extensions-dir',path.join(temp,'extensions'), `--extensionDevelopmentPath=${path.join(repositoryRoot,'packages/vscode')}`,
    '--disable-extension','GitHub.copilot', '--disable-extension','GitHub.copilot-chat',
    '--disable-workspace-trust','--skip-welcome','--skip-release-notes',
    '--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'], {env, detached:true, stdio:['ignore','pipe','pipe']});
  const endpoint = await new Promise((resolve,reject) => {
    let output=''; const timer=setTimeout(()=>reject(new Error('VS Code did not expose its local renderer debugger within 20 seconds')),20000);
    const receive = chunk => {
      output=(output+chunk.toString()).slice(-32768);
      const match=/DevTools listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(output);
      if (match) {clearTimeout(timer);resolve(match[1]);}
    };
    child.stderr.on('data',receive); child.stdout.on('data',receive);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`VS Code exited before capture (${code})`));});
  });
  browser = await chromium.connectOverCDP(endpoint);
  let page;
  for (let i=0;i<100;i++) {
    page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('workbench'));
    if(page) break; await pause(100);
  }
  assert.ok(page,'VS Code workbench opened');
  page.setDefaultTimeout(15000);
  await page.setViewportSize({width:1440,height:960});
  await page.locator('.monaco-workbench').waitFor({state:'visible'});
  await page.getByText('Margin: 3 of 3 open',{exact:true}).waitFor({state:'visible'});
  async function command(title) {
    await page.keyboard.press('F1');
    const input=page.locator('.quick-input-widget input');
    await input.fill(`>${title}`);
    await page.locator('.quick-input-list .monaco-list-row').filter({hasText:title}).first().waitFor({state:'visible'});
    await page.keyboard.press('Enter');
    await page.locator('.quick-input-widget').waitFor({state:'hidden'});
  }
  await command('Margin: Next Open Comment');
  await page.getByText(observations[0].body,{exact:false}).first().waitFor({state:'visible'});
  await pause(500);
  await page.screenshot({path:path.join(temp,'review-comments.png'),scale:'css'});
  // Make an illustrative user edit through the editor; never save it.
  await page.keyboard.press('Escape');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  const find = page.locator('.find-widget textarea').first();
  await find.fill(observations[0].quote);
  await page.keyboard.press('Escape');
  await page.keyboard.insertText('A longer day would give commuters somewhere to study after work.');
  await pause(700);
  await page.keyboard.press('F1');
  await page.locator('.quick-input-widget input').fill('>Compare Reviewed Version with Current');
  await page.locator('.quick-input-list .monaco-list-row').filter({hasText:'Compare Reviewed Version with Current'}).first().waitFor({state:'visible'});
  await page.keyboard.press('Enter');
  await page.getByText('Choose Margin comment',{exact:true}).waitFor({state:'visible'});
  await page.keyboard.press('Enter');
  await page.locator('.monaco-diff-editor').waitFor({state:'visible'});
  await page.getByText('[argument] changed · UNSAVED BUFFER · open',{exact:true}).first().waitFor({state:'visible'});
  await page.getByLabel('Collapse',{exact:true}).click();
  await command('View: Toggle Primary Side Bar Visibility');
  await pause(700);
  const currentText = await page.locator('.monaco-diff-editor .modified .view-lines').first().innerText();
  assert.ok(currentText.replace(/\s+/g,' ').includes('would give commuters somewhere to study after work.'), 'The comparison displays the example revision');
  await page.screenshot({path:path.join(temp,'compare-versions.png'),scale:'css'});
  assert.deepEqual(fs.readFileSync(path.join(root,'draft.md')),source,'Screenshot workflow did not save the draft');
  for (const name of ['review-comments.png','compare-versions.png']) fs.copyFileSync(path.join(temp,name),path.join(destination,name));
  console.log('Captured real VS Code comments and comparison with Playwright: docs/images/');
} finally {
  clearTimeout(deadline); process.off('SIGINT',stop); process.off('SIGTERM',stop);
  await browser?.close().catch(()=>{});
  if(child?.exitCode===null) {stop(); await Promise.race([once(child,'exit').catch(()=>{}),pause(3000)]);}
  fs.rmSync(temp,{recursive:true,force:true});
}
