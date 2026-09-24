# Period-bound receipt creation and safe request replay

New receipt forms can bind their absent-record assertion to
`reward.confirm.expectedPeriodKey`. The service validates this only for the
`expectNew` path and checks the selected activity's current period after card
ownership validation, before finding or creating a participation. A changed
period returns `VERSION_CONFLICT` with `field: expectedPeriodKey` and performs no
write. Existing-participation corrections retain their snapshot, original
activity period, receipt-date validation, and expected-version behavior.

The original successful request is still replayed before these new validations.
A receipt committed in September can therefore return its original result in
October without moving its activity period, altering its receipt date, or
creating another reward.

The new `request.replay` query takes an original command's action, exact payload,
and request ID. It reads the authenticated owner's request ledger and compares
the existing canonical fingerprint. It never dispatches the original command,
materializes periods, creates a missing request record, or falls back to a new
write. This is a distinct action so older servers reject it safely rather than
ignoring an unfamiliar read-only flag on a mutating command.

A missing ledger record returns `REQUEST_UNRESOLVED`. This describes the lookup
result only: an original request still in flight may commit later. Clients must
retain the pending intent and exact payload after an unresolved lookup or a
period mismatch. A legacy draft without a persisted request ID or reconstructible
intent key cannot be presented as an exact retry.

`tests/creation-period-replay.test.ts` covers monthly, quarterly, annual, and
once-only periods; commit/replay ordering; independent cards and owners;
absence/version/date guards; existing historical corrections; legacy card
lookup without new writes; exact fingerprints; suppression of implicit period
materialization; and a delayed original commit after an unresolved lookup.
Verification is restricted to `ssh test-env`.

Remote verification passed all 44 cases in `creation-period-replay.test.ts`,
`domain.test.ts`, and `billing-period-target.test.ts`, including the 13 new cases.
The parent task runs the integrated client, type-check, and build acceptance.
No local verification was performed.
