# Complete UI/UX review: round 5

## Result and review boundary

Round 5 found five new actionable issues. The consecutive clean-review count remains **0**. This is a completed findings round, not the first clean round. Fixes made after a finding do not retroactively change the result of this round.

The review freshly read all 16 registered routes and their TypeScript, WXML, WXSS, and JSON files; all three shared components; global styling and navigation; the prototype generator; the complete browser runtime; and the HTML/CSS workbench. Independent read-only reviewers covered the management routes and components, the wallet/history/account routes, and the three activity-record routes, while the round reviewer covered Todo, Activities, Rewards, cross-cutting services, and prototype integration. The round reviewer reread the source mechanisms behind every finding. This was a complete new pass rather than a check of earlier findings alone.

The UI/UX Pro Max skill and both its full quick reference and professional checklist guided all ten review categories. Accessibility, touch interaction, feedback, forms, state preservation, responsive behavior, and navigation received priority. The application remains an explicitly light-themed native WeChat utility; browser conventions were not imposed where they do not apply to native controls. There are no chart interactions in the current product.

No local test, build, validation suite, or runtime probe was run. Local work consisted of source/document reads and inspection of remotely generated images. The main task owns all executable verification through `ssh test-env`.

## Incoming evidence reviewed

The main task reported a successful remote type check, **217/217** business/controller tests, and the complete source build from `scripts/build.mjs` for the incoming candidate. The reviewer read `.qa-native/prototype/final/report.json`, which records **78 passed scenarios**, **0 failures**, **84 screenshots**, **0 runtime exceptions**, and **64 source handlers exercised through browser UI**. Its generated inventory includes all **16 routes**, **3 shared components**, **260 source bindings**, and **184 unique source handlers**. Inventory completeness is distinct from runtime branch coverage.

The incoming prototype SHA-256 is `66c3f73c7a4faf0a7c5e639a175378a3a3c4e6856896ff294626a7ec7f1cd3ae`. The report completed at `2026-09-22T16:12:10.233Z`. The reviewer inspected these images from that evidence set:

- `.qa-native/prototype/final/contact-sheet-375.png`
- `.qa-native/prototype/final/contact-sheet-320.png`
- `.qa-native/prototype/final/contact-sheet-768-landscape.png`
- `.qa-native/prototype/final/workbench-overview.png`, with the complete flow overview expanded

The images confirm the corrected narrow-device dock, normal switch tracks, readable demo disclosure, coherent page hierarchy, and the connected route workbench. The report specifically covers the previous failed-month label, retained sheet scroll, private-content authorization recheck, and disabled pagination conditions. No new concrete visual-layout defect was identified in these images. This does not override the new state and concurrency findings below, which are outside the passing scenarios' exact paths.

The prototype's final incoming source, including the same-instance permission-denial scenario, was read after the main task declared it frozen. Finding integration subsequently reopened source changes. The incoming report and hash do not certify those later changes.

## New actionable findings

### R5-01 — P2: Treat image-picker cancellation as cancellation in Full Submission

Evidence at discovery: `miniprogram/services/api.ts:65` passes the `wx.chooseMedia` failure callback value directly to Promise rejection. Native cancellation can therefore be the ordinary object `{ errMsg: 'chooseMedia:fail cancel' }`. `miniprogram/pages/submission-edit/index.ts`, in `addImage()`, extracted a message only from `Error` instances. A cancellation object became the generic upload-failure message; the following cancellation check no longer matched, and the handler wrote `errors.imageIds` and rebuilt the error summary. The Lead editor already recognizes ordinary `message` and `errMsg` properties.

Impact: Dismissing the image picker creates a red failure state and error-summary entry even though the user intentionally canceled and no upload failed. Equivalent selection operations behave differently between the lightweight and complete submission editors.

Recommendation: Normalize native and Error-shaped messages consistently. Cancel without changing the existing image list, draft, or validation state. Preserve a useful recovery message for actual picker, reading, or upload failures.

Acceptance: Cover ordinary-object cancellation, Error-shaped cancellation, and a genuine image failure. Cancel with an existing error and draft to confirm they are preserved, and verify that a real failure remains visible and retryable.

Integration reread: The main task added `imageErrorMessage()` and stopped clearing the existing form error when image selection begins. The reviewer confirmed this source correction during the round. New remote verification is still required; the incoming 78-scenario artifact predates it.

### R5-02 — P2: Reconcile Detail before offering state-dependent actions again

Evidence at discovery: `miniprogram/pages/detail/index.ts:71-77` calls `load()` on return and sets `loading`, but the WXML shows loading only when there is no existing `detail`. Existing progress, amounts, and bottom actions remain visible with no refresh indicator. `prepareAction()` at line 106 checks `busy`, not the read-in-progress state. The bottom actions and management actions are primarily disabled by `busy`. The refresh failure branch replaces the loaded detail with a full error state.

Impact: After saving a receipt and returning to Detail with a delayed activity read, the page still displays the old estimate and old completion/receipt actions. A user can invoke an action based on the outdated state; an idempotent completion response can then produce a completion message that asks the user to confirm a receipt which was already saved. On a failed follow-up read, the previous useful detail context disappears entirely.

Recommendation: Distinguish initial loading from same-record refresh. Retain the current detail with explicit refresh/retry feedback, and disable state-dependent actions until the read successfully reconciles it. Preserve the previous context after failure while marking it stale. Continue request-generation and disposal guards.

Acceptance: Save progress and a receipt, return to Detail, delay and fail its read, and retry. Verify preserved context, clear feedback, disabled stale actions, and accurate amounts and actions after recovery. Exercise a delayed refresh around skip/resume, completion/revoke, and expected-date changes as applicable.

Integration reread: The reviewer reread the revised Detail controller and template after the implementation author marked them ready. Loaded detail now remains mounted during refresh and failure, state-dependent handlers and controls share the stale/busy guard, saved mutations retain accurate feedback through a failed read, and delayed card-choice or revocation responses are rejected after a newer read. Expected-date edits remain visible with updated-record context. Fresh remote checks are still required; this does not close R5-05's separate prototype navigation issue.

### R5-03 — P2: Make the registration field visible and comparable during progress recovery

Evidence at discovery: `miniprogram/pages/progress/index.ts:66-70` builds `latestSummary` from progress and stage only. `preserveInput` retains the user's earlier `registered` value, while `showRegistration` is derived only from the newest rule and record. The template asks the user to check the latest record before reapplying, but it displays the retained input. `domain/service.ts`, in `participation.progress`, keeps stage `in_progress` whenever progress is positive, independently of registration.

Impact: If another editor changes only registration on a record with positive progress, the refreshed summary looks unchanged. The user cannot see the new registration state before explicitly reapplying an older value. For an activity without mandatory registration, if the new version clears registration, `showRegistration` becomes false while retained `registered: true` is still submitted: the value can be reapplied through a hidden field. Draft recovery has the same need to expose preserved registration input.

Recommendation: Show the latest registration state as part of the recovery comparison. Keep a retained or recovered registration choice visible and editable whenever it differs or is relevant to the pending save. Do not silently merge or save it; preserve explicit reapplication and version assertions.

Acceptance: With positive progress, change only registration in another editor, trigger a conflict, reload, and compare both latest and retained states. Repeat in both registration directions for an activity without mandatory registration, and with a recovered draft. The user must be able to inspect and change every value that Save will submit.

Integration reread: The current source explicitly includes the latest registration state in `latestSummary`, keeps a relevant preserved registration choice visible, and exposes a recovered registered draft. Versioned saving and explicit reapplication remain in place. The reviewer confirmed this source correction during the round; its new regressions still require remote execution.

### R5-04 — P2: Detect concurrent first-time receipt creation before converting it to a correction

Evidence at discovery: `miniprogram/pages/receipt/index.ts:193-197` sends an undefined `expectedVersion` when its form read found no participation. If two forms read that state for the same account, activity, period, and card scope, the first save creates the record. On the second save, `domain/service.ts:86-94` returns that now-existing participation, `checkVersion()` at lines 124-125 skips the assertion for an undefined version, and `reward.confirm` at lines 358-369 writes a correction to the existing amount and date. The second form never enters the existing conflict/reload/reapply UI and still gives the first-record success message.

Impact: A user saving a stale first-time form can silently replace another editor's newly recorded receipt amount or date. Existing-record conflict protection does not cover this initial-creation case.

Recommendation: Carry a verifiable first-read baseline or absence condition and enforce it inside the transaction. A concurrent existing record should enter the existing conflict flow, retaining the user's input and requiring an explicit decision after reading the precise current account/activity/period/card scope. A pre-save client read alone does not close the race.

Acceptance: Open two first-time forms for the same user scope and, separately, the same card scope. Save different amounts and dates from both. The later stale save must not silently correct the first one; it should retain its input and show the latest record before explicit reapplication. Verify different-card independence, transaction rollback, actual-date attribution, ownership, rule snapshots, and retry idempotency without weakening any existing assertion.

### R5-05 — P2: Coordinate dirty-sheet dismissal with prototype navigation

Evidence: The remote acceptance reviewer reproduced this through actual browser controls on the incoming prototype hash. Open the completed quarterly activity, open its expected-date sheet, change the date from `2026-10-05` to `2026-10-06`, use the native-style Back button, and confirm the first leave dialog. The current route is already `pages/todo/index`, but a second discard-date dialog appears. Choosing its continue-editing action dismisses the dialog while leaving the user on Todo; it cannot return to the abandoned editor. The round reviewer inspected `.qa-native/prototype/final/r5-expected-double-confirm.png` and `r5-expected-continue-on-wrong-page.png`.

Source mechanism: `prototype/runtime.js`, in `goBack()`, first completes `mayLeave()`, then calls `hideCurrentPage()`. That function independently invokes the open sheet owner's `closeExpected()` handler. The handler asks for a second asynchronous discard decision, while `goBack()` proceeds to unload the editor without awaiting the sheet result.

Impact: A confirmation appears after navigation has already completed, and its continue-editing choice makes a promise it cannot honor. It adds a confusing second decision and undermines the draft/unsaved-change model in the interactive prototype.

Recommendation: Coordinate page leave and dirty-sheet dismissal as one navigation decision, retaining owner-controlled cancellation. Do not unload the editor before a required sheet decision settles, and do not ask again after its changes have already been deliberately discarded. Preserve the ability to cancel and continue with the same visible date input.

Acceptance: Repeat the reported back path, cancel the initial leave decision, confirm it, and exercise explicit sheet close/mask/Escape independently. Cancel must leave the editor and draft intact; confirmed navigation must reach the destination with no late dialog. Also check push/tab navigation from an open dirty sheet. This is confirmed browser-projection behavior; it is not evidence of the native WeChat lifecycle.

## Complete route checklist

Each row includes the full current controller, template, styles, configuration, every bound operation, and applicable loading, refreshing, empty, failure, success, disabled, and conditional states. A source-review conclusion is not a physical-device acceptance claim.

| Registered route | Actions and states freshly reviewed | Round 5 conclusion |
| --- | --- | --- |
| `pages/todo/index` | Three filters, deadline switch, deadline groups, next action, detail, progress, completion, receipt, skip/resume/undo, action sheet, tab shortcuts/history, retained refresh and stale locks | No new actionable finding |
| `pages/activities/index` | Bank rail and searchable sheet, held-card filter, reset, subscription, sharing, detail, initial/refresh/page errors, retained window/cursor, obsolete requests and bottom loading | No new actionable finding |
| `pages/rewards/index` | Recorded/pending tabs, month/currency selection, requested-scope label, independent counts/subtotals, confirm/correct/detail, retained same-scope refresh, hidden old-scope totals, pagination/retry | No new actionable finding |
| `pages/wallet/index` | Add/edit/name cards, independent/shared/archived accounts, expansion, payment/undo, due dates, reminder authorization/preference recovery, matching activities, retained refresh and locks | No new actionable finding |
| `pages/mine/index` | Status-specific attention hints, every menu, privacy explanation, moderator entry, explicit demo-role selection, loading/errors and response sequencing | No new actionable finding |
| `pages/detail/index` | All participation/card scopes, join/another card, progress/complete/receipt/correction/revoke, skip/resume/undo/tracking, expected-date edit/save/clear/discard, reminders, rules/source/guide/images, history and deep links | R5-02; projected dirty-sheet leave in R5-05 |
| `pages/progress/index` | Progress/registration fields, validation/focus, drafts, dirty leave, saving/read-only, version conflict, latest read, reapplication, success and safe return | R5-03 |
| `pages/receipt/index` | Cashback/discount terminology, amount/date/attribution, create/correct, field feedback/focus, drafts/leave, existing-record conflict/reapply, absent-record concurrency, scoped records, success/return | R5-04 |
| `pages/history/index` | Global/activity scope, filters, detail, retained multi-page window, failure/retry, repeated-cursor protection, audit open/loading/empty/error/retry/close, independent request generations and sheet content changes | No new actionable finding |
| `pages/card-edit/index` | All identity/card/repayment fields, conditional groups, independent/shared billing, changed shared-account context, error summary/field navigation, drafts, save/remove confirmation and locks, late responses, safe return | No new actionable finding |
| `pages/submissions/index` | New lead, lead/full routing, all statuses/reasons, session recheck and hidden private rows, retained window, page retry, account/request changes | No new actionable finding |
| `pages/submission-lead/index` | All required/alternative source fields, image limits/upload/cancel/preview/remove/retry, local drafts, conflict/latest read, complete-editor conversion, save/update, access and read-only states, return | No new actionable finding |
| `pages/submission-edit/index` | All four groups and conditional fields, issuer/network/date/reward/entrance choices, source/image reuse, upload/cancel, linked error summary, drafts/conflicts, submit/update, verification/publish/return and unsaved moderation edits | R5-01 |
| `pages/review/index` | Authorization, statuses, private-row hiding while unverified, loading/error/retry, retained pagination, disabled paging, account changes, same-instance permission loss and return | No new actionable finding |
| `pages/preferences/index` | All four switches, unavailable/loading states, dirty leave, saving lock, success/failure and return | No new actionable finding |
| `pages/web-entry/index` | Invalid/restricted/approved URLs, loading and load/error callbacks, retry, copy and safe return | No new actionable finding |

## Shared components and prototype checklist

| Area | Fresh review coverage and result |
| --- | --- |
| `components/app-sheet` | Visibility/title/content observation, guarded measurement, content growth, keyboard/viewport bounds, safe area, owner-controlled close, busy lock, native-tab ownership/restore and page lifecycle were read. No additional native finding. |
| `components/privacy-gate` | Observer lifecycle, active-page behavior, agree/reject resolution, policy success/failure, bounded content and persistent actions were read. No new native finding. |
| `components/demo-notice` | Explicit demo condition, source disclosure text and typography, production separation, and source-rendered projection were read. No new finding. |
| Global/navigation/services | Five tabs, secondary/deep-link returns, Chinese interface copy, typography and semantic colors, button/field sizing, press/disabled feedback, wrapping, fixed bars, entrance dispatch/labels, draft boundaries and API safeguards were checked. No additional independent finding. |
| Prototype generator | All routes and shared bindings, tokenizer, WXML null-safe expressions, native tag-selector mapping, preview units, embedded assets, forced demo configuration, original controller reuse and portable output were read. No new generator finding. |
| Browser runtime | Every adapter path, controls and labels, conditional rendering, within-page and page-lifetime focus/scroll, retained tab instances, keyed sheet body, disabled dismissal, privacy/policy return, platform simulations, scenarios, errors/latency, pagination/concurrent-edit fixtures and scoped storage/reset were read. R5-05 was confirmed by a focused remote UI reproduction. |
| Workbench | Route atlas, connected flow overview, scenario controls, action inventory/conditions/location, shared actions, explicit platform boundaries, responsive shell, width control and reset confirmation were read and compared with the latest overview image. No new finding. |

## Closure requirements and retained limits

Resolve the five findings, regenerate the prototype from source, and rerun relevant remote regressions plus the complete business suite, type check, and source build. The resulting artifact needs its own hash and remote evidence. The incoming passing report applies only to the candidate identified above.

At round closure, source corrections for R5-01, R5-02, and R5-03 had been reread. R5-04's transactional creation guard and R5-05's prototype leave coordination were still being integrated. Their final implementation and all new acceptance results belong to the next candidate's verification record.

Then start a fresh complete review of the corrected stable candidate. End the loop only after two consecutive complete rounds of the same final revision find no new actionable recommendation. Round 5 remains at clean count **0** even when its fixes pass.

No finding removes moderated public submissions or relaxes transaction, ownership, receipt-date, period-snapshot, version, or idempotency guarantees. No cloud deployment, real notification, experience upload, or production publication was performed. Native WeChat rendering, physical keyboard and screen-reader behavior, large system text, privacy/image integration, real cloud authorization, subscription delivery, cross-mini-program navigation, and business-domain web views remain separate integration acceptance boundaries.
