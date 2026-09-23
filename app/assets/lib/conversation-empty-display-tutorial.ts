export type ConversationEmptyDisplayTutorialStage = "brief" | "materials" | "confirmation";

export type ConversationEmptyDisplayTutorial = {
  activeStep: 0 | 1;
  guidance: string;
};

const TUTORIALS: Record<ConversationEmptyDisplayTutorialStage, ConversationEmptyDisplayTutorial> = {
  brief: {
    activeStep: 0,
    guidance: "先说清给谁看、想达到什么效果；不用先写完整脚本。",
  },
  materials: {
    activeStep: 0,
    guidance: "资料不用先整理；它会优先作为内容和画面依据。",
  },
  confirmation: {
    activeStep: 1,
    guidance: "先确认关键选择再生成，能减少后续返工。",
  },
};

export function resolveConversationEmptyDisplayTutorialStage({
  hasPendingConfirmation,
  hasExplicitMaterials,
}: {
  hasPendingConfirmation: boolean;
  hasExplicitMaterials: boolean;
}): ConversationEmptyDisplayTutorialStage {
  if (hasPendingConfirmation) return "confirmation";
  if (hasExplicitMaterials) return "materials";
  return "brief";
}

export function conversationEmptyDisplayTutorial(
  stage: ConversationEmptyDisplayTutorialStage,
): ConversationEmptyDisplayTutorial {
  return TUTORIALS[stage];
}
