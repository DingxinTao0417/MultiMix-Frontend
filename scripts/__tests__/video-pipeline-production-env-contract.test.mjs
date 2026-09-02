import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { cleanupRetainedE2ERun } from "../e2e-run-lifecycle.mjs";

const scriptsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runnerPath = path.join(scriptsRoot, "run-video-pipeline-production-e2e.mjs");
const productionSpecPath = path.resolve(scriptsRoot, "..", "e2e", "video-pipeline-production.spec.ts");
const retainedExportSpecPath = path.resolve(scriptsRoot, "..", "e2e", "video-pipeline-retained-export.spec.ts");

function loadRunnerEnvParser() {
  const source = fs.readFileSync(runnerPath, "utf8");
  const functionSource = source.match(
    /const dotenvReferencePattern[\s\S]*?\r?\n}\r?\n\r?\nconst baseCanonicalEnv/,
  )?.[0].replace(/\r?\n\r?\nconst baseCanonicalEnv$/, "");

  assert.ok(functionSource, "production E2E env parser is missing");
  return new Function("fs", `"use strict"; ${functionSource}; return parseEnvFile;`)(fs);
}

test("production video E2E help exits before creating an isolated run", () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "multimix-video-e2e-help-"),
  );
  const backendRoot = path.join(temporaryRoot, "backend");
  const runId = `help-${Date.now()}-${process.pid}`;
  const runtimeRunDir = path.join(
    os.homedir(),
    "Desktop",
    "multimix-test-results",
    "e2e-runtime",
    "video-pipeline-production",
    runId,
  );

  fs.mkdirSync(
    path.join(backendRoot, "app", "video_pipelines", "unified"),
    { recursive: true },
  );
  fs.writeFileSync(
    path.join(backendRoot, "app", "video_pipelines", "unified", "activation.yaml"),
    "active_versions:\n  explainer: v1\n",
    "utf8",
  );

  try {
    const result = spawnSync(process.execPath, [runnerPath, "--help"], {
      cwd: scriptsRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MULTIMIX_CANONICAL_BACKEND_ROOT: backendRoot,
        MULTIMIX_BACKEND_ROOT: backendRoot,
        VIDEO_PIPELINE_VIDEO_TYPE: "explainer",
        VIDEO_PIPELINE_RUN_ID: runId,
        VIDEO_PIPELINE_RESULT_DIR: path.join(temporaryRoot, "results"),
        VIDEO_PIPELINE_VISION_SERVICE_URL: "http://127.0.0.1:1",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
    assert.equal(fs.existsSync(runtimeRunDir), false);
  } finally {
    if (fs.existsSync(runtimeRunDir)) {
      cleanupRetainedE2ERun({
        suite: "video-pipeline-production",
        runId,
        confirmed: true,
      });
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("production video E2E exposes a fixed plain-language generation instruction for saved-library A/B runs", () => {
  const runnerSource = fs.readFileSync(runnerPath, "utf8");
  const browserSource = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(runnerSource, /VIDEO_PIPELINE_GENERATION_INSTRUCTION/);
  assert.match(
    runnerSource,
    /generationInstructionSha256:\s*generationInstructionOverride\s*\?\s*crypto\.createHash\("sha256"\)/,
  );
  assert.match(
    runnerSource,
    /generationInstruction:\s*generationInstructionOverride \|\| null/,
  );
  assert.match(
    runnerSource,
    /VIDEO_PIPELINE_GENERATION_INSTRUCTION:\s*generationInstructionOverride/,
  );
  assert.match(
    browserSource,
    /const qaGenerationInstructionOverride = \(process\.env\.VIDEO_PIPELINE_GENERATION_INSTRUCTION \?\? ""\)\.trim\(\)/,
  );
  assert.match(
    browserSource,
    /inputProfile === "explainer_saved_library_simple"\s*\? qaGenerationInstructionOverride/,
  );
});

test("production video E2E can widen only the isolated backend vision timeout", () => {
  const runnerSource = fs.readFileSync(runnerPath, "utf8");

  assert.match(runnerSource, /VIDEO_PIPELINE_VISION_TIMEOUT_SECONDS/);
  assert.match(
    runnerSource,
    /MULTIMIX_VISION_TIMEOUT_SECONDS:\s*visionTimeoutSecondsOverride\s*\|\|\s*canonicalEnv\.MULTIMIX_VISION_TIMEOUT_SECONDS/,
  );
  assert.match(
    runnerSource,
    /visionTimeoutSecondsOverride:\s*visionTimeoutSecondsOverride \|\| null/,
  );
});

test("production video E2E can widen only the candidate MP4 range download timeout", () => {
  const runnerSource = fs.readFileSync(runnerPath, "utf8");
  const browserSource = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(runnerSource, /VIDEO_PIPELINE_CANDIDATE_RANGE_TIMEOUT_MS/);
  assert.match(
    runnerSource,
    /VIDEO_PIPELINE_CANDIDATE_RANGE_TIMEOUT_MS:\s*String\(candidateRangeTimeoutMs\)/,
  );
  assert.match(
    browserSource,
    /process\.env\.VIDEO_PIPELINE_CANDIDATE_RANGE_TIMEOUT_MS \?\? 60_000/,
  );
  assert.match(
    browserSource,
    /VIDEO_PIPELINE_CANDIDATE_RANGE_TIMEOUT_MS must be a positive integer/,
  );
});

test("saved-library A/B instruction override preserves the existing default conversation", () => {
  const browserSource = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(
    browserSource,
    /qaGenerationInstructionOverride\s*\? qaGenerationInstructionOverride\s*:\s*`用我已有的家装素材，做一条家装服务宣传讲解视频\$\{requireMgInstruction\}`/,
  );
});

test("saved-library A/B instruction links the uploaded media to the plain-language request", () => {
  const browserSource = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(
    browserSource,
    /inputProfile === "explainer_saved_library_simple"\s*&&\s*Boolean\(qaGenerationInstructionOverride\)[\s\S]{0,240}?requiredLinkedAssetIds\.push\(mediaAsset\.id\)/,
  );
});

test("production video E2E does not hard-code semantic rejection of a particular saved asset", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.doesNotMatch(source, /generic hammer/i);
  assert.doesNotMatch(source, /savedLibraryMediaAssetIds\[5\]/);
});

test("production video E2E isolates backend settings with the current MULTIMIX prefix", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.doesNotMatch(source, /CHANGEIN_/);
  for (const variable of [
    "MULTIMIX_AUTH_PROVIDER",
    "MULTIMIX_DATABASE_URL",
    "MULTIMIX_ARTIFACT_DIR",
    "MULTIMIX_TEST_LLM_SNAPSHOT_DIR",
    "MULTIMIX_LLM_BASE_URL",
    "MULTIMIX_QWEN_FALLBACK_ENABLED",
    "MULTIMIX_VISION_SERVICE_URL",
    "MULTIMIX_CORS_ORIGINS",
  ]) {
    assert.match(source, new RegExp(variable));
  }
});

test("production video E2E uses configured vision service and fails closed for an unconfigured local provider", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(
    source,
    /process\.env\.VIDEO_PIPELINE_VISION_SERVICE_URL\s*\?\?\s*canonicalEnv\.MULTIMIX_VISION_SERVICE_URL/,
  );
  assert.match(source, /Local vision service requires a configured Qwen\/DashScope API key/);
  assert.match(source, /VISION_QWEN_API_KEY:\s*effectiveVisionApiKey/);
  assert.match(source, /VISION_QWEN_BASE_URL:\s*effectiveVisionBaseUrl/);
  assert.match(
    source,
    /VISION_REMOTE_HTTPS_PROXY:\s*`http:\/\/127\.0\.0\.1:\$\{providerProxy\.port\}`/,
  );
  assert.match(source, /VISION_REMOTE_PROXY_HOSTS:\s*providerProxyHosts\.join\(","\)/);
});

test("production video E2E can disable BGM without dereferencing an absent catalog", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(source, /const stagedBgm = !isResume && expectBgm/);
  assert.match(
    source,
    /const productMediaManifestRef = \(\s*isResume \|\| savedLibraryInputProfile \|\| expectedVideoType === "presenter"\s*\)\s*\? ""\s*: stageApprovedProductMediaCatalog\(\)/,
  );
  assert.doesNotMatch(source, /stagedBgm\.manifestRef/);
  assert.doesNotMatch(source, /stagedBgm\.defaultCatalogId/);
  assert.match(source, /MULTIMIX_VIDEO_BGM_MANIFEST_REF:\s*effectiveBgm\.manifestRef/);
  assert.match(source, /MULTIMIX_VIDEO_BGM_DEFAULT_CATALOG_ID:\s*effectiveBgm\.defaultCatalogId/);
});

test("production video E2E records explicit no-BGM state alongside the public project track", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /const bgmTrack = videoProject\?\.tracks\?\.find/);
  assert.match(source, /expect\(bgmTrack\?\.type\)\.toBe\("audio"\)/);
  assert.match(source, /intentional no-BGM degradation must not create a music track/);
  assert.match(source, /const bgmChoice = videoProject\?\.metadata\?\.bgm_choice/);
  assert.match(source, /intentional no-BGM degradation must persist its explicit disabled state/);
  assert.match(source, /intentional no-BGM degradation must persist its selection reason/);
  assert.match(source, /bgmEnabled: bgmChoice\?\.enabled/);
  assert.match(source, /bgmSelectionReason: bgmChoice\?\.selection_reason/);
});

test("production video E2E resolves safe dotenv references before forwarding provider settings", () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "multimix-video-e2e-env-"),
  );
  const envPath = path.join(temporaryRoot, ".env.local");
  fs.writeFileSync(
    envPath,
    [
      "MULTIMIX_EMBEDDING_API_KEY=resolved-provider-key",
      "MULTIMIX_QWEN_FALLBACK_API_KEY=${MULTIMIX_EMBEDDING_API_KEY}",
      "UNRESOLVED=${MISSING_PROVIDER_KEY}",
      "NON_EXECUTABLE=$(whoami)",
      "PLAIN_VALUE=unchanged",
    ].join("\n"),
    "utf8",
  );

  try {
    const parseEnvFile = loadRunnerEnvParser();
    const parsed = parseEnvFile(envPath);

    assert.equal(parsed.MULTIMIX_QWEN_FALLBACK_API_KEY, "resolved-provider-key");
    assert.equal(parsed.UNRESOLVED, "${MISSING_PROVIDER_KEY}");
    assert.equal(parsed.NON_EXECUTABLE, "$(whoami)");
    assert.equal(parsed.PLAIN_VALUE, "unchanged");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("production video E2E initializes dotenv reference support before loading canonical settings", () => {
  const source = fs.readFileSync(runnerPath, "utf8");
  const resolverInitialization = source.indexOf("const dotenvReferencePattern");
  const canonicalSettingsLoad = source.indexOf("const baseCanonicalEnv");

  assert.ok(resolverInitialization > -1, "dotenv reference resolver is missing");
  assert.ok(canonicalSettingsLoad > -1, "canonical settings load is missing");
  assert.ok(
    resolverInitialization < canonicalSettingsLoad,
    "dotenv reference resolver must initialize before canonical settings are loaded",
  );
});

test("production video E2E writes a timing ledger for runner and browser stages", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(source, /VIDEO_PIPELINE_TIMING_PATH:/);
  for (const stage of [
    "schema_initialization",
    "vision_service_startup",
    "backend_startup",
    "frontend_startup",
    "playwright",
    "candidate_video_verification",
    "qa_report",
  ]) {
    assert.match(source, new RegExp(`lifecycle\\.measure\\("${stage}"`));
  }
  assert.match(source, /E2E stage timings \(slowest first\)/);
  assert.match(source, /Browser pipeline timings \(slowest first\)/);
});

test("production video E2E lets the API authorize failed retries and rehydrates isolated source media", () => {
  const source = fs.readFileSync(runnerPath, "utf8");
  const retainedJobReader = source.match(
    /async function readRetainedVideoJob[\s\S]*?\r?\n}\r?\n\r?\nasync function rehydrateRetainedSourceExcerpt/,
  )?.[0] ?? "";
  const rehydration = source.match(
    /async function rehydrateRetainedSourceExcerpt[\s\S]*?\r?\n}\r?\n\r?\nasync function authenticateRetainedVideoUser/,
  )?.[0] ?? "";

  assert.match(source, /async function resumeRetainedVideoJob/);
  assert.match(source, /from app\.services\.video_job_dispatch import dispatch_video_job/);
  assert.match(retainedJobReader, /VideoRenderJob\.public_id\.like\(/);
  assert.match(retainedJobReader, /video-job-%/);
  assert.match(source, /job\.status === "failed"/);
  assert.match(source, /job\.status === "completed" && job\.renderStage === "done"/);
  assert.doesNotMatch(source, /if \(!job\.retryable\)/);
  assert.match(source, /\/jobs\/\$\{job\.publicId\}\/retry/);
  assert.match(source, /Date\.now\(\) < deadline/);
  assert.match(source, /async function rehydrateRetainedSourceExcerpt/);
  assert.match(
    source,
    /async function rehydrateRetainedSourceExcerpt[\s\S]*?"from app\.config import get_settings"/,
  );
  assert.match(source, /artifact_key_from_ref/);
  assert.match(source, /source excerpt resume fingerprint changed/);
  assert.match(source, /source excerpt resume ref left the isolated run namespace/);
  assert.match(rehydration, /prepare_source_clip_artifacts/);
  assert.match(rehydration, /source_clip_outcomes/);
  assert.match(rehydration, /audio_ref/);
  assert.match(rehydration, /source_fingerprint/);
  assert.match(
    source,
    /await rehydrateRetainedSourceExcerpt\(backendEnv\);[\s\S]*?await resumeRetainedVideoJob\(backendEnv\)/,
  );
  assert.match(source, /await resumeRetainedVideoJob\(backendEnv\)/);
});

test("retained video polling uses the public project readiness contract", () => {
  const source = fs.readFileSync(runnerPath, "utf8");
  const retainedJobWait = source.match(
    /async function waitForRetainedVideoJob[\s\S]*?\r?\n}\r?\n\r?\nasync function resumeRetainedVideoJob/,
  )?.[0] ?? "";

  assert.match(
    retainedJobWait,
    /current\.status === "completed" && current\.project_ready === true/,
  );
  assert.doesNotMatch(retainedJobWait, /current\.render_stage/);
});

test("retained export reads duration from the public video plan contract", () => {
  const source = fs.readFileSync(retainedExportSpecPath, "utf8");
  const start = source.indexOf("async function reselectProjectWhenDurationIsOutOfContract");
  const end = source.indexOf("function assertSourceClipIdentity", start);
  const durationRecovery = source.slice(start, end);

  assert.ok(start > -1 && end > start);
  assert.match(
    durationRecovery,
    /currentProject\.metadata\?\.video_plan\?\.duration_seconds/,
  );
  assert.doesNotMatch(durationRecovery, /creative_brief/);
});

test("production video E2E continues a completed retained project through browser export", () => {
  const source = fs.readFileSync(runnerPath, "utf8");
  const retainedSpec = fs.readFileSync(retainedExportSpecPath, "utf8");
  const seedReader = source.match(
    /async function readRetainedExportSeed[\s\S]*?\r?\n}\r?\n\r?\nasync function writeQaReport/,
  )?.[0] ?? "";

  assert.match(source, /async function readRetainedExportSeed/);
  assert.match(
    source,
    /job\.status === "completed" && job\.renderStage === "done"[\s\S]*?recoverInterruptedVideoJob\(backendEnv, \{ requireMainResume: false \}\)[\s\S]*?waitForRetainedVideoJob/,
  );
  assert.match(seedReader, /from app\.models import AssetConversation, ContentAsset, User, VideoRenderJob/);
  assert.match(seedReader, /VideoRenderJob\.public_id\.like\(/);
  assert.match(seedReader, /video-job-%/);
  assert.match(seedReader, /conversation=db\.get\(AssetConversation, job\.conversation_id\)/);
  assert.match(seedReader, /'conversationId': conversation\.public_id/);
  assert.match(seedReader, /'videoType': plan\.get\('video_type'\)/);
  assert.doesNotMatch(seedReader, /'conversationId': job\.conversation_id/);
  assert.match(source, /video-pipeline-retained-export\.spec\.ts/);
  assert.match(source, /VIDEO_PIPELINE_RETAINED_EXPORT_SEED/);
  assert.match(source, /targetSeconds/);
  assert.match(source, /minimumDurationSeconds/);
  assert.match(source, /maximumDurationSeconds/);
  assert.match(retainedSpec, /selectClosestDurationCandidate/);
  assert.match(retainedSpec, /activeSeed\.videoType === "source_excerpt"/);
  assert.match(retainedSpec, /assertPresenterSourceIdentity\(project\)/);
  assert.match(retainedSpec, /presenter original audio track is missing/);
  assert.match(retainedSpec, /twoStageEnabled: activeSeed\.videoType !== "presenter"/);
  assert.match(retainedSpec, /kind:\s*"select"[\s\S]*?candidate_id/);
  assert.match(retainedSpec, /generation-jobs/);
  assert.match(retainedSpec, /waitForCompletedProject/);
  assert.match(retainedSpec, /product_status === "failed"/);
  assert.match(retainedSpec, /视频方案 · 待确认/);
  assert.match(retainedSpec, /latest_job_public_id/);
  assert.match(retainedSpec, /project\.metadata\?\.video_workflow_stage/);
  assert.doesNotMatch(retainedSpec, /project\.workflow_stage/);
  assert.match(
    retainedSpec,
    /\/v1\/video\/projects\/\$\{value\.projectAssetId\}[\s\S]*?\/v1\/assets\/detail\/\$\{value\.projectAssetId\}/,
  );
  assert.match(
    source,
    /if \(isResume\)[\s\S]*?await verifyResumedVideoJob\(backendEnv\)[\s\S]*?frontend_startup[\s\S]*?video-pipeline-retained-export\.spec\.ts[\s\S]*?candidate_video_verification[\s\S]*?qa_report/,
  );
  assert.match(
    source,
    /SELECT status, render_stage, attempts, error_message FROM video_render_jobs WHERE public_id LIKE 'video-job-%' ORDER BY id DESC LIMIT 1/,
  );
  assert.match(retainedSpec, /\[aria-label="成片预览"\], \[title="视频工程预播"\]/);
  assert.match(retainedSpec, /initialExportState/);
  assert.match(retainedSpec, /initialExportState === "导出视频"/);
  assert.match(retainedSpec, /initialExportState === "下载成片"/);
  assert.match(retainedSpec, /unexpected retained export state/);
});

test("production video E2E warns but does not reject a final MP4 for duration drift", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(source, /durationReference/);
  assert.match(source, /!Number\.isFinite\(duration\)\s*\|\|\s*duration <= 0/s);
  assert.match(source, /duration < minimumDurationSeconds\s*\|\|\s*duration > maximumDurationSeconds/s);
  assert.match(source, /warnings\.push\([\s\S]*?duration_seconds=.*expected=/);
  assert.doesNotMatch(source, /failures\.push\([\s\S]{0,120}?duration_seconds=/);
});

test("saved-library E2E profiles do not inject an unrelated source document", () => {
  const runnerSource = fs.readFileSync(runnerPath, "utf8");
  const browserSource = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(browserSource, /const savedLibraryInputProfile = inputProfile === "explainer_saved_library_simple"\s*\|\| singleImageCreativeDraft/);
  assert.match(browserSource, /!savedLibraryInputProfile[\s\S]*?VIDEO_PIPELINE_SOURCE_DOCUMENT is missing/);
  assert.match(browserSource, /if \(savedLibraryInputProfile\)[\s\S]*?multimix_local_user/);
  assert.match(runnerSource, /const savedLibraryInputProfile = inputProfile === "explainer_saved_library_simple"\s*\|\| singleImageCreativeDraft/);
  assert.match(runnerSource, /const sourceDocumentFingerprint = savedLibraryInputProfile\s*\? null\s*:\s*fingerprintFile\(sourceDocument\)/);
});

test("quality-baseline E2E fails closed without approved product or presenter inputs", () => {
  const runnerSource = fs.readFileSync(runnerPath, "utf8");
  const browserSource = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(runnerSource, /const qualityBaselineRun = process\.env\.VIDEO_PIPELINE_QUALITY_BASELINE === "true"/);
  assert.match(runnerSource, /VIDEO_PIPELINE_PRESENTER_SOURCE_VIDEO/);
  assert.match(runnerSource, /VIDEO_PIPELINE_PRESENTER_SOURCE_APPROVAL_REF/);
  assert.match(runnerSource, /quality baseline explainer requires approved product media/);
  assert.match(runnerSource, /quality baseline presenter requires an approved source video/);
  assert.match(runnerSource, /qualityBaselineRun,/);
  assert.match(runnerSource, /presenterSourceApprovalRef,/);
  assert.ok(
    runnerSource.indexOf("const qualityBaselineInputs =")
      < runnerSource.indexOf("const lifecycle ="),
    "quality-baseline preflight must run before creating its isolated runtime",
  );
  assert.match(browserSource, /const qualityBaselineRun = process\.env\.VIDEO_PIPELINE_QUALITY_BASELINE === "true"/);
  assert.match(browserSource, /quality baseline explainer cannot use a saved-library creative-draft profile/);
  assert.match(runnerSource, /explainer_single_image_draft is creative-draft-only and cannot run as a quality baseline/);
  assert.match(browserSource, /quality baseline presenter requires a source approval reference/);
  assert.match(browserSource, /VIDEO_PIPELINE_PRESENTER_SOURCE_VIDEO/);
});

test("quality-baseline presenter accepts one approved original from the neutral saved-library input", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(
    source,
    /const isQualityBaselinePresenter = qualityBaselineRun && expectedVideoType === "presenter"/,
  );
  assert.match(
    source,
    /const requiredSavedLibraryMediaCount = isQualityBaselinePresenter \|\| singleImageCreativeDraft \? 1 : 3/,
  );
  assert.match(
    source,
    /savedLibraryMediaFiles\.length,[\s\S]*?requiredSavedLibraryMediaCount/,
  );
  assert.match(source, /quality-baseline presenter requires exactly one approved source video/);
});

test("quality-baseline presenter keeps the source video extension in its upload filename", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(
    source,
    /name:\s*`用户确认口播原片\$\{path\.extname\(presenterSourceVideo\)\}`/,
  );
});

test("quality-baseline presenter accepts every API-supported source video format and preserves WebM MIME", () => {
  const runnerSource = fs.readFileSync(runnerPath, "utf8");
  const browserSource = fs.readFileSync(productionSpecPath, "utf8");

  for (const source of [runnerSource, browserSource]) {
    assert.match(
      source,
      /const supportedVideoExtensions = new Set\(\["\.mp4", "\.mov", "\.webm", "\.mkv"\]\)/,
    );
  }
  assert.match(browserSource, /const isVideo = supportedVideoExtensions\.has\(extension\)/);
  assert.match(browserSource, /"\.webm", "video\/webm"/);
  assert.match(
    runnerSource,
    /supportedVideoExtensions\.has\(path\.extname\(String\(value\?\.path \?\? ""\)\)\.toLowerCase\(\)\)/,
  );
});

test("quality-baseline explainer records only the product inputs it actually passes on", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(
    source,
    /const usesSavedLibraryMedia = savedLibraryInputProfile\s*\|\| expectedVideoType === "presenter"/,
  );
  assert.match(
    source,
    /const savedLibraryMediaFiles = usesSavedLibraryMedia\s*\?\s*\(qualityBaselineRun && expectedVideoType === "presenter"[\s\S]*?: "\[\]";/,
  );
  assert.match(source, /savedLibraryMedia: configuredInputFingerprints\(savedLibraryMediaFiles\)/);
  assert.match(source, /const usesRemoteArtifactStorage = expectedVideoType === "source_excerpt"\s*\|\| configuredInputIncludesVideo\(savedLibraryMediaFiles\)/);
});

test("single-image creative-draft E2E is explicit, non-baseline, and user-material-only", () => {
  const runnerSource = fs.readFileSync(runnerPath, "utf8");
  const browserSource = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(runnerSource, /const singleImageCreativeDraft = inputProfile === "explainer_single_image_draft"/);
  assert.match(runnerSource, /explainer_single_image_draft requires VIDEO_PIPELINE_VIDEO_TYPE=explainer/);
  assert.match(runnerSource, /explainer_single_image_draft requires VIDEO_PIPELINE_SAVED_LIBRARY_MEDIA_FILES/);
  assert.match(runnerSource, /creativeDraftOnly: singleImageCreativeDraft/);
  assert.match(runnerSource, /创意草稿（非公开、非黄金基线）/);
  assert.match(browserSource, /const singleImageCreativeDraft = inputProfile === "explainer_single_image_draft"/);
  assert.match(browserSource, /single-image creative draft requires exactly one user image/);
  assert.match(browserSource, /single-image creative draft accepts one product image, not a video source/);
  assert.match(browserSource, /\|\| singleImageCreativeDraft[\s\S]*?requiredLinkedAssetIds\.push\(mediaAsset\.id\)/);
  assert.match(browserSource, /不得把本稿写成可公开发布的事实承诺/);
  assert.match(browserSource, /creativeDraftOnly: singleImageCreativeDraft/);
  assert.match(browserSource, /single-image creative draft must keep its one user image as every scene's primary visual/);
  assert.match(browserSource, /expectedVideoType !== "presenter"\s*&& !singleImageCreativeDraft[\s\S]*?assertDistinctPersistedPrimaryVisualWindows/);
});

test("quality-baseline presenter asks to preserve the source ratio without forcing an output ratio", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");
  const generationInstructionStart = source.indexOf("const generationInstruction");
  const branchStart = source.indexOf(
    'expectedVideoType === "presenter"',
    generationInstructionStart,
  );
  const branchEnd = source.indexOf('expectedVideoType === "source_excerpt"', branchStart);
  const presenterInstruction = source.slice(branchStart, branchEnd);

  assert.ok(generationInstructionStart >= 0 && branchStart >= 0 && branchEnd > branchStart);
  assert.match(presenterInstruction, /保持原片比例/);
  assert.doesNotMatch(presenterInstruction, /targetRatioAcceptance\.instructionLabel/);
});

test("production video E2E keeps the browser download action separate from candidate retrieval", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /await exportButton\.click\(\{ timeout: 30_000 \}\);/);
  assert.match(source, /toBe\("再次下载"\)/);
  assert.match(
    source,
    /\/v1\/video\/media\?ref=\$\{encodeURIComponent\(mp4Ref\)\}/,
  );
  assert.match(source, /async function downloadCandidateMp4ByRange/);
  assert.match(source, /const CANDIDATE_MP4_RANGE_CHUNK_BYTES = 1024 \* 1024;/);
  assert.match(source, /process\.env\.VIDEO_PIPELINE_CANDIDATE_RANGE_TIMEOUT_MS \?\? 60_000/);
  assert.match(source, /range: "bytes=0-0"/);
  assert.match(source, /range: `bytes=\$\{start\}-\$\{end\}`/);
  assert.match(source, /Content-Range.*total size|candidate MP4 range response/i);
  assert.match(source, /timeout: CANDIDATE_MP4_RANGE_TIMEOUT_MS/);
  assert.match(source, /Buffer\.concat\(chunks\)/);
  assert.doesNotMatch(source, /const candidateBytes = await candidateResponse\.body\(\);/);
  assert.doesNotMatch(source, /page\.waitForEvent\("download"/);
  assert.doesNotMatch(source, /download\.saveAs\(/);
});

test("production video E2E observes both supported asynchronous export task responses", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /const exportTaskResponsePaths = \[/);
  assert.match(
    source,
    /`\$\{apiBase\}\/v1\/video\/projects\/\$\{projectAsset!\.id\}\/exports\/register`/,
  );
  assert.match(
    source,
    /`\$\{apiBase\}\/v1\/video\/projects\/\$\{projectAsset!\.id\}\/exports`/,
  );
  assert.match(source, /exportTaskResponsePaths\.includes\(response\.url\(\)\)/);
});

test("production video E2E reads the persisted export task before long render polling", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");
  const stageStart = source.indexOf('measureE2EStage("export_preview_ready"');
  const stageEnd = source.indexOf('measureE2EStage("export_browser_render"', stageStart);
  const exportStage = source.slice(stageStart, stageEnd);
  const responseWait = exportStage.indexOf("const createResponse = await exportCreateResponse;");
  const currentTaskRead = exportStage.indexOf("/exports/current", responseWait);
  const renderPolling = exportStage.indexOf("assertExportHasNotFailed(page, exportButton");

  assert.ok(stageStart >= 0 && stageEnd > stageStart);
  assert.ok(responseWait >= 0 && currentTaskRead > responseWait);
  assert.doesNotMatch(exportStage, /createResponse\.json\(/);
  assert.ok(
    renderPolling > currentTaskRead,
    "the persisted task must be read before long render polling starts",
  );
});

test("production video browser flow records its major user-visible pipeline waits", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /VIDEO_PIPELINE_TIMING_PATH/);
  for (const stage of [
    "workspace_entry",
    "document_upload",
    "director_generation",
    "video_project_ready",
    "final_browse_recovery",
    "export_preflight",
    "export_preview_ready",
    "export_browser_render",
    "export_download",
  ]) {
    assert.match(source, new RegExp(`measureE2EStage\\("${stage}"`));
  }
});

test("production video E2E writes a pending human review only after its candidate MP4 exists", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");
  const candidateWrite = source.indexOf('fs.writeFileSync(outputPath, candidateBytes)');
  const resultWrite = source.indexOf('path.join(resultDir, "browser-result.json")');
  const reviewWrite = source.indexOf("const humanReviewReportPath = writeVideoHumanReviewReport");

  assert.ok(candidateWrite > -1, "candidate MP4 must be written before review evidence");
  assert.ok(resultWrite > candidateWrite, "browser result must follow the candidate file");
  assert.ok(reviewWrite > resultWrite, "human review must follow the candidate and result record");
  assert.match(source, /import \{ writeVideoHumanReviewReport \} from "\.\.\/scripts\/video-human-review-report\.mjs"/);
  assert.match(source, /humanReviewStatus:\s*"pending"/);
  assert.match(source, /humanReviewReport:\s*"human-review\.md"/);
  assert.match(
    source,
    /writeVideoHumanReviewReport\(\{[\s\S]*?candidateVideo:\s*candidateVideoPath,[\s\S]*?videoType:\s*expectedVideoType,[\s\S]*?creativeDraftOnly:\s*singleImageCreativeDraft,[\s\S]*?qualityWarnings:\s*projectQualityReport!\.warnings \?\? \[\]/,
  );
  assert.match(source, /expect\(fs\.existsSync\(humanReviewReportPath\)\)\.toBe\(true\)/);
});

test("production video E2E discovers active video types and asserts the server plan contract", () => {
  const runnerSource = fs.readFileSync(runnerPath, "utf8");
  const specSource = fs.readFileSync(productionSpecPath, "utf8");

  assert.doesNotMatch(
    runnerSource,
    /activeVideoTypes\.includes\("presenter"\)/,
    "an explicitly selected active video type must not be blocked by another active type",
  );
  assert.doesNotMatch(
    specSource,
    /active\.some\(\(videoType\) => !allowed\.has/,
    "the browser spec must validate its selected type instead of rejecting the full registry",
  );
  assert.match(runnerSource, /if \(activeVideoTypes\.length === 0\)/);
  assert.match(specSource, /if \(active\.length === 0\)/);
  assert.match(specSource, /activation\.yaml/);
  assert.match(specSource, /activeVideoTypes/);
  assert.match(runnerSource, /for \(const videoType of activeVideoTypes\)/);
  assert.match(runnerSource, /VIDEO_PIPELINE_VIDEO_TYPE: videoType/);
  assert.match(specSource, /persistedVideoPlan\.video_type/);
  assert.match(specSource, /expect\(persistedVideoPlan\.video_type\)\.toBe\(expectedVideoType\)/);
  assert.doesNotMatch(specSource, /expectedPipelineCode/);
  assert.doesNotMatch(specSource, /pipelineCode/);
  assert.doesNotMatch(specSource, /VIDEO_PIPELINE_SCENARIO/);
  assert.doesNotMatch(runnerSource, /VIDEO_PIPELINE_SCENARIO/);
});

test("production video E2E fails before confirmation when required understanding or routing is wrong", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");
  const understandingGate = source.indexOf("saved-library source understanding failed");
  const generationInstruction = source.indexOf("const generationInstruction");
  const routeGate = source.indexOf("director selected wrong video type");
  const confirmationClick = source.indexOf("await confirmButton.click()");

  assert.ok(understandingGate > -1 && understandingGate < generationInstruction);
  assert.ok(routeGate > generationInstruction && routeGate < confirmationClick);
  assert.match(source, /understanding\?\.status/);
  assert.match(source, /directorVideoPlan\.video_type/);
});

test("production E2E no longer exposes the retired demonstration type or input contract", () => {
  const specSource = fs.readFileSync(productionSpecPath, "utf8");
  const runnerSource = fs.readFileSync(runnerPath, "utf8");

  assert.doesNotMatch(specSource, /\bdemonstration\b/i);
  assert.doesNotMatch(runnerSource, /\bdemonstration\b/i);
  assert.doesNotMatch(specSource, /VIDEO_PIPELINE_DEMONSTRATION_MEDIA_FILES/);
  assert.doesNotMatch(runnerSource, /VIDEO_PIPELINE_DEMONSTRATION_MEDIA_FILES/);
  assert.match(specSource, /VIDEO_PIPELINE_SAVED_LIBRARY_MEDIA_FILES/);
  assert.match(runnerSource, /VIDEO_PIPELINE_SAVED_LIBRARY_MEDIA_FILES/);
});

test("source excerpt E2E uses the dedicated analyze and candidate-selection flow", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /\/v1\/long-form\/sources\/upload/);
  assert.match(source, /kind:\s*"analyze"[\s\S]*?source_asset_id/);
  assert.match(source, /kind:\s*"select"[\s\S]*?analysis_asset_id[\s\S]*?candidate_id/);
  assert.match(source, /analysisMetadata\.top_candidates/);
  assert.match(source, /selectClosestDurationCandidate/);
  assert.match(source, /candidate_id:\s*selectedCandidateId/);
  assert.doesNotMatch(source, /candidate_id:\s*topCandidateIds\[0\]/);
  assert.match(source, /source_fingerprint/);
  assert.match(source, /sourceExcerptExpectedFingerprint/);
  assert.match(source, /\^\[a-f0-9\]\{64\}\$/);
  assert.doesNotMatch(source, /toMatch\(\/\^sha256:\//);
  assert.doesNotMatch(source, /sourceExcerptLinkedAssetIds/);
});

test("source excerpt E2E isolates public ASR storage and precisely cleans its remote writes", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(source, /expectedVideoType === "source_excerpt"/);
  assert.match(source, /MULTIMIX_ARTIFACT_KEY_PREFIX:/);
  assert.match(source, /e2e\/video-pipeline-production\/\$\{runId\}/);
  assert.match(source, /MULTIMIX_ARTIFACT_WRITE_LEDGER_PATH:/);
  assert.match(source, /cleanupRemoteArtifactWrites/);
  assert.match(source, /await cleanupRemoteArtifactWrites\(decisionAuditEnv\)/);
  assert.doesNotMatch(source, /delete.*bucket/i);
});

test("saved-library video E2E uses the same isolated remote storage for cloud ASR", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(source, /function configuredInputIncludesVideo/);
  assert.match(source, /supportedVideoExtensions\.has\(path\.extname\(String\(value\?\.path \?\? ""\)\)\.toLowerCase\(\)\)/);
  assert.match(
    source,
    /const usesRemoteArtifactStorage = expectedVideoType === "source_excerpt"\s*\|\| configuredInputIncludesVideo\(savedLibraryMediaFiles\)/,
  );
  assert.match(source, /MULTIMIX_SUPABASE_URL: usesRemoteArtifactStorage/);
  assert.match(source, /MULTIMIX_SUPABASE_SERVICE_ROLE_KEY: usesRemoteArtifactStorage/);
  assert.match(source, /MULTIMIX_ARTIFACT_KEY_PREFIX: usesRemoteArtifactStorage/);
  assert.match(source, /MULTIMIX_ARTIFACT_WRITE_LEDGER_PATH: remoteWriteLedgerPath/);
  assert.match(source, /await cleanupRemoteArtifactWrites\(decisionAuditEnv\)/);
});

test("saved-library media upload has an explicit acceptance timeout", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /const mediaUploadTimeoutMs = Number\(/);
  assert.match(source, /VIDEO_PIPELINE_MEDIA_UPLOAD_TIMEOUT_MS/);
  assert.match(source, /timeout: mediaUploadTimeoutMs/);
});

test("saved-library video E2E continues the presenter cleanup confirmation before the recommended direction", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /async function confirmPresenterCleanupIfRequired/);
  assert.match(source, /确认清理并进入导演方案/);
  assert.match(source, /presenter cleanup confirmation must queue a director job/);
  assert.match(source, /await confirmPresenterCleanupIfRequired\(/);
});

test("production E2E treats presenter as an active type and confirms its single recommendation", () => {
  const specSource = fs.readFileSync(productionSpecPath, "utf8");
  const runnerSource = fs.readFileSync(runnerPath, "utf8");

  assert.match(specSource, /type ActiveVideoType = [^;]*"presenter"/);
  assert.match(specSource, /function videoProjectConfirmationCard/);
  assert.match(specSource, /getByLabel\("口播型方案 · 待确认"\)/);
  assert.match(specSource, /videoParameters\?\.ratio_source\)\.toBe\("source_video"\)/);
  assert.match(specSource, /videoParameters\?\.voice_source\)\.toBe\("source_audio"\)/);
  assert.match(specSource, /videoParameters\?\.ai_voice_enabled\)\.toBe\(false\)/);
  assert.match(specSource, /expect\(narrationTrack\?\.type\)\.toBe\("audio"\)/);
  assert.match(specSource, /expect\(narrationTrack\?\.name\)\.toBe\("原声"\)/);
  assert.match(specSource, /expect\(narrationTrack\?\.elements\)\.toHaveLength\(expectedSceneCount\)/);
  assert.doesNotMatch(specSource, /narrationTrack\?\.logicalLayer/);
  assert.doesNotMatch(specSource, /videoProject\?\.orchestration\?\.tts_segments/);
  assert.match(specSource, /presenter subtitle cues must be public and non-empty/);
  assert.match(specSource, /expect\(String\(element\.displayText \?\? element\.content \?\? ""\)\.trim\(\)\)\.not\.toBe\(""\)/);
  assert.match(specSource, /expect\(Number\(element\.duration \?\? 0\)\)\.toBeGreaterThan\(0\)/);
  assert.doesNotMatch(specSource, /directorVideoPlan\.director_plan/);
  assert.match(specSource, /pendingCard\.getByRole\("article", \{ name: \/推荐方案\/ \}\)/);
  assert.match(specSource, /getByRole\("spinbutton", \{ name: "目标时长（秒）" \}\)/);
  assert.match(specSource, /fill\(String\(targetSeconds\)\)/);
  assert.doesNotMatch(
    specSource,
    /savedLibraryInputProfile\s*&& expectedVideoType !== "presenter"[\s\S]{0,300}?multimix_local_user/,
  );
  assert.match(
    specSource,
    /savedLibraryInputProfile\s*&& expectedVideoType !== "presenter"[\s\S]{0,300}?saved-library input must let the director choose/,
  );
  assert.match(
    specSource,
    /if \(expectedVideoType !== "presenter"\) \{[\s\S]{0,300}?confirmedPlanCard[\s\S]{0,300}?confirmationLabel/,
  );
  assert.match(runnerSource, /const twoStageEnabled = expectedVideoType !== "presenter"/);
});

test("retained production E2E checkpoints remote artifacts before cleanup and restores them before resume", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(source, /async function checkpointRemoteArtifactWrites/);
  assert.match(source, /async function restoreCheckpointedRemoteArtifacts/);
  assert.match(source, /retained-remote-artifacts/);
  assert.match(source, /manifest\.json/);
  assert.match(source, /sha256/);
  assert.match(source, /content_type/);
  assert.match(source, /remote artifact checkpoint ref escaped the current E2E namespace/);
  assert.match(source, /remote artifact checkpoint digest changed/);
  assert.match(source, /const checkpointAttempts = 3/);
  assert.match(source, /checkpoint remote artifacts attempt \$\{attempt\}/);
  assert.match(source, /if current and target\.is_file\(\):/);
  assert.match(source, /if len\(cached\) != int\(current\.get\('size_bytes'\) or -1\)/);
  assert.match(source, /continue/);
  assert.match(source, /remote artifact checkpoint path escaped its cache directory/);
  assert.match(
    source,
    /await checkpointRemoteArtifactWrites\(decisionAuditEnv\);[\s\S]*?await cleanupRemoteArtifactWrites\(decisionAuditEnv\)/,
  );
  assert.match(
    source,
    /await restoreCheckpointedRemoteArtifacts\(backendEnv\);[\s\S]*?await rehydrateRetainedSourceExcerpt\(backendEnv\)/,
  );
});

test("production video E2E can skip the remote checkpoint for a non-resumable acceptance run", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(
    source,
    /const retainRemoteCheckpoint = process\.env\.VIDEO_PIPELINE_RETAIN_REMOTE_CHECKPOINT !== "false"/,
  );
  assert.match(
    source,
    /if \(retainRemoteCheckpoint\) \{\s*await checkpointRemoteArtifactWrites\(decisionAuditEnv\);\s*remoteCheckpointReady = true;\s*\}[\s\S]*?await cleanupRemoteArtifactWrites\(decisionAuditEnv\)/,
  );
  assert.match(
    source,
    /resumeSupported: retainRemoteCheckpoint && remoteCheckpointReady && localResumeReady/,
  );
});

test("production video E2E reports durable director substage timings separately", () => {
  const runnerSource = fs.readFileSync(runnerPath, "utf8");
  const specSource = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(specSource, /director_phase_/);
  assert.match(specSource, /director_scene_/);
  assert.match(specSource, /timing_events/);
  assert.match(specSource, /progress_events/);
  assert.match(runnerSource, /Director substage timings \(slowest first\)/);
  assert.match(runnerSource, /Director per-scene timings \(slowest first\)/);
  assert.match(runnerSource, /director_phase_/);
});

test("production video E2E keeps project metrics separate from export preflight", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /quality\?stage=project/);
  assert.match(source, /quality\?stage=export_preflight/);
  assert.match(
    source,
    /const narrationCoverage = projectQualityReport\.metrics\?\.narration_coverage/,
  );
  assert.doesNotMatch(
    source,
    /const narrationCoverage = qualityReport\.metrics\?\.narration_coverage/,
  );
});

test("production video E2E treats narration as the full visible subtitle", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(
    source,
    /const visibleSubtitle = scene\.narration\?\.trim\(\) \|\| scene\.subtitle_focus/,
  );
});

test("production video E2E retries a transient transport failure while waiting for MG", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");
  const pendingIndex = source.indexOf("const pending = plannedMgScenes.filter");
  const pollStart = source.lastIndexOf("await expect", pendingIndex);
  const mgTerminalPoll = source.slice(pollStart, pendingIndex);

  assert.ok(pendingIndex > -1, "MG terminal poll should remain present");
  assert.match(mgTerminalPoll, /try\s*\{\s*response = await page\.request\.get/s);
  assert.match(mgTerminalPoll, /return `transport-error:/);
});

test("production video E2E retries a transient transport failure while waiting for generation jobs", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");
  const functionStart = source.indexOf("async function waitForGenerationJob");
  const functionEnd = source.indexOf("async function waitForProjectReady", functionStart);
  const generationJobPoll = source.slice(functionStart, functionEnd);

  assert.ok(functionStart > -1 && functionEnd > functionStart);
  assert.match(generationJobPoll, /try\s*\{\s*response = await page\.request\.get/s);
  assert.match(generationJobPoll, /return `transport-error:/);
  assert.match(generationJobPoll, /job\.status === "failed"/);
});

test("production video E2E treats only the current export 404 as an expected console miss", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /const expectedMissingCurrentExportConsoleError = \(message: string\) =>/);
  assert.match(
    source,
    /message\.includes\(\s*"Failed to load resource: the server responded with a status of 404",?\s*\)/s,
  );
  assert.match(source, /message\.includes\(`@ \$\{currentExportUrl\}:`\)/);
  assert.match(
    source,
    /!expectedMissingCurrentExportConsoleError\(message\)/,
  );
});

test("production video E2E only requires an MG quantity for an explicit opt-in run", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(
    source,
    /const requireMg = process\.env\.VIDEO_PIPELINE_REQUIRE_MG === "true"/,
  );
  assert.match(
    source,
    /requireMg\s*\?\s*"[^"\n]*MG overlay[^"\n]*"\s*:\s*""/,
  );
  assert.match(
    source,
    /已有家装素材继续作为该镜主画面[^"\n]*不是 MG 主画面/,
  );
  assert.match(source, /结果与图形增强[^"\n]*callout/);
  assert.match(source, /focus_label[^"\n]*图纸核对区/);
  assert.match(source, /图纸核对区[^"\n]*不得出现在旁白和字幕/);
  assert.match(
    source,
    /if \(requireMg\) \{\s*expect\(\s*plannedMgScenes\.length,[\s\S]*director ignored the explicit request for at least one MG scene[\s\S]*\)\.toBeGreaterThan\(0\);\s*\}/,
  );
  assert.match(
    source,
    /if \(plannedMgScenes\.length === 0\) \{\s*projectAsset = current;\s*return "not-needed";/s,
  );
  assert.match(source, /mg-not-dispatched:/);
  assert.match(source, /all enabled MG scenes reached a failed terminal state:/);
  assert.doesNotMatch(
    source,
    /expect\(mgOverlayTrack\?\.elements\?\.length\)\.toBeGreaterThan\(0\)/,
  );
  assert.match(source, /const renderedMgSceneIds = new Set/);
  assert.match(source, /expect\(mgOverlaySceneIds\)\.toEqual\(renderedMgSceneIds\)/);
});

test("production video E2E validates art direction through the public animation summary", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.doesNotMatch(source, /internal_production/);
  assert.match(source, /animation_overlay_count/);
  assert.match(source, /animation_full_scene_count/);
  assert.match(source, /animation_protected_count/);
  assert.match(source, /animation_effect_count/);
  assert.match(source, /publicAnimationSceneCount/);
});

test("production video E2E validates two-stage output through the public project", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.doesNotMatch(source, /metadata\?\.asset_manifest/);
  assert.doesNotMatch(source, /metadata\?\.edit_decisions/);
  assert.match(source, /publicProjectReferenceMatch/);
  assert.match(source, /publicPrimaryVisuals/);
});

test("production video E2E defines generated-primary warning codes before export preflight", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");
  const declaration = source.indexOf("const generatedPrimaryFailureCodes = new Set");
  const usage = source.indexOf("generatedPrimaryFailureCodes.has");

  assert.ok(declaration > -1);
  assert.ok(usage > declaration);
  assert.match(source, /"mg_primary_blank"/);
  assert.match(source, /"mg_primary_fallback"/);
  assert.match(source, /"title_scene_render_fallback"/);
});

test("production video E2E validates generated headline subtitle dedup through the public main track", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");
  const functionStart = source.indexOf(
    "function generatedPrimaryRepeatsVisibleSubtitle",
  );
  const functionEnd = source.indexOf('test("produces persisted visuals', functionStart);
  const helper = source.slice(functionStart, functionEnd);

  assert.doesNotMatch(helper, /primary_scene_spec/);
  assert.match(helper, /primaryElement\?\.displayText/);
  assert.doesNotMatch(helper, /primaryElement\?\.name/);
  assert.match(source, /generatedPrimaryRepeatsVisibleSubtitle\(scene, mainElement\)/);
});

test("production video E2E waits for user-visible completion before UI convergence", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");
  const functionStart = source.indexOf("async function waitForProjectReady");
  const functionEnd = source.indexOf("function scenesFromAsset", functionStart);
  const readinessWait = source.slice(functionStart, functionEnd);
  const productPoll = readinessWait.indexOf("project.product_status === \"completed\"");
  const pageReload = readinessWait.indexOf("await page.reload");

  assert.ok(functionStart > -1 && functionEnd > functionStart);
  assert.match(readinessWait, /productDeadline = Date\.now\(\) \+ videoJobTimeoutMs/);
  assert.match(readinessWait, /project\.product_status === "failed"/);
  assert.match(readinessWait, /video_product_not_completed_before_timeout/);
  assert.ok(productPoll > -1 && productPoll < pageReload);
});

test("production video E2E resolves a queued confirmation job from every public aggregate location", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /confirmationPayload\.product\?\.metadata\?\.latest_job_public_id/);
  assert.match(source, /confirmationPayload\.conversation\?\.metadata\?\.latest_job_public_id/);
  assert.match(source, /message\.metadata\?\.job_public_id/);
});
