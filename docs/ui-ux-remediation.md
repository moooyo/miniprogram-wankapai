# UI/UX remediation and acceptance

Completed on 2026-09-21 with explicit authorization for local Windows verification. The accepted product scope, moderated public submissions, and server authorization rules remain intact.

## Changes

| Review area | Implemented behavior | Verification |
| --- | --- | --- |
| Actual reward amounts | Received todo rows show actual receipts, with the original estimate separately labeled. | Records tests and SDK receipt-to-todo flow |
| Card identity | Lists and forms share card labels; repeated names are disambiguated, and archived card identities remain available to their owner. | Ownership/legacy-record tests and real same-name-card UI flow |
| Repayment reminders | Each unpaid bill has a reminder action. Preferences, in-app tasks, demo explanations, and accepted WeChat authorization are distinguished. | Wallet tests and SDK demo boundary; zero subscription requests |
| Historical access | Todo and the personal page link to all participation records, including prior periods. | Expired-record domain tests and SDK navigation |
| Bank context | Activity-driven card creation preselects the activity's bank and its issuer options. | Form tests and SDK card creation |
| Skipped participation | Skipped records offer restoration instead of an unusable receipt action. | Records tests and SDK skip/restore/receipt flow |
| Save-state locking | Card editing is locked during save, remove, and confirmation operations. | Delayed-response controller tests |
| Conflicts | Progress and receipt inputs survive a conflict; the user loads the latest version and explicitly reapplies the input with a version assertion. | Controller conflict/recovery tests |
| Review pagination | Stale status and pagination responses cannot append rows or errors to a new filter. | Deferred-response tests |
| Field feedback | Correcting one field preserves other errors. Submission and card validation locate the actual invalid field. | Form/submission tests and SDK invalid-submission feedback |
| Currency scope | Pending totals show all-currency scope and selectable currency counts, while amounts remain separated by currency. | Domain projection tests and SDK count consistency |
| Returning edited submissions | Moderators explicitly confirm that returning saves the review note but does not save draft edits. | Confirmation and cancellation tests |
| Local drafts | Card, progress, receipt, and submission inputs are saved by account and entity and restored only after confirmation. Older drafts never silently submit over newer records. | Storage isolation, conflict tests, and four SDK recovery flows |
| Late requests | An old save may clear only its own draft revision and cannot navigate, alter leave warnings, or overwrite drafts after its page has been unloaded. | Deferred success/failure and storage-error tests |
| Month filter | Month-end filtering appears only with unfinished tasks; completed/current-record scope is stated explicitly. | Records tests and visual inspection |
| Visual hierarchy | Activity titles align with the reading edge, joined-activity entry buttons are secondary, bill settings collapse, and operational metadata is more readable. | SDK geometry/color assertions and screenshot review |
| Modal sheets | Active sheets hide native tab navigation, restore it on close, retry failed restoration, hide background accessibility content, and remeasure on viewport/keyboard changes. | Sheet lifecycle tests and rendered-viewport SDK assertions |

Local draft saving and section progress reduce the cost of filling long submissions. Publication validation and source-verification requirements have not been relaxed.

## Acceptance result

- Type checking passed.
- All **109** automated domain, adapter, controller, and contract tests passed.
- The source build passed through `scripts/build.mjs`.
- All **22** SDK UI acceptance scenarios passed, with **zero captured runtime exceptions**.
- The run produced **29 SDK screenshots**. Its initial viewport was 390px wide in the iPhone 12/13 (Pro) simulator, using base library 3.17.3. Overlay measurements use the actual rendered viewport after native tab navigation is hidden.
- Demo data, draft keys, and navigation handoff keys were restored and compared with their initial snapshot. The temporary test project was closed; the user's regular project was not used for business mutations.

Run `npm run test:ui` to reproduce the simulator acceptance. `.qa-native/ui-acceptance/latest.json` points to the latest HTML/JSON report and screenshot directory. No computer-use automation was used for this acceptance.

## Boundaries

Delayed network responses, version conflicts, and review races are covered by controlled tests; native rendered flows are covered by the SDK. Regression cases mock platform confirmation and leave dialogs, and the role picker is tested at the event level. This is not a claim of successful production WeChat authorization or message delivery.

Physical-device keyboard behavior, screen-reader traversal, large accessibility text, landscape, and other device sizes still require their own acceptance. The sheet responds to viewport and keyboard changes, but one simulator size does not establish behavior on every device. No cloud functions were deployed, no real notifications were sent, and no version was uploaded or published.
