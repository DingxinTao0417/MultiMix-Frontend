# Source attachment terminal reconciliation

> Status: active-plan
> Owner: frontend
> Last verified: 2026-07-31

## Background and root cause

A browser upload of a PDF can be durably accepted while the response still reports its source asset as `processing`. If the React reconciliation effect subscribes after that state transition, it can miss an already-completed ingest job and leave the composer permanently blocked as “资料正在准备”. The durable asset and its ingest job are the source of truth; local transfer progress is not.

## Scope and implementation

- `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`: start one immediate, idempotent reconciliation for an accepted source attachment that is returned as `processing`; permit that first poll to run before React's state-ref update, then retain the existing tracked-attachment guard for later polls.
- `MultiMix-Frontend/app/assets/__tests__/chat-attachment-upload-state.test.ts`: cover the accepted-source/processing path and preserve the existing strict send block for genuinely in-flight work.

## Risks and trade-offs

The additional read is only for a server-accepted source attachment whose terminal state was not included in the upload response. It cannot send a message or mark a file ready without observing the ingest-job terminal state. Failed jobs remain failures and continue to block sending.

## Verification

- Run the focused attachment-state test, TypeScript check, and ESLint for touched files.
- Restart only the isolated local frontend on port 3317.
- In Chrome, upload the PDF, observe the composer become sendable, submit the public-material video request, confirm the director script, create its video project, export, download, and inspect the MP4.

## Execution record

- Focused attachment-state coverage passes (`5 passed`); TypeScript and ESLint pass for the touched frontend files.
- Browser verification passed: a freshly uploaded PDF reached “你的素材已就绪” with no “资料正在准备，暂不可发送” block and accepted the public-material video request. The subsequent model-generation stall is tracked separately from upload reconciliation.
