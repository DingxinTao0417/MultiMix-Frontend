# Inline keyframe application availability

> Status: archived
> Owner: frontend
> Last verified: 2026-09-07

## Background and root cause

The local three-keyframe acceptance conversation renders the generated images, candidate-set hash, and director-scene target correctly, but shows “尚未应用到分镜” without the set-application action. Two paths combine to cause the dead end: the workspace withholds callbacks while a lightweight/snapshot conversation is displayed, and the alternate `ProductPreview` branch used by this image workspace does not forward the callbacks at all. A snapshot can already contain enough generated-image metadata to render the review UI, while its user action has no route to continue.

Applying an existing generated keyframe is a persisted edit, not a new generation. The action must remain user-triggered and use the full conversation before submitting the write.

## Scope and implementation

- `app/assets/components/assets-workspace-client.tsx`
  - Offer single-image and keyframe-set application callbacks whenever backend persistence is available, including while a snapshot is displayed.
  - On an explicit application request, hydrate the selected conversation if needed, merge the authoritative detail into UI state, then submit the existing structured image-generation application message against that detail.
  - Preserve existing read-only and unavailable-backend protections; do not auto-apply or generate video.
- `app/assets/components/product-workspace.tsx`
  - Forward existing generated-image callbacks and selection state through the alternate image preview branch, matching the primary preview branch.
- `app/assets/__tests__/runtime-write-capability-gating.test.tsx`
  - Reproduce a generated keyframe set rendered from a snapshot while detail hydration is pending.
  - Assert the set action remains visible and clicking it waits for detail before forwarding the existing structured assignment payload.

## Risks and tradeoffs

- The action appears earlier than full detail completion, so the click path must re-fetch detail before it writes. This avoids a dead-end UI without treating snapshot data as authority for the write.
- Both preview branches must retain the same callback contract; otherwise a valid action can silently disappear according to layout state.
- Only explicit user clicks can reach the write path. Existing candidate hash, target, assignment mapping, and backend confirmation/idempotency checks remain authoritative.

## Verification

1. Focused Vitest case fails before the change, then passes after it.
2. Run the generated-image gallery and runtime write-capability suites.
3. Run frontend typecheck and docs validation.
4. Refresh the isolated local acceptance page and verify the “将 3 张分别用于 3 个分镜” button is visible; click it only after user confirmation because it changes the test conversation state.
