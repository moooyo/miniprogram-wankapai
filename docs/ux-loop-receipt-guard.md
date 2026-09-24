# Receipt creation conflict guard

## Finding

Two receipt forms can both load before a participation exists. Previously, each
submitted an activity and card without an expected participation version. Once
the first form saved, the second form reused the new participation and silently
corrected its amount and receipt date.

## Changes

- New receipt forms opt into `reward.confirm.expectNew`. Inside the existing
  mutation transaction, an existing owner, activity, period, and scope match now
  raises `VERSION_CONFLICT` before any reward or audit write.
- `expectNew` must be a boolean when supplied. A true value cannot be combined
  with a participation ID or expected version. Existing clients that omit the
  guard retain their previous behavior; existing-record forms still send their
  expected version.
- Request replay remains ahead of the guard, both before and inside the
  transaction. Retrying an already committed request returns the original result.
- `activity.get.cardId` validates card ownership and selects that card's current
  participation, or the shared user-scope participation. Archived owned cards
  remain readable through their historical participation snapshots.
- The receipt controller preserves the user's amount and date on conflict. It
  reads the exact intended scope, displays the latest state, and requires an
  explicit reapply action before using the new participation version.
- A first-form draft remains recoverable after another form creates the record.
  Its creation key follows the activity scope, so user-scope recovery does not
  depend on the winning form's associated card. Reload and recovery migrate it to
  the participation draft key. Revision checks prevent cleanup from deleting a
  newer draft written while a read was pending.

## Acceptance coverage

`tests/receipt-creation-conflict.test.ts` uses the real service and transaction
store to cover concurrent first forms in both scopes, independent cards and
owners, request replay, guard validation, transaction rollback, existing
participation conflicts, current-period lookup, snapshot and receipt-date
guarantees, legacy callers, controller conflict/reload/reapply behavior, and
reopening a conflicted first-form draft without an automatic save.

No local verification was run. The parent task runs this coverage together with
the full business suite, type check, and source build on `ssh test-env`.
