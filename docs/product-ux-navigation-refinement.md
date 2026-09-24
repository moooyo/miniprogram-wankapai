# Product UX Navigation Refinement

## Scope

This change refines the activity detail, rewards, and participation history pages. It builds on the existing interaction model and leaves transaction handlers, ownership checks, receipt date rules, historical period snapshots, and idempotency behavior in place.

The review used the existing 320 px and 375 px screenshots in `.qa-native/entitlements-20260924/full-regression-r3`. These images are baseline evidence, not verification of the new implementation.

## Activity Detail

### Problem

The fixed action bar offered completion and receipt recording even before an activity had been added to the task list. A participation below its cumulative target emphasized completion while progress editing was a small action in the middle of the page. At 320 px, the two wide actions wrapped into a two-row bar. Existing participation information appeared after the external bank entrance.

### Changes

- Show existing participation details before the bank entrance and give progress editing an explicit label.
- Use one primary action selected from the participation state and its saved activity snapshot: join, update progress, complete, record or correct a receipt, or resume a skipped period.
- Keep a compact More action beside the primary action in a single row.
- Preserve direct completion and direct receipt recording in More before joining. Both use the original action preparation and card selection handlers; no preliminary join command is introduced.
- Keep the expected receipt date available in the participation panel and More. History and the existing management actions remain available.
- Remove the duplicated top management control and the second join button in the page body.

The current public activity revision must not replace a participation snapshot when choosing the next action. A changed current target or reward kind therefore cannot turn an old cashback participation into a different workflow.

## Rewards

### Problem

An empty month displayed the total, two zero-valued subtotals, a statistical explanation, and an empty list heading before its next action. At 320 px, the action fell below the first viewport.

### Changes

- Preserve the selected month, selected currency, and monthly total.
- Hide empty subtotals and the unused list heading when the selected scope has no received records.
- Present the empty-state action immediately after the compact total: review all pending records when pending records exist, otherwise browse activities.
- Use a count-free pending action label. The existing service computes `pendingCounts` across all pending owner records, independently of the received-record pagination window.
- Leave populated summaries, currency separation, actual-date accounting, and record correction behavior unchanged.

## Participation History

### Problem

A long introductory explanation delayed the first record, and every record gave its audit action a separate full-width row below its date or progress note.

### Changes

- Show a concise scope label with an initially collapsed explanation control. The original explanation remains available in full.
- Place each date or progress note beside its audit action in a wrapping footer.
- Preserve the 48 px audit touch target, separate record and audit buttons, period labels, amount types, dates, and existing handlers.

## Verification

No tests, builds, runtime probes, or browser checks were run on the local Windows machine. Remote verification is coordinated by the main task.

Added controller coverage in `tests/detail-sheet-context.test.ts` exercises snapshot-based next actions, unfinished discount recording, and direct unjoined completion or receipt recording for both user-scoped and card-scoped activities. The card-scoped cases retain eligibility checks and assert that no join command is written before the requested action.

The relevant existing coverage includes detail sheet context, detail reminder preferences, receipt creation and period drafts, benefit semantics, and rewards refresh and pagination behavior. The full type check, build, and browser verification remain required on the designated remote environment.

## Browser Acceptance Updates

- A receipt action is no longer always in `.detail-bottom-bar`. For an unjoined or unfinished cashback activity, open `.detail-more` and use `#detail-manage button[data-handler="receipt"]`.
- Expected-date editing is available through `.date-setting` or the More sheet, replacing `.detail-bottom-bar button[data-handler="openExpected"]`.
- The unjoined primary action is `.detail-bottom-bar button[data-handler="join"]`; unfinished cumulative cashback uses `button[data-handler="editProgress"]` in that bar.
- Existing `.audit-link` selectors remain valid. Record dates and progress notes now live under `.record-footer .record-note`.
- History explanation controls are `.history-help`, `.history-scope`, and `#history-record-help`.
- Empty rewards have `.income-summary.is-empty` and `.income-empty`; the empty scope has no `.income-breakdown` or received-list `.section-heading`.
