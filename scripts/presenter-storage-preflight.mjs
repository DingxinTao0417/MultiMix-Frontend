import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

export const STORAGE_PREFLIGHT_BUDGET_MS = 50_000;
const executeFile = promisify(execFile);
const MESSAGES = {
  STORAGE_CONFIG: 'Storage configuration is missing or invalid',
  STORAGE_HTTP: 'Storage authentication or bucket request failed',
  STORAGE_TLS_TIMEOUT: 'Storage TLS handshake timed out',
  STORAGE_TIMEOUT: 'Storage request timed out',
  STORAGE_REQUEST: 'Storage request failed',
  STORAGE_RESPONSE: 'Storage bucket response was not verified',
  STORAGE_PREFLIGHT_TIMEOUT: 'Storage preflight process deadline exceeded',
  STORAGE_PREFLIGHT_PROCESS: 'Storage preflight process failed',
};

export function readCanonicalBackendEnv(runnerPath, canonicalBackendRoot, env=process.env) {
  // Reuse the paid runner's parser without importing its executable entry point.
  const parser = fs.readFileSync(runnerPath,'utf8').match(/const dotenvReferencePattern[\s\S]*?\r?\n}\r?\n\r?\nconst baseCanonicalEnv/)?.[0];
  assert.ok(parser,'Cannot locate canonical env parser');
  const parse = new Function('fs',`${parser.replace(/\r?\n\r?\nconst baseCanonicalEnv$/,'')}; return parseEnvFile;`)(fs);
  const base = parse(path.join(canonicalBackendRoot,'.env'),env);
  return {...base,...parse(path.join(canonicalBackendRoot,'.env.local'),base)};
}

// No app.db, schema bootstrap, file/object writes, Provider or Modal imports.
export const STORAGE_PROBE_SCRIPT = String.raw`
import json
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request
from app.config import Settings
from app.services.storage import ArtifactStore

def probe():
    result = {"ok": False, "scope": "bucket-readiness", "objectReadVerified": False}
    try:
        settings = Settings()
        url = str(settings.supabase_url or "").strip()
        parsed = urlparse(url)
        bucket = str(settings.s3_bucket or "").strip()
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or not bucket or not settings.supabase_service_role_key):
            return {**result, "code": "STORAGE_CONFIG"}
        store = ArtifactStore(settings)
        # Validate the same explicit proxy that the production client uses.
        store._supabase_opener()
    except Exception:
        return {**result, "code": "STORAGE_CONFIG"}
    result.update(socketTimeoutSeconds=max(1, settings.artifact_storage_connect_timeout_seconds or 5,
                                          settings.artifact_storage_read_timeout_seconds or 20),
                  maxAttempts=max(1, settings.artifact_storage_max_attempts or 2))
    try:
        request = Request(url.rstrip("/") + "/storage/v1/bucket/" + quote(bucket, safe=""),
                          headers={"apikey": settings.supabase_service_role_key,
                                   "Authorization": "Bearer " + settings.supabase_service_role_key})
        body, _headers = store._open_supabase_request_with_headers(request)
        data = json.loads(body)
        if not isinstance(data, dict) or data.get("id") != bucket:
            return {**result, "code": "STORAGE_RESPONSE"}
        return {**result, "ok": True}
    except Exception as error:
        causes, current = [], error
        while current is not None and len(causes) < 8 and current not in causes:
            causes.append(current)
            current = getattr(current, "__cause__", None) or getattr(current, "reason", None)
        http = next((e for e in causes if isinstance(e, HTTPError)), None)
        if http is not None:
            return {**result, "code": "STORAGE_HTTP", "httpStatus": http.code}
        if any(isinstance(e, TimeoutError) for e in causes):
            tls = any("handshake" in str(e).lower() for e in causes)
            return {**result, "code": "STORAGE_TLS_TIMEOUT" if tls else "STORAGE_TIMEOUT"}
        return {**result, "code": "STORAGE_REQUEST"}

print(json.dumps(probe()))
`;

export async function probeStorage({python,backendRoot,canonicalBackendRoot,runnerPath,env=process.env}, dependencies={}) {
  const started = Date.now();
  const base = {scope:'bucket-readiness',objectReadVerified:false};
  const fail = (code,httpStatus) => ({...base,ok:false,elapsedMs:Date.now()-started,
    failure:{code,message:MESSAGES[code],...(Number.isInteger(httpStatus) && httpStatus>=100 && httpStatus<=599 ? {httpStatus}: {})}});
  let values;
  try {values = readCanonicalBackendEnv(runnerPath,canonicalBackendRoot,env);}
  catch {return fail('STORAGE_CONFIG');}
  const childEnv = {
    ...env,...values,
    MULTIMIX_SUPABASE_URL:values.MULTIMIX_SUPABASE_URL ?? values.SUPABASE_URL ?? '',
    MULTIMIX_SUPABASE_SERVICE_ROLE_KEY:values.MULTIMIX_SUPABASE_SERVICE_ROLE_KEY ?? values.SUPABASE_SERVICE_ROLE_KEY ?? '',
    MULTIMIX_S3_BUCKET:values.MULTIMIX_S3_BUCKET ?? 'multimix-artifacts',
    SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',
    MULTIMIX_DATABASE_URL:'sqlite:///:memory:',PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',
  };
  let stdout;
  try {
    ({stdout} = await (dependencies.execute ?? executeFile)(python,['-c',STORAGE_PROBE_SCRIPT],{
      cwd:backendRoot,env:childEnv,windowsHide:true,encoding:'utf8',
      timeout:STORAGE_PREFLIGHT_BUDGET_MS,maxBuffer:64*1024,
    }));
  } catch(error) {
    // execFile errors may contain the entire command, stderr and credentials.
    return fail(error.killed ? 'STORAGE_PREFLIGHT_TIMEOUT' : 'STORAGE_PREFLIGHT_PROCESS');
  }
  let report;
  try {report=JSON.parse(stdout);}
  catch {return fail('STORAGE_RESPONSE');}
  if (report?.ok === false) return fail(Object.hasOwn(MESSAGES,report.code) ? report.code : 'STORAGE_RESPONSE',report.httpStatus);
  if (report?.ok !== true || report.scope !== base.scope || report.objectReadVerified !== false
      || !Number.isInteger(report.socketTimeoutSeconds) || report.socketTimeoutSeconds < 1
      || !Number.isInteger(report.maxAttempts) || report.maxAttempts < 1) return fail('STORAGE_RESPONSE');
  return {...base,ok:true,elapsedMs:Date.now()-started,
    socketTimeoutSeconds:report.socketTimeoutSeconds,maxAttempts:report.maxAttempts};
}
