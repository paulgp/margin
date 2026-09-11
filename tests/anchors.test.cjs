const test = require('node:test');
const assert = require('node:assert/strict');
const {core} = require('./helpers.cjs');
const base = 'A specific opening establishes the subject.\n\nThe central claim needs evidence.\n\nThe final paragraph gives the reader a way forward.\n';
const quote = 'The central claim needs evidence.';
const anchor = core.evidence('draft.md',base,base.indexOf(quote),base.indexOf(quote)+quote.length);
const resolve = (current, a=anchor, original=base) => core.attach(a,original,new Map(Object.entries(current)));
const initial = resolve({'draft.md':base});

test('documented UTF-16 coordinates with emoji, BOM decoding, LF and CRLF', () => {
  const text = core.decode(Buffer.from('\ufeff🐈é\r\nA😀B\n'));
  assert.equal(text.length,10);
  assert.deepEqual(core.offsetPosition(text,5),{line:1,character:0});
  assert.deepEqual(core.offsetPosition(text,8),{line:1,character:3});
  assert.equal(text.slice(6,8),'😀');
  assert.throws(()=>core.offsetPosition(text,100),/outside/);
});

test('insert/delete before quote, paragraph moves, exact file renames and cross-file moves', () => {
  assert.equal(resolve({'draft.md':'New preface.\n\n'+base}).start,anchor.start+14);
  assert.equal(resolve({'draft.md':base.slice(20)}).start,anchor.start-20);
  const moved = quote+'\n\n'+base.replace(quote+'\n\n',''); assert.equal(resolve({'draft.md':moved}).start,0);
  const renamed = resolve({'renamed.md':base}); assert.equal(renamed.status,'attached'); assert.equal(renamed.path,'renamed.md');
  const result = resolve({'draft.md':'Unrelated replacement','sections/new.tex':base}); assert.equal(result.path,'sections/new.tex');
  assert.equal(resolve({'draft.md':'No matching quote here.'}).status,'unanchored');
});

test('rewritten spans changed with defensible mapping; deleted, wholesale replacements and duplicates unanchored', () => {
  const rewrite = resolve({'draft.md':base.replace(quote,'A different claim now needs supporting evidence.')});
  assert.equal(rewrite.status,'changed');
  assert.equal(resolve({'draft.md':base.replace(quote,'')}).status,'unanchored');
  assert.equal(resolve({'draft.md':'An entirely new paper.'}).status,'unanchored');
  assert.equal(resolve({'draft.md':base+base}).status,'unanchored');
  assert.equal(resolve({'one.md':base,'two.md':base}).status,'unanchored');
});

test('context disambiguates exact quote when evidence is distinctive', () => {
  const extra = '\n\nAn unrelated appendix with its own topic.\n'+quote+'\nIt has a different conclusion entirely.';
  const a = resolve({'draft.md':'A preface.\n'+base+extra}); assert.equal(a.status,'attached'); assert.equal(a.start,anchor.start+11);
});

test('deleting a reviewed copy does not attach to a different surviving historical copy', () => {
  const original = 'The first distinct topic introduces this claim.\n\n'+quote+'\n\nThe first topic concludes.\n\n'+'A second distinct topic appears far later.\n\n'+quote+'\n\nThe second topic concludes differently.';
  const first = core.evidence('draft.md',original,original.indexOf(quote),original.indexOf(quote)+quote.length);
  const current = original.replace(quote,'');
  assert.equal(resolve({'draft.md':current},first,original).status,'unanchored');
});

test('unique exact whole-file rename preserves identity even with repeated internal passages', () => {
  const original = base+base+base;
  const a = core.evidence('draft.md',original,base.length+anchor.start,base.length+anchor.end);
  const result = resolve({'renamed.md':original},a,original);
  assert.equal(result.status,'attached');assert.equal(result.start,a.start);assert.equal(result.path,'renamed.md');
  assert.equal(resolve({'one.md':original,'two.md':original},a,original).status,'unanchored');
});

test('importable coordinates cannot split surrogate pairs or CRLF', () => {
  assert.throws(()=>core.evidence('draft.md','A😀B',1,2),/split/);
  assert.throws(()=>core.evidence('draft.md','A\r\nB',0,2),/split/);
});

test('live insertion boundaries, overlap, deletion, undo/redo and multi-edit pre-event coordinates', () => {
  const map = edits => core.mapEdits(anchor,initial,base,edits);
  assert.equal(map([{rangeOffset:anchor.start,rangeLength:0,text:'PRE '}]).start,anchor.start+4);
  assert.equal(map([{rangeOffset:anchor.end,rangeLength:0,text:' POST'}]).end,anchor.end);
  assert.equal(map([{rangeOffset:anchor.start+4,rangeLength:0,text:'new '}]).status,'changed');
  assert.equal(map([{rangeOffset:anchor.start,rangeLength:quote.length,text:''}]).status,'unanchored');
  const edits = [{rangeOffset:base.length,rangeLength:0,text:'End.'},{rangeOffset:4,rangeLength:3,text:'expanded'},{rangeOffset:0,rangeLength:0,text:'😀'}];
  const after = core.applyEdits(base,edits), mapped = core.mapEdits(anchor,initial,base,edits,after);
  assert.equal(mapped.start,anchor.start+7); assert.equal(after.slice(mapped.start,mapped.end),quote);
  const replacement = [{rangeOffset:anchor.start+4,rangeLength:7,text:'different'}];
  const changedText = core.applyEdits(base,replacement), changed = core.mapEdits(anchor,initial,base,replacement);
  assert.equal(changed.status,'changed');
  const undo = [{rangeOffset:anchor.start+4,rangeLength:9,text:base.slice(anchor.start+4,anchor.start+11)}];
  const restored = core.mapEdits(anchor,changed,changedText,undo); assert.equal(restored.status,'attached');
  assert.equal(core.mapEdits(anchor,restored,base,replacement).status,'changed');
  assert.equal(core.mapEdits(anchor,initial,base,[], 'wrong text').status,'unanchored');
  assert.throws(()=>core.applyEdits(base,[{rangeOffset:1,rangeLength:10,text:''},{rangeOffset:3,rangeLength:2,text:''}]),/nonoverlapping/);
});

test('whole-document replacement uses conservative snapshot diff', () => {
  const current = 'Inserted introduction.\n'+base;
  assert.equal(resolve({'draft.md':current}).status,'attached');
  assert.equal(resolve({'draft.md':'Entirely rewritten'}).status,'unanchored');
});

test('stale asynchronous work cannot publish over newer editor/refresh generation', async () => {
  const generation = new core.Generation(); let published;
  const old = generation.next(); let release; const deferred = new Promise(r=>{release=r;});
  const calculation = (async()=>{await deferred;if(generation.isCurrent(old))published='old';})();
  const recent = generation.next(); if(generation.isCurrent(recent))published='new'; release(); await calculation;
  assert.equal(published,'new'); assert.equal(generation.isCurrent(old),false);
});
