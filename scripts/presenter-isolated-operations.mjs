import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {probeStorage,readCanonicalBackendEnv} from './presenter-storage-preflight.mjs';
import {spawn,execFileSync} from 'node:child_process';
import {probeTransport,checkedIsolatedUrl,redactDiagnostic} from './presenter-isolated-transport.mjs';
import {e2eRuntimeRoot} from './e2e-run-lifecycle.mjs';

const PRODUCTION = ['multimix-remotion','multimix-vision-service'];
const MODULES = ['vision_service.app','vision_service.analysis','app.services.presenter_visual_observation'];
const URL_QUERY = `import json,sys,modal
f=modal.Function.from_name(sys.argv[1], 'fastapi_app', environment_name='main')
print(json.dumps({'app_name':sys.argv[1],'function_name':'fastapi_app','url':f.get_web_url()}))`;
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (cwd,args) => execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true}).trim();

export function validateConfig(input) {
  const c=structuredClone(input);
  const match=/^lly-66-presenter-visual-smoke-(\d{8}-r[1-9]\d*)$/.exec(c.runId);
  assert.ok(match,'Invalid isolated runId');
  assert.ok(typeof c.authorizationRef==='string' && c.authorizationRef.trim(),'Explicit new authorizationRef required');
  for(const field of ['workspaceRoot','canonicalBackendRoot','backendRoot','frontendRoot','python','sourceDocument'])assert.ok(typeof c[field]==='string' && path.isAbsolute(c[field]),`${field} must be absolute`);
  assert.equal(path.resolve(c.canonicalBackendRoot),path.join(path.resolve(c.workspaceRoot),'MultiMix-Backend'));
  for(const field of ['backendRoot','frontendRoot']) {
    const relative=path.relative(c.workspaceRoot,c[field]);assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'Worktree must stay within workspace');
  }
  for(const port of [c.backendPort,c.frontendPort])assert.ok(Number.isInteger(port) && port>1024 && port<=65535 && ![3117,3200,8199].includes(port),'Unsafe test port');
  assert.notEqual(c.backendPort,c.frontendPort);
  for(const asset of [c.source,c.support]) {
    assert.ok(asset && path.isAbsolute(asset.path),'Asset path must be absolute');
    assert.match(asset.sha256,/^[a-f0-9]{64}$/);assert.ok(typeof asset.approvalRef==='string' && asset.approvalRef.trim(),'Asset approval required');
  }
  c.visionName=`multimix-presenter-vision-e2e-${match[1]}`;
  c.remotionName=`multimix-presenter-remotion-e2e-${match[1]}`;
  c.preflightUrl=checkedIsolatedUrl(c.preflightEndpoint,c.preflightEndpoint?.app_name);
  c.result=path.join(c.workspaceRoot,'MultiMix-Frontend','test-results',c.runId);
  c.runtime=path.join(path.dirname(c.workspaceRoot),'multimix-test-results','e2e-runtime','video-pipeline-production',c.runId);
  return c;
}

async function assertPortFree(port) {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({port,host:'127.0.0.1',exclusive:true},()=>server.close(resolve));});
}

export function createOperations(input,env=process.env,dependencies={}) {
  const c=validateConfig(input);const runner=path.join(c.frontendRoot,'scripts/run-video-pipeline-production-e2e.mjs');
  let ownsEvidence=false,token='',secrets=[],beforeApps,baseline;
  const save=async(name,data)=>{if(ownsEvidence)fs.writeFileSync(path.join(c.result,name),JSON.stringify(data,null,2));};
  const snapshot=dependencies.snapshot ?? (()=>({
    inputs:{source:hash(c.source.path),support:hash(c.support.path),document:hash(c.sourceDocument)},
    repos:Object.fromEntries([c.backendRoot,c.frontendRoot].map(repo=>[repo,{
      head:git(repo,['rev-parse','HEAD']),
      hashes:Object.fromEntries(git(repo,['ls-files','-m','-o','--exclude-standard']).split(/\r?\n/).filter(Boolean).map(file=>[file,fs.existsSync(path.join(repo,file))?hash(path.join(repo,file)):null])),
    }])),
  }));
  const command=dependencies.command ?? (async (executable,args,label,options={})=>{
    console.log(`[${new Date().toISOString()}] ${label}`);
    return new Promise((resolve,reject)=>{
      const child=spawn(executable,args,{cwd:options.cwd ?? c.backendRoot,env:{...env,MODAL_PROFILE:'multimix',MODAL_ENVIRONMENT:'main',PYTHONIOENCODING:'utf-8',...options.env},windowsHide:true,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';
      child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
      child.once('error',reject);
      child.once('close',code=>{
        // Scrub complete output, not chunks which may split a credential.
        if(ownsEvidence)fs.writeFileSync(path.join(c.result,`${label}.log`),redactDiagnostic(stdout+stderr,secrets));
        if(code===0)resolve(stdout);else reject(Object.assign(new Error(`${label} exited ${code}; see local log`),{code:'CHILD_EXIT'}));
      });
    });
  });
  const modal=(args,label)=>command(c.python,['-m','modal',...args],label);
  const listApps=async label=>JSON.parse(await modal(['app','list','--env','main','--json'],label));
  const history=async(app,label)=>JSON.parse(await modal(['app','history',app.app_id,'--env','main','--json'],label));
  const names=[c.visionName,c.remotionName];
  const ops={config:c,save,get token(){return token;},get secrets(){return secrets;},
    async validateInputs(){
      assert.equal(c.runtime,path.join(e2eRuntimeRoot(),'video-pipeline-production',c.runId),'Runtime must match the existing E2E lifecycle');
      assert.ok(!fs.existsSync(c.result),'Evidence directory already exists; never reuse a round');
      assert.ok(!fs.existsSync(c.runtime),'Runtime already exists');
      for(const asset of [c.source,c.support])assert.equal(hash(asset.path),asset.sha256,'Input fingerprint mismatch');
      assert.ok(fs.statSync(c.sourceDocument).isFile());assert.ok(fs.statSync(c.python).isFile());
      for(const repo of [c.backendRoot,c.frontendRoot]) {
        assert.notEqual(git(repo,['rev-parse','--git-dir']),git(repo,['rev-parse','--git-common-dir']),'Use an isolated worktree');
        assert.equal(git(repo,['rev-parse','--show-superproject-working-tree']),'','Submodule is not isolation');
      }
      const wrapper=fs.readFileSync(path.join(c.backendRoot,'vision_service/modal_presenter_e2e.py'),'utf8');
      assert.ok(wrapper.includes(`APP_NAME = "${c.visionName}"`) && wrapper.includes(`RUN_ID = "${c.runId}"`),'Local wrapper must match the newly authorized identity');
      const values=readCanonicalBackendEnv(runner,c.canonicalBackendRoot,env);
      token=values.MULTIMIX_VISION_SERVICE_TOKEN;
      assert.ok(token,'Vision auth must be configured');
      secrets=Object.entries({...env,...values}).filter(([key,value])=>/token|secret|password|api.?key/i.test(key) && typeof value==='string' && value).map(([,value])=>value);
      await assertPortFree(c.backendPort);await assertPortFree(c.frontendPort);
      fs.mkdirSync(path.dirname(c.result),{recursive:true});fs.mkdirSync(c.result);ownsEvidence=true;
    },
    probe:()=>probeTransport({hostname:new URL(c.preflightUrl).hostname}),
    probeStorage:()=>(dependencies.storageProbe ?? probeStorage)({python:c.python,backendRoot:c.backendRoot,canonicalBackendRoot:c.canonicalBackendRoot,runnerPath:runner,env}),
    async baseline(){
      beforeApps=await listApps('apps-before');assert.ok(!beforeApps.some(app=>names.includes(app.description)),'Test app already exists');
      const production={};
      for(const name of PRODUCTION){const app=beforeApps.find(a=>a.description===name);assert.equal(app?.state,'deployed');production[name]={id:app.app_id,history:await history(app,`${name}-before`)};}
      baseline={snapshot:snapshot(),production};await save('baseline.json',baseline);
    },
    async consumeAuthorization(){
      const parent=path.dirname(c.result);
      if(fs.existsSync(parent)) {
        for(const entry of fs.readdirSync(parent,{withFileTypes:true}).filter(e=>e.isDirectory() && /^lly-66-presenter-visual-smoke-\d{8}-r\d+$/.test(e.name) && e.name!==c.runId)) {
          const fuse=path.join(parent,entry.name,'authorization-consumed.json');
          if(fs.existsSync(fuse))assert.ok(JSON.parse(fs.readFileSync(fuse,'utf8')).authorized!==c.authorizationRef,'Authorization record already consumed by another round');
        }
      }
      fs.mkdirSync(c.result,{recursive:true});
      fs.writeFileSync(path.join(c.result,'authorization-consumed.json'),JSON.stringify({runId:c.runId,authorized:c.authorizationRef,at:new Date().toISOString()}),{flag:'wx'});
    },
    deployVision:()=>modal(['deploy','--env','main','--name',c.visionName,'-m','vision_service.modal_presenter_e2e'],'deploy-vision'),
    deployRemotion:()=>modal(['deploy','--env','main','--name',c.remotionName,'-m','app.services.remotion_modal.modal_app'],'deploy-remotion'),
    async resolveUrl(){return checkedIsolatedUrl(await command(c.python,['-c',URL_QUERY,c.visionName],'resolve-vision-url'),c.visionName);},
    expectedIdentity:()=>({app_name:c.visionName,run_id:c.runId,code_hashes:Object.fromEntries(MODULES.map(name=>[name,hash(path.join(c.backendRoot,`${name.replaceAll('.','/')}.py`))]))}),
    runE2E:url=>command(process.execPath,[runner],'real-e2e',{cwd:c.frontendRoot,env:{
      MULTIMIX_ALLOW_PAID_E2E:'true',MULTIMIX_CANONICAL_BACKEND_ROOT:c.canonicalBackendRoot,MULTIMIX_BACKEND_ROOT:c.backendRoot,PYTHON:c.python,
      VIDEO_PIPELINE_VIDEO_TYPE:'presenter',VIDEO_PIPELINE_QUALITY_BASELINE:'true',VIDEO_PIPELINE_RUN_ID:c.runId,VIDEO_PIPELINE_RESULT_DIR:c.result,
      VIDEO_PIPELINE_SOURCE_DOCUMENT:c.sourceDocument,VIDEO_PIPELINE_PRESENTER_SOURCE_VIDEO:c.source.path,VIDEO_PIPELINE_PRESENTER_SOURCE_APPROVAL_REF:c.source.approvalRef,
      VIDEO_PIPELINE_PRESENTER_SUPPORT_IMAGE_FILES:JSON.stringify([{path:c.support.path,approval_ref:c.support.approvalRef,name:c.support.name ?? path.basename(c.support.path)}]),
      VIDEO_PIPELINE_BACKEND_PORT:String(c.backendPort),VIDEO_PIPELINE_FRONTEND_PORT:String(c.frontendPort),VIDEO_PIPELINE_RATIO:'9:16',VIDEO_PIPELINE_EXPECT_BGM:'false',VIDEO_PIPELINE_RETAIN_REMOTE_CHECKPOINT:'false',
      VIDEO_PIPELINE_VISION_SERVICE_URL:url,VIDEO_PIPELINE_MG_MODAL_APP_NAME:c.remotionName,VIDEO_PIPELINE_MODAL_ENVIRONMENT:'main',
    }}),
    async collectAndCleanupLocal(){
      if(!fs.existsSync(c.runtime))return;
      assert.ok(!fs.existsSync(path.join(c.runtime,'remote-artifact-writes.ndjson')),'Remote cleanup must finish before local deletion');
      const database=path.join(c.runtime,'runtime.sqlite3');
      if(fs.existsSync(database)) {
        const output=await command(c.python,['-c',`import json,sqlite3,sys
db=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
db.row_factory=sqlite3.Row
assets=[]
for row in db.execute('SELECT id, content_type, status, metadata FROM content_assets ORDER BY id'):
 item=dict(row)
 meta=json.loads(item.pop('metadata') or '{}')
 item['metadata']={k:v for k,v in meta.items() if k.startswith('presenter') or k in ['understanding','video_plan','video_project','video_segments','generation_state','failure_reason','orchestration_pending','video_quality_report']}
 assets.append(item)
files=[dict(row) for row in db.execute('SELECT id, asset_id, file_role, mime_type, width, height, size_bytes, content_hash FROM asset_files ORDER BY id')]
print(json.dumps({'assets':assets,'files':files},ensure_ascii=False))
db.close()`,database],'evidence-export');
        await save('actual-presenter-evidence.json',JSON.parse(output));
      }
      for(const name of ['run-state.json','run-ledger.ndjson','playwright-timing.ndjson']) {
        const file=path.join(c.runtime,name);if(ownsEvidence && fs.existsSync(file))fs.copyFileSync(file,path.join(c.result,name));
      }
      await command(process.execPath,[path.join(c.frontendRoot,'scripts/manage-e2e-run.mjs'),'cleanup',`video-pipeline-production/${c.runId}`,'--confirm'],'cleanup-local',{cwd:c.frontendRoot});
    },
    async stopTestApps(){
      assert.ok(beforeApps,'Missing baseline');const errors=[];
      for(const app of (await listApps('apps-pre-cleanup')).filter(a=>names.includes(a.description))) {
        try {assert.ok(!beforeApps.some(a=>a.app_id===app.app_id),'Refuse to stop a pre-existing app');if(app.state!=='stopped')await modal(['app','stop',app.app_id,'--env','main','--yes'],`stop-${app.description}`);}
        catch(error){errors.push(error);}
      }
      if(errors.length)throw new AggregateError(errors,'Test app cleanup failed');
    },
    async verifyUnchanged(){
      const after=await listApps('apps-after');
      for(const name of PRODUCTION){const app=after.find(a=>a.description===name);assert.equal(app?.app_id,baseline.production[name].id,'Production app ID changed');assert.equal(app?.state,'deployed');assert.deepEqual(await history(app,`${name}-after`),baseline.production[name].history,'Production history changed');}
      for(const app of after.filter(a=>names.includes(a.description))){assert.equal(app.state,'stopped');assert.equal(Number(app.tasks),0);}
      const final=snapshot();await save('final-snapshot.json',final);assert.deepEqual(final,baseline.snapshot,'Code or inputs changed');
    },
  };
  return ops;
}
