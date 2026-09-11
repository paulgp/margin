const test = require('node:test');
const assert = require('node:assert/strict');
const {nextOpenComment, reviewProgress} = require('../packages/vscode/dist/navigation');

const session = {comments: ['a', 'b', 'c', 'd'].map(id => ({id}))};
const state = {comments: {a:{status:'open'}, b:{status:'resolved'}, c:{status:'dismissed'}, d:{status:'open'}}};

test('navigation starts at either end, skips closed discussions, and wraps in immutable review order', () => {
  for (const [current, direction, expected] of [[undefined,1,'a'], [undefined,-1,'d'], ['a',1,'d'], ['d',1,'a'], ['a',-1,'d'], ['d',-1,'a'], ['b',1,'d'], ['b',-1,'a'], ['missing',1,'a']]) {
    assert.equal(nextOpenComment(session,state,current,direction), expected);
  }
  assert.deepEqual(reviewProgress(session,state),{open:2,total:4});
});

test('one remaining comment can be revisited; zero comments or zero open discussions have no target', () => {
  const one = {comments:{...state.comments, d:{status:'dismissed'}}};
  assert.equal(nextOpenComment(session,one,'a',1),'a');
  assert.equal(nextOpenComment(session,one,'a',-1),'a');
  const closed = {comments:{...one.comments, a:{status:'resolved'}}};
  assert.equal(nextOpenComment(session,closed,'b',1),undefined);
  assert.deepEqual(reviewProgress(session,closed),{open:0,total:4});
  assert.equal(nextOpenComment({comments:[]},{comments:{}},undefined,-1),undefined);
  assert.deepEqual(reviewProgress({comments:[]},{comments:{}}),{open:0,total:0});
});

test('navigation uses discussion state only and does not reorder moved or detached targets', () => {
  const comments = session.comments.map((c,i) => ({...c, anchor:{path:['z.tex','a.typ','b.md','deleted.md'][i]}}));
  const allOpen = {comments:Object.fromEntries(comments.map(c => [c.id,{status:'open'}]))};
  let current; const visited = [];
  for (let i=0;i<comments.length;i++) {current=nextOpenComment({comments},allOpen,current,1);visited.push(current);}
  assert.deepEqual(visited,['a','b','c','d']);
  allOpen.comments.b.status='resolved';
  assert.equal(nextOpenComment({comments},allOpen,'a',1),'c');
  allOpen.comments.b.status='open';
  assert.equal(nextOpenComment({comments},allOpen,'a',1),'b');
});
