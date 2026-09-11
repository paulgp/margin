const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {fixture,core,response,protectedEvidence,gitFixture} = require('./helpers.cjs');
const {mockProvider} = require('../packages/cli/dist/providers');
const focus = (file, start_line, end_line=start_line) => ({file,start_line,end_line});

test('line focus converts saved BOM/CRLF/emoji source without changing bytes or block coverage', t => {
  const bytes = Buffer.from('\ufeffThe outside opening stays as context.\r\nA café 🐈 deserves a focused observation.\r\nThe outside bridge remains context.\r\nA final focused claim needs support.\r\n');
  const root=fixture(t,{'draft.md':bytes});gitFixture(root);
  const before=protectedEvidence(root,['draft.md']);
  const {request,snapshot}=core.prepare(root,{file:'draft.md',focus:[focus('draft.md',2),focus('draft.md',4)]});
  const text=core.decode(bytes);
  assert.equal(request.schema_version,2);
  assert.deepEqual(request.focus.map(r=>[r.start_line,r.end_line,text.slice(r.start,r.end)]),[[2,2,'A café 🐈 deserves a focused observation.\r\n'],[4,4,'A final focused claim needs support.\r\n']]);
  assert.equal(request.blocks.map(b=>b.text).join(''),text);
  assert.deepEqual(request.blocks.map(b=>b.role),['context','source','context','source']);
  for(const block of request.blocks) assert.equal(block.text,text.slice(block.start,block.end));
  assert.deepEqual(fs.readFileSync(path.join(root,`.reviews/snapshots/${snapshot.id}/files/draft.md`)),bytes);
  assert.equal(snapshot.files[0].sha256,core.hash(bytes));
  assert.deepEqual(core.loadRequest(root,request.id),request);
  assert.match(core.packetText(request),/REVIEW FOCUS.*inclusive saved-snapshot lines/);
  assert.deepEqual(protectedEvidence(root,['draft.md']),before);
});

test('focus parsing and normalization merge duplicates/overlaps/adjacency and preserve file order', () => {
  assert.deepEqual(core.parseLineRanges('draft.md','2-4, 7,9-10'),[focus('draft.md',2,4),focus('draft.md',7),focus('draft.md',9,10)]);
  const texts=new Map([['z.tex','one\rtwo\rthree\rfour\rfive'],['a.typ','one\ntwo\n']]);
  const ranges=core.normalizeFocus([focus('a.typ',2),focus('z.tex',4),focus('z.tex',2,3),focus('z.tex',3)],['z.tex','a.typ'],texts);
  assert.deepEqual(ranges.map(({start,end,...r})=>r),[focus('z.tex',2,4),focus('a.typ',2)]);
  assert.equal(texts.get('z.tex').slice(ranges[0].start,ranges[0].end),'two\rthree\rfour\r');
  assert.equal(core.focusDescription(ranges),'z.tex:2-4, a.typ:2');
});

test('invalid, empty, excessive and escaping focus ranges fail explicitly', t => {
  for(const value of ['', '0','0-2','2-1','-1','2-','1.5','1,','1:4','1-2-3','9007199254740992']) assert.throws(()=>core.parseLineRanges('draft.md',value),/Invalid line range/);
  for(const file of ['../secret.md','/tmp/secret.md','.git/a.md','node_modules/a.md']) assert.throws(()=>core.parseLineRanges(file,'1'));
  const root=fixture(t,{'draft.md':'one\n\nthree\n'}), before=protectedEvidence(root,['draft.md']);
  for(const ranges of [[],[focus('draft.md',0)],[focus('draft.md',1,5)],[focus('draft.md',2)],[focus('draft.md',4)],[focus('other.md',1)],Array(201).fill(focus('draft.md',1))]) {
    assert.throws(()=>core.prepare(root,{file:'draft.md',focus:ranges}),/Focus|focus/);
    assert.equal(core.listSessions(root).length,0);assert.deepEqual(protectedEvidence(root,['draft.md']),before);
  }
});

for(const file of ['draft.md','draft.typ','draft.tex']) test(`focused prepare → mock → import: ${file}`, async t => {
  const root=fixture(t,{[file]:'An opening outside the review focus.\nA selected argument needs more evidence.\nA closing line outside the focus.\n'});
  const before=protectedEvidence(root,[file]);
  const {request}=core.prepare(root,{file,focus:[focus(file,2)]});
  const result=await mockProvider.run(request), session=core.importResponse(root,request.id,result.response,result.provenance);
  assert.equal(session.comments.length,1);assert.equal(session.schema_version,2);
  assert.deepEqual(session.focus,request.focus);
  assert.equal(session.comments[0].anchor.quote,'A selected argument needs more evidence.');
  assert.deepEqual(core.loadSession(root,session.id),session);
  const stored=core.loadState(root,session);stored.state.comments[session.comments[0].id].status='resolved';core.saveState(root,session,stored.state,stored.token);
  assert.equal(core.loadState(root,session).state.comments[session.comments[0].id].status,'resolved');
  assert.deepEqual(protectedEvidence(root,[file]),before);
});

test('focused multi-file project retains full context and excludes context-only/unfocused files as comment targets', async t => {
  const root=fixture(t,{});fs.cpSync(path.resolve('examples/latex'),root,{recursive:true});
  const files=['main.tex','sections/introduction.tex','sections/methods.tex','macros.tex','references.bib'];
  const before=protectedEvidence(root,files);
  const {request}=core.prepare(root,{project:true,focus:[focus('sections/introduction.tex',1),focus('sections/methods.tex',1)]});
  for(const file of files) assert.equal(request.blocks.filter(b=>b.file===file).map(b=>b.text).join(''),fs.readFileSync(path.join(root,file),'utf8'));
  assert.ok(request.blocks.filter(b=>['main.tex','macros.tex','references.bib'].includes(b.file)).every(b=>b.role==='context'));
  const result=await mockProvider.run(request), session=core.importResponse(root,request.id,result.response,result.provenance);
  assert.deepEqual(session.comments.map(c=>c.anchor.path),['sections/introduction.tex','sections/methods.tex']);
  for(const file of ['macros.tex','references.bib','other.tex']) assert.throws(()=>core.prepare(root,{project:true,focus:[focus(file,1)]}),/not a selected source file|Unsupported source file/);
  assert.deepEqual(protectedEvidence(root,files),before);
});

test('import rejects any out-of-focus or crossing quote as a whole and uses original lines after live edits', t => {
  const original='An outside opening sentence.\nThe selected claim needs evidence.\nAn outside closing sentence.\n';
  const root=fixture(t,{'draft.md':original});gitFixture(root);
  const {request}=core.prepare(root,{file:'draft.md',focus:[focus('draft.md',2)]});
  const valid=response(request), before=protectedEvidence(root,['draft.md']);
  const installed=core.importResponse(root,request.id,JSON.stringify(valid));
  const immutable=fs.readFileSync(path.join(root,`.reviews/sessions/${installed.id}.json`));
  const outside=request.blocks.find(b=>b.role==='context');
  for(const bad of [
    {...valid.comments[0],block_id:outside.id,quote:outside.text.trim()},
    {...valid.comments[0],quote:'evidence.\nAn outside'},
    {...valid.comments[0],quote:original.trim()},
  ]) {
    assert.throws(()=>core.importResponse(root,request.id,JSON.stringify({...valid,comments:[valid.comments[0],bad]})),/No review installed/);
    assert.deepEqual(core.listSessions(root),[installed.id]);assert.deepEqual(protectedEvidence(root,['draft.md']),before);
  }
  assert.deepEqual(fs.readFileSync(path.join(root,`.reviews/sessions/${installed.id}.json`)),immutable);
  fs.writeFileSync(path.join(root,'draft.md'),'User inserted a new line.\n'+original);
  const edited=protectedEvidence(root,['draft.md']);
  const imported=core.importResponse(root,request.id,JSON.stringify(valid));
  assert.equal(imported.focus[0].start_line,2);
  assert.equal(imported.comments[0].anchor.start,original.indexOf('The selected'));
  const attachment=core.attach(imported.comments[0].anchor,original,new Map([['draft.md',fs.readFileSync(path.join(root,'draft.md'),'utf8')]]));
  assert.equal(attachment.status,'attached');assert.ok(attachment.start>imported.comments[0].anchor.start);
  assert.deepEqual(protectedEvidence(root,['draft.md']),edited);
});

test('tampered focus metadata, block eligibility, offsets, version downgrade, and session scope are rejected', t => {
  const root=fixture(t,{'draft.md':'Outside opening text.\nA selected claim needs supporting evidence.\nOutside closing text.\n'});
  const {request}=core.prepare(root,{file:'draft.md',focus:[focus('draft.md',2)]});
  const reqPath=path.join(root,`.reviews/requests/${request.id}/request.json`);
  const mutate = fn => {const copy=structuredClone(request);fn(copy);fs.writeFileSync(reqPath,core.json(copy));assert.throws(()=>core.loadRequest(root,request.id));fs.writeFileSync(reqPath,core.json(request));};
  mutate(r=>r.focus[0].start++);mutate(r=>r.focus[0].start_line=1);mutate(r=>r.focus[0].extra='unsupported');
  mutate(r=>r.focus=[]);mutate(r=>r.schema_version=1);mutate(r=>delete r.focus);
  mutate(r=>r.blocks.find(b=>b.role==='context').role='source');
  mutate(r=>{const text=r.blocks.map(b=>b.text).join('');r.blocks=[{...r.blocks[0],text,start:0,end:text.length,role:'context'}];});
  const session=core.importResponse(root,request.id,JSON.stringify(response(request)));
  const sessionPath=path.join(root,`.reviews/sessions/${session.id}.json`);session.focus[0].end_line=3;fs.writeFileSync(sessionPath,core.json(session));
  assert.throws(()=>core.loadSession(root,session.id),/Session\/request mismatch/);
});

test('line focus does not bypass file limits or symlink protections and keeps legacy reviews readable', t => {
  const root=fixture(t), outside=fixture(t);core.init(root);
  const old=core.prepare(root,{file:'draft.md'});const session=core.importResponse(root,old.request.id,JSON.stringify(response(old.request)));
  assert.equal(old.request.schema_version,1);assert.equal(session.schema_version,1);assert.equal(session.focus,undefined);assert.deepEqual(core.loadSession(root,session.id),session);
  fs.symlinkSync(path.join(outside,'draft.md'),path.join(root,'link.md'));
  assert.throws(()=>core.prepare(root,{file:'link.md',focus:[focus('link.md',1)]}),/Symlink/);
  fs.writeFileSync(path.join(root,'.reviews/config.json'),core.json({...core.defaults,limits:{...core.defaults.limits,file_bytes:10}}));
  assert.throws(()=>core.prepare(root,{file:'draft.md',focus:[focus('draft.md',1)]}),/limit/);
});

test('CLI supports repeated/comma-separated lines and explicit project file focus through prepare/import', t => {
  const root=fixture(t,{'draft.md':'First argument merits a focused discussion.\nSecond argument stays context.\nThird argument merits a focused discussion.\n','section.typ':'A separate section provides the rationale.\n'});
  const cli=path.resolve('packages/cli/dist/main.js');
  const run=args=>spawnSync(process.execPath,[cli,...args,'--json'],{cwd:root,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});
  const wrongRoot=run(['review','.demo/markdown/draft.md','--lines','3','--provider','codex']);
  assert.equal(wrongRoot.status,1);assert.match(wrongRoot.stderr,/Use --root DIR/);
  const prepared=run(['prepare','draft.md','--lines','1','--lines','3']);assert.equal(prepared.status,0,prepared.stderr);
  const data=JSON.parse(prepared.stdout);assert.equal(data.focus.length,2);assert.match(prepared.stderr,/full selected files remain in the packet/);
  const req=core.loadRequest(root,data.request_id);fs.writeFileSync(path.join(root,'response.json'),JSON.stringify(response(req)));
  const imported=run(['import',req.id,'response.json']);assert.equal(imported.status,0,imported.stderr);assert.deepEqual(JSON.parse(imported.stdout).focus,data.focus);
  const reviewed=run(['review','draft.md','--lines','1,3','--provider','mock']);assert.equal(reviewed.status,0,reviewed.stderr);
  fs.writeFileSync(path.join(root,'.reviews/config.json'),core.json({...core.defaults,files:['draft.md','section.typ']}));
  const project=run(['review','--project','--focus','draft.md:1','--focus','section.typ:1','--provider','mock']);assert.equal(project.status,0,project.stderr);
  assert.equal(core.loadSession(root,JSON.parse(project.stdout).review_id).comments.length,2);
  for(const args of [['prepare','--project','--lines','1'],['prepare','draft.md','--lines','0'],['prepare','draft.md','--lines','99'],['prepare','--project','--focus','section.typ'],['import',req.id,'response.json','--lines','1']]) assert.equal(run(args).status,1);
});
