const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {fixture,protectedEvidence,gitFixture} = require('./helpers.cjs');
const {doctor,connectionProbeScript,parseConnectionResult,ignoredEnvironment} = require('../packages/cli/dist/doctor');

test('connection probes use fixed unauthenticated HEAD requests and report only phase/status/code', () => {
  for (const mode of ['success','dns','tls','timeout','unknown']) {
    let output='', deadline, destroyed=0, options;
    const request=new EventEmitter(), socket=new EventEmitter();
    request.destroy=()=>{destroyed++;};
    const https={request:(args, callback)=>{
      options=args;
      request.end=()=>{
        request.emit('socket',socket);
        if(mode==='dns') { request.emit('error',{code:'ENOTFOUND',message:'SECRET'});return; }
        socket.emit('lookup',null);socket.emit('connect');
        if(mode==='tls') { request.emit('error',{code:'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',message:'SECRET'});return; }
        if(mode==='timeout') { deadline(); return; }
        if(mode==='unknown') { request.emit('error',{code:'SECRET',message:'SECRET'});return; }
        socket.emit('secureConnect');callback({statusCode:403,destroy:()=>{destroyed++;}});
        request.emit('error',{code:'SECRET'}); // A later socket error cannot replace the result.
      };
      return request;
    }};
    vm.runInNewContext(connectionProbeScript,{require:name=>{assert.equal(name,'node:https');return https;},process:{argv:['node','chatgpt.com'],stdout:{write:s=>output+=s}},setTimeout:cb=>{deadline=cb;return 1;},clearTimeout:()=>{}});
    assert.equal(options.hostname,'chatgpt.com');assert.equal(options.method,'HEAD');assert.equal(options.path,'/');
    assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);
    assert.equal(options.headers,undefined);assert.equal(options.auth,undefined);
    const result=parseConnectionResult(output);
    assert.equal(result.phase,mode==='success'?'http':mode==='dns'?'dns':'tls');
    if(mode==='success') {assert.equal(result.status,403);assert.equal(destroyed,2);}
    if(mode==='timeout') {assert.equal(result.code,'ETIMEDOUT');assert.equal(destroyed,1);}
    if(mode==='unknown') assert.equal(result.code,'UNKNOWN');
    assert.ok(!output.includes('SECRET'));
  }
});

test('probe reports reject extra fields, unsafe codes, and invalid statuses', () => {
  for(const result of [null,[],{phase:'http',status:600},{phase:'http',status:200,body:'SECRET'},{phase:'tls',code:'SECRET'},{phase:'dns',status:200},{phase:'http',code:'ECONNRESET',status:200}]) assert.throws(()=>parseConnectionResult(JSON.stringify(result)));
  assert.throws(()=>parseConnectionResult('not json'));
  assert.deepEqual(ignoredEnvironment({HTTPS_PROXY:'SECRET',CODEX_CA_CERTIFICATE:'SECRET',UNRELATED:'SECRET'}),['HTTPS_PROXY','CODEX_CA_CERTIFICATE']);
});

test('doctor compares the same cleared environment with and without Seatbelt, cleans temp and preserves source/index', {skip:process.platform!=='darwin'}, async t => {
  const root=fixture(t);gitFixture(root);const before=protectedEvidence(root,['draft.md']), calls=[];
  const report=await doctor(root,{run:async(executable,args,options)=>{
    calls.push({executable,args,options});
    assert.notEqual(options.cwd,root);assert.ok(options.timeoutMs<=10000);assert.ok(options.outputBytes<=16384);
    assert.equal(options.env.OPENAI_API_KEY,undefined);assert.equal(options.env.NODE_OPTIONS,undefined);assert.equal(options.env.HTTPS_PROXY,undefined);
    assert.deepEqual(fs.readdirSync(options.env.CODEX_HOME),[]); // No authentication copy.
    if(executable==='/usr/bin/sw_vers') return {stdout:'26.6.2\n',stderr:''};
    if(args.includes('--version')) return {stdout:'codex-cli 0.154.0\n',stderr:''};
    assert.ok(args.includes(connectionProbeScript));assert.ok(['chatgpt.com','api.openai.com'].includes(args.at(-1)));
    if(executable==='/usr/bin/sandbox-exec') {
      assert.match(args[1],/deny file-write/);assert.ok(args[1].includes(root));
      return {stdout:JSON.stringify({phase:'tls',code:'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'}),stderr:''};
    }
    return {stdout:'{"phase":"http","status":401}',stderr:''};
  }});
  assert.equal(report.macos,'26.6.2');assert.equal(report.connections.length,4);
  assert.ok(report.hints.some(h=>h.includes('points toward the outer sandbox')));
  assert.ok(!JSON.stringify(report).includes(root));
  for(const {options} of calls) assert.ok(!fs.existsSync(options.env.TMPDIR));
  assert.deepEqual(protectedEvidence(root,['draft.md']),before);assert.ok(!fs.existsSync(path.join(root,'.reviews')));
});

test('doctor bounds failed probes, omits raw errors, and cleans up after cancellation', {skip:process.platform!=='darwin'}, async t => {
  const root=fixture(t), temps=[];
  const report=await doctor(root,{run:async(executable,args,options)=>{temps.push(options.env.TMPDIR);throw new Error('Provider timed out: SECRET');}});
  assert.ok(report.connections.every(c=>c.phase==='process'&&c.code==='ETIMEDOUT'));assert.ok(!JSON.stringify(report).includes('SECRET'));
  const controller=new AbortController();
  await assert.rejects(doctor(root,{signal:controller.signal,run:async(executable,args,options)=>{temps.push(options.env.TMPDIR);controller.abort();throw new Error('SECRET');}}),/aborted/);
  for(const temp of temps) assert.ok(!fs.existsSync(temp));
});
