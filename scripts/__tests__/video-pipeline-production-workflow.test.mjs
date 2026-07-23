import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "../..");
const runner = fs.readFileSync(
  path.join(root, "scripts", "run-video-pipeline-production-e2e.mjs"),
  "utf8",
);
const spec = fs.readFileSync(
  path.join(root, "e2e", "video-pipeline-production.spec.ts"),
  "utf8",
);
const comparisonRunnerPath = path.join(
  root,
  "scripts",
  "run-video-pipeline-on-off-comparison.mjs",
);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("production pipeline runner resolves workspace files from the frontend parent", () => {
  assert.match(runner, /const workspaceRoot = path\.resolve\(frontendRoot, "\.\."\);/);
  assert.doesNotMatch(runner, /const workspaceRoot = path\.resolve\(frontendRoot, "\.\.", "\.\."\);/);
  assert.match(runner, /path\.join\(workspaceRoot, "MultiMix-Backend"\)/);
  assert.match(runner, /path\.join\(workspaceRoot, "MultiMix-商业计划\.md"\)/);
});

test("production pipeline restores tracked Next config before removing its temporary build", () => {
  const restoreIndex = runner.indexOf("restoreFiles(workspaceSnapshots);");
  const nextBuildCleanupIndex = runner.indexOf(
    "path.join(frontendRoot, `.next-video-pipeline-${runId}`)",
  );
  assert.notEqual(restoreIndex, -1);
  assert.notEqual(nextBuildCleanupIndex, -1);
  assert.ok(restoreIndex < nextBuildCleanupIndex);
  assert.ok(runner.lastIndexOf("restoreFiles(workspaceSnapshots);") > nextBuildCleanupIndex);
});

test("production pipeline QA stages reviewed BGM and approved product captures", () => {
  assert.match(runner, /stageReviewedBgmCatalog/);
  assert.match(runner, /bgm-review-decisions\.json/);
  assert.match(runner, /CHANGEIN_VIDEO_BGM_ENABLED:\s*"true"/);
  assert.match(runner, /stageApprovedProductMediaCatalog/);
  assert.match(runner, /VIDEO_PIPELINE_PRODUCT_MEDIA_FILES/);
  assert.match(runner, /CHANGEIN_VIDEO_PRODUCT_MEDIA_MANIFEST_REF/);
});

test("production pipeline E2E proves product media and BGM enter the project", () => {
  assert.match(spec, /getByRole\("button", \{ name: "上传 PDF 或文档" \}\)\.click\(\)/);
  assert.match(spec, /source_type\?\:\s*string/);
  assert.match(spec, /product_asset/);
  assert.match(spec, /track-bgm/);
  assert.match(spec, /bgm_choice/);
  assert.match(spec, /message\.location\(\)/);
  assert.match(spec, /requestfailed/);
  assert.match(spec, /requestFailures/);
  assert.match(spec, /net::ERR_ABORTED/);
  assert.match(spec, /actionableRequestFailures/);
  assert.match(runner, /可行动失败请求/);
});

test("production pipeline E2E can verify intentional no-BGM degradation", () => {
  assert.match(spec, /VIDEO_PIPELINE_EXPECT_BGM/);
  assert.match(spec, /expectBgm/);
  assert.match(spec, /bgm_choice\?\.enabled/);
  assert.match(spec, /track-bgm/);
  assert.match(spec, /measurement_status/);
});

test("production pipeline E2E explicitly parameterizes the two-stage runtime and records the run manifest", () => {
  assert.match(runner, /VIDEO_PIPELINE_TWO_STAGE_ENABLED/);
  assert.match(runner, /twoStageEnabled/);
  assert.match(
    runner,
    /CHANGEIN_MULTIMIX_VIDEO_TWO_STAGE_ASSET_PIPELINE_ENABLED:\s*twoStageEnabled\s*\?\s*"true"\s*:\s*"false"/,
  );
  assert.doesNotMatch(
    runner,
    /CHANGEIN_MULTIMIX_VIDEO_TWO_STAGE_ASSET_PIPELINE_ENABLED:\s*"true"/,
  );
  assert.match(runner, /VIDEO_PIPELINE_EXPECT_TWO_STAGE/);
  assert.match(runner, /run-manifest\.json/);
  assert.match(spec, /VIDEO_PIPELINE_EXPECT_TWO_STAGE/);
  assert.match(spec, /expectTwoStage/);
  assert.match(runner, /two-stage-evaluation-report\.json/);
  assert.match(runner, /resumeReuse/);
  assert.match(runner, /openmontage-comparison\.md/);
  assert.match(spec, /asset_manifest/);
  assert.match(spec, /edit_decisions/);
  assert.match(spec, /manifestProjectReferenceMatch/);
  assert.match(spec, /publicCandidateOnlyCount/);
  assert.match(spec, /transport-error/);
});

test("production pipeline E2E separates two-stage evidence from the shared export contract", () => {
  assert.match(spec, /if \(expectTwoStage\) \{/);
  assert.match(spec, /if \(expectTwoStage && requirePublicAsset\) \{/);
  assert.match(spec, /let recomposeTested = false/);
  assert.match(spec, /recomposeTested = true/);
  assert.match(spec, /twoStageEnabled: expectTwoStage/);
  assert.match(spec, /recomposeTested,/);
  assert.match(spec, /Shared quality and export contract for both pipeline modes/);
});

test("on-off comparison runner uses isolated sequential runs and validates identical inputs", () => {
  assert.equal(fs.existsSync(comparisonRunnerPath), true);
  const comparisonRunner = fs.readFileSync(comparisonRunnerPath, "utf8");
  assert.match(comparisonRunner, /for \(const mode of \["off", "on"\]\)/);
  assert.match(comparisonRunner, /VIDEO_PIPELINE_TWO_STAGE_ENABLED/);
  assert.match(comparisonRunner, /VIDEO_PIPELINE_RUN_ID/);
  assert.match(comparisonRunner, /VIDEO_PIPELINE_RESULT_DIR/);
  assert.match(comparisonRunner, /path\.join\(comparisonRoot, mode\)/);
  assert.match(comparisonRunner, /assertComparableManifests/);
  assert.match(comparisonRunner, /comparison-report\.json/);
  assert.match(comparisonRunner, /blind-scorecard\.md/);
  assert.match(comparisonRunner, /blind-map\.json/);
  assert.equal(
    packageJson.scripts["test:e2e:video-pipeline-compare"],
    "node scripts/run-video-pipeline-on-off-comparison.mjs",
  );
});

test("production pipeline E2E verifies the formal MP4 media contract", () => {
  assert.match(runner, /ffprobe/);
  assert.match(runner, /media-probe\.json/);
  assert.match(runner, /codec_name.*h264/s);
  assert.match(runner, /pix_fmt.*yuv420p/s);
  assert.match(runner, /codec_name.*aac/s);
  assert.match(runner, /width.*1920/s);
  assert.match(runner, /height.*1080/s);
  assert.match(runner, /duration.*27/s);
  assert.match(runner, /duration.*33/s);
  assert.match(runner, /loudnorm/);
  assert.match(runner, /integratedLufs/);
  assert.match(runner, /truePeakDbfs/);
  assert.match(runner, /clipping/);
  assert.match(spec, /narration_coverage/);
  assert.match(spec, /coverage_rate/);
  assert.match(spec, /unintentional_material_reuse/);
  assert.match(spec, /predicted_voice_to_music_ratio/);
});

test("production pipeline E2E has a real hybrid scenario with saved-media evidence gates", () => {
  assert.match(spec, /VIDEO_PIPELINE_SCENARIO/);
  assert.match(spec, /VIDEO_PIPELINE_HYBRID_MEDIA_FILES/);
  assert.match(spec, /extension === "\.mp4"/);
  assert.match(spec, /"video\/mp4"/);
  assert.match(spec, /target_kind:\s*mediaKind/);
  assert.match(spec, /pipelineCode/);
  assert.match(spec, /saved_asset/);
  assert.match(spec, /evidence_required/);
  assert.match(spec, /confirmed_fact/);
});

test("production pipeline E2E requires real public material adoption for animated_public", () => {
  assert.match(spec, /animated_public/);
  assert.match(spec, /VIDEO_PIPELINE_REQUIRE_PUBLIC_ASSET/);
  assert.match(spec, /publicManifestScenes/);
  assert.match(spec, /source_type === "public_asset"/);
  assert.match(spec, /artifact_ref.*startsWith\("local:\/\/"\)/s);
  assert.match(spec, /provider_item_id/);
  assert.match(spec, /license_snapshot/);
  assert.match(spec, /sourceAssetId/);
  assert.match(spec, /\/v1\/assets\/\$\{sourceAssetId\}\/download/);
  assert.match(runner, /requirePublicAsset/);
  assert.match(runner, /公共素材正式采用/);
});

test("production pipeline E2E uses an explicit allowlisted proxy for sandbox provider DNS", () => {
  assert.match(runner, /startProviderEgressProxy/);
  assert.match(runner, /CHANGEIN_MULTIMIX_VIDEO_PIPELINE_PROVIDER_PROXY_DNS_ENABLED:\s*"true"/);
  assert.match(runner, /CHANGEIN_MULTIMIX_VIDEO_PIPELINE_PROVIDER_PROXY_HOSTS/);
  assert.match(runner, /CHANGEIN_MULTIMIX_VIDEO_PIPELINE_PROVIDER_HTTPS_PROXY/);
  assert.match(runner, /videos\.pexels\.com/);
  assert.match(runner, /providerProxy\.close/);
});

test("production pipeline E2E can crash and recover the worker after manifest publication", () => {
  assert.match(runner, /VIDEO_PIPELINE_INTERRUPT_AFTER_MANIFEST/);
  assert.match(runner, /waitForManifestArtifact/);
  assert.match(runner, /stopChild\(backend\)/);
  assert.match(runner, /recover_video_project_jobs/);
  assert.match(runner, /run_video_orchestration_job/);
  assert.match(runner, /backend-restarted\.log/);
  assert.match(spec, /VIDEO_PIPELINE_EXPECT_RESUME/);
  assert.match(spec, /resumeReuse/);
  assert.match(runner, /time\.sleep\(0\.05\)/);
  assert.match(runner, /run\(pythonCommand, \["-c", probeScript, databasePath, String\(timeoutMs\)\]/);
  assert.match(runner, /signal,/);
  assert.match(runner, /select metadata from content_assets/);
  assert.doesNotMatch(runner, /select metadata_json from content_assets/);
  assert.match(spec, /已核验的产品能力/);
});

test("production pipeline E2E stops manifest polling when Playwright finishes early", () => {
  assert.match(runner, /AbortController/);
  assert.match(runner, /Promise\.race/);
  assert.match(runner, /signal\.aborted/);
  assert.match(runner, /Playwright finished before asset_manifest publication/);
});

test("production pipeline E2E waits for the exact confirmed video job before project assertions", () => {
  assert.match(spec, /latest_job_public_id/);
  assert.match(spec, /confirmationPayload\.conversation\?\.metadata\?\.latest_job_public_id/);
  assert.match(spec, /\/v1\/video\/jobs\/\$\{videoJobId\}/);
  assert.match(spec, /video project generation failed/);
  assert.match(spec, /timeout:\s*20 \* 60_000/);
});
