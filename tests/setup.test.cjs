const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('./helpers.cjs');

async function installation(t, mode='success') {
  const {setup}=await import('../scripts/setup.mjs'), {releaseInfo,checksum}=await import('../scripts/release.mjs');
  const root=fixture(t,{}), prefix=path.join(root,'npm prefix'), code=path.join(root,'VS Code CLI');
  fs.writeFileSync(code,'test executable',{mode:0o700});
  for(const dir of ['', 'packages/core', 'packages/cli', 'packages/vscode']) {fs.mkdirSync(path.join(root,dir),{recursive:true});fs.writeFileSync(path.join(root,dir,'package.json'),JSON.stringify({version:'0.2.0'}));}
  const info=releaseInfo(root), dist=path.join(root,'dist');fs.mkdirSync(dist);
  const artifacts={};
  for(const key of ['cli','extension']) {const file=path.join(dist,info[key]);fs.writeFileSync(file,key);artifacts[key]={file:info[key],sha256:checksum(file)};}
  fs.writeFileSync(path.join(dist,info.manifest),JSON.stringify({schema_version:1,version:info.version,artifacts}));
  const calls=[], logs=[];let extensionInstalled=false;
  const run=async(command,args,options)=>{
    calls.push({command,args,options});
    if(command===code) {
      if(args.includes('--version'))return mode==='old-code'?'1.80.0\ncommit\narm64':'1.136.1\ncommit\narm64';
      if(args.includes('--list-extensions')) return mode==='newer-extension'?'margin-local.margin@0.3.0':extensionInstalled?'margin-local.margin@0.2.0':'margin-local.margin@0.1.0';
      if(args.includes('--install-extension')) {if(mode==='extension-failure')throw new Error('fake VS Code error');extensionInstalled=true;return '';}
    }
    if(args[0]===path.join(prefix,'bin/margin'))return 'margin 0.2.0';
    if(args.includes('prefix'))return prefix;
    if(args.includes('--version'))return '10.9.4';
    if(args.includes('install')&&mode==='cli-failure')throw new Error('fake npm error');
    return '';
  };
  return {root,prefix,code,info,dist,calls,logs,run:extra=>setup(['--code',code,...(extra??[])],{root,run,log:s=>logs.push(s)})};
}

test('setup builds and installs both versioned packages without linking, launching a window or calling a model', async t=>{
  const x=await installation(t);const result=await x.run();assert.equal(result.version,'0.2.0');
  assert.ok(x.calls.some(c=>c.args.includes('ci')));assert.ok(x.calls.some(c=>c.args.includes('package')));
  const cli=x.calls.find(c=>c.args.includes('install'));assert.ok(cli.args.includes('--offline'));assert.ok(cli.args.includes('--ignore-scripts'));
  assert.ok(cli.args.includes(path.join(x.dist,x.info.cli)));assert.ok(cli.args.includes(x.prefix));assert.ok(!cli.args.includes('--force'));
  const ext=x.calls.find(c=>c.args.includes('--install-extension'));assert.ok(ext.args.includes(path.join(x.dist,x.info.extension)));assert.ok(ext.args.includes('--force'));
  assert.ok(x.calls.indexOf(cli)<x.calls.indexOf(ext));
  assert.ok(!x.calls.some(c=>c.args.includes('link')||c.args.includes('codex')||c.args.includes('--new-window')));
  assert.ok(x.logs.some(s=>s.includes('Reload Window')));assert.ok(x.logs.some(s=>s.includes('export PATH=')));
});

test('setup can install existing artifacts offline or just the CLI', async t=>{
  const x=await installation(t);await x.run(['--from-dist','--cli-only']);
  assert.ok(!x.calls.some(c=>c.command===x.code));assert.ok(!x.calls.some(c=>c.args.includes('ci')||c.args.includes('package')));
  assert.ok(x.calls.some(c=>c.args.includes('install')));
});

test('preflight rejects old VS Code and newer installed versions before installation', async t=>{
  for(const mode of ['old-code','newer-extension']) {const x=await installation(t,mode);await assert.rejects(x.run(),/VS Code 1.100.0|newer Margin extension/);assert.ok(!x.calls.some(c=>c.args.includes('ci')||c.args.includes('install')||c.args.includes('--install-extension')));}
  const x=await installation(t);fs.mkdirSync(path.join(x.prefix,'lib/node_modules/margin-cli'),{recursive:true});fs.writeFileSync(path.join(x.prefix,'lib/node_modules/margin-cli/package.json'),' {"version":"0.3.0"}');
  await assert.rejects(x.run(),/newer Margin CLI/);
});

test('corrupt or path-traversing artifact entries fail before installing either component', async t=>{
  const x=await installation(t);fs.appendFileSync(path.join(x.dist,x.info.cli),'corrupt');await assert.rejects(x.run(['--from-dist']),/checksum/);
  assert.ok(!x.calls.some(c=>c.args.includes('install')||c.args.includes('--install-extension')));
  const y=await installation(t);const file=path.join(y.dist,y.info.manifest), manifest=JSON.parse(fs.readFileSync(file));manifest.artifacts.extension.file='../draft.md';fs.writeFileSync(file,JSON.stringify(manifest));
  await assert.rejects(y.run(['--from-dist']),/Invalid extension artifact/);
});

test('partial failures explain what was installed and do not report complete success', async t=>{
  const x=await installation(t,'cli-failure');await assert.rejects(x.run(['--from-dist']),/No extension installation was attempted/);assert.ok(!x.calls.some(c=>c.args.includes('--install-extension')));
  const y=await installation(t,'extension-failure');await assert.rejects(y.run(['--from-dist']),/CLI 0.2.0 is installed, but extension installation failed/);assert.ok(!y.logs.some(s=>s.startsWith('Installed Margin')));
});

test('release metadata, prerequisites and executable lookup handle unsupported inputs', async t=>{
  const {checkNode,releaseInfo}=await import('../scripts/release.mjs');const {findCode,newerThan}=await import('../scripts/setup.mjs');
  checkNode('22.22.0');checkNode('24.18.0');assert.throws(()=>checkNode('20.0.0'),/Node 22 or 24/);
  assert.equal(newerThan('0.10.0','0.2.0'),true);assert.equal(newerThan('0.2.0','0.2.0'),false);assert.throws(()=>newerThan('unknown','0.2.0'),/Cannot compare/);
  assert.throws(()=>findCode('/definitely/no-code'),/VS Code CLI not found/);
  const x=await installation(t);assert.equal(findCode(x.code),x.code);
  fs.writeFileSync(path.join(x.root,'packages/vscode/package.json'),'{"version":"0.1.0"}');assert.throws(()=>releaseInfo(x.root),/Version mismatch/);
});

test('setup subprocess failures, timeouts and cancellation are bounded', async t=>{
  const {runCommand}=await import('../scripts/release.mjs');const cwd=fixture(t,{});
  await assert.rejects(runCommand('/missing-program',[],{cwd,capture:true}),/Cannot run/);
  await assert.rejects(runCommand(process.execPath,['-e','process.exit(3)'],{cwd,capture:true}),/exited 3/);
  await assert.rejects(runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd,capture:true,timeoutMs:50}),/timed out/);
  const controller=new AbortController();const p=runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd,capture:true,signal:controller.signal});controller.abort();await assert.rejects(p,/cancelled/);
});
