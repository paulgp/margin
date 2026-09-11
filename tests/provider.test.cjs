const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture,core,protectedEvidence,gitFixture} = require('./helpers.cjs');
const {runCodex,runProcess,codexArgs,verifyRuntime,verifyFeatureSettings,disabledFeatures,supportedVersion,seatbeltProfile,eventProgress,providerIssue} = require('../packages/cli/dist/codex');
const help = '--ignore-user-config --ignore-rules --sandbox --output-schema --output-last-message --ephemeral --strict-config --json';
const features = [...disabledFeatures,'skip_host_skill_discovery'].map(f=>`${f} stable false`).join('\n');

function fake(t, mode, authorRoot) {
  const root = fixture(t,{}), file = path.join(root,'fake-codex');
  const script = `#!${process.execPath}\nconst fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const args=process.argv.slice(2), mode=${JSON.stringify(mode)};
if(args.includes('--version')){console.log(mode==='version'?'codex-cli 0.1.0':${JSON.stringify('codex-cli '+supportedVersion)});process.exit(0);}
if(args.includes('--help')){console.log(mode==='flags'?'unsupported':${JSON.stringify(help)});process.exit(0);}
if(args.includes('features')){console.log(args.includes('-c')?${JSON.stringify(features.replace('skip_host_skill_discovery stable false','skip_host_skill_discovery stable true'))}:${JSON.stringify(features)});process.exit(0);}
if(mode==='failure'){console.error('authentication rejected (fake)');process.exit(12);}
if(mode==='timeout'){setInterval(()=>{},1000);return;}
if(mode==='retry-timeout'){console.log(JSON.stringify({type:'error',message:'Reconnecting after error sending request: SECRET'}));setInterval(()=>{},1000);return;}
if(mode==='overflow'){process.stdout.write('x'.repeat(3*1024*1024));setInterval(()=>{},1000);return;}
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{
  assert.ok(input.includes('SOURCE DATA')); assert.ok(input.includes('Request: request-'));
  assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('--ignore-rules'));assert.ok(args.includes('--strict-config'));
  assert.ok(args.includes('--json'));console.log(JSON.stringify({type:'turn.started'}));
  assert.equal(args[args.indexOf('--sandbox')+1],'read-only');assert.ok(args.includes('approval_policy="never"'));
  for(const flag of ${JSON.stringify(disabledFeatures)})assert.ok(args.includes('features.'+flag+'=false'));
  assert.ok(!process.env.MARGIN_TEST_SECRET);assert.ok(!process.env.NODE_OPTIONS);
  assert.notEqual(process.cwd(),${JSON.stringify(authorRoot)});
  assert.ok(process.env.CODEX_HOME.startsWith(process.env.HOME));
  assert.deepEqual(fs.readdirSync(process.env.CODEX_HOME),['auth.json']);
  assert.throws(()=>fs.writeFileSync(${JSON.stringify(path.join(authorRoot,'draft.md'))},'ATTACK'));
  assert.throws(()=>fs.readFileSync(${JSON.stringify(path.join(authorRoot,'draft.md'))}));
  const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));
  const out=args[args.indexOf('--output-last-message')+1];
  const response={schema_version:1,request_id:schema.properties.request_id.const,summary:'Fake executable, verified protected arguments and OS read/write denials.',comments:[]};
  if(mode==='missing')return;
  if(mode==='symlink'){fs.symlinkSync(${JSON.stringify(path.join(authorRoot,'draft.md'))},out);return;}
  fs.writeFileSync(out,mode==='malformed'?'not json':JSON.stringify(response));
  console.log('progress log deliberately NOT JSON');
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'PRIVATE MODEL TEXT'}}));
  console.log(JSON.stringify({type:'turn.completed'}));
});\n`;
  fs.writeFileSync(file,script,{mode:0o755});
  const authHome = path.join(root,'auth'); fs.mkdirSync(authHome);fs.writeFileSync(path.join(authHome,'auth.json'),'{}');
  return {executable:file,authHome};
}

test('safe arguments and incompatible runtime controls fail closed', () => {
  const args = codexArgs('/tmp/schema','/tmp/out','/tmp/work','example-model');
  assert.ok(args.includes('read-only'));assert.ok(args.includes('approval_policy="never"'));
  assert.ok(!args.some(a=>/full-auto|workspace-write|danger-full|bypass/.test(a)));
  assert.equal(args.at(-1),'-');assert.ok(args.includes('--json'));
  verifyRuntime('codex-cli '+supportedVersion,help,features);
  assert.throws(()=>verifyRuntime('codex-cli 0.153.0',help,features),/Unsupported/);
  assert.throws(()=>verifyRuntime('codex-cli '+supportedVersion,'',features),/unavailable/);
  assert.throws(()=>verifyRuntime('codex-cli '+supportedVersion,help,''),/feature unavailable/);
  assert.throws(()=>verifyFeatureSettings(features),/discovery/);
  assert.throws(()=>verifyFeatureSettings(features.replace('plugins stable false','plugins stable true')),/control/);
  assert.throws(()=>codexArgs('a','b','c','$(touch prose)'),/model identifier/);
  assert.match(seatbeltProfile('/private/tmp/margin-test','/bin/test'),/deny file-write/);
});

test('progress events expose lifecycle and failure classes without printing prose or secrets', () => {
  assert.match(eventProgress('{"type":"turn.started"}').message,/awaiting model/);
  assert.match(eventProgress('{"type":"turn.completed"}').message,/completed/);
  assert.deepEqual(eventProgress('not JSON'),{});
  assert.deepEqual(eventProgress('{"type":"item.completed","item":{"type":"reasoning","text":"SECRET"}}'),{});
  assert.ok(!JSON.stringify(eventProgress('{"type":"item.completed","item":{"type":"agent_message","text":"SECRET"}}')).includes('SECRET'));
  assert.equal(eventProgress('{"type":"error","message":"401 token SECRET"}').issue,'Codex reported an authentication or authorization problem.');
  assert.match(providerIssue('error sending request: SECRET'),/connection/);
  assert.match(providerIssue('Invalid response schema'),/schema/);
});

test('streaming progress arrives before exit, handles split UTF-8, and flushes unterminated lines', async t => {
  const cwd=fixture(t,{}), lines=[];
  const source='const b=Buffer.from("🦉\\nlast");process.stdout.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(2));process.stderr.write("error\\n");},20);';
  const result=await runProcess(process.execPath,['-e',source],{cwd,env:{PATH:process.env.PATH},onLine:(line,stream)=>lines.push([line,stream])});
  assert.equal(result.stdout,'🦉\nlast');
  assert.ok(lines.some(([s,p])=>s==='🦉'&&p==='stdout'));assert.ok(lines.some(([s,p])=>s==='last'&&p==='stdout'));assert.ok(lines.some(([s,p])=>s==='error'&&p==='stderr'));
});

test('subprocess bounds, cancellation, missing executable, failure and Unicode output', async t => {
  const cwd=fixture(t,{}), env={PATH:process.env.PATH};
  assert.equal((await runProcess(process.execPath,['-e','process.stdout.write("🦉")'],{cwd,env})).stdout,'🦉');
  await assert.rejects(runProcess('/definitely/missing-codex',[],{cwd,env}),/Cannot start/);
  await assert.rejects(runProcess(process.execPath,['-e','process.stderr.write("failure");process.exit(4)'],{cwd,env}),/exited 4/);
  await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd,env,timeoutMs:30}),/timed out/);
  await assert.rejects(runProcess(process.execPath,['-e','process.stdout.write("x".repeat(100000))'],{cwd,env,outputBytes:20}),/byte limit/);
  const controller=new AbortController(); const p=runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd,env,signal:controller.signal});controller.abort();await assert.rejects(p,/cancelled/);
  await assert.rejects(runProcess(process.execPath,[],{cwd,env,signal:controller.signal}),/cancelled/);
});

for (const mode of ['success','version','flags','failure','timeout','overflow','missing','malformed','symlink']) test(`Codex adapter fake executable: ${mode}, with real OS sandbox`, {skip:process.platform!=='darwin'}, async t => {
  const root=fixture(t);gitFixture(root);const {request}=core.prepare(root,{file:'draft.md'});
  const before=protectedEvidence(root,['draft.md']);const options=fake(t,mode,root);
  if(mode==='success') {
    const progress=[];
    const result=await runCodex(request,{...options,onProgress:message=>progress.push(message)});assert.match(result.response,/Fake executable/);assert.equal(result.provenance.reported_model,null);
    assert.ok(progress.some(m=>m.includes('awaiting model')));assert.ok(progress.some(m=>m.includes('validation')));assert.ok(!progress.join('').includes('PRIVATE MODEL TEXT'));
    assert.equal(core.importResponse(root,request.id,result.response,result.provenance).comments.length,0);
  } else if(mode==='malformed') {
    const result=await runCodex(request,options);assert.throws(()=>core.importResponse(root,request.id,result.response,result.provenance),/No review installed/);
  } else await assert.rejects(runCodex(request,{...options,...(mode==='timeout'?{timeoutMs:80}:{})}),mode==='version'?/Unsupported/:mode==='flags'?/unavailable/:mode==='failure'?/authentication rejected/:mode==='timeout'?/timed out/:mode==='overflow'?/byte limit/:mode==='missing'?/no final response/:/regular file/);
  assert.deepEqual(protectedEvidence(root,['draft.md']),before);
});

test('Codex timeout retains its last diagnostic class without exposing raw event contents', {skip:process.platform!=='darwin'}, async t => {
  const root=fixture(t);const {request}=core.prepare(root,{file:'draft.md'}), options=fake(t,'retry-timeout',root);
  await assert.rejects(runCodex(request,{...options,timeoutMs:300}),error=>/timed out/.test(error.message)&&/connection problem/.test(error.message)&&!error.message.includes('SECRET'));
});

test('Codex adapter cancellation and missing auth preserve source/index', {skip:process.platform!=='darwin'}, async t => {
  const root=fixture(t);gitFixture(root);const {request}=core.prepare(root,{file:'draft.md'}); const before=protectedEvidence(root,['draft.md']);
  const options=fake(t,'timeout',root), controller=new AbortController();
  const promise=runCodex(request,{...options,signal:controller.signal});setTimeout(()=>controller.abort(),200);await assert.rejects(promise,/cancelled|aborted/i);
  if(!process.env.OPENAI_API_KEY)await assert.rejects(runCodex(request,{...options,authHome:path.join(root,'absent')}),/authentication unavailable/);
  assert.deepEqual(protectedEvidence(root,['draft.md']),before);
});
