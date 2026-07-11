import fs from "node:fs";
import path from "node:path";

import type { ScenarioDefinition, ScenarioId, ScenarioPrompts, SyntheticAsset } from "./types";

const scenarios: Record<ScenarioId, Omit<ScenarioDefinition, "directory" | "primaryImages" | "distractorImages" | "documents" | "prompts" | "syntheticAssets">> = {
  "01": { id: "01", slug: "local_service_home_renovation", targetDurationSeconds: 25, forbiddenPhrases: ["0 甲醛", "全城最低价", "百分百不增项", "保证 7 天完工"], thresholds: { effectiveSceneMinimum: 4, matchedMinimum: 4 } },
  "02": { id: "02", slug: "ecommerce_skincare", targetDurationSeconds: 20, forbiddenPhrases: ["治疗敏感肌", "医美术后修复", "修复红血丝", "医生推荐", "医学级", "孕妇可用"], thresholds: { effectiveSceneMinimum: 3, matchedMinimum: 3 } },
  "03": { id: "03", slug: "knowledge_ip_jwst", targetDurationSeconds: 45, forbiddenPhrases: ["Webb 看到宇宙诞生瞬间", "颜色是肉眼真实色彩", "NASA 背书"], thresholds: { effectiveSceneMinimum: 6, matchedMinimum: 4 } },
  "04": { id: "04", slug: "material_gap_and_dialog_boundary", targetDurationSeconds: 30, forbiddenPhrases: ["完全隔音", "百分百隔绝噪音", "一点声音都听不到"], thresholds: { effectiveSceneMinimum: 4, matchedMinimum: 1, noAssetHitMinimum: 4 } },
};

const folderById: Record<ScenarioId, string> = {
  "01": "01_local_service_home_renovation",
  "02": "02_ecommerce_skincare",
  "03": "03_knowledge_ip_jwst",
  "04": "04_material_gap_and_dialog_boundary",
};

const documentNames = ["raw_text_materials.md", "client_chat_log.md", "data_notes.md", "data_constraints.md", "mg_overlay_candidates.md"];

export class ScenarioLoadError extends Error {}

function requireFile(filePath: string): string {
  if (!fs.existsSync(filePath)) throw new ScenarioLoadError(`Missing required scenario file: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

function listFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) throw new ScenarioLoadError(`Missing required scenario directory: ${directory}`);
  return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(directory, entry.name)).sort();
}

function sections(markdown: string): Map<string, string> {
  const result = new Map<string, string>();
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    result.set(current[1].trim(), markdown.slice((current.index ?? 0) + current[0].length, next?.index ?? markdown.length).trim());
  }
  return result;
}

function promptLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

function parsePrompts(markdown: string): ScenarioPrompts {
  const parsed = sections(markdown);
  const find = (prefix: string) => [...parsed.entries()].find(([heading]) => heading.startsWith(prefix))?.[1] ?? "";
  const initial = find("首轮生成提示词");
  const revisions = promptLines(find("多轮改写提示词"));
  const structural = find("结构性改写提示词");
  const boundaries = promptLines(find("对话边界提示词"));
  if (!initial || !structural) throw new ScenarioLoadError("demo_prompts.md is missing initial or structural prompt sections");
  return { initial, revisions, structural, boundaries };
}

function loadSyntheticAssets(root: string, id: ScenarioId): SyntheticAsset[] {
  const manifestPath = path.join(root, "material_source_manifest.json");
  const manifest = JSON.parse(requireFile(manifestPath)) as { assets?: Array<{ path: string; scenario: string; test_role: string; expected_usage: string }> };
  const folder = folderById[id];
  return (manifest.assets ?? []).filter((asset) => asset.scenario === folder).map((asset) => ({ path: path.join(root, asset.path), testRole: asset.test_role, expectedUsage: asset.expected_usage }));
}

export function loadScenario(root: string, id: ScenarioId): ScenarioDefinition {
  const base = scenarios[id];
  const directory = path.join(root, folderById[id]);
  if (!fs.existsSync(directory)) throw new ScenarioLoadError(`Missing scenario directory: ${directory}`);
  const documents = Object.fromEntries(documentNames.map((name) => [name, requireFile(path.join(directory, name))]));
  return {
    ...base,
    directory,
    primaryImages: listFiles(path.join(directory, "images")),
    distractorImages: listFiles(path.join(directory, "distractor_assets")),
    documents,
    prompts: parsePrompts(requireFile(path.join(directory, "demo_prompts.md"))),
    syntheticAssets: loadSyntheticAssets(root, id),
  };
}

export function loadScenarios(root: string, ids: ScenarioId[]): ScenarioDefinition[] {
  return ids.map((id) => loadScenario(root, id));
}
