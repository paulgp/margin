const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture,install,protectedEvidence,core,gitFixture} = require('./helpers.cjs');
test('replies, statuses and manual overrides persist independently; conflicts never overwrite', t => {
  const root = fixture(t); gitFixture(root); const {session} = install(root);
  const sessionPath = path.join(root,`.reviews/sessions/${session.id}.json`), immutable = fs.readFileSync(sessionPath);
  const before = protectedEvidence(root,['draft.md']); const loaded = core.loadState(root,session), c = session.comments[0];
  const original = structuredClone(c.anchor);
  loaded.state.comments[c.id].replies.push({id:core.id('reply'),body:'I am keeping the pause.',created_at:new Date().toISOString()});
  loaded.state.comments[c.id].status = 'resolved';
  const text = 'A manually selected new passage.\n';
  loaded.state.comments[c.id].override = core.manualOverride('draft.md',text,2,29,true);
  const saved = core.saveState(root,session,loaded.state,loaded.token);
  assert.deepEqual(core.loadState(root,session),saved);
  assert.throws(()=>core.saveState(root,session,loaded.state,loaded.token),/changed since/);
  for (const status of ['dismissed','open']) { const latest = core.loadState(root,session); latest.state.comments[c.id].status=status; core.saveState(root,session,latest.state,latest.token); assert.equal(core.loadState(root,session).state.comments[c.id].status,status); }
  const override = core.loadState(root,session).state.comments[c.id].override;
  const attachment = core.attach(override,override.source_text,new Map([['draft.md','Preface.\n'+text]])); assert.equal(attachment.status,'attached');
  assert.deepEqual(core.loadSession(root,session.id).comments[0].anchor,original);
  assert.deepEqual(fs.readFileSync(sessionPath),immutable);
  assert.deepEqual(protectedEvidence(root,['draft.md']),before);
  fs.writeFileSync(path.join(root,`.reviews/state/${session.id}.lock`),'');
  const latest=core.loadState(root,session); assert.throws(()=>core.saveState(root,session,latest.state,latest.token),/writer conflict/);
  assert.deepEqual(protectedEvidence(root,['draft.md']),before);
});
test('state symlinks and tampered manual evidence fail closed', t => {
  const root = fixture(t), outside=fixture(t,{'draft.md':'outside'}); const {session}=install(root);
  const {state}=core.loadState(root,session); const cid=session.comments[0].id;
  state.comments[cid].override=core.manualOverride('draft.md','new selection',0,3,false); state.comments[cid].override.quote='fake';
  assert.throws(()=>core.saveState(root,session,state,null),/evidence/);
  delete state.comments[cid].override;
  fs.mkdirSync(path.join(root,'.reviews/state'),{recursive:true});
  fs.symlinkSync(path.join(outside,'draft.md'),path.join(root,`.reviews/state/${session.id}.json`));
  assert.throws(()=>core.saveState(root,session,state,null),/Symlink/);
  assert.equal(fs.readFileSync(path.join(outside,'draft.md'),'utf8'),'outside');
});
