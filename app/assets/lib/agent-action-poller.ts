import type { AgentActionRunResponse as ApiAgentActionRunResponse } from "../../../lib/api";
import type {
  AgentActionRunResponse,
  AgentActionStatus,
  AssetConversation,
} from "./asset-workspace-types";

export type AgentActionLive = {
  conversationId: string;
  action: AgentActionRunResponse;
};

type AgentActionLike = ApiAgentActionRunResponse | AgentActionRunResponse;

function actionId(action: AgentActionLike): string {
  return action.id;
}

function actionStatus(action: AgentActionLike): AgentActionStatus {
  return action.status;
}

function actionAssetId(action: AgentActionLike): number | null {
  return "asset_id" in action ? action.asset_id : action.assetId;
}

function actionVersionId(action: AgentActionLike): number | null {
  return "version_id" in action ? action.version_id : action.versionId;
}

export function isPendingAgentAction(action: AgentActionLike): boolean {
  return actionStatus(action) === "queued" || actionStatus(action) === "running";
}

export function persistedAgentActions(
  conversations: AssetConversation[],
): AgentActionLive[] {
  const entries = new Map<string, AgentActionLive>();
  for (const conversation of conversations) {
    const actions = [
      conversation.activeAgentAction,
      ...(conversation.messages ?? []).map((message) => message.agentAction),
    ];
    for (const action of actions) {
      if (!action) continue;
      const key = `${conversation.id}::${action.id}`;
      entries.set(key, { conversationId: conversation.id, action });
    }
  }
  return [...entries.values()];
}

export function agentActionPollLifecycleKey(entries: AgentActionLive[]): string {
  return entries
    .filter((entry) => isPendingAgentAction(entry.action))
    .map((entry) => `${entry.conversationId}::${actionId(entry.action)}`)
    .sort()
    .join(",");
}

export function agentActionPollOutcome(action: AgentActionLike): {
  terminal: boolean;
  refreshConversation: boolean;
  assetId?: number;
  versionId?: number;
} {
  const terminal = !isPendingAgentAction(action)
    && actionStatus(action) !== "planned"
    && actionStatus(action) !== "waiting_confirmation";
  const assetId = actionAssetId(action);
  const versionId = actionVersionId(action);
  return {
    terminal,
    refreshConversation: terminal,
    ...(typeof assetId === "number" ? { assetId } : {}),
    ...(typeof versionId === "number" ? { versionId } : {}),
  };
}
