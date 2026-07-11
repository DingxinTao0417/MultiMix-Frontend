export type ScenarioId = "01" | "02" | "03" | "04";

export type SyntheticAsset = {
  path: string;
  testRole: string;
  expectedUsage: string;
};

export type ScenarioPrompts = {
  initial: string;
  revisions: string[];
  structural: string;
  boundaries: string[];
};

export type ScenarioDefinition = {
  id: ScenarioId;
  slug: string;
  directory: string;
  targetDurationSeconds: number;
  primaryImages: string[];
  distractorImages: string[];
  documents: Record<string, string>;
  prompts: ScenarioPrompts;
  forbiddenPhrases: string[];
  thresholds: {
    effectiveSceneMinimum: number;
    matchedMinimum: number;
    noAssetHitMinimum?: number;
  };
  syntheticAssets: SyntheticAsset[];
};

export type CheckStatus = "passed" | "failed" | "blocked" | "not_run";
export type CheckResult = { code: string; status: CheckStatus; severity: "P0" | "P1" | "P2"; expected: unknown; actual: unknown; evidence?: unknown };
export type AssetReference = { status?: string; chosen_asset_id?: number | null; match_confidence?: number };
export type PlanScene = { narration?: string; visual_brief?: string; asset_reference?: AssetReference; material_candidates?: Array<{ source_type?: string; asset_id?: number }>; mg_decision?: { mode?: string; needed?: boolean; status?: string; chosen_template?: string; reason?: string } };
export type InitialPlanInput = { imageIds: number[]; distractorIds: number[]; scenes: PlanScene[]; markdown: string; syntheticEvidencePhrases?: string[] };
