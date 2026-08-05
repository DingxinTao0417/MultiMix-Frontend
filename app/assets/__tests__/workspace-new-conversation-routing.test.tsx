import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  preserveSelectedConversationDetail,
  shouldLoadConversationDetail,
  shouldRestoreInitialConversationFocus,
} from "../lib/conversation-detail-load-policy";

function readWorkspaceClient(): string {
  const localPath = resolve(process.cwd(), "app/assets/components/assets-workspace-client.tsx");
  const workspacePath = resolve(process.cwd(), "MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx");
  return readFileSync(
    existsSync(localPath) ? localPath : workspacePath,
    "utf8",
  );
}

describe("new conversation routing", () => {
  it("routes new and selected conversations through Next navigation", () => {
    const client = readWorkspaceClient();

    expect(client).toContain('import { useRouter } from "next/navigation";');
    expect(client).toContain('url.searchParams.set("conversation", "new");');
    expect(client).toContain('url.searchParams.delete("product");');
    expect(client).toContain('router.replace(`${url.pathname}${url.search}${url.hash}`);');
    expect(client).not.toContain("window.history.replaceState(window.history.state, \"\", url);");
  });

  it("does not let a delayed summaries refresh replace an intentional new conversation", () => {
    expect(shouldRestoreInitialConversationFocus({
      pendingConversationId: null,
      routeConversationId: "historical-1",
      initialConversationId: "historical-1",
      selectedConversationId: "new",
      summaryIds: ["historical-1"],
    })).toBe(false);
    expect(shouldRestoreInitialConversationFocus({
      pendingConversationId: null,
      routeConversationId: "historical-1",
      initialConversationId: "historical-1",
      selectedConversationId: "historical-1",
      summaryIds: ["historical-1"],
    })).toBe(true);
  });

  it("reloads legacy conversation rows unless their detail flag is explicitly true", () => {
    const client = readWorkspaceClient();

    expect(client).toContain('selectedConversation.detailsLoaded === true');
    expect(client).toContain('const selectedDetailLoaded = selectedPersistedConversation?.detailsLoaded === true;');
    expect(client).toContain('const selectedPersistedConversation = visibleConversationRows.find(');
    expect(client).toContain('conversationDetailRequestKeyRef.current === requestKey');
  });

  it("keeps a restored snapshot pending so the conversation loading skeleton can render", () => {
    const client = readWorkspaceClient();

    expect(client).toContain(
      "const selectedConversation = selectedPersistedConversation ?? assetWorkspaceAdapter.getNewConversation();",
    );
    expect(client).not.toContain("detailsLoaded: true,");
    expect(client).not.toContain("正在恢复完整对话记录。");
  });

  it("keeps the restored product visible while snapshot conversation details are pending", () => {
    const client = readWorkspaceClient();

    expect(client).toContain(
      "const selectedProduct = !selectedConversationHasDetail && !isConversationSnapshot",
    );
  });

  it("loads a deep-linked historical conversation even when it is outside the recent summary page", () => {
    const detail = { id: "historical-1", detailsLoaded: true, title: "历史会话" };
    const recent = { id: "recent-1", detailsLoaded: false, title: "最近会话" };

    expect(shouldLoadConversationDetail({
      hasToken: true,
      conversationId: detail.id,
      detailsLoaded: false,
    })).toBe(true);
    expect(preserveSelectedConversationDetail({
      merged: [recent],
      current: [detail],
      selectedConversationId: detail.id,
    })).toEqual([detail, recent]);
  });
});
