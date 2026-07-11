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

