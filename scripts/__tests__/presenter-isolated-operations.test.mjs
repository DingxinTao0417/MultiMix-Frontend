import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import test from 'node:test';

async function subject(){const file=new URL('../presenter-isolated-operations.mjs',import.meta.url);assert.ok(fs.existsSync(file),'Missing guarded external operations');return import(file.href);}
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'presenter-operations-'));
  const cfg={runId:'lly-66-presenter-visual-smoke-20990101-r1',authorizationRef:'new-explicit-record',
    workspaceRoot:path.join(root,'workspace'),canonicalBackendRoot:path.join(root,'workspace/MultiMix-Backend'),backendRoot:path.join(root,'workspace/backend-worktree'),frontendRoot:path.join(root,'workspace/frontend-worktree'),
    python:path.join(root,'python.exe'),sourceDocument:path.join(root,'brief.md'),backendPort:18448,frontendPort:13448,
    preflightEndpoint:{app_name:'multimix-presenter-vision-e2e-20990101-r0',function_name:'fastapi_app',url:'https://multimix--multimix-presenter-vision-e2e-20990101-r0-fas-123456.modal.run'},
    source:{path:path.join(root,'source.mp4'),sha256:sha('source'),approvalRef:'source-approved'},
    support:{path:path.join(root,'support.png'),sha256:sha('support'),approvalRef:'support-approved',name:'Support'},
  };
  return {root,cfg,cleanup:()=>{fs.rmSync(root,{recursive:true,force:true});}};
}
test('config requires explicit identity, authorization, absolute inputs and safe ports',async()=>{
  const {validateConfig}=await subject();const {cfg,cleanup}=fixture();
  try{
    const normalized=validateConfig(cfg);
    assert.equal(normalized.visionName,'multimix-presenter-vision-e2e-20990101-r1');
    assert.equal(path.basename(normalized.result),cfg.runId);assert.equal(path.basename(normalized.runtime),cfg.runId);
    for(const bad of [{authorizationRef:''},{runId:'../../r14'},{backendPort:8199},{frontendPort:3200},{frontendPort:cfg.backendPort},{backendRoot:'.'},{source:{...cfg.source,sha256:'bad'}},{preflightEndpoint:{...cfg.preflightEndpoint,url:'https://production.modal.run'}}])assert.throws(()=>validateConfig({...cfg,...bad}));
  }finally{cleanup();}
});
test('real exclusive authorization file prevents reuse and contains the explicit record',async()=>{
  const {createOperations}=await subject();const {cfg,cleanup}=fixture();
  try{
    const ops=createOperations(cfg,{}, {command:async()=>assert.fail('no external command expected')});
    await ops.consumeAuthorization();
    const content=JSON.parse(fs.readFileSync(path.join(ops.config.result,'authorization-consumed.json'),'utf8'));
    assert.equal(content.runId,cfg.runId);assert.equal(content.authorized,cfg.authorizationRef);
    await assert.rejects(ops.consumeAuthorization(),{code:'EEXIST'});
  }finally{cleanup();}
});
test('test app collision blocks baseline; production ID or history change is rejected',async()=>{
  const {createOperations}=await subject();const {cfg,cleanup}=fixture();
  const prod=[{description:'multimix-remotion',app_id:'ap-remotion',state:'deployed'},{description:'multimix-vision-service',app_id:'ap-vision',state:'deployed'}];
  let changed=false,collision=false;
  const command=async(_cmd,args)=>{
    if(args.includes('list'))return JSON.stringify(collision?[...prod,{description:'multimix-presenter-vision-e2e-20990101-r1',app_id:'ap-other'}]:prod);
    if(args.includes('history'))return JSON.stringify([{version:changed?2:1}]);
    return '';
  };
  try{
    const ops=createOperations(cfg,{}, {command,snapshot:()=>({fixed:true})});
    collision=true;await assert.rejects(ops.baseline(),/already exists/);collision=false;
    await ops.baseline();changed=true;await assert.rejects(ops.verifyUnchanged(),/history/);
  }finally{cleanup();}
});
test('stop selects only this run and continues after one stop fails',async()=>{
  const {createOperations}=await subject();const {cfg,cleanup}=fixture();
  const prod=[{description:'multimix-remotion',app_id:'ap-prod-r',state:'deployed'},{description:'multimix-vision-service',app_id:'ap-prod-v',state:'deployed'}];
  const apps=[...prod,{description:'other-test',app_id:'ap-other',state:'deployed'},
    {description:'multimix-presenter-vision-e2e-20990101-r1',app_id:'ap-test-v',state:'deployed'},
    {description:'multimix-presenter-remotion-e2e-20990101-r1',app_id:'ap-test-r',state:'deployed'}];
  let after=false;const stopped=[];
  const command=async(_cmd,args)=>{if(args.includes('list'))return JSON.stringify(after?apps:prod);if(args.includes('history'))return '[]';if(args.includes('stop')){stopped.push(args[4]);if(stopped.length===1)throw new Error('stop error');}return '';};
  try{
    const ops=createOperations(cfg,{}, {command,snapshot:()=>({})});await ops.baseline();after=true;
    await assert.rejects(ops.stopTestApps());assert.deepEqual(stopped,['ap-test-v','ap-test-r']);
    assert.ok(stopped.every(id=>!id.includes('prod')&&id!=='ap-other'));
  }finally{cleanup();}
});
test('render invocation forwards frozen Presenter quality settings and exact input approvals',async()=>{
  const {createOperations}=await subject();const {cfg,cleanup}=fixture();let invocation;
  try{
    const ops=createOperations(cfg,{}, {command:async(...args)=>{invocation=args;return '';}});
    await ops.runE2E('https://test-endpoint');const childEnv=invocation[3].env;
    assert.equal(childEnv.VIDEO_PIPELINE_VIDEO_TYPE,'presenter');assert.equal(childEnv.VIDEO_PIPELINE_QUALITY_BASELINE,'true');
    assert.equal(childEnv.VIDEO_PIPELINE_VISION_SERVICE_URL,'https://test-endpoint');
    assert.equal(childEnv.VIDEO_PIPELINE_PRESENTER_SOURCE_APPROVAL_REF,cfg.source.approvalRef);
    assert.equal(JSON.parse(childEnv.VIDEO_PIPELINE_PRESENTER_SUPPORT_IMAGE_FILES)[0].approval_ref,cfg.support.approvalRef);
    assert.equal(childEnv.VIDEO_PIPELINE_RETAIN_REMOTE_CHECKPOINT,'false');
  }finally{cleanup();}
});

test('local cleanup retains an unresolved remote ledger and does not touch a database',async()=>{
  const {createOperations}=await subject();const {cfg,cleanup}=fixture();
  try{
    const ops=createOperations(cfg,{}, {command:async()=>assert.fail('must retain unresolved ledger')});
    fs.mkdirSync(ops.config.runtime,{recursive:true});fs.writeFileSync(path.join(ops.config.runtime,'remote-artifact-writes.ndjson'),'{}');
    await assert.rejects(ops.collectAndCleanupLocal(),/Remote cleanup/);
    assert.ok(fs.existsSync(path.join(ops.config.runtime,'remote-artifact-writes.ndjson')));
  }finally{cleanup();}
});

test('missing runtime cleanup is a no-op; empty runtime uses the exact existing cleanup manager',async()=>{
  const {createOperations}=await subject();const {cfg,cleanup}=fixture();let invocation;
  try{
    const ops=createOperations(cfg,{}, {command:async(...args)=>{invocation=args;return '';}});
    await ops.collectAndCleanupLocal();assert.equal(invocation,undefined);
    fs.mkdirSync(ops.config.runtime,{recursive:true});await ops.collectAndCleanupLocal();
    assert.equal(invocation[1][1],'cleanup');assert.equal(invocation[1][2],`video-pipeline-production/${cfg.runId}`);
    assert.equal(invocation[1][3],'--confirm');
  }finally{cleanup();}
});

test('the same explicit authorization record cannot fund a second round',async()=>{
  const {createOperations}=await subject();const {cfg,cleanup}=fixture();
  try{
    await createOperations(cfg).consumeAuthorization();
    const next=createOperations({...cfg,runId:'lly-66-presenter-visual-smoke-20990101-r2'});
    await assert.rejects(next.consumeAuthorization(),/Authorization record already consumed/);
    assert.ok(!fs.existsSync(path.join(next.config.result,'authorization-consumed.json')));
  }finally{cleanup();}
});

test('default operations reject a runtime location inconsistent with the existing lifecycle',async()=>{
  const {createOperations}=await subject();const {cfg,cleanup}=fixture();
  try{
    const ops=createOperations(cfg,{}, {command:async()=>assert.fail('No command before validation')});
    await assert.rejects(ops.validateInputs(),/Runtime must match/);
    assert.ok(!fs.existsSync(ops.config.result));
  }finally{cleanup();}
});

test('standalone Storage preflight forwards actual roots without consuming authorization or starting Modal',async()=>{
  const {createOperations}=await subject();const {root,cfg,cleanup}=fixture();let received;
  try{
    const env={MARKER:'caller'};
    const ops=createOperations(cfg,env,{command:async()=>assert.fail('No Modal or E2E command'),storageProbe:async options=>{received=options;return {ok:true,objectReadVerified:false};}});
    assert.equal(typeof ops.probeStorage,'function');
    assert.equal((await ops.probeStorage()).ok,true);
    assert.equal(received.python,cfg.python);assert.equal(received.backendRoot,cfg.backendRoot);
    assert.equal(received.canonicalBackendRoot,cfg.canonicalBackendRoot);assert.equal(received.env,env);
    assert.deepEqual(fs.readdirSync(root),[]);
  }finally{cleanup();}
});
