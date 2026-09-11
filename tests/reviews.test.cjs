const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {fixture,response,install,git,gitFixture,protectedEvidence,core} = require('./helpers.cjs');
const {mockProvider} = require('../packages/cli/dist/providers');

test('snapshots preserve exact BOM/CRLF/emoji bytes and SHA-256, and import ignores live changes', t => {
  const bytes = Buffer.from('\ufeff# Café 🐈\r\n\r\nThis is a reviewed sentence.\r\n');
  const root = fixture(t, {'draft.md':bytes}); const before = protectedEvidence(root,['draft.md']);
  const {request,snapshot} = core.prepare(root,{file:'draft.md'});
  assert.deepEqual(fs.readFileSync(path.join(root,`.reviews/snapshots/${snapshot.id}/files/draft.md`)),bytes);
  assert.equal(snapshot.files[0].sha256,core.hash(bytes));
  assert.deepEqual(snapshot.git,{head:null,branch:null});
  assert.equal(request.blocks.map(b=>b.text).join(''),bytes.toString('utf8').slice(1));
  assert.deepEqual(protectedEvidence(root,['draft.md']),before);
  fs.writeFileSync(path.join(root,'draft.md'),'User changed this fixture after prepare.');
  const changed = protectedEvidence(root,['draft.md']);
  const session = core.importResponse(root,request.id,JSON.stringify(response(request)));
  assert.match(session.comments[0].anchor.quote,/reviewed sentence/);
  assert.deepEqual(protectedEvidence(root,['draft.md']),changed);
});

test('dirty, untracked, detached, unborn Git context and unchanged HEAD/index', t => {
  const root = fixture(t); git(root,['init','-q']);
  const unborn = core.prepare(root,{file:'draft.md'}).snapshot.git;
  assert.equal(unborn.head,null); assert.equal(typeof unborn.branch,'string');
  const head = gitFixture(root);
  fs.writeFileSync(path.join(root,'draft.md'),'Dirty working source.\n\nDifferent from the staged fixture.');
  fs.writeFileSync(path.join(root,'untracked.typ'),'An untracked source paragraph.');
  const before = protectedEvidence(root,['draft.md','untracked.typ']);
  const {session} = install(root);
  const state = core.loadState(root,session); state.state.comments[session.comments[0].id].status = 'resolved';
  core.saveState(root,session,state.state,state.token);
  core.prepare(root,{file:'untracked.typ'});
  assert.deepEqual(protectedEvidence(root,['draft.md','untracked.typ']),before);
  assert.equal(before.git.head,head);
  fs.writeFileSync(path.join(root,'.git/HEAD'),head+'\n');
  assert.deepEqual(core.prepare(root,{file:'draft.md'}).snapshot.git,{head,branch:null});
});

for (const [name,file] of [['markdown','draft.md'],['typst','draft.typ'],['latex',null]]) test(`prepare → mock → import: ${name}`, async t => {
  const root = fixture(t,{}); fs.cpSync(path.resolve('examples',name),root,{recursive:true});
  const files = file ? [file] : ['main.tex','sections/introduction.tex','sections/methods.tex','macros.tex','references.bib'];
  const before = protectedEvidence(root,files);
  const {request} = core.prepare(root,file ? {file} : {project:true});
  const a = await mockProvider.run(request), b = await mockProvider.run(request);
  assert.equal(a.response,b.response);
  const session = core.importResponse(root,request.id,a.response,a.provenance);
  assert.equal(session.comments.length,file ? 1 : 3);
  for (const c of session.comments) assert.equal(core.snapshotText(root,session.snapshot_id,c.anchor.path).slice(c.anchor.start,c.anchor.end),c.anchor.quote);
  assert.deepEqual(core.loadSession(root,session.id),session);
  assert.deepEqual(protectedEvidence(root,files),before);
});

test('strict response validation is all-or-nothing, creates diagnostics, preserves valid reviews/source/index', t => {
  const root = fixture(t,{'draft.md':'A repeated phrase. A repeated phrase.\n\nA unique conclusion that is long enough.','macros.tex':'A context-only macro.'});
  gitFixture(root); core.init(root);
  fs.writeFileSync(path.join(root,'.reviews/config.json'),core.json({...core.defaults,files:['draft.md'],context_files:['macros.tex']}));
  const {request} = core.prepare(root,{project:true});
  const valid = response(request,{comments:[{file:'draft.md',block_id:request.blocks[1].id,quote:'A unique conclusion',category:'argument',body:'What supports this?'}]});
  const session = core.importResponse(root,request.id,JSON.stringify(valid));
  const immutable = fs.readFileSync(path.join(root,`.reviews/sessions/${session.id}.json`));
  const before = protectedEvidence(root,['draft.md','macros.tex']);
  const cases = [
    '{not JSON', JSON.stringify({...valid,request_id:'request-wrong'}), JSON.stringify({...valid,schema_version:2}),
    JSON.stringify({...valid,patch:'malicious unsupported field'}),
    JSON.stringify({...valid,comments:[{...valid.comments[0],block_id:'b99999'}]}),
    JSON.stringify({...valid,comments:[{...valid.comments[0],quote:'Absent quote'}]}),
    JSON.stringify({...valid,comments:[{...valid.comments[0],block_id:request.blocks[0].id,quote:'A repeated phrase.'}]}),
    JSON.stringify({...valid,comments:[{...valid.comments[0],quote:''}]}),
    JSON.stringify({...valid,comments:Array(9).fill(valid.comments[0])}),
    JSON.stringify({...valid,comments:[{...valid.comments[0],file:'macros.tex',block_id:request.blocks.at(-1).id,quote:'A context-only macro.'}]}),
    JSON.stringify({...valid,comments:[{...valid.comments[0],file:'../escape.md'}]}),
    JSON.stringify({...valid,comments:[{...valid.comments[0],category:'rewrite'}]}),
    JSON.stringify({...valid,comments:[valid.comments[0],{...valid.comments[0],body:'x',quote:'missing'}]})
  ];
  for (const raw of cases) {
    assert.throws(()=>core.importResponse(root,request.id,raw),/No review installed/);
    assert.deepEqual(core.listSessions(root),[session.id]);
    assert.deepEqual(fs.readFileSync(path.join(root,`.reviews/sessions/${session.id}.json`)),immutable);
    assert.deepEqual(protectedEvidence(root,['draft.md','macros.tex']),before);
  }
  assert.equal(fs.readdirSync(path.join(root,`.reviews/requests/${request.id}/diagnostics`)).length,cases.length);
  const empty = core.importResponse(root,request.id,JSON.stringify({...valid,comments:[]})); assert.equal(empty.comments.length,0);
});

test('scope, source and sidecar traversal/symlinks rejected; no unrelated writes', t => {
  const root = fixture(t), outside = fixture(t,{'secret.md':'private secret'});
  for (const file of ['../secret.md','/tmp/secret.md','.git/a.md','node_modules/a.md','build/a.tex','.env','draft.pdf','C:/a.md','a/../draft.md','a\\draft.md','missing.md']) assert.throws(()=>core.prepare(root,{file}));
  fs.symlinkSync(path.join(outside,'secret.md'),path.join(root,'link.md'));
  assert.throws(()=>core.prepare(root,{file:'link.md'}),/Symlink/);
  fs.symlinkSync(outside,path.join(root,'linked')); assert.throws(()=>core.prepare(root,{file:'linked/secret.md'}),/Symlink/);
  fs.symlinkSync(outside,path.join(root,'.reviews/sessions'));
  const {request} = core.prepare(root,{file:'draft.md'});
  assert.throws(()=>core.importResponse(root,request.id,JSON.stringify(response(request))),/Symlink/);
  assert.deepEqual(fs.readdirSync(outside),['secret.md']);
  const another = fixture(t); fs.symlinkSync(outside,path.join(another,'.reviews'));
  assert.throws(()=>core.init(another),/Symlink/);
  assert.throws(()=>core.atomicWrite(root,'draft.md','overwrite'),/restricted/);
  assert.throws(()=>core.loadRequest(root,'../../escape'),/Invalid Margin ID/);
});

test('missing manifest files, limits and invalid UTF-8 fail explicitly without truncation', t => {
  const root = fixture(t); core.init(root);
  const update = extra => fs.writeFileSync(path.join(root,'.reviews/config.json'),core.json({...core.defaults,...extra}));
  update({files:['draft.md','missing.tex']}); assert.throws(()=>core.prepare(root,{project:true}),/ENOENT/);
  update({limits:{...core.defaults.limits,file_bytes:5}}); assert.throws(()=>core.prepare(root,{file:'draft.md'}),/limit/);
  update({limits:{...core.defaults.limits,packet_bytes:100}}); assert.throws(()=>core.prepare(root,{file:'draft.md'}),/limit/);
  update({files:['draft.md'],context_files:['draft.md']}); assert.throws(()=>core.prepare(root,{project:true}),/distinct/);
  update({}); fs.writeFileSync(path.join(root,'draft.md'),Buffer.from([0xff,0xfe])); assert.throws(()=>core.prepare(root,{file:'draft.md'}),/UTF-8/);
});

test('block splitting preserves all spans with bounded chunks and surrogate/CRLF boundaries', () => {
  const source = ('🐈'.repeat(45)+'\r\n\r\n')+'x'.repeat(200)+'\n\nEnd';
  const blocks = core.splitBlocks('draft.md',source,'source',64,0);
  assert.equal(blocks.map(b=>b.text).join(''),source);
  for (const [i,b] of blocks.entries()) {
    assert.equal(b.text,source.slice(b.start,b.end)); assert.ok(b.text.length<=64); assert.equal(b.start,i ? blocks[i-1].end : 0);
    assert.ok(!/[\ud800-\udbff]$/.test(b.text)); assert.ok(!(b.text.endsWith('\r') && source[b.end]==='\n'));
  }
});

test('tampered immutable evidence and request blocks are detected', t => {
  const root = fixture(t); const {request,snapshot,session} = install(root);
  const p = path.join(root,`.reviews/requests/${request.id}/request.json`);
  const copy = structuredClone(request); copy.blocks[0].text = 'tampered'; fs.writeFileSync(p,core.json(copy));
  assert.throws(()=>core.loadSession(root,session.id),/block/);
  fs.writeFileSync(p,core.json(request));
  fs.writeFileSync(path.join(root,`.reviews/snapshots/${snapshot.id}/files/draft.md`),'tampered');
  assert.throws(()=>core.loadSession(root,session.id),/integrity/);
});

test('source is read once and a detected edit during capture fails the request', t => {
  const root=fixture(t), source=path.join(root,'draft.md'), inode=fs.statSync(source).ino;
  const originalRead=fs.readFileSync; let sourceReads=0;
  fs.readFileSync=function(file,...args) {
    const bytes=originalRead.call(fs,file,...args);
    if(typeof file==='number' && fs.fstatSync(file).ino===inode) { sourceReads++; fs.appendFileSync(source,'\nA simulated concurrent user edit.'); }
    return bytes;
  };
  try { assert.throws(()=>core.prepare(root,{file:'draft.md'}),/changed during capture/); }
  finally { fs.readFileSync=originalRead; }
  assert.equal(sourceReads,1); assert.equal(core.listSessions(root).length,0);
});

test('Git worktree-style .git file preserves nullable metadata without directory assumptions', t => {
  const root=fixture(t); const head=gitFixture(root);
  const container=fixture(t,{}), gitdir=path.join(container,'metadata');
  fs.renameSync(path.join(root,'.git'),gitdir);fs.writeFileSync(path.join(root,'.git'),`gitdir: ${gitdir}\n`);
  const beforeIndex=fs.readFileSync(path.join(gitdir,'index'));
  const {snapshot}=core.prepare(root,{file:'draft.md'});
  assert.equal(snapshot.git.head,head);assert.equal(snapshot.git.branch,'fixture');
  assert.deepEqual(fs.readFileSync(path.join(gitdir,'index')),beforeIndex);
});

test('CLI executable prepare/import --json works without credentials or model executable', t => {
  const root = fixture(t); const cli = path.resolve('packages/cli/dist/main.js');
  const run = args => spawnSync(process.execPath,[cli,...args,'--json'],{cwd:root,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});
  assert.equal(run(['init']).status,0);
  const prepared = run(['prepare','draft.md','--brief','Review the argument.']); assert.equal(prepared.status,0,prepared.stderr);
  assert.match(prepared.stderr,/SAVED DISK CONTENTS/);
  const data = JSON.parse(prepared.stdout); for (const key of ['packet','schema','snapshot','request']) assert.ok(fs.existsSync(path.join(root,data[key])));
  const req = core.loadRequest(root,data.request_id); fs.writeFileSync(path.join(root,'response.json'),JSON.stringify(response(req)));
  const imported = run(['import',req.id,'response.json']); assert.equal(imported.status,0,imported.stderr); assert.ok(JSON.parse(imported.stdout).review_id);
  const mock = run(['review','draft.md','--provider','mock','--max-comments','0']); assert.equal(mock.status,0,mock.stderr);
  assert.equal(core.loadSession(root,JSON.parse(mock.stdout).review_id).comments.length,0);
  assert.notEqual(run(['prepare','draft.md','--max-comments','NaN']).status,0);
});

test('CLI requires an explicit demo root and reports the folder VS Code must open', t => {
  const root = fixture(t, {'draft.md':'Unrelated project source.', '.demo/markdown/draft.md':'A demo argument needs supporting evidence.\n'});
  gitFixture(root);
  const before = protectedEvidence(root,['draft.md','.demo/markdown/draft.md']);
  const cli = path.resolve('packages/cli/dist/main.js');
  const run = args => spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});
  const rejected = run(['review','.demo/markdown/draft.md','--provider','codex']);
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/Excluded source path: .demo\/markdown\/draft.md/);
  assert.match(rejected.stderr,/Use --root DIR/);
  assert.match(rejected.stderr,/Open that same folder in VS Code/);
  assert.ok(!fs.existsSync(path.join(root,'.reviews')));
  const selected = fs.realpathSync(path.join(root,'.demo/markdown'));
  const reviewed = run(['review','draft.md','--root','.demo/markdown','--provider','mock','--json']);
  assert.equal(reviewed.status,0,reviewed.stderr);
  const data = JSON.parse(reviewed.stdout);
  assert.equal(data.project_root,selected);
  assert.ok(reviewed.stderr.includes(`Project folder: ${selected}`));
  assert.ok(fs.existsSync(path.join(selected,data.session)));
  assert.equal(core.loadSession(selected,data.review_id).comments[0].anchor.path,'draft.md');
  assert.ok(!fs.existsSync(path.join(root,'.reviews')));
  const human = run(['review','draft.md','--root','.demo/markdown','--provider','mock']);
  assert.equal(human.status,0,human.stderr);
  assert.ok(human.stdout.includes(`In VS Code, open ${selected} and run Margin: Select Review`));
  assert.deepEqual(protectedEvidence(root,['draft.md','.demo/markdown/draft.md']),before);
});
