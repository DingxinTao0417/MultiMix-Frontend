# Public Material Entry Boundary Implementation Plan

> Status: archived
> Owner: frontend
> Last verified: 2026-08-27

> **For agentic workers:** Execute this plan inline in the owning worktree. Do not delegate subagents.

**Goal:** Remove the resource-library-wide public-material search and import flow so public media can enter a video only through the scoped storyboard material-candidate and recompose flow. Completed 2026-08-27.

**Architecture:** `LibraryWorkshop` remains the user’s owned-material library and web-capture/upload surface. It must no longer enumerate providers, search a global catalogue, or persist a client-submitted public candidate. The existing video-project material-candidates + recompose API remains unchanged: it scopes candidate IDs to a user, project, and segment, then validates and persists a chosen public candidate before replacing that segment.

**Tech Stack:** Next.js/React, TypeScript, Vitest, Testing Library.

## Background and root cause

`docs/specs/ui/agentic-workbench-design.md` (current design, §11) limits public materials to the storyboard candidate path. `MultiMix-Backend/docs/authority/asset-understanding-and-segment-referencing.md` (§5, §6.1.7) makes the segment `material-candidates` endpoint the only public-candidate reader and `recompose` the only adoption command. However, `LibraryWorkshop` still exposes a global “公开素材搜索” dialog and `asset-workspace-adapter.ts` still calls the removed `/assets/public-search` and `/assets/public-import` APIs. This is why the existing product-copy contract test fails.

The backend already protects the correct boundary: `app/tests/test_public_materials.py::test_global_public_search_and_client_dictionary_import_routes_are_removed` requires the global search/import routes to remain absent. Its internal public-asset importer remains necessary for the scoped video-candidate workflow and is out of scope.

## Files and boundaries

- Modify `app/assets/components/library-workshop.tsx`: remove the global public-search trigger, state, effects, dialog, thumbnails, handlers, and imports; preserve upload, web capture, library browsing and details.
- Modify `app/assets/lib/asset-workspace-adapter.ts`: remove legacy global public-search/import/provider-admin methods and their API DTO imports; keep segment material-candidate methods unchanged.
- Modify `app/globals.css`: remove selectors used exclusively by the deleted global public-search dialog/cards.
- Modify `app/assets/__tests__/accessibility-interactions.test.tsx`: keep the web-capture modal focus/escape test and remove the deleted public-search modal interaction.
- Modify `app/assets/__tests__/agent-ui-copy.test.ts`: make the existing source-level product-boundary test also reject the obsolete public-source-list endpoint.
- Modify `docs/API.md`: remove “公共素材搜索与导入” from resource-library capabilities; retain video-project segment candidates and material replacement.

## Risks and trade-offs

- Existing users lose the ability to add stock material to the library before creating a video. This is intentional: public material is now contextual to a target segment and is validated, persisted, and traceable before use.
- Do not remove `PublicMaterialCandidate` support from the backend or the scoped video replacement path; doing so would break the required “换素材 → 公共素材” workflow.
- No Provider request, local database, deployment, or production operation is part of this change.

## Verification

### Task 1: Lock the UI/API boundary with tests

**Files:**
- Modify: `app/assets/__tests__/agent-ui-copy.test.ts:1585-1594`
- Modify: `app/assets/__tests__/accessibility-interactions.test.tsx:45-126`

- [x] Extend the existing anti-regression contract so the adapter cannot contain `/assets/public-sources`, `/assets/public-search`, `/assets/public-import`, or `/admin/public-sources`.

```ts
expect(adapter).not.toContain("/assets/public-sources");
expect(adapter).not.toContain("/assets/public-search");
expect(adapter).not.toContain("/assets/public-import");
expect(adapter).not.toContain("/admin/public-sources");
```

- [x] Remove only the public-search section of the accessibility test; retain the web-capture dialog assertion, including focus restoration after Escape.
- [x] Run the two files before implementation and record the expected failure from the existing public-search assertions.

### Task 2: Remove the global library flow without touching scoped video candidates

**Files:**
- Modify: `app/assets/components/library-workshop.tsx:4-80, 337-346, 545-688, 778-786, 1177-1289`
- Modify: `app/assets/lib/asset-workspace-adapter.ts:38-45, 583-591, 1442-1475`
- Modify: `app/globals.css:5801-5950` (only selectors exclusively referenced by the deleted dialog)

- [x] Delete the global public-search state, provider-fetch effect, search/import handlers, trigger and dialog from `LibraryWorkshop`.
- [x] Delete global public-source/search/import/admin methods from `AssetWorkspaceAdapter` and unused `PublicMaterialCandidate`/`PublicSourceRead` imports.
- [x] Delete only CSS classes with no remaining selector use; do not change storyboard `AssetPicker` styles or `loadSegmentMaterialCandidates`/`recomposeSegmentMaterial` methods.
- [x] Re-run the focused tests; expected result: both pass, no public-search button/dialog remains, and the source contract reports no global endpoint string.

### Task 3: Align documentation and run project checks

**Files:**
- Modify: `docs/API.md:68-75`
- Modify: this plan to mark completed evidence after verification.

- [x] Change the resource-library capability row to omit global public-material search/import and describe public material only under the video-project candidate/replacement row.
- [x] Run:

```powershell
npm test -- --run app/assets/__tests__/agent-ui-copy.test.ts app/assets/__tests__/accessibility-interactions.test.tsx
npm run typecheck
npm run lint
npm run docs:check
npm test
```

- [x] Run the backend contract test without starting a service or Provider:

```powershell
python -m pytest app/tests/test_public_materials.py::test_global_public_search_and_client_dictionary_import_routes_are_removed -q
```

- [x] Update this plan’s evidence with the exact commands and results. Do not archive it until the already-active Modal MG plan’s closeout commit is complete; this boundary fix is a separate follow-up.

## Completed evidence (2026-08-27)

- RED: `npm test -- --run app/assets/__tests__/agent-ui-copy.test.ts app/assets/__tests__/accessibility-interactions.test.tsx` failed because `LibraryWorkshop` still contained `公开素材搜索`.
- GREEN: the same focused command passed with `2` files and `61` tests.
- `npm run typecheck`, `npm run lint`, and `npm run docs:check` passed.
- `npm test` passed with `94` files and `715` tests.
- `python -m pytest app/tests/test_public_materials.py::test_global_public_search_and_client_dictionary_import_routes_are_removed -q` passed with `1 passed`; it uses no Provider or service process.
