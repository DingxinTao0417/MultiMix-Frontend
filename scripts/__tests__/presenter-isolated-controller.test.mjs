import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const file = new URL('../run-presenter-isolated-e2e.mjs',import.meta.url);
async function subject(){assert.ok(fs.existsSync(file),'Missing safe single-run controller');return import(file.href);}
const env={MULTIMIX_ALLOW_PAID_E2E:'true'};
function config(){return {runId:'lly-66-presenter-visual-smoke-20990101-r1',authorizationRef:'explicit-new-authorization'};}
function harness(overrides={}) {
  const events=[];let used=false;
  const ops={
    secrets:['PRIVATE'],token:'PRIVATE',
    validateInputs:async()=>{events.push('validate');},
    probe:async()=>{events.push('probe');return {ok:true,applicationReady:false};},
    probeStorage:async()=>{events.push('storage');return {ok:true,scope:'bucket-readiness',objectReadVerified:false};},
    baseline:async()=>{events.push('baseline');},
    consumeAuthorization:async()=>{events.push('fuse');if(used)throw Object.assign(new Error('already consumed'),{code:'EEXIST'});used=true;},
    deployVision:async()=>{events.push('vision');},deployRemotion:async()=>{events.push('remotion');},
    resolveUrl:async()=>{events.push('resolve');return 'https://isolated.test';},
    expectedIdentity:()=>({app_name:'test',run_id:'run',code_hashes:{module:'hash'}}),
    fetch:async(_url,options)=>{events.push(options.headers?'authenticated':'unauthenticated');return options.headers?new Response(JSON.stringify({app_name:'test',run_id:'run',code_hashes:{module:'hash'}})):new Response(null,{status:401});},
    runE2E:async()=>{events.push('e2e');},
    collectAndCleanupLocal:async()=>{events.push('local-cleanup');},
    stopTestApps:async()=>{events.push('stop');},verifyUnchanged:async()=>{events.push('verify');},
    save:async(name,data)=>{events.push(name);if(name==='execution-result.json')ops.saved=data;},
    ...overrides,
  };
  return {ops,events};
}

test('missing paid opt-in has no external or filesystem side effects',async()=>{
  const {runIsolatedPresenter}=await subject(); const {ops,events}=harness();
  await assert.rejects(runIsolatedPresenter(config(),{env:{},operations:ops}),/MULTIMIX_ALLOW_PAID_E2E/);
  assert.deepEqual(events,[]);
});
test('failed preflight does not consume authorization, deploy, or generate',async()=>{
  const {runIsolatedPresenter}=await subject();const {ops,events}=harness({probe:async()=>({ok:false,failure:{stage:'dns',code:'ENOTFOUND',message:'unavailable'}})});
  const result=await runIsolatedPresenter(config(),{env,operations:ops});
  assert.equal(result.failureDetail.stage,'transport-preflight');
  assert.equal(result.failureDetail.cause.code,'ENOTFOUND');
  for(const action of ['fuse','vision','remotion','e2e','stop','local-cleanup'])assert.ok(!events.includes(action));
});
test('Storage failure blocks authorization and deployment even when Modal TLS passes',async()=>{
  const {runIsolatedPresenter}=await subject();
  const {ops,events}=harness({probeStorage:async()=>({ok:false,objectReadVerified:false,failure:{code:'STORAGE_TLS_TIMEOUT',message:'Storage TLS timeout'}})});
  const result=await runIsolatedPresenter(config(),{env,operations:ops});
  assert.equal(result.startedPaid,false);
  assert.equal(result.failureDetail.stage,'storage-preflight');
  assert.equal(result.failureDetail.cause.code,'STORAGE_TLS_TIMEOUT');
  assert.ok(events.includes('storage-preflight.json'));
  for(const action of ['baseline','fuse','vision','remotion','e2e','stop','local-cleanup'])assert.ok(!events.includes(action));
});
test('happy single-run path strictly orders preflight, fuse, identity, generation and cleanup',async()=>{
  const {runIsolatedPresenter}=await subject();const {ops,events}=harness();
  const result=await runIsolatedPresenter(config(),{env,operations:ops});assert.equal(result.failure,null);
  const ordered=['validate','probe','storage','baseline','fuse','vision','remotion','resolve','unauthenticated','authenticated','e2e','local-cleanup','stop','verify','execution-result.json'];
  assert.deepEqual(events.filter(event=>ordered.includes(event)),ordered);
  assert.deepEqual(result.cleanupErrors,[]);
});
test('an already consumed authorization never deploys or stops unrelated apps',async()=>{
  const {runIsolatedPresenter}=await subject();const {ops,events}=harness({consumeAuthorization:async()=>{throw Object.assign(new Error('consumed'),{code:'EEXIST'});}});
  const result=await runIsolatedPresenter(config(),{env,operations:ops});assert.equal(result.failureDetail.code,'EEXIST');
  assert.ok(!events.includes('vision'));assert.ok(!events.includes('stop'));
});
test('each paid-stage failure cleans up without retry and preserves first cause',async()=>{
  const {runIsolatedPresenter}=await subject();
  for(const name of ['deployVision','deployRemotion','resolveUrl','runE2E']) {
    let calls=0;const {ops,events}=harness({[name]:async()=>{calls++;throw new TypeError('fetch failed',{cause:Object.assign(new Error('connect PRIVATE'),{code:'ECONNRESET'})});},collectAndCleanupLocal:async()=>{throw new Error('cleanup failed');}});
    const result=await runIsolatedPresenter(config(),{env,operations:ops});
    assert.equal(calls,1);assert.equal(result.failure,'fetch failed');assert.equal(result.failureDetail.cause.code,'ECONNRESET');
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.equal(result.cleanupErrors.length,1);
    assert.ok(events.includes('stop'));assert.ok(events.includes('verify'));
  }
});
test('bad HTTP auth or identity blocks E2E and still stops test apps',async()=>{
  const {runIsolatedPresenter}=await subject();
  for(const failure of ['unauthorized','authenticated','identity','hash']) {
    let calls=0;const {ops,events}=harness({fetch:async(_url,options)=>{
      calls++;if(!options.headers)return new Response(null,{status:failure==='unauthorized'?404:401});
      if(failure==='authenticated')return new Response('private',{status:403});
      return new Response(JSON.stringify({app_name:failure==='identity'?'wrong':'test',run_id:'run',code_hashes:{module:'bad'}}));
    }});
    const result=await runIsolatedPresenter(config(),{env,operations:ops});
    assert.ok(result.failure);assert.ok(!events.includes('e2e'));assert.ok(events.includes('stop'));assert.ok(calls<=2);
  }
});
test('CLI help, default execution and import cannot enter paid mode',async()=>{
  await subject();const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'presenter-controller-cli-'));
  try {
    for(const args of [[file.pathname.replace(/^\/(\w:)/,'$1'),'--help'],[file.pathname.replace(/^\/(\w:)/,'$1')],['--input-type=module','-e',`await import(${JSON.stringify(file.href)})`]]) {
      const r=spawnSync(process.execPath,args,{cwd:tmp,env:{...process.env,MULTIMIX_ALLOW_PAID_E2E:''},encoding:'utf8',windowsHide:true});
      assert.equal(r.status,args.length===1?1:0);assert.deepEqual(fs.readdirSync(tmp),[]);
    }
  } finally {fs.rmdirSync(tmp);}
});

test('evidence write failure cannot replace the original failure',async()=>{
  const {runIsolatedPresenter}=await subject();
  const {ops}=harness({deployVision:async()=>{throw new Error('original failure');},save:async(name)=>{if(name==='execution-result.json')throw new Error('disk full');}});
  const result=await runIsolatedPresenter(config(),{env,operations:ops});
  assert.equal(result.failure,'original failure');assert.equal(result.cleanupErrors.at(-1).stage,'persist-result');
});
