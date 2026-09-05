import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertPaidE2EAllowed } from './paid-e2e-gate.mjs';
import { checkIntegrity, serializeFailure } from './presenter-isolated-transport.mjs';

export async function runIsolatedPresenter(config,{env=process.env,operations}={}) {
  assertPaidE2EAllowed({suite:'presenter-isolated-e2e',env,args:[]});
  const ops = operations ?? (await import('./presenter-isolated-operations.mjs')).createOperations(config,env);
  let stage='validate-inputs', startedPaid=false, failureDetail=null;
  const cleanupErrors=[];
  try {
    await ops.validateInputs();
    stage='transport-preflight';
    const preflight=await ops.probe();
    await ops.save('transport-preflight.json',preflight);
    if (!preflight.ok) throw new Error('Transport preflight failed',{cause:preflight.failure});
    stage='storage-preflight';
    const storage=await ops.probeStorage();
    await ops.save('storage-preflight.json',storage);
    if (storage?.ok !== true) throw new Error('Storage preflight failed',{cause:storage?.failure});
    stage='production-baseline';await ops.baseline();
    stage='consume-authorization';await ops.consumeAuthorization();startedPaid=true;
    stage='deploy-vision';await ops.deployVision();
    stage='deploy-remotion';await ops.deployRemotion();
    stage='resolve-vision-url';const url=await ops.resolveUrl();
    const identity=await checkIntegrity(url,{token:ops.token,expected:ops.expectedIdentity(),fetchImpl:ops.fetch ?? fetch,onStage:value=>{stage=value;}});
    await ops.save('vision-integrity.json',{...identity,unauthenticatedStatus:401});
    stage='real-e2e';await ops.runE2E(url);
  } catch(error) {
    failureDetail=serializeFailure(error,{stage,secrets:ops.secrets});
  } finally {
    if (startedPaid) {
      for (const [cleanupStage,action] of [
        ['local-evidence-cleanup',()=>ops.collectAndCleanupLocal()],
        ['stop-test-apps',()=>ops.stopTestApps()],
        ['verify-unchanged',()=>ops.verifyUnchanged()],
      ]) {
        try {await action();} catch(error) {cleanupErrors.push(serializeFailure(error,{stage:cleanupStage,secrets:ops.secrets}));}
      }
    }
  }
  const result={runId:config.runId,failure:failureDetail?.message ?? null,failureDetail,cleanupErrors,startedPaid,finishedAt:new Date().toISOString()};
  try {await ops.save('execution-result.json',result);}
  catch(error) {cleanupErrors.push(serializeFailure(error,{stage:'persist-result',secrets:ops.secrets}));}
  return result;
}

export async function main(args=process.argv.slice(2),env=process.env) {
  if(args.length===1 && ['--help','-h'].includes(args[0])) {
    console.log('Usage: node scripts/run-presenter-isolated-e2e.mjs --config <absolute-json-path>\nRequires explicit MULTIMIX_ALLOW_PAID_E2E=true and a fresh per-run authorization. No default run, retries, or production deployment.');
    return 0;
  }
  assertPaidE2EAllowed({suite:'presenter-isolated-e2e',env,args:[]});
  if(args.length!==2 || args[0]!=='--config' || !path.isAbsolute(args[1])) throw new Error('An explicit absolute --config path is required');
  const config=JSON.parse(fs.readFileSync(args[1],'utf8'));
  const result=await runIsolatedPresenter(config,{env});
  console.log(JSON.stringify(result));
  return result.failure || result.cleanupErrors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(JSON.stringify(serializeFailure(error,{stage:'startup'})));process.exitCode=1;});
}
