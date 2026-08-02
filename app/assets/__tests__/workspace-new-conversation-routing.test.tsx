import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
    const client = readWorkspaceClient();

    expect(client).toContain('selectedConversationIdRef.current !== "new"');
    expect(client).toContain("pendingConversationNavigationRef.current");
    expect(client).toContain('pendingConversationId !== initialConversationId');
    expect(client).toContain('routeConversationId !== initialConversationId');
    expect(client).toContain('currentRouteConversationId === initialConversationId');
    expect(client).toContain('selectedConversationIdRef.current = conversationId;');
    expect(client).toContain('selectedConversationIdRef.current = "new";');
    expect(client).toMatch(
      /const conversationId = resolveInitialConversationId\(initialConversationId, conversations\);\s+selectedConversationIdRef\.current = conversationId;\s+setSelectedConversationId\(conversationId\);/,
    );
  });

  it("reloads legacy conversation rows unless their detail flag is explicitly true", () => {
    const client = readWorkspaceClient();

    expect(client).toContain('selectedConversation.detailsLoaded === true');
    expect(client).toContain('const selectedDetailLoaded = selectedPersistedConversation?.detailsLoaded === true;');
    expect(client).toContain('const selectedPersistedConversation = visibleConversationRows.find(');
    expect(client).toContain('conversationDetailRequestKeyRef.current === requestKey');
  });

  it("loads a deep-linked historical conversation even when it is outside the recent summary page", () => {
    const client = readWorkspaceClient();

    expect(client).toContain(
      "const selectedDetailLoaded = selectedPersistedConversation?.detailsLoaded === true;",
    );
    expect(client).toContain("if (selectedDetailLoaded) return;");
    expect(client).toContain("return [detail, ...current];");
    expect(client).toContain("conversation.id === selectedConversationIdRef.current");
    expect(client).toContain("selectedDetail && !merged.some");
    expect(client).not.toContain("if (!summary || summary.detailsLoaded === true) return;");
  });
});
