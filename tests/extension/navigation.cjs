const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const core = require('../../packages/core/dist');
const wait = () => new Promise(resolve => setTimeout(resolve, 400));

exports.run = async (api, root, previousSession) => {
  const sources = {
    'navigation.md': 'The first claim needs evidence from an independent source.\n\nThe second argument asks a different question about timing.\n',
    'section.typ': 'The method begins with a comparison across independent cases.\nThis method supports the central argument with a distinct example.\nThe resulting evidence needs a separate interpretation.\n',
    'appendix.tex': 'The appendix supplies a distinct check on this reasoning.\n\nA supporting note remains in the appendix.\n',
  };
  for (const [file,text] of Object.entries(sources)) fs.writeFileSync(path.join(root,file),text);
  fs.writeFileSync(path.join(root,'.reviews/config.json'),core.json({...core.defaults,files:Object.keys(sources)}));
  const {request} = core.prepare(root,{project:true});
  const blocks = request.blocks.filter(b => b.text.trim()).slice(0,4);
  const response = {schema_version:1,request_id:request.id,summary:'Offline navigation fixture.',comments:blocks.map((b,i)=>({file:b.file,block_id:b.id,quote:b.file === 'section.typ' ? 'This method supports the central argument with a distinct example.' : b.text.trim(),category:'argument',body:`Navigation observation ${i+1}.`}))};
  const session = core.importResponse(root,request.id,JSON.stringify(response));
  const immutable = fs.readFileSync(path.join(root,`.reviews/sessions/${session.id}.json`));
  const ids = session.comments.map(c => c.id), [a,b,c,d] = ids;
  const command = (name,arg) => vscode.commands.executeCommand(`margin.${name}`,arg);
  const progress = open => {
    assert.deepEqual(api.inspect().progress,{open,total:4});
    assert.ok(api.inspect().statusText.includes(`${open} of 4 open`));
    assert.equal(api.inspect().treeDescription,`${open} of 4 open`);
  };
  await command('selectReview',{id:session.id}); progress(4);
  await command('previousOpen'); assert.equal(api.inspect().current,d,'previous without a current comment starts at the end');
  await command('nextOpen'); assert.equal(api.inspect().current,a,'next wraps to the beginning');
  assert.equal(api.inspect().threadStates[a],vscode.CommentThreadCollapsibleState.Expanded);
  await command('nextOpen'); assert.equal(api.inspect().current,b);
  assert.equal(api.inspect().threadStates[a],vscode.CommentThreadCollapsibleState.Collapsed);
  await Promise.all([command('nextOpen'),command('nextOpen')]);
  assert.equal(api.inspect().current,d,'rapid navigation commands advance in order');
  await command('resolve',{id:b}); await command('dismiss',{id:c}); progress(2);
  await command('nextOpen'); assert.equal(api.inspect().current,a);
  await command('previousOpen'); assert.equal(api.inspect().current,d);
  await command('reopen',{id:c}); progress(3);
  await command('filter','resolved'); assert.equal(api.inspect().items,1);
  await command('nextOpen'); assert.equal(api.inspect().current,a);
  assert.equal(api.inspect().filter,'open','open navigation makes its target visible through a closed-discussion filter');
  assert.equal(api.inspect().items,3); progress(3);

  // These edits simulate the user, and occur only in the temporary Development Host workspace.
  const markdown = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root,'navigation.md')));
  const preface = new vscode.WorkspaceEdit(); preface.insert(markdown.uri,new vscode.Position(0,0),'An unsaved preface.\n\n');
  await vscode.workspace.applyEdit(preface); await wait();
  await command('open',{id:a});
  assert.equal(markdown.offsetAt(vscode.window.activeTextEditor.selection.start),markdown.getText().indexOf(session.comments[0].anchor.quote));
  assert.match(api.inspect().statusText,/UNSAVED BUFFER/);
  const typst = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root,'section.typ')));
  const start = typst.getText().indexOf('supports');
  const rewrite = new vscode.WorkspaceEdit(); rewrite.replace(typst.uri,new vscode.Range(typst.positionAt(start),typst.positionAt(start+8)),'qualifies');
  await vscode.workspace.applyEdit(rewrite); await wait();
  assert.equal(api.inspect().attachments[2].status,'changed');
  const appendix = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root,'appendix.tex')));
  const target = api.inspect().attachments[3];
  const deletion = new vscode.WorkspaceEdit(); deletion.delete(appendix.uri,new vscode.Range(appendix.positionAt(target.start),appendix.positionAt(target.end)));
  await vscode.workspace.applyEdit(deletion); await wait();
  assert.equal(api.inspect().attachments[3].status,'unanchored'); progress(3);
  await command('nextOpen'); assert.equal(api.inspect().current,c);
  assert.equal(vscode.window.activeTextEditor.document.uri.fsPath,typst.uri.fsPath);
  await command('nextOpen'); assert.equal(api.inspect().current,d);
  assert.equal(vscode.window.activeTextEditor.document.uri.scheme,'margin');
  assert.equal(vscode.window.activeTextEditor.document.getText(),sources['appendix.tex']);
  await command('filter','all');
  await command('resolveAndNext'); assert.equal(api.inspect().current,a); progress(2);
  assert.equal(core.loadState(root,session).state.comments[d].status,'resolved');
  await command('dismissAndNext'); assert.equal(api.inspect().current,c); progress(1);
  assert.equal(api.inspect().threadStates[a],vscode.CommentThreadCollapsibleState.Collapsed);
  assert.equal(core.loadState(root,session).state.comments[a].status,'dismissed');

  // A concurrent state writer must prevent both the decision and automatic advancement.
  const stored = core.loadState(root,session);
  stored.state.comments[c].replies.push({id:core.id('reply'),body:'Concurrent local reply.',created_at:new Date().toISOString()});
  core.saveState(root,session,stored.state,stored.token);
  const lock = path.join(root,`.reviews/state/${session.id}.lock`);
  fs.writeFileSync(lock,'fixture writer',{flag:'wx'});
  try { await command('resolveAndNext'); } finally { fs.unlinkSync(lock); }
  assert.equal(api.inspect().current,c);
  assert.equal(api.inspect().threadStates[c],vscode.CommentThreadCollapsibleState.Expanded);
  assert.equal(core.loadState(root,session).state.comments[c].status,'open');
  await command('refresh');
  await command('resolveAndNext'); progress(0);
  assert.equal(api.inspect().current,c,'finishing the last open discussion does not open a closed comment');
  assert.equal(api.inspect().threadStates[c],vscode.CommentThreadCollapsibleState.Collapsed);
  await command('nextOpen'); progress(0);
  assert.equal(core.loadState(root,session).state.comments[c].replies[0].body,'Concurrent local reply.');
  await command('reopen',{id:a}); progress(1);
  await command('selectReview',{id:session.id}); progress(1);
  assert.equal(api.inspect().current,undefined,'session selection resets the disposable navigation cursor');
  await command('nextOpen'); assert.equal(api.inspect().current,a);
  // Queued navigation from the prior session must not set a cursor in the new one.
  await Promise.all([command('nextOpen'),command('nextOpen'),command('selectReview',{id:previousSession.id})]);
  assert.equal(api.inspect().session,previousSession.id);
  assert.equal(api.inspect().current,undefined);
  const empty = core.importResponse(root,request.id,JSON.stringify({...response,comments:[]}));
  await command('selectReview',{id:empty.id}); await command('nextOpen');
  assert.deepEqual(api.inspect().progress,{open:0,total:0});
  assert.equal(api.inspect().current,undefined);
  for (const [file,text] of Object.entries(sources)) assert.equal(fs.readFileSync(path.join(root,file),'utf8'),text,'navigation/status actions never save a draft');
  assert.deepEqual(fs.readFileSync(path.join(root,`.reviews/sessions/${session.id}.json`)),immutable);
  console.log('Margin navigation smoke passed: wrap/skip, rapid commands, file changes, detached targets, dirty buffers, filters/counts, resolve/dismiss and advance, conflicts, session switches, empty reviews.');
};
