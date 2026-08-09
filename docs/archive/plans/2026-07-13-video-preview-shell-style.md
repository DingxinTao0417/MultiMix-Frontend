# Video Preview Shell Style Implementation Plan

> Owner: frontend
> Last verified: 2026-07-13

**Goal:** Keep the existing video ratios and playback behavior while matching the approved `workspace-video.html` preview-card styling.

**Architecture:** Reuse `VideoPreviewPlayer` and its current media state. Adjust only the shared player markup and CSS contract so both completed-video and storyboard-video paths render the same white preview shell.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library.

## Global Constraints

- Preserve the existing landscape and portrait ratio classes.
- Preserve click-to-play, click-to-pause, seeking, playback-position updates, and recoverable errors.
- Do not change video orchestration, saved asset references, segment data, or editor behavior.
- Do not start E2E services or create a SQLite database for this style-only change.

### Task 1: Match the approved video preview shell

**Files:**

- Modify: `MultiMix-Frontend/app/assets/__tests__/video-preview-player.test.tsx`
- Modify: `MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts`
- Modify: `MultiMix-Frontend/app/assets/components/video-preview-player.tsx`
- Modify: `MultiMix-Frontend/app/globals.css`

- [x] Add a component regression case proving the screen remains the only play/pause control and the bottom row contains time, progress, and duration.
- [x] Add a style contract for the white 20px shell, 7px inset, hairline border, soft shadow, and 14px clipped screen.
- [x] Run the targeted tests and confirm they fail on the current implementation.
- [x] Apply the minimal markup and CSS changes.
- [x] Run the targeted tests and confirm they pass.
- [x] Run `npm run typecheck`, `npm run lint`, `npm run docs:check`, and the relevant display-area test suite.
- [x] Inspect the final diff and confirm unrelated dirty files remain untouched.

## Validation Cases

- [x] Portrait video keeps its `9 / 16` screen ratio inside the styled shell.
- [x] Landscape video keeps its `16 / 9` screen ratio inside the styled shell.
- [x] Paused video shows the centered circular play control.
- [x] Clicking the video surface plays and pauses without a duplicate bottom play button.
- [x] The bottom row shows current time, progress, and total duration.
- [x] Load failure still exposes retry behavior.

