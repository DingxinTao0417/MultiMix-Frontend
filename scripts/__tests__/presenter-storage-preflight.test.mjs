import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const runnerPath=fileURLToPath(new URL('../run-video-pipeline-production-e2e.mjs',import.meta.url));
async function subject(){const file=new URL('../presenter-storage-preflight.mjs',import.meta.url);assert.ok(fs.existsSync(file),'Missing readonly Storage preflight');return import(file.href);}
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'presenter-storage-preflight-'));
  fs.writeFileSync(path.join(root,'.env'),'MULTIMIX_S3_BUCKET=base-bucket\nMULTIMIX_SUPABASE_SERVICE_ROLE_KEY=PRIVATE\nMULTIMIX_SUPABASE_URL=https://example.supabase.co\nMULTIMIX_ARTIFACT_STORAGE_HTTPS_PROXY=http://127.0.0.1:7890\n');
  fs.writeFileSync(path.join(root,'.env.local'),'MULTIMIX_S3_BUCKET=${MULTIMIX_S3_BUCKET}-local\n');
  return {root,options:{runnerPath,canonicalBackendRoot:root,backendRoot:root,python:path.join(root,'python.exe'),env:{}},cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const success={ok:true,scope:'bucket-readiness',objectReadVerified:false,socketTimeoutSeconds:20,maxAttempts:2};

test('preflight uses canonical env precedence including base-only values without mutating caller',async()=>{
  const {readCanonicalBackendEnv,probeStorage}=await subject();const {root,options,cleanup}=fixture();
  try {
    const original={MULTIMIX_SUPABASE_SERVICE_ROLE_KEY:'WRONG',SUPABASE_SERVICE_ROLE_KEY:'ALIAS',MULTIMIX_DATABASE_URL:'PRIVATE_DATABASE'};
    const values=readCanonicalBackendEnv(runnerPath,root,original);
    assert.equal(values.MULTIMIX_SUPABASE_SERVICE_ROLE_KEY,'PRIVATE');
    // The production parser deliberately preserves self references, so use a distinct key below.
    fs.writeFileSync(path.join(root,'.env.local'),'OTHER_BUCKET=${MULTIMIX_S3_BUCKET}\n');
    let invocation;
    const result=await probeStorage({...options,env:original},{execute:async(...args)=>{invocation=args;return {stdout:JSON.stringify(success)};}});
    assert.equal(result.ok,true);assert.equal(result.objectReadVerified,false);
    const child=invocation[2];
    assert.equal(child.env.MULTIMIX_SUPABASE_SERVICE_ROLE_KEY,'PRIVATE');
    assert.equal(child.env.SUPABASE_SERVICE_ROLE_KEY,'');
    assert.equal(child.env.MULTIMIX_ARTIFACT_STORAGE_HTTPS_PROXY,'http://127.0.0.1:7890');
    assert.equal(child.env.MULTIMIX_S3_BUCKET,'base-bucket');
    assert.equal(child.env.OTHER_BUCKET,'base-bucket');
    assert.equal(child.cwd,options.backendRoot);assert.equal(child.timeout,50_000);assert.equal(child.windowsHide,true);
    assert.equal(child.env.MULTIMIX_DATABASE_URL,'sqlite:///:memory:');
    assert.equal(original.MULTIMIX_DATABASE_URL,'PRIVATE_DATABASE');
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    assert.deepEqual(fs.readdirSync(root).sort(),['.env','.env.local']);
  } finally {cleanup();}
});

test('backend alias resolution matches the Presenter runner and never exposes response bodies',async()=>{
  const {probeStorage}=await subject();const {root,options,cleanup}=fixture();
  try {
    fs.writeFileSync(path.join(root,'.env'),'SUPABASE_URL=https://alias.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=ALIAS_PRIVATE\n');
    fs.writeFileSync(path.join(root,'.env.local'),'');
    let child;
    const result=await probeStorage(options,{execute:async(_file,_args,opt)=>{child=opt.env;return {stdout:JSON.stringify({...success,body:'ALIAS_PRIVATE'})};}});
    assert.equal(child.MULTIMIX_SUPABASE_URL,'https://alias.supabase.co');
    assert.equal(child.MULTIMIX_SUPABASE_SERVICE_ROLE_KEY,'ALIAS_PRIVATE');
    assert.equal(child.MULTIMIX_S3_BUCKET,'multimix-artifacts');
    assert.equal(result.ok,true);assert.ok(!JSON.stringify(result).includes('ALIAS_PRIVATE'));
  } finally {cleanup();}
});

test('failed, malformed and misleading bucket reports fail closed',async()=>{
  const {probeStorage}=await subject();const {options,cleanup}=fixture();
  try {
    for(const report of ['invalid PRIVATE',{}, {...success,ok:'true'}, {...success,objectReadVerified:true},
      {ok:false,code:'STORAGE_HTTP',httpStatus:403,message:'PRIVATE',body:'PRIVATE'},
      {ok:false,code:'STORAGE_TLS_TIMEOUT',message:'PRIVATE'}]) {
      const result=await probeStorage(options,{execute:async()=>({stdout:typeof report==='string'?report:JSON.stringify(report)})});
      assert.equal(result.ok,false);assert.equal(result.objectReadVerified,false);
      assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(result.failure.code.startsWith('STORAGE_'));
      if(report.code==='STORAGE_HTTP')assert.equal(result.failure.httpStatus,403);
    }
  } finally {cleanup();}
});

test('process timeout or startup failure is bounded and does not leak stderr or env',async()=>{
  const {probeStorage}=await subject();const {options,cleanup}=fixture();
  try {
    for(const killed of [true,false]) {
      let calls=0;
      const result=await probeStorage(options,{execute:async()=>{calls++;throw Object.assign(new Error('PRIVATE'),{killed,stderr:'PRIVATE',stdout:'PRIVATE'});}});
      assert.equal(calls,1);assert.equal(result.ok,false);
      assert.equal(result.failure.code,killed?'STORAGE_PREFLIGHT_TIMEOUT':'STORAGE_PREFLIGHT_PROCESS');
      assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    }
  } finally {cleanup();}
});

// Frontend-only CI has no private Backend checkout; run explicitly in the split workspace.
test('embedded Python uses the real Storage client with offline failure injection',{
  skip:!process.env.PRESENTER_STORAGE_TEST_PYTHON || !process.env.PRESENTER_STORAGE_TEST_BACKEND,
},async()=>{
  const {STORAGE_PROBE_SCRIPT}=await subject();
  const harness=String.raw`
import io,json,socket,sys
from contextlib import redirect_stdout
from urllib.error import HTTPError,URLError
from unittest.mock import patch
from app.config import Settings
import app.services.storage as storage
script=sys.stdin.read()
settings=Settings(_env_file=None,supabase_url='https://example.supabase.co',
                  supabase_service_role_key='PRIVATE',s3_bucket='test-bucket',
                  artifact_storage_https_proxy='',artifact_storage_max_attempts=1)
cases=[('success',b'{"id":"test-bucket"}',None,'OK'),
       ('wrong_bucket',b'{"id":"wrong"}',None,'STORAGE_RESPONSE'),
       ('invalid_json',b'PRIVATE',None,'STORAGE_REQUEST'),
       ('auth',None,HTTPError('https://example.supabase.co',403,'PRIVATE',{},io.BytesIO(b'PRIVATE')),'STORAGE_HTTP'),
       ('tls',None,URLError(TimeoutError('The handshake operation timed out PRIVATE')),'STORAGE_TLS_TIMEOUT'),
       ('timeout',None,TimeoutError('PRIVATE'),'STORAGE_TIMEOUT'),
       ('transport',None,URLError('PRIVATE'),'STORAGE_REQUEST')]
for label,body,failure,expected in cases:
 def network(request,timeout):
  assert request.get_method()=='GET'
  assert request.full_url=='https://example.supabase.co/storage/v1/bucket/test-bucket'
  assert request.get_header('Authorization')=='Bearer PRIVATE'
  assert timeout==20
  if failure: raise failure
  class Response:
   headers={}
   def read(self):return body
   def __enter__(self):return self
   def __exit__(self,*args):pass
  return Response()
 output=io.StringIO()
 with patch('app.config.Settings',return_value=settings),patch.object(storage,'urlopen',network),patch.object(socket,'create_connection',side_effect=AssertionError('No external network allowed')),redirect_stdout(output):
  exec(script,{})
 result=json.loads(output.getvalue())
 assert result['ok'] == (label=='success'),label
 assert result.get('code','OK')==expected,label
 assert not result['objectReadVerified']
 assert 'PRIVATE' not in output.getvalue()
 if label=='auth':assert result['httpStatus']==403
assert 'app.db' not in sys.modules
print(json.dumps({'passed':len(cases)}))
`;
  const output=execFileSync(process.env.PRESENTER_STORAGE_TEST_PYTHON,['-c',harness],{
    cwd:process.env.PRESENTER_STORAGE_TEST_BACKEND,input:STORAGE_PROBE_SCRIPT,encoding:'utf8',windowsHide:true,
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',MULTIMIX_DATABASE_URL:'sqlite:///:memory:'},timeout:10_000,
  });
  assert.equal(JSON.parse(output).passed,7);
});
