const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const tls = require('node:tls');
const {X509Certificate} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {fixture} = require('./helpers.cjs');
const {publicCertificateBundle,installPublicCertificates} = require('../packages/cli/dist/certificates');
const {runProcess,seatbeltProfile,protectedEnvironment} = require('../packages/cli/dist/codex');

test('the public CA bundle contains exactly the public roots shipped with Node, without ambient CA configuration', () => {
  const bundle=publicCertificateBundle();
  const pem=bundle.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  assert.equal(pem.length,bundle.count);
  const fingerprints=certs=>new Set(certs.map(cert=>new X509Certificate(cert).fingerprint256));
  assert.deepEqual(fingerprints(pem),fingerprints(tls.rootCertificates));
  assert.ok(pem.every(cert=>new X509Certificate(cert).ca));
  assert.equal(publicCertificateBundle([tls.rootCertificates[0],tls.rootCertificates[0]]).count,1);
  assert.throws(()=>publicCertificateBundle([]),/count/);
  assert.throws(()=>publicCertificateBundle(['-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----']),/invalid certificate/);
  assert.throws(()=>publicCertificateBundle([tls.rootCertificates[0]+'\n-----BEGIN PRIVATE KEY-----\nSECRET']),/certificates only/);
  assert.throws(()=>publicCertificateBundle([tls.rootCertificates[0]+'SECRET']),/certificates only/);
  assert.throws(()=>publicCertificateBundle(['x'.repeat(2*1024*1024+1)]),/2 MiB/);
});

test('CA installation is private and cannot overwrite files or follow a destination symlink', t => {
  const temp=fixture(t,{}), target=installPublicCertificates(temp);
  assert.equal(fs.statSync(target.file).mode&0o777,0o600);
  const before=fs.readFileSync(target.file);
  assert.throws(()=>installPublicCertificates(temp),/EEXIST/);
  assert.deepEqual(fs.readFileSync(target.file),before);
  fs.unlinkSync(target.file);
  const source=path.join(temp,'source.md');fs.writeFileSync(source,'unchanged');fs.symlinkSync(source,target.file);
  assert.throws(()=>installPublicCertificates(temp),/EEXIST/);assert.equal(fs.readFileSync(source,'utf8'),'unchanged');
});

test('TLS in actual Seatbelt accepts a selected CA but rejects an untrusted issuer and wrong hostname', {skip:process.platform!=='darwin'}, async t => {
  const author=fs.realpathSync(fixture(t,{})), isolated=fs.realpathSync(fixture(t,{}));
  const openssl=(...args)=>execFileSync('/usr/bin/openssl',args,{cwd:author,stdio:'ignore',env:{PATH:'/usr/bin:/bin',HOME:author}});
  // Short-lived keys are generated in disposable test fixtures; none are production credentials.
  fs.writeFileSync(path.join(author,'ca.cnf'),'[req]\ndistinguished_name=dn\n[dn]\n[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  fs.writeFileSync(path.join(author,'leaf.cnf'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n');
  openssl('req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=Margin Disposable Test CA','-keyout','ca.key','-out','ca.pem','-config','ca.cnf','-extensions','v3_ca');
  openssl('req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=localhost','-keyout','leaf.key','-out','leaf.csr','-config','ca.cnf');
  openssl('x509','-req','-in','leaf.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-days','2','-out','leaf.pem','-extfile','leaf.cnf');
  const ca=fs.readFileSync(path.join(author,'ca.pem'),'utf8'), leaf=fs.readFileSync(path.join(author,'leaf.pem'),'utf8');
  assert.throws(()=>publicCertificateBundle([leaf]),/non-CA/);
  const server=https.createServer({key:fs.readFileSync(path.join(author,'leaf.key')),cert:leaf},(req,res)=>{res.writeHead(204);res.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const bundled=installPublicCertificates(isolated);
  const selected=path.join(isolated,'test-only-ca.pem');fs.writeFileSync(selected,publicCertificateBundle([ca]).pem,{mode:0o600});
  const env=protectedEnvironment(isolated), node=fs.realpathSync(process.execPath), profile=seatbeltProfile(isolated,node,author);
  const code=String.raw`
const https=require('node:https'),fs=require('node:fs');
const request=https.request({host:'127.0.0.1',port:Number(process.argv[1]),servername:process.argv[2],path:'/',method:'HEAD',ca:fs.readFileSync(process.argv[3]),rejectUnauthorized:true,agent:false},response=>{console.log('HTTP '+response.statusCode);response.resume();});
request.on('error',error=>console.log(error.code));request.end();`;
  const connect=async(name,file)=>(await runProcess('/usr/bin/sandbox-exec',['-p',profile,node,'-e',code,String(server.address().port),name,file],{cwd:isolated,env,timeoutMs:5000})).stdout.trim();
  assert.equal(await connect('localhost',selected),'HTTP 204');
  assert.match(await connect('localhost',bundled.file),/UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED_CERT_IN_CHAIN/);
  assert.equal(await connect('wrong.invalid',selected),'ERR_TLS_CERT_ALTNAME_INVALID');
});
