# Library Dynamic Loading Empty State Implementation Plan

> Status: archived
> Owner: frontend
> Last verified: 2026-07-11

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` task-by-task. Subagents are prohibited unless the user explicitly approves the delegated scope. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent asset, copy, image, and video library views from rendering a blank body while their dynamic workspace chunk loads or fails.

**Architecture:** Add focused loading and error-boundary components beside the workspace shell. `AssetsWorkspaceClient` passes the active library title into a visible dynamic fallback and wraps the dynamically loaded `LibraryWorkshop` in a client error boundary. Existing library data and true empty-state behavior remain unchanged.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, Testing Library.

## Global Constraints

- Do not change APIs, authentication, library filters, data mapping, or stored content.
- Preserve the existing true empty state text `这个分类还没有内容`.
- Loading state uses `role="status"`, `aria-live="polite"`, and library-specific text.
- Error state exposes exactly one `重新加载` button.
- Follow TDD: observe each focused test fail before implementation.

---

### Task 1: Visible Dynamic Loading Fallback

**Files:**

- Create: `MultiMix-Frontend/app/assets/components/library-workspace-state.tsx`
- Create: `MultiMix-Frontend/app/assets/__tests__/library-workspace-state.test.tsx`
- Modify: `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`

**Interfaces:**

- Produces: `LibraryWorkspaceLoading({ title }: { title: string })`.
- `AssetsWorkspaceClient` supplies `assetWorkspaceAdapter.getWorkshop(activeView).title` through a small dynamic wrapper so the loading UI reflects the selected library.

- [ ] **Step 1: Write the failing loading-state test**

```tsx
import { render, screen } from "@testing-library/react";
import { LibraryWorkspaceLoading } from "../components/library-workspace-state";

it("shows an accessible image-library loading state", () => {
  render(<LibraryWorkspaceLoading title="图片库" />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  expect(screen.getByText("正在加载图片库…")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/library-workspace-state.test.tsx`

Expected: FAIL because `library-workspace-state.tsx` does not exist.

- [ ] **Step 3: Implement the minimal fallback and dynamic wrapper**

```tsx
export function LibraryWorkspaceLoading({ title }: { title: string }) {
  return (
    <section className="shadcn-prototype-workshop-state" role="status" aria-live="polite">
      <span className="shadcn-prototype-library-loading" aria-hidden="true" />
      <strong>{`正在加载${title}…`}</strong>
      <div className="shadcn-prototype-workshop-state-skeleton" aria-hidden="true" />
    </section>
  );
}
```

Define a small component that resolves the active title and renders the dynamically imported workshop; replace `loading: () => null` with `loading: () => <LibraryWorkspaceLoading title="资源库" />` so no chunk boundary is visually empty, while the resolved wrapper supplies the exact active title during normal transitions.

- [ ] **Step 4: Run focused test, typecheck, and existing agent-copy test**

Run: `npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/library-workspace-state.test.tsx app/assets/__tests__/agent-ui-copy.test.ts`

Run: `npm --prefix MultiMix-Frontend run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add app/assets/components/library-workspace-state.tsx app/assets/components/assets-workspace-client.tsx app/assets/__tests__/library-workspace-state.test.tsx
git commit -m "fix: show library workspace loading state"
```

---

### Task 2: Recoverable Library Error Boundary

**Files:**

- Modify: `MultiMix-Frontend/app/assets/components/library-workspace-state.tsx`
- Modify: `MultiMix-Frontend/app/assets/__tests__/library-workspace-state.test.tsx`
- Modify: `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`

**Interfaces:**

- Produces: `LibraryWorkspaceErrorBoundary` with `children: ReactNode` and optional injected `onReload` for deterministic tests.

- [ ] **Step 1: Add a failing error-boundary test**

```tsx
it("shows one reload action when the library body throws", () => {
  const onReload = vi.fn();
  const Broken = () => { throw new Error("chunk failed"); };
  render(<LibraryWorkspaceErrorBoundary onReload={onReload}><Broken /></LibraryWorkspaceErrorBoundary>);
  expect(screen.getByText("加载失败，请重新加载")).toBeInTheDocument();
  const reload = screen.getByRole("button", { name: "重新加载" });
  expect(reload).toBeInTheDocument();
  reload.click();
  expect(onReload).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run and verify red**

Run: `npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/library-workspace-state.test.tsx`

Expected: FAIL because `LibraryWorkspaceErrorBoundary` is missing.

- [ ] **Step 3: Implement and wire the boundary**

Implement a React class error boundary whose default reload handler calls `window.location.reload()`. Wrap only the `LibraryWorkshop` branch so a library chunk/render failure does not replace conversations or navigation.

- [ ] **Step 4: Run focused and full verification**

Run:

```powershell
npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/library-workspace-state.test.tsx
npm --prefix MultiMix-Frontend run typecheck
npm --prefix MultiMix-Frontend run lint
npm --prefix MultiMix-Frontend test
npm --prefix MultiMix-Frontend run build
npm --prefix MultiMix-Frontend run docs:check
```

Expected: all commands exit 0; lint may retain existing warnings but must have zero errors.

- [ ] **Step 5: Browser verification**

Use the running local frontend or an isolated frontend instance to confirm:

- loading fallback is visible when the dynamic import is intentionally delayed in a test;
- a real empty library still shows `这个分类还没有内容`;
- a populated image library still renders cards after the chunk resolves.

- [ ] **Step 6: Commit**

```powershell
git add app/assets/components/library-workspace-state.tsx app/assets/components/assets-workspace-client.tsx app/assets/__tests__/library-workspace-state.test.tsx
git commit -m "fix: recover failed library workspace loads"
```
