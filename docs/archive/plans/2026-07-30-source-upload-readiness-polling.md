# Source Upload Readiness Polling

> Status: active-plan
> Owner: frontend
> Last verified: 2026-07-30

## Background and root cause

The PDF upload endpoint accepts the source asset before its derived visual assets and understanding work have completed. The workspace records that first `processing` response in `chatImageUploads`, but never refreshes the source asset afterwards. Even after the online ingest job and source asset are `completed` / `ready`, `attachmentSendBlockReason` continues to block the draft as "资料正在准备，暂不可发送。"

## Files and key paths

- `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`: upload completion state and new-conversation attachment lifecycle.
- `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts`: existing read API for a persisted asset, if one is needed by the poller.
- `MultiMix-Frontend/app/assets/__tests__/`: upload-state regression coverage.

## Changes

1. After the upload response supplies a persisted asset ID with `processing` status, poll the existing asset read endpoint at a bounded interval.
2. Update only the matching draft attachment to `ready` or `failed` from the authoritative server response; stop polling when removed, unmounted, or terminal.
3. Preserve the existing send guard while the server genuinely reports `processing`; allow the original source asset to be linked once it reports `ready`.

## Risks and tradeoffs

- Polling must not overwrite a removed attachment or keep timers alive after navigation.
- A transient read error must not mark a successful upload failed; it should retry while the attachment remains present.
- This fixes client state convergence only; it does not loosen the document understanding quality gate.

## Verification

- Add a regression test: `processing` upload response followed by `ready` asset read unblocks the attachment.
- Keep the existing test proving a genuinely processing attachment blocks sending.
- Run the focused frontend tests and typecheck.
- Browser: upload the PDF, wait for the live source asset to become ready, and submit the original concise video request.
