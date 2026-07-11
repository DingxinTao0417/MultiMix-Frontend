import type {
  AgentRunStep,
  AssetConversationMessage,
  AssetMessagePresentation,
} from "./asset-workspace-types";

export type ExecutionOptimisticExchange = {
  userText: string;
  assistantText: string;
  status: "pending" | "stopped" | "failed" | "unsubmitted";
  presentation?: AssetMessagePresentation;
  runSteps?: AgentRunStep[];
};

export function confirmationMessagePresentation(
  role: "user" | "assistant",
  metadata: Record<string, unknown> | undefined,
): AssetMessagePresentation {
  const stage = typeof metadata?.video_workflow_stage === "string"
    ? metadata.video_workflow_stage
    : "";
  const confirmationKey = typeof metadata?.confirmation_idempotency_key === "string"
    ? metadata.confirmation_idempotency_key
    : "";
  if (!confirmationKey) return "standard";
  if (role === "user" && stage === "director_script_confirmed") return "hidden_confirmation";
  if (role === "assistant" && stage.startsWith("video_project_")) return "execution_anchor";
  return "standard";
}

export function mergeVisibleConversationMessages(
  messages: AssetConversationMessage[],
  exchange: ExecutionOptimisticExchange | null,
): AssetConversationMessage[] {
  const visible = messages.filter((message) => message.presentation !== "hidden_confirmation");
  if (!exchange) return visible;
  const assistant: AssetConversationMessage = {
    role: "assistant",
    text: exchange.assistantText,
    pending: exchange.status === "pending",
    localState: exchange.status === "pending" ? undefined : exchange.status,
    presentation: exchange.presentation ?? "standard",
    runSteps: exchange.runSteps,
  };
  if (exchange.presentation === "execution_anchor") return [...visible, assistant];
  return [...visible, { role: "user", text: exchange.userText }, assistant];
}

export function shouldRenderMessageBody(message: AssetConversationMessage): boolean {
  if (message.presentation !== "execution_anchor") return Boolean(message.text.trim());
  return Boolean(message.localState && message.text.trim());
}
