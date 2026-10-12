import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { projectListStateLabel } from "../components/assets-workspace-client";

const workspaceClient = readFileSync(new URL("../components/assets-workspace-client.tsx", import.meta.url), "utf8");
const conversationStart = readFileSync(new URL("../components/conversation-start.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");

describe("workspace navigation panel contract", () => {
  it("puts recent projects before the global library navigation", () => {
    const projectSection = workspaceClient.indexOf('className="shadcn-prototype-conversation-section"');
    const libraryNavigation = workspaceClient.indexOf('className="shadcn-prototype-nav" aria-label="资源库"');

    expect(projectSection).toBeGreaterThan(-1);
    expect(libraryNavigation).toBeGreaterThan(projectSection);
    expect(workspaceClient).toContain("最近项目");
    expect(workspaceClient).not.toContain('<span>项目列表</span>');
  });

  it("shows eight recent projects by default while search and expansion cover the full list", () => {
    expect(workspaceClient).toContain("RECENT_PROJECT_LIMIT = 8");
    expect(workspaceClient).toContain("showAllProjectRows");
    expect(workspaceClient).toContain("查看全部");
    expect(workspaceClient).toContain("收起项目");
    expect(workspaceClient).toContain("normalizedQuery");
    expect(workspaceClient).toContain("selectedConversationId");
  });

  it("uses a calm one-line project row and presents libraries as plain text rows", () => {
    expect(css).toMatch(/\.shadcn-prototype-conversation-main\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*min-height:\s*42px;/s);
    expect(workspaceClient).toContain('className="shadcn-prototype-nav-title">资源库');
    expect(workspaceClient).toMatch(/<Package size=\{15\} \/><\/span>\s*资产/);
    expect(workspaceClient).toMatch(/<FileText size=\{15\} \/><\/span>\s*文案/);
    expect(workspaceClient).toMatch(/<ImageIcon size=\{15\} \/><\/span>\s*图片/);
    expect(workspaceClient).toMatch(/<Video size=\{15\} \/><\/span>\s*视频/);
    // Utility rows: no card surface, no shadow, no per-library colour.
    expect(css).toMatch(/\.shadcn-prototype-nav button\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
    expect(css).not.toMatch(/\.shadcn-prototype-nav button\s*\{[^}]*box-shadow/s);
    expect(css).not.toMatch(/\.shadcn-prototype-nav-item\.(assets|copy|image|video)/);
    expect(css).not.toMatch(/\.agent-visual-refresh \.shadcn-prototype-nav button\s*\{/);
    expect(css).toMatch(/\.shadcn-prototype-conversation-row\.active\s*\{[^}]*background:\s*#eeece8;[^}]*color:\s*var\(--sp-text\);/s);
  });

  it("shows only the three project states that require attention", () => {
    expect(projectListStateLabel("generating")).toBe("生成中");
    expect(projectListStateLabel("script_review")).toBe("待确认");
    expect(projectListStateLabel("needs_attention")).toBe("需处理");
    expect(projectListStateLabel("ready")).toBeNull();
    expect(projectListStateLabel("needs_input")).toBeNull();
    expect(projectListStateLabel(undefined)).toBeNull();
    expect(workspaceClient).not.toContain("conversation.updatedAt}</span>");
    expect(css).toMatch(/\.shadcn-prototype-project-state\s*\{[^}]*background:\s*transparent;[^}]*font-size:\s*var\(--sp-text-meta\);/s);
  });

  it("removes the image-only material readiness strip from the new-project page", () => {
    expect(conversationStart).not.toContain("MaterialsReadyStrip");
    expect(conversationStart).not.toContain("你的素材可以开始做视频了");
  });

  it("opens navigation on demand from the header and never keeps a persistent sidebar", () => {
    // Full-width shell: no 264px sidebar track, no collapsed 52px rail.
    expect(css).toMatch(/\.shadcn-prototype-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
    expect(css).not.toMatch(/grid-template-columns:\s*264px minmax\(0, 1fr\)/);
    expect(css).not.toContain("collapsed-rail");
    expect(css).not.toMatch(/sidebar-(collapsed|expanded|visual-collapsed)/);
    expect(workspaceClient).not.toContain("collapsed-rail");
    expect(workspaceClient).not.toMatch(/SidebarState|setSidebarState/);
    // The header switcher is the only entry, with an attention badge drawn from
    // the same labels the project rows show.
    expect(workspaceClient).toContain('className="shadcn-prototype-project-switcher"');
    expect(workspaceClient).toMatch(/projectListStateLabel\(conversation\.projectState\) !== null/);
    expect(workspaceClient).toMatch(/event\.metaKey \|\| event\.ctrlKey/);
  });
});
