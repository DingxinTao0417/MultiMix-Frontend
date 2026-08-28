# Prevent stale Presenter cleanup confirmations

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-28

## Background and root cause

Production Presenter validation exposed a conflicting confirmation path.  While a
structured `presenter_cleanup_confirmation` card was still pending, an older
generic `submit_message` suggestion labelled "确认生成" remained actionable.  Its
backend utterance is the unbound text "确认".  Selecting it can advance the
conversation without the cleanup-plan ID, hash, selected items, or audio binding;
the subsequently correct card submission then encounters a stale/conflicting
server state.

The product rule is that a key confirmation must be performed through its
structured card and its explicit object binding.  A text-only confirmation must
not compete with an active Presenter cleanup confirmation.

## Scope and implementation

- `app/assets/components/conversation-studio.tsx`
  - Derive whether the current visible conversation has a pending Presenter
    cleanup confirmation.
  - Hide generic executable confirmation suggestions (the unbound
    `submit_message` action whose utterance is plain "确认") while that card is
    active.  Keep ordinary editable suggestions and the structured card itself
    available.
- `app/assets/__tests__/conversation-agent-actions.test.tsx`
  - Reproduce the stale-path fixture: a pending cleanup card plus an older
    generic "确认生成" action.
  - Assert the generic action is absent and only the structured card can submit
    the bound cleanup confirmation payload.

## Risks and trade-offs

- The suppression is deliberately narrow: it applies only to a plain executable
  confirmation while a pending Presenter cleanup card exists.  It does not hide
  general suggestions in other stages or change backend idempotency behavior.
- The backend remains authoritative and will continue rejecting stale bindings;
  this change removes the competing UI action rather than weakening that safety
  boundary.

## Verification

1. Add the failing frontend regression test before implementation.
2. Run the focused conversation action tests and the affected suggestion tests.
3. Run frontend type/lint checks and `npm --prefix MultiMix-Frontend run
   docs:check`.
4. Deploy the frontend, then run one fresh production Presenter conversation:
   verify that no generic unbound confirmation appears beside the pending cleanup
   card and that the exact card confirmation advances without a conflict.  Report
   only phases, HTTP/completion status, call counts, fallback and failure codes;
   never record generated body text.
