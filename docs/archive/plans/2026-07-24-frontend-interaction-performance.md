# Frontend Interaction Performance Remediation Implementation Plan

> Status: archived
> Owner: frontend
> Last verified: 2026-07-24

> **For agentic workers:** REQUIRED SUB-SKILL: use `executing-plans` and complete the tasks inline. Workspace rules prohibit Subagents unless the user separately approves them.

**Goal:** Remove the confirmed multi-second interaction stalls in the workspace without changing the approved library taxonomy, asset semantics, or video-preview visual contract.

**Architecture:** Keep the existing adapter boundary and UI structure. Make the video editor an explicit, user-triggered enhancement over the lightweight storyboard preview; page library reads through the existing asset endpoint; render no eager video elements in library cards; cache short-lived first pages; and memoize the heavy library/Markdown subtrees behind stable callback boundaries.

**Tech Stack:** Next.js 15, React 19, TypeScript strict, Vitest/Testing Library, FastAPI, SQLAlchemy, pytest.

## Global Constraints

- Preserve `video-preview-shell-contract:v1`: white shell, `1px solid #eae7e1`, `20px` radius, `7px` padding, approved shadow, canvas-only aspect ratio, and the existing player controls.
- Preserve asset-library categories and `metadata.understanding`; this work must not reinterpret `visual`, `visual_tags`, `asset_reference`, or `mg_decision`.
- Do not introduce a new semantic classifier, keyword table, fake progress state, or demo-data fallback.
- Do not add a frontend virtualization dependency for the first remediation; server paging plus a 48-row render ceiling is sufficient and lower risk.
- Do not change editor behavior after it is explicitly loaded.
- No database files, production data, commits, merges, pushes, or Subagents are authorized by this task.

---

## Background and Root Cause

The 2026-07-24 controlled audit reproduced the latency with an instant local API:

- a 200-video library produced about 2,905 DOM nodes and 200 immediate media requests;
- expanding the sidebar while that list was mounted took about 2.37 seconds, versus about 0.3 seconds in a light view;
- a ready video project mounted `/editor?...&mode=preview` automatically and took about 30 seconds to become usable in development;
- long copy content rebuilt thousands of Markdown DOM nodes during unrelated parent updates.

The confirmed causes are:

1. `MultiMix-Frontend/app/assets/components/product-preview.tsx:351-380` mounts a preview editor iframe before the user asks for it, while `product-workspace.tsx:791-802` simultaneously mounts a second hidden editor iframe as an export bridge.
2. `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts:1072-1103` can fetch 200 rows per media kind; the video view combines two kinds.
3. `MultiMix-Frontend/app/assets/components/library-workshop.tsx:120-133` creates one `<video preload="metadata">` per video card and `:572-644` renders every row.
4. `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx:47-58` declares four dynamic wrappers for the same library module, and unstable callback props prevent a memoized heavy view from being skipped.
5. `MultiMix-Frontend/app/assets/components/product-preview.tsx:190-200` rebuilds the full Markdown subtree on parent updates.

During isolated browser verification, a concurrent display-coverage cleanup
deleted the fixed `.next-display-coverage` directory while another run was
compiling `/editor`. This produced false editor failures and 500 responses.
The verification runner therefore also needs a run-id-scoped Next directory.

The same browser run exposed a second fixture-only inconsistency: the local
backend enables the new pipeline-readiness gate, while the ready-project
display fixture lacked persisted `video_plan.primary_visual` fields. The API
correctly returned that fixture as not ready. The fixture now satisfies the
shared readiness invariant under both legacy and pipeline-enabled settings;
the editor and API readiness checks remain unchanged.

## Approaches Considered

### Video project preview

1. **Explicit full-preview load over the existing lightweight storyboard — selected.** Immediate browse state stays useful, segment cards keep working, and `/editor` loads only after a clear user action.
2. Load the editor during `requestIdleCallback`. This still spends CPU/network without user intent and can interrupt a later click.
3. Remove project preview entirely. This improves performance but removes an existing capability.

### Library loading

1. **Use the existing `/v1/assets` endpoint with `library_kind`, `limit`, and `offset` — selected.** It gives one globally ordered request per library and is backward-compatible.
2. Add a new lightweight DTO endpoint. This offers a smaller payload but expands API surface and requires a second detail-fetch lifecycle.
3. Keep fetching all rows and only virtualize the DOM. This leaves the oversized payload and eager media work unresolved.

## Files and Responsibilities

- Modify `MultiMix-Backend/app/api/assets.py:369-396`
  - accept and validate `library_kind`;
  - apply it together with existing `limit` and `offset`.
- Modify `MultiMix-Backend/app/tests/test_asset_conversation.py`
  - prove library filtering and stable pagination order.
- Modify `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts:30-61,310,1072-1103`
  - add `LibraryPage`;
  - use one paginated library request;
  - expose a distinct thumbnail URL so list cards never need the full video URL.
- Modify `MultiMix-Frontend/app/assets/components/library-workshop.tsx:120-133,208-322,572-645`
  - render video thumbnails/placeholders instead of `<video>`;
  - load 48 rows at a time;
  - abort stale requests;
  - keep a bounded, token-scoped short-lived page cache;
  - provide an accessible “加载更多” action.
- Modify `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx:47-58,1781-1787,2173-2184`
  - use one dynamic library wrapper;
  - pass stable callbacks and the refresh revision;
  - stop forcing a new library module identity per view.
- Create `MultiMix-Frontend/app/assets/lib/use-stable-callback.ts`
  - provide a stable callback identity that always invokes the latest closure.
- Create `MultiMix-Frontend/app/assets/components/markdown-product-document.tsx`
  - memoize sanitized Markdown rendering with module-stable plugin arrays.
- Modify `MultiMix-Frontend/app/assets/components/product-preview.tsx:1-15,185-203,351-414`
  - use the memoized Markdown document;
  - default ready projects to `StoryboardPreview`;
  - mount `VideoProjectPreview` only after “加载完整工程预览”.
- Modify `MultiMix-Frontend/app/assets/components/product-workspace.tsx:133-145,250-383,690-714,791-802`
  - do not mount the hidden export/editor iframe in passive browse mode;
  - mount it after explicit edit/export intent;
  - queue an export click through quality preflight and continue automatically when the editor reports ready.
- Modify `MultiMix-Backend/app/tests/fixtures/display_coverage/seed.py`
  - seed enough isolated video-library-only rows to exercise the 48-row browser boundary and “加载更多”;
  - keep ready-project fixtures valid when pipeline orchestration is enabled.
- Modify `MultiMix-Backend/app/tests/test_display_coverage_seed.py`
  - prove the seeded ready project satisfies the shared pipeline-enabled
    readiness invariant.
- Modify `MultiMix-Frontend/e2e/display-area.spec.ts`
  - prove passive ready-project browsing makes no editor request before the explicit preview click;
  - prove the real video library renders 48 rows, zero list videos, then appends the remaining rows.
- Modify `MultiMix-Frontend/scripts/run-display-coverage.mjs` and its workflow contract test
  - scope the disposable Next development directory to `DISPLAY_COVERAGE_RUN_ID`;
  - clean only that run's directory so concurrent verification cannot invalidate an active server.
- Add/modify focused frontend tests under `MultiMix-Frontend/app/assets/__tests__/`.
- Update this plan when implementation details diverge.

## Risks and Trade-offs

- The first page contains 48 rows rather than the previous complete library. The explicit “加载更多” action preserves access while bounding work.
- A video card without an image thumbnail shows the approved video placeholder. The playable video remains available in the detail modal.
- Cached pages can be stale for at most 30 seconds. Upload/import/reparse refresh revisions bypass the cache.
- The full project preview adds one explicit click. In return, normal browsing no longer downloads and initializes the editor.
- The existing `/v1/assets` response is still richer than a purpose-built list DTO. If production payload timing remains high after paging, a separate lightweight DTO is the next isolated optimization.

## Task 1: Paginated Backend Library Read

**Interfaces**

- Consumes: `GET /v1/assets?library_kind=<assets|copy|image|video>&limit=<1..200>&offset=<n>`.
- Produces: the existing `list[ContentAssetRead]`, filtered by the authenticated user and requested library, ordered by `updated_at DESC, id DESC`.

- [x] Add a failing API test that inserts rows in at least two libraries and asserts filtering plus two non-overlapping pages.
- [x] Run the focused pytest case and confirm it fails because `library_kind` is currently ignored.
- [x] Add normalized `library_kind` validation and SQL filtering to `list_assets`.
- [x] Re-run the focused pytest case and the adjacent asset-list tests.

## Task 2: Frontend Adapter Paging

**Interfaces**

```ts
export type LibraryPage = {
  rows: LibraryRow[];
  nextOffset: number | null;
};

listLibrary(
  token: string,
  view: Exclude<AssetWorkspaceView, "conversation">,
  query?: string,
  options?: { offset?: number; limit?: number; signal?: AbortSignal },
): Promise<LibraryPage>;
```

- [x] Add a failing adapter test asserting one `library_kind` request, `limit + 1` lookahead, correct offset, 48 returned rows, and `nextOffset`.
- [x] Run the focused Vitest case and confirm the old array/multi-kind behavior fails.
- [x] Implement the paginated adapter result while retaining the existing keyword/semantic-search merge for non-empty queries.
- [x] Add a failing mapping assertion that a video row exposes a still thumbnail separately from its playable URL.
- [x] Implement `thumbnailUrl`; keep `previewUrl` for the detail modal.
- [x] Re-run adapter tests.

## Task 3: Bounded Library Rendering and Request Lifecycle

- [x] Add a failing component test with more than one page of video rows:
  - only the first page renders initially;
  - the list contains zero `<video>` elements;
  - opening the detail modal creates at most one `<video>`;
  - “加载更多” appends the next page.
- [x] Run the test and confirm the current all-row/eager-video behavior fails.
- [x] Implement 48-row paging, stale-request abort, and separate loading-more state.
- [x] Replace list-card videos with still thumbnails or the existing placeholder.
- [x] Add a 30-second bounded cache scoped to the current token, view, query, and refresh revision.
- [x] Re-run the component and adapter tests.

## Task 4: Explicit Full Video-Project Preview

- [x] Add a failing product-preview test proving a ready project initially contains “轻量分镜预览” and no “视频工程预播” iframe.
- [x] Add an assertion that clicking “加载完整工程预览” mounts the existing iframe with the unchanged editor URL.
- [x] Add a failing workspace test proving passive browse mode contains no hidden “视频剪辑器” iframe.
- [x] Add an export test proving one explicit export click mounts the bridge, waits for editor ready, and then posts the export command without a second click.
- [x] Run the focused tests and confirm they fail because both iframe paths currently mount automatically.
- [x] Add `projectPreviewRequested` state, reset it per product, and keep segment selection on the lightweight preview until requested.
- [x] Add `editorRequested` and a pending-export handoff in `ProductWorkspace`; explicit edit/export actions are the only bridge mount triggers.
- [x] Keep the existing `VideoProjectPreview` component and player-shell implementation unchanged.
- [x] Re-run video preview, display-area, and browse-contract unit tests.

## Task 5: Heavy-Subtree Render Isolation

- [x] Add a failing `useStableCallback` test proving identity stays stable while the latest closure is invoked.
- [x] Implement the hook and pass stable library callbacks from `AssetsWorkspaceClient`.
- [x] Add a failing contract test proving only one dynamic `library-workshop` import remains and the library receives a refresh revision rather than a forced active-view key.
- [x] Collapse the four dynamic declarations to one and memoize `LibraryWorkshop`.
- [x] Add a failing Markdown component test proving the same Markdown string does not rerender the parser after a parent rerender, while changed Markdown does.
- [x] Implement `MarkdownProductDocument` with `React.memo` and stable plugin arrays; replace the inline parser.
- [x] Re-run focused tests.

## Task 6: Verification

- [x] Run backend focused pytest and Ruff on changed backend files.
- [x] Run frontend focused Vitest cases.
- [x] Run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
- [ ] Run `npm run check:agents`, including `docs:check`.
  - `AGENTS.md` synchronization passes and this plan's header is accepted.
    The aggregate command remains blocked by six unrelated 2026-07-22 active
    plans that predate this change and still lack the required status header.
- [x] Because video browse behavior is touched, run:
  - `npm run check:video-preview-contract`
  - `npm run test:product-stage-style`
  - isolated `npm run test:display-coverage`
- [x] Start isolated frontend/backend or mock services on unused ports, with a disposable SQLite database only if a backend is required.
- [x] Browser acceptance:
  - initial ready-project browse makes no `/editor` iframe request;
  - explicit full-preview click loads exactly one iframe;
  - first video-library page renders at most 48 cards and zero list-card video elements;
  - initial media requests are bounded to visible still images;
  - sidebar collapse/expand remains responsive with the first page mounted;
  - “加载更多” appends rows without replacing the current page.
- [x] Stop all test processes, delete the disposable database/build directory, and verify test ports are closed.

## Success Criteria

- Ready video projects do not load editor chunks or either editor iframe before explicit user action.
- Video-library list cards create zero `<video>` elements; the detail modal creates at most one.
- Initial library read is one request and at most 49 records on the wire for a 48-row page.
- Repeated sidebar state changes do not rerender the memoized library or Markdown parser when their data/props are unchanged.
- All protected video-preview contract checks remain unchanged and pass.
- No unrelated working-tree changes are overwritten or included.
