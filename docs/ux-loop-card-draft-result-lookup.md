# Recovered ordinary card draft result lookup

Date: 2026-09-23

## Confirmed recovery gap

The R14 reproduction began with an ordinary card draft that had already persisted its creation intent and form values. A targeted native-storage mock then rejected only the later write containing pending-creation metadata. The card creation committed, but its response was lost. The existing draft-save failure and leave-with-data-loss warnings were correctly shown.

After the user explicitly recovered the older ordinary draft, its unchanged nickname collided with the card that had already been created. Normal Save correctly issued no command. However, the screen provided no way to ask whether the original draft had already been saved, even though a read-only lookup with the original intent and payload returned the existing card.

The frozen pre-fix evidence is `.qa-native/prototype/r14-before/r14-card-draft-report.json`, against prototype SHA-256 `dac92caa1785b82f582608c2324467db3179b73fe9328ee73dda1cf9d6ba5d39`. It includes the real prototype UI flow, storage failure injection, committed command, lost response, restoration, nickname rejection, and read-only control result. The existing warnings are part of the evidence, not a missing-warning claim.

## Implementation

Only an explicitly recovered ordinary creation draft with a valid persisted intent and no pending metadata becomes a lookup candidate. The controller captures its normalized original creation payload in memory. The lookup entry is available only while the current owner, draft scope, intent, and normalized payload still match that candidate and the form has a nickname collision.

The screen offers an explicit action to check whether that recovered draft was saved. The copy explains that the check only reads existing results and will not add another card. It does not assume that an ordinary draft was submitted. Normal Save retains its original validation and cannot bypass the nickname restriction.

The action verifies the current session owner and calls the existing API with the captured payload, original intent, and `replayOnly: true`. A confirmed result conditionally removes only the inspected draft revision and opens Wallet. A newer draft revision is preserved. Missing, unsupported-server, transport, and other lookup failures keep the current values and provide a retry or Wallet inspection path without a fresh creation fallback.

Editing the payload removes the lookup option; restoring the original normalized values can make it available again. The existing pending-result and cross-period lookup flows remain separate. The original storage-failure and unload warnings remain visible and unchanged.

## Review and verification scope

The implementation uses the existing card-form notice, button, and helper-text styles. The `ui-ux-pro-max` state-clarity, truthful feedback, error-recovery, and touch-interaction guidance was applied to the new entry without changing the visual system.

An independent static review found no additional correctness issue. Remote regression verification preserved all existing card-creation and UI-contract checks: 52 passed, zero failed. The new `tests/card-draft-result-lookup.test.ts` added 14 passing cases using the real page controller, API client, domain service, and transactional memory store with mocked native storage and cloud transport. The complete TypeScript check passed. The original `tests/card-creation-intent.test.ts` was not edited for this change.

The new cases cover the actual pending-marker storage failure followed by committed creation and lost response; the original storage and unload warning; explicit ordinary-draft recovery; normal Save still issuing zero commands on collision; read-only recovery with a single existing card; genuinely unsubmitted drafts; changes to twelve payload fields; missing or invalid original intent; declined recovery; unsupported-server and network failures; busy-state locking; newer draft revisions; disposed pages; and identity changes.

```text
cd /tmp/wankapai-ux-loop-20260922
npx tsx --test --test-reporter=spec tests/card-creation-intent.test.ts tests/ui-contract.test.ts
npx tsx --test --test-reporter=spec tests/card-draft-result-lookup.test.ts
npm run typecheck
```

All execution ran through `ssh test-env` in `/tmp/wankapai-ux-loop-20260922`. The root task performs the final combined build, full suite, and prototype acceptance after the parallel fixes are integrated. No local validation, real notification, deployment, experience-version upload, or publishing was performed.
