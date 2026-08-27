import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runnerPath = path.join(scriptsRoot, "run-video-pipeline-production-e2e.mjs");
const productionSpecPath = path.resolve(scriptsRoot, "..", "e2e", "video-pipeline-production.spec.ts");
const retainedExportSpecPath = path.resolve(scriptsRoot, "..", "e2e", "video-pipeline-retained-export.spec.ts");

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
    /const productMediaManifestRef = \(\s*isResume \|\| inputProfile === "explainer_saved_library_simple"\s*\)\s*\? ""\s*: stageApprovedProductMediaCatalog\(\)/,
  );
  assert.doesNotMatch(source, /stagedBgm\.manifestRef/);
  assert.doesNotMatch(source, /stagedBgm\.defaultCatalogId/);
  assert.match(source, /MULTIMIX_VIDEO_BGM_MANIFEST_REF:\s*effectiveBgm\.manifestRef/);
  assert.match(source, /MULTIMIX_VIDEO_BGM_DEFAULT_CATALOG_ID:\s*effectiveBgm\.defaultCatalogId/);
});

test("production video E2E validates BGM through the public project track", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.doesNotMatch(source, /videoProject\?\.metadata\?\.bgm_choice/);
  assert.match(source, /const bgmTrack = videoProject\?\.tracks\?\.find/);
  assert.match(source, /expect\(bgmTrack\?\.type\)\.toBe\("audio"\)/);
  assert.match(source, /intentional no-BGM degradation must not create a music track/);
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
  assert.doesNotMatch(seedReader, /'conversationId': job\.conversation_id/);
  assert.match(source, /video-pipeline-retained-export\.spec\.ts/);
  assert.match(source, /VIDEO_PIPELINE_RETAINED_EXPORT_SEED/);
  assert.match(source, /targetSeconds/);
  assert.match(source, /minimumDurationSeconds/);
  assert.match(source, /maximumDurationSeconds/);
  assert.match(retainedSpec, /selectClosestDurationCandidate/);
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

test("simple saved-library E2E does not inject an unrelated source document", () => {
  const runnerSource = fs.readFileSync(runnerPath, "utf8");
  const browserSource = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(browserSource, /inputProfile !== "explainer_saved_library_simple"[\s\S]*?VIDEO_PIPELINE_SOURCE_DOCUMENT is missing/);
  assert.match(browserSource, /inputProfile === "explainer_saved_library_simple"[\s\S]*?multimix_local_user/);
  assert.match(runnerSource, /inputProfile === "explainer_saved_library_simple"\s*\? null\s*:\s*fingerprintFile\(sourceDocument\)/);
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
  const understandingGate = source.indexOf("demonstration source understanding failed");
  const generationInstruction = source.indexOf("const generationInstruction");
  const routeGate = source.indexOf("director selected wrong video type");
  const confirmationClick = source.indexOf("await confirmButton.click()");

  assert.ok(understandingGate > -1 && understandingGate < generationInstruction);
  assert.ok(routeGate > generationInstruction && routeGate < confirmationClick);
  assert.match(source, /understanding\?\.status/);
  assert.match(source, /directorVideoPlan\.video_type/);
});

test("demonstration E2E asks for an observable operation sequence instead of a generic explainer", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /上传资料与素材 → 理解并组织已有素材 → 生成可编辑分镜与预览/);
  assert.match(source, /至少两个不同分镜必须使用两个不同的已审核产品界面/);
  assert.match(source, /只有涉及 MultiMix 产品能力、操作结果或效果的文字才必须由产品资料支持/);
  assert.match(source, /装修视频只作为被输入和组织的真实业务素材/);
  assert.match(source, /每个分镜必须承担不同且必要的操作、状态或结果/);
  assert.doesNotMatch(source, /商家内容制作示范片/);
});

test("demonstration E2E links the explicitly uploaded operation clips to the generation request", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /demonstrationLinkedAssetIds\.push\(mediaAsset\.id\)/);
  assert.match(source, /linked_asset_ids:\s*linkedAssetIds/);
  assert.match(
    source,
    /postConversation\([\s\S]*?generationInstruction[\s\S]*?demonstrationLinkedAssetIds/,
  );
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

test("demonstration E2E gives every selected clip an observable role without public fallback", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /过程基线用于开场输入/);
  assert.match(source, /步骤迭代用于理解和组织/);
  assert.match(source, /结果与图形增强只用于展示画面中已经存在的区域标签和 KITCHEN FLOW \/ 服务流程文字/);
  assert.match(source, /不使用公共素材/);
  assert.match(source, /不得使用“自动整理、自动标注、自动生成”/);
  assert.match(source, /不声称素材由系统完成了组织/);
  assert.match(source, /两个操作界面都不得由装修素材替代/);
  assert.match(source, /只有涉及 MultiMix 产品能力、操作结果或效果的文字才必须由产品资料支持/);
  assert.doesNotMatch(source, /每一步都必须使用批准的产品界面或忠于资料的事实证据/);
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

test("demonstration E2E requires distinct reviewed product captures for observable product operations", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /productPresentation/);
  assert.match(source, /productSceneCount/);
  assert.match(source, /工作区总览界面/);
  assert.match(source, /分镜编辑或视频预览界面/);
  assert.match(source, /reviewed product operation scenes/);
  assert.match(source, /distinct reviewed product captures/);
  assert.match(source, /catalog_entry_id/);
  assert.doesNotMatch(
    source,
    /previousVisual\?\.source_type === "product_asset"[\s\S]*?continue;/,
  );
  assert.match(source, /assertDistinctPersistedPrimaryVisualWindows/);
  assert.match(source, /trimStart/);
  assert.match(source, /source windows must not overlap/);
  assert.doesNotMatch(source, /every scene must use a distinct persisted main visual/);
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
