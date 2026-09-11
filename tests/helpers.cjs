const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const zlib = require('node:zlib');
const core = require('../packages/core/dist');
function fixture(t, files = {'draft.md':'# Title\n\nThe central claim needs evidence.\n\nA final paragraph makes room for doubt.\n'}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-test-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  for (const [file, contents] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive:true}); fs.writeFileSync(path.join(root,file), contents); }
  return root;
}
function response(request, overrides = {}) {
  const block = request.blocks.find(b => b.role === 'source' && b.text.trim().length > 20) ?? request.blocks[0];
  return {schema_version:1, request_id:request.id, summary:'An editorial letter.', comments:[{file:block.file, block_id:block.id, quote:block.text.trim(), category:'clarity', body:'What connects this observation to the claim?'}], ...overrides};
}
function install(root, file = 'draft.md') {
  const {request, snapshot} = core.prepare(root, {file});
  const session = core.importResponse(root, request.id, JSON.stringify(response(request)));
  return {request,snapshot,session};
}
function git(root, args) { return execFileSync('git', ['--no-optional-locks','-C',root,...args], {encoding:'utf8', env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}, stdio:['ignore','pipe','ignore']}).trim(); }
// Static Git fixture objects, not a git commit command; never touch the working repository.
function gitFixture(root) {
  git(root,['init','-q']);
  const object = (type, data) => {
    const bytes = Buffer.concat([Buffer.from(`${type} ${Buffer.byteLength(data)}\0`), Buffer.from(data)]);
    const id = createHash('sha1').update(bytes).digest('hex');
    const dir = path.join(root,'.git/objects',id.slice(0,2)); fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,id.slice(2)),zlib.deflateSync(bytes)); return id;
  };
  const tree = object('tree', Buffer.alloc(0));
  const head = object('commit', `tree ${tree}\nauthor Fixture <fixture@example.invalid> 0 +0000\ncommitter Fixture <fixture@example.invalid> 0 +0000\n\nStatic test evidence\n`);
  fs.mkdirSync(path.join(root,'.git/refs/heads'),{recursive:true});
  fs.writeFileSync(path.join(root,'.git/HEAD'),'ref: refs/heads/fixture\n'); fs.writeFileSync(path.join(root,'.git/refs/heads/fixture'),head+'\n');
  git(root,['add','--','draft.md']); // Populate the disposable fixture's index; runtime never stages.
  return head;
}
function protectedEvidence(root, files) {
  return {files:Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,f)).toString('base64')])), git:core.gitContext(root), index:fs.existsSync(path.join(root,'.git/index')) ? fs.readFileSync(path.join(root,'.git/index')).toString('base64') : null};
}
module.exports = {fixture,response,install,git,gitFixture,protectedEvidence,core};
