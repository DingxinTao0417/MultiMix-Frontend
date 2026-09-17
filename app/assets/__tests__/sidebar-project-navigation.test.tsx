import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { projectListStateLabel } from "../components/assets-workspace-client";

const workspaceClient = readFileSync(new URL("../components/assets-workspace-client.tsx", import.meta.url), "utf8");
const conversationStart = readFileSync(new URL("../components/conversation-start.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");

describe("desktop sidebar project navigation contract", () => {
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

  it("uses a calm one-line project row and presents libraries as the approved two-column utility grid", () => {
    expect(css).toMatch(/\.shadcn-prototype-sidebar\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto auto auto;/s);
    expect(css).toMatch(/\.shadcn-prototype-conversation-main\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*min-height:\s*42px;/s);
    expect(workspaceClient).toContain('className="shadcn-prototype-nav-title">资源库');
    expect(workspaceClient).toContain("shadcn-prototype-nav-icon");
    expect(workspaceClient).toContain("资产\n");
    expect(workspaceClient).toContain("文案\n");
    expect(workspaceClient).toContain("图片\n");
    expect(workspaceClient).toContain("视频\n");
    expect(css).toMatch(/\.shadcn-prototype-nav\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*gap:\s*7px;/s);
    expect(css).toMatch(/\.shadcn-prototype-nav-title\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s);
    expect(css).toMatch(/\.shadcn-prototype-nav button\s*\{[^}]*min-height:\s*54px;[^}]*border:\s*1px solid #e9e5de;[^}]*border-radius:\s*11px;/s);
    expect(css).toMatch(/\.shadcn-prototype-nav-icon\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*border-radius:\s*9px;/s);
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
});
