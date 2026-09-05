import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';

async function subject() {
  const file = new URL('../presenter-isolated-transport.mjs', import.meta.url);
  assert.ok(fs.existsSync(file), 'Missing transport preflight and structured diagnostics');
  return import(file.href);
}

test('nested causes and aggregate codes survive without tokens or signed URLs', async () => {
  const { serializeFailure } = await subject();
  const cause = Object.assign(new Error('connect https://u:p@example.test/x?key=hidden#secret bearer SECRET'), {code:'ECONNREFUSED',syscall:'connect'});
  const error = new TypeError('fetch failed', {cause:new AggregateError([cause], 'network')});
  error.headers = {Authorization:'SECRET'};
  const detail = serializeFailure(error, {stage:'integrity',secrets:['SECRET']});
  assert.equal(detail.cause.errors[0].code, 'ECONNREFUSED');
  assert.equal(detail.cause.errors[0].syscall, 'connect');
  assert.equal(detail.stage, 'integrity');
  assert.equal(detail.message, 'fetch failed');
  const text = JSON.stringify(detail);
  for (const secret of ['SECRET','hidden','u:p','headers','#secret']) assert.ok(!text.includes(secret));
  assert.match(text, /https:\/\/example.test\/x/);
});

test('cycles, deep errors, getters and long strings cannot break evidence serialization', async () => {
  const { serializeFailure } = await subject();
  const cyclic = new Error('x'.repeat(10000)); cyclic.cause = cyclic;
  const result = serializeFailure(cyclic);
  assert.equal(result.cause.truncated, true);
  assert.ok(result.message.length <= 2048);
  const hostile = {get message(){throw new Error('getter');}};
  assert.doesNotThrow(() => JSON.stringify(serializeFailure(hostile)));
  let deep = new Error('root'); for(let i=0;i<30;i++) deep = new Error('wrapped',{cause:deep});
  assert.ok(JSON.stringify(serializeFailure(deep)).length < 10000);
});

test('DNS failure keeps stage/code and does not create a socket', async () => {
  const { probeTransport } = await subject();
  const result = await probeTransport({hostname:'test.invalid'}, {
    lookup:async()=>{throw Object.assign(new Error('DNS unavailable'), {code:'ENOTFOUND'});},
    connect:()=>assert.fail('must not connect after DNS failure'),
  });
  assert.equal(result.ok, false); assert.equal(result.failure.stage,'dns');
  assert.equal(result.failure.code,'ENOTFOUND');
});

test('a total deadline also bounds a stalled DNS lookup', async () => {
  const { probeTransport } = await subject();
  const start=Date.now();
  const result=await probeTransport({hostname:'test.invalid',timeoutMs:30}, {lookup:()=>new Promise(()=>{})});
  assert.equal(result.failure.code,'ETIMEDOUT'); assert.equal(result.failure.stage,'dns');
  assert.ok(Date.now()-start<1000);
});

test('real loopback connection refusal is recorded as TCP failure', async () => {
  const { probeTransport } = await subject();
  const server=net.createServer(); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const port=server.address().port; await new Promise(r=>server.close(r));
  const result=await probeTransport({hostname:'127.0.0.1',port,timeoutMs:1000});
  assert.equal(result.ok,false); assert.equal(result.failure.stage,'tcp');
  assert.equal(result.failure.code,'ECONNREFUSED');
});

test('TLS hang is bounded and closes its socket without sending HTTP', async () => {
  const { probeTransport } = await subject();
  const sockets=new Set(); const received=[];
  const server=net.createServer(socket=>{sockets.add(socket);socket.on('data',data=>received.push(data));socket.on('close',()=>sockets.delete(socket));});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    const result=await probeTransport({hostname:'127.0.0.1',port:server.address().port,timeoutMs:100});
    assert.equal(result.ok,false); assert.equal(result.failure.stage,'tls');
    assert.equal(result.failure.code,'ETIMEDOUT');
    assert.ok(!Buffer.concat(received).toString().includes('GET '));
  } finally {for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
});

test('plain HTTP server cannot pass TLS preflight', async () => {
  const { probeTransport } = await subject();
  const sockets=new Set();
  const server=net.createServer(socket=>{sockets.add(socket);socket.resume();socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    const result=await probeTransport({hostname:'127.0.0.1',port:server.address().port,timeoutMs:1000});
    assert.equal(result.ok,false); assert.equal(result.failure.stage,'tls');
  } finally {for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
});

test('integrity uses real HTTP: exact 401/200, identity and complete hash set', async () => {
  const { checkIntegrity } = await subject();
  const expected={app_name:'test-app',run_id:'test-run',code_hashes:{'vision_service.app':'a'}};
  let calls=0; let payload=expected;
  const server=http.createServer((req,res)=>{calls++; if(req.headers.authorization!=='Bearer private'){res.writeHead(401);res.end();}else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(payload));}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await checkIntegrity(url,{token:'private',expected}),expected);
    assert.equal(calls,2);
    for(payload of [{...expected,run_id:'wrong'},{...expected,code_hashes:{}},{...expected,code_hashes:{'vision_service.app':'bad'}}]) {
      await assert.rejects(checkIntegrity(url,{token:'private',expected}));
    }
    assert.equal(calls,8);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('HTTP errors and redirects fail immediately without retry or leaking response body', async () => {
  const { checkIntegrity } = await subject();
  for(const status of [200,302,404,500]) {
    let calls=0;
    await assert.rejects(checkIntegrity('https://example.test',{token:'secret',expected:{},fetchImpl:async(_url,opts)=>{
      calls++;assert.equal(opts.redirect,'error');return new Response('sensitive body',{status});
    }}),error=>!error.message.includes('sensitive body'));
    assert.equal(calls,1);
  }
});

test('transport fetch error retains its cause and never retries', async () => {
  const { checkIntegrity,serializeFailure } = await subject(); let calls=0;
  await assert.rejects(checkIntegrity('https://example.test',{token:'secret',expected:{},fetchImpl:async()=>{
    calls++;throw new TypeError('fetch failed',{cause:Object.assign(new Error('timeout'),{code:'UND_ERR_CONNECT_TIMEOUT'})});
  }}),error=>serializeFailure(error).cause.code==='UND_ERR_CONNECT_TIMEOUT');
  assert.equal(calls,1);
});

// Local-only self-signed test identity; never used by production operations.
const localTlsIdentity = {
  "key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDen+Z120g1zRpp\nQOLiRBsIyxEw1c0ln78J1EKzUdQHOGTo8tywwNoqKoK6XCGB/FhPrspmiBrYLJ3G\nUPRimSyMxUaONKZDdCqTA513sSvLJUCzMeqcQF/95EqipFkRyVTvMTkg2tW7O3MB\nGWDlXt8lB9cQwxTnxJ/tVNFQdQYuCkBffEh/A+9okg5BJebkpJ1SHZuLLhDX0rt5\n8ijucleSkuCwzYAGKMVVOm7Gn7eLvnEbAOnaPBp4RBNoc7RYLAXjGaGy8blmdWIz\n3yqQgfoIXn1yAdTaj/a+P7V7GRiZidp427Lnhe3oMLuvK43v3d6mFkrIZxEOlDLd\nT8o6o3g7AgMBAAECggEALpV0Am5fpk5kO+kFcMZCh+0CDF94nWpXbcWaLW6ueNJO\nn0YOcvfvzsn1b+yOYGY+znGrTZgmUdzIKPLQqH8XyN8Q2/ndXpkEvZ2QijarDMef\nSb/ksUxxKa3nBjBwqN2hpal9pEfWWGbgsjauxWA8PkHtOUcw7SyCMIXChNzv7Zr4\ngPSq8Vip6+FWPWsa6ecAXHcUzV4+nCsO/mxEHCrTI7X5pE+heGaRkAWPleCpPCnZ\n760k8j7ZgJZAnaEzPeHdo+uvY49fjr1cEevHOsalKf0MzoD8nt396Ymhscil7UHN\ncCU4dmVRK2n2GKPnOsWUbzlbopnuH0pNNW3Y2WXqlQKBgQD7fpGRngp8OgEaCdAI\nyCIVYGA82bJLYccli3yZus2Y2xo9gcqNOzJs6jO7vnJDF8j1O2rXxyRKd7Gb+LdS\nTsqKZ6BXs83FnDd40bqychtkIQ5zmL+r6T645i9EsJHZpA0yLfZlkfQYEAGwVqaF\n3jYZTLpRPrRqXMY8Erwv5LTE5QKBgQDinOz+ZQcqbG+Ej0XOoruEykIvk634IuVh\nDjLn1l8Uol/jAzsHxldfIwNYsy3CxHPc0uGd3FNgasJAjjbiDvXfLAlXmdEAAYS/\n+4AwuRV8FWY4NX/kTdnphXMHp/CfElCinljMH5PNtdnyf0O5kV/NjEBbxK1mvn2e\nPJHvrhOWnwKBgQDKObof128i+RlNsLpBdXxCqB56j6qYhuU1wXXNv7H2yafN8YHI\nEuO3RJOY0cjbPlLvLnn5TD5YSurcOiBe5NBkfnMmUoSR881/L1Xqi2qPFy2hsh/d\nwk4XK7CykTCWSx35TZAlmDko6CYTf3mjh00FBveCwOMd67/TKlV8RXE+KQKBgQC4\nz9JYBny5lIW+TjpYM09LFMi1lHMlExCO/s11VddlNKeOtGvIA3HuHNf11utTFHSJ\ne1KVM8Krt2WE0HbiFeFfiMJ1tvREVPi2uZ3qHofvEmSzIq6Suwsk77jIXaZXlNA+\nT3WLw5T/B3gf1Lqe9Hh1YhR6wwPH70LzceJy3j0LcQKBgBGK4UDlRjGrIbrBvRi3\nsg6YHo0sS5E2J/EEmIn/Z1JpUL27iisr3pq0zfhKaiIKefdiBA1goRQl+CaKvP2Z\nm0tSLsTvsTSq6xl+/hZ+yiuwlRUrc6+kvDv5L9kdBdDoJdT/e3WNpIOW7HjSA2F6\n0YKy1acfjCYnafRG1qlbARql\n-----END PRIVATE KEY-----\n",
  "cert": "-----BEGIN CERTIFICATE-----\nMIICzjCCAbagAwIBAgIBATANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAlsb2Nh\nbGhvc3QwIBcNMjAwMTAxMDAwMDAwWhgPMjEyMDAxMDEwMDAwMDBaMBQxEjAQBgNV\nBAMMCWxvY2FsaG9zdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAN6f\n5nXbSDXNGmlA4uJEGwjLETDVzSWfvwnUQrNR1Ac4ZOjy3LDA2ioqgrpcIYH8WE+u\nymaIGtgsncZQ9GKZLIzFRo40pkN0KpMDnXexK8slQLMx6pxAX/3kSqKkWRHJVO8x\nOSDa1bs7cwEZYOVe3yUH1xDDFOfEn+1U0VB1Bi4KQF98SH8D72iSDkEl5uSknVId\nm4suENfSu3nyKO5yV5KS4LDNgAYoxVU6bsaft4u+cRsA6do8GnhEE2hztFgsBeMZ\nobLxuWZ1YjPfKpCB+ghefXIB1NqP9r4/tXsZGJmJ2njbsueF7egwu68rje/d3qYW\nSshnEQ6UMt1PyjqjeDsCAwEAAaMpMCcwFAYDVR0RBA0wC4IJbG9jYWxob3N0MA8G\nA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAAiolPYi2im/3p9aaRfc\naRVNk59Hfdw4ZnE3+thWiMZVk7hO4kh7uPSG7FyI51zYMzBO5poego9R2ga46iuI\nuhw6obI/D+gFYsraIb/p4vTc/li6IALt59CHqL3+Ss+miNYEAJlOc6XpSTnRlGVl\nf3eayAA6kDdI/Qck5z7Wm8mE59WM4o9+CMeWL9AII0s9Qxpflmn6cgHfm27gU9+Q\nOy4BG6uVvtQA4MnokhiBiA/LE4pVNZxPiW7CHNqF1z+5nwfjy/nLdQEYWR28ASbg\npu1BsbQmNFc52DoH0pvcYr6Us0E7DspopBzprsrHxlYBMKL7QaVfgk96rSYrDuFN\n7pU=\n-----END CERTIFICATE-----\n"
};

test('trusted local TLS completes without sending an HTTP request', async () => {
  const { probeTransport } = await subject();
  const tls = await import('node:tls'); const sockets=new Set(); let bytes=0;
  const server=tls.createServer(localTlsIdentity,socket=>{sockets.add(socket);socket.on('data',data=>{bytes+=data.length;});socket.on('close',()=>sockets.delete(socket));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const result=await probeTransport({hostname:'localhost',port:server.address().port,timeoutMs:1000},{lookup:async()=>({address:'127.0.0.1',family:4}),upgrade:options=>tls.connect({...options,ca:localTlsIdentity.cert})});
    assert.equal(result.ok,true);assert.equal(result.applicationReady,false);
    assert.deepEqual(result.stages.map(s=>s.stage),['dns','tcp','tls']);assert.equal(bytes,0);
  } finally {for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
});

test('invalid integrity JSON never includes response content in diagnostics',async()=>{
  const {checkIntegrity,serializeFailure}=await subject();let calls=0;
  await assert.rejects(checkIntegrity('https://example.test',{token:'private',expected:{},fetchImpl:async()=>++calls===1?new Response(null,{status:401}):new Response('PRIVATE')}),error=>!JSON.stringify(serializeFailure(error)).includes('PRIVATE'));
});

test('SDK URL for another round is rejected before transmitting authorization',async()=>{
  const {checkedIsolatedUrl}=await subject();
  assert.throws(()=>checkedIsolatedUrl({app_name:'multimix-presenter-vision-e2e-20990101-r1',function_name:'fastapi_app',url:'https://multimix--multimix-presenter-vision-e2e-20990101-r2-fas-123456.modal.run'},'multimix-presenter-vision-e2e-20990101-r1'));
});
