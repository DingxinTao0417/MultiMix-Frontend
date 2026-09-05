import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

export const TRANSPORT_BUDGET_MS = 20_000;
export const INTEGRITY_BUDGET_MS = 120_000;
const MAX_TEXT = 2048;
const MAX_DEPTH = 6;

export function redactDiagnostic(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets.filter(s => typeof s === 'string' && s)) text = text.replaceAll(secret, '[redacted]');
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, raw => {
    try {const url = new URL(raw); return `${url.protocol}//${url.host}${url.pathname}`;}
    catch {return '[redacted-url]';}
  });
  return text.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]');
}

export function serializeFailure(error, { stage, secrets = [] } = {}) {
  const seen = new WeakSet();
  const read = (object, key) => {try {return object?.[key];} catch {return undefined;}};
  const clean = value => redactDiagnostic(value, secrets).slice(0, MAX_TEXT);
  function visit(item, depth) {
    if (depth > MAX_DEPTH) return {truncated:true};
    if (!item || typeof item !== 'object') return {message:clean(item)};
    if (seen.has(item)) return {truncated:true};
    seen.add(item);
    const result = {};
    for (const key of ['name','message','code','syscall']) {
      const value = read(item,key);
      if (['string','number'].includes(typeof value)) result[key] = clean(value);
    }
    if (!result.message) result.message = 'Error details unavailable';
    const cause = read(item,'cause');
    if (cause !== undefined) result.cause = visit(cause, depth+1);
    const errors = read(item,'errors');
    if (Array.isArray(errors)) {
      result.errors = errors.slice(0,8).map(e => visit(e,depth+1));
      if (errors.length > 8) result.truncated = true;
    }
    return result;
  }
  return {...visit(error,0), ...(stage ? {stage:clean(stage)} : {})};
}

function untilAbort(promise, signal) {
  return new Promise((resolve,reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}

function socketReady(socket, event, signal) {
  return new Promise((resolve,reject) => {
    const cleanup = () => {
      socket.off(event,ready);socket.off('error',fail);socket.off('close',closed);
      signal.removeEventListener('abort',abort);
    };
    const ready = () => {cleanup();resolve();};
    const fail = error => {cleanup();reject(error);};
    const closed = () => fail(Object.assign(new Error('Connection closed before ready'),{code:'ECONNRESET'}));
    const abort = () => fail(signal.reason);
    socket.once(event,ready);socket.once('error',fail);socket.once('close',closed);
    signal.addEventListener('abort',abort,{once:true});
    if (signal.aborted) abort();
  });
}

export async function probeTransport({hostname,port=443,timeoutMs=TRANSPORT_BUDGET_MS}, dependencies={}) {
  assert.ok(typeof hostname === 'string' && hostname.length > 0);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= TRANSPORT_BUDGET_MS);
  const started = Date.now(); const stages = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('Transport preflight deadline exceeded'), {code:'ETIMEDOUT'})), timeoutMs);
  const signal = controller.signal;
  let stage='dns', socket, secureSocket;
  try {
    const address = await untilAbort((dependencies.lookup ?? dns.lookup)(hostname),signal);
    stages.push({stage,elapsedMs:Date.now()-started}); stage='tcp';
    socket = (dependencies.connect ?? net.connect)({host:address.address,port,family:address.family});
    socket.on('error',()=>{});
    await socketReady(socket,'connect',signal);
    stages.push({stage,elapsedMs:Date.now()-started}); stage='tls';
    secureSocket = (dependencies.upgrade ?? tls.connect)({socket,servername:net.isIP(hostname) ? undefined : hostname,rejectUnauthorized:true});
    secureSocket.on('error',()=>{});
    await socketReady(secureSocket,'secureConnect',signal);
    assert.equal(secureSocket.authorized,true,'TLS certificate must be trusted');
    stages.push({stage,elapsedMs:Date.now()-started});
    return {ok:true,hostname,stages,elapsedMs:Date.now()-started,applicationReady:false};
  } catch (error) {
    return {ok:false,hostname,stages,elapsedMs:Date.now()-started,failure:serializeFailure(error,{stage})};
  } finally {clearTimeout(timer);secureSocket?.destroy();socket?.destroy();}
}

export async function checkIntegrity(url,{token,expected,fetchImpl=fetch,onStage=()=>{}}) {
  assert.ok(token,'Missing Vision service token');
  onStage('integrity-unauthenticated');
  const unauthorized = await fetchImpl(`${url}/e2e-integrity`,{redirect:'error',signal:AbortSignal.timeout(INTEGRITY_BUDGET_MS)});
  await unauthorized.body?.cancel();
  assert.equal(unauthorized.status,401,'Unauthenticated integrity must return 401');
  onStage('integrity-authenticated');
  const response = await fetchImpl(`${url}/e2e-integrity`,{redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(INTEGRITY_BUDGET_MS)});
  if (response.status !== 200) {
    await response.body?.cancel();
    throw Object.assign(new Error(`Authenticated integrity returned HTTP ${response.status}`),{code:'INTEGRITY_HTTP_STATUS'});
  }
  let identity;
  try {identity = await response.json();}
  catch(error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw Object.assign(new Error('Integrity response is not valid JSON'),{code:'INTEGRITY_INVALID_JSON'});
  }
  onStage('integrity-identity');
  // Avoid assertion diffs containing untrusted response bodies.
  assert.ok(identity?.app_name === expected.app_name,'Integrity app mismatch');
  assert.ok(identity?.run_id === expected.run_id,'Integrity run mismatch');
  const keys = Object.keys(expected.code_hashes);
  assert.ok(keys.length > 0 && identity.code_hashes && Object.keys(identity.code_hashes).length === keys.length,'Integrity module set mismatch');
  assert.ok(keys.every(key => identity.code_hashes[key] === expected.code_hashes[key]),'Integrity source hash mismatch');
  return identity;
}

export function checkedIsolatedUrl(response,expectedAppName) {
  const data = typeof response === 'string' ? JSON.parse(response) : response;
  assert.match(expectedAppName,/^multimix-presenter-vision-e2e-\d{8}-r\d+$/);
  assert.ok(data?.app_name === expectedAppName && data.function_name === 'fastapi_app','SDK identity mismatch');
  const url = new URL(data.url);
  assert.ok(url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password && !url.port && !url.search && !url.hash,'Unsafe endpoint URL');
  assert.ok(/^multimix--[a-z0-9-]*presenter-vision-e2e-[a-z0-9-]+\.modal\.run$/.test(url.hostname),'Not an isolated test endpoint');
  assert.ok(url.hostname.startsWith(`multimix--${expectedAppName}-`),'Endpoint belongs to another round');
  assert.ok(url.hostname.split('.').every(label => label.length <= 63),'Invalid DNS label');
  return url.origin;
}
