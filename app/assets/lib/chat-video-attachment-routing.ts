import type { AssetConversation } from "./asset-workspace-types";

export type ChatVideoAttachmentPurpose = "visual_material" | "long_form_source";

function isExplainerProduct(conversation: AssetConversation): boolean {
  const products = conversation.products?.length
    ? conversation.products
    : [conversation.product];
  return products.some((product) => (
    product.contentType === "video_script"
    || product.metadata?.capability === "video_script"
  ));
}

function hasExplainerConfirmation(conversation: AssetConversation): boolean {
  return (conversation.messages ?? []).some((message) => (
    message.plan?.kind === "video_parameter_confirmation"
  ));
}

export function resolveChatVideoAttachmentPurpose(
  conversation: AssetConversation,
): ChatVideoAttachmentPurpose {
  const activeGoal = conversation.agentTasks?.active?.goal;
  if (
    isExplainerProduct(conversation)
    || hasExplainerConfirmation(conversation)
    || activeGoal === "video_script"
    || activeGoal === "video_plan_generation"
  ) {
    return "visual_material";
  }
  return "long_form_source";
}
