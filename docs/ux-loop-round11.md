# Complete UI/UX review: round 11

## Result and scope

Round 11 is a findings round. Five concrete source mechanisms were identified: one P1 startup defect and four P2 interaction or reminder defects. The consecutive clean-review count remains **0**. Corrections made during this round and successful regression runs do not retroactively make it clean.

The review freshly covered all 16 registered native routes across their 64 TypeScript, WXML, WXSS, and JSON files; all three shared components across their 12 files; every bound action and supported state; all client services; relevant authoritative receipt, creation, wallet, reminder, and request-ledger boundaries; global app configuration/styling; native build/package integrity; and all five prototype source files (generator, runtime, HTML, CSS, README). Independent read-only reviewers covered eight core routes, six management routes and the components, and the complete prototype. The round reviewer covered Card Edit and Detail after their round 10 product source was declared frozen, reread all services and build integration, and independently checked each finding's source chain.

UI/UX Pro Max's skill, all ten quick-reference categories, its professional checklist, `interaction-design.md`, and preceding review records guided this pass. Accessibility, touch/feedback, layout, typography, forms, navigation, state preservation, and supported data semantics were reviewed. This was not limited to old regressions. No new feature, subjective visual restyling, chart interaction, or unimplemented dark theme is counted as a finding.

No local executable verification was performed. Local activities were source/document reading and inspection of remotely generated artifacts. All executable checks and focused reproductions belong to the coordinated `ssh test-env` workflow. No real notification, cloud deployment, account authorization, experience upload, or publication occurred.

## Evidence boundaries

The before-reproduction browser artifact is `.qa-native/prototype/candidate-r9/interactive-prototype.html`, SHA-256 `174ae56519ab4b9ae6d789c1e41163498ab769a370c6ac721cb340fb564f45d9`. Its historical 109-scenario report is background evidence only. It does **not** certify round 10 corrections or the later round 11 fixes.

The main task explicitly authorized focused before proofs against unchanged affected source/HTML while the remaining round 10 Card/Detail integration finished. The browser proofs below identify that before hash. The archived-reminder proof instead identifies the actual source hashes and its mocked native/transport boundaries. These focused results are distinct from both old baseline acceptance and the forthcoming consolidated `candidate-r11` artifact.

The reviewer read the relevant JSON checkpoints and inspected the before screenshots for preference refresh, the delayed-save warning loss, month-start bootstrap, and notification entry/control. All five mechanisms have confirmed remote evidence. Final corrected source and consolidated verification are recorded separately; no stale report is called final acceptance.

## New actionable findings

### R11-01 — P2: Preserve dirty forms when using workbench refresh controls

Source mechanism at discovery: `prototype/runtime.js`, in `refreshPage()`, directly invokes the current controller's `onPullDownRefresh()` or `load()`. The workbench Refresh, slow-loading, and current-page failure controls call this path without the `depart()`/`mayLeave()` decision used by navigation. Preferences does not enable native pull-down refresh; its `load()` overwrites switches from the service and clears `dirty`. Progress, Receipt, and Card Edit also have initial-read behavior that is not an implicit permission to discard a current form.

User impact: A reviewer can change a setting, click Refresh or Slow Loading, and lose the unsaved value with no discard decision. The prototype's workbench undermines the unsaved-input behavior it is intended to demonstrate.

Remote confirmation: `.qa-native/prototype/candidate-r9/r11-preferences-before.json` records an unsaved `newActivities: true`, `dirty: true`, and an active leave warning. Both `refresh-page` and `slow-next` return the switch to false and clear `dirty` without a modal. The stale leave-warning text remains even after the unsaved value was overwritten. The failure control also reads without confirmation, but in that reproduction its failed read retains the value; it must not be described as the same overwrite. The reviewer inspected `r11-preferences-refresh-page.png` and the corresponding JSON states.

Recommendation: Coordinate workbench rereads with the captured page owner's unsaved-state decision, keeping cancellation on the same form. Do not consume an injected delay/failure after a canceled refresh. Prevent a workbench refresh from replacing a form while its native save/remove/recovery operation owns the state, and recheck that ownership after any asynchronous confirmation.

Acceptance: Cover clean and dirty Preferences, Progress, Receipt, and Card Edit; Refresh, slow loading, and injected read failure; cancel/confirm; repeated triggers; navigation during confirmation; and refresh during save/remove/reload. Keep native page behavior and ordinary list refreshes intact.

Correction reread: The prototype reviewer reread all five current files after the first correction. Captured-owner coordination, cancel-without-arming, and repeated-refresh protection were present. A same-finding tail concerning source save/remove/reload/rebase ownership was reported and then corrected. A complete reread of the updated runtime and README confirmed operation guards before refresh, after confirmation, and immediately before reload; query fixtures do not consume the wrong refresh effect, and canceled or unused injections are not carried into unrelated reads. No additional issue was found in that source correction. This is not a new clean round or executable acceptance.

### R11-02 — P2: Do not promise a repayment reminder for a disabled account

Source mechanism at discovery: Wallet renders a reminder action for every unpaid retained bill and shows success after authorization. Removing the last linked card disables its billing account. `reminder.authorize` originally checked only bill ownership for repayment, while both the reminder worker's candidate creation and its final eligibility check require `account.enabled`. An accepted grant therefore cannot make that disabled-account bill eligible.

User impact: A retained archived bill can show a successful reminder application even though the existing worker deliberately will not deliver it. The user receives inaccurate reassurance about an upcoming payment.

Remote confirmation: `.qa-native/prototype/candidate-r9/r11-archived-reminder-repro.json` uses the actual Wallet controller, WXML condition, shared API, service, card removal, MemoryStore, and worker, with mocked native consent, cloud transport, and a dummy sender. After removing the only card, the account is disabled, the unpaid bill remains, the action is available, consent is accepted, and one grant is stored. The worker creates and sends zero jobs within the valid three-day reminder window. An exact-state control changing only `account.enabled` to true creates and sends one job. This is source-controller/business-worker evidence, not a rendered native authorization screenshot or a real message.

Contract interpretation: The historical remediation document says each unpaid bill has a reminder action, and an older Wallet test expected the archived action through a mock. The interaction contract retains archived unpaid history but does not require disabled accounts to continue sending notifications. The main task chose to preserve the existing disabled-account worker semantics. Keeping a historical record is not a promise of continuing notification eligibility.

Recommendation and acceptance: Explain that a disabled account's retained bills cannot apply for WeChat reminders, prevent the stale page handler from starting authorization, and reject an ineligible repayment grant server-side before recording success. Preserve the bill and its payment/date actions. Verify enabled, shared, restored, paid, foreign, missing, and concurrently disabled accounts. Do not create a new automatic historical-notification policy or send without explicit grants.

Correction reread: The reviewer assigned to Wallet reread its four files, the service authorization guard, tests, and correction notes. Disabled/unavailable bill eligibility is explicit in the UI; stale handlers and delayed success notices are guarded; server authorization checks both bill/account ownership and eligible state before grant creation. The worker remains unchanged. The main task reported 75 related remote tests; consolidated acceptance remains separate.

### R11-03 — P1: Keep fresh demonstration startup valid on every calendar day

Source mechanism at discovery: `miniprogram/services/demo.ts` seeds card statement days as `6 + index`, while setting each due date to today plus `3 + index` days. On the first or second day of a month, those dates remain in the current month but precede the seeded statement day. The correct wallet validation rejects the card. Persistence occurs only after all seeds succeed, so initialization fails before a usable session is established, and retrying the same empty store repeats the failure.

User impact: Fresh demonstration mode and a fresh interactive prototype fail to start on the first two days of every month. The default demo experience can be blank or unable to load, affecting all pages rather than one field.

Remote confirmation: `.qa-native/prototype/candidate-r9/r11-demo-month-start-repro.json` records separate empty-storage browser contexts with deterministic China dates. On October 1 and 2, the unmodified bootstrap throws the same-month repayment-date validation error, leaves storage empty, and never reaches `Prototype.ready` or a route. October 3 is the control: startup completes, the store is persisted, and Todo loads. The reviewer inspected `r11-demo-month-start-2026-10-01.png` and `r11-demo-month-start-2026-10-03.png`; the October 2 result is separately recorded in the JSON.

Recommendation: Make the fixture's statement/repayment plan valid for its actual initialization date, preserving the intended short upcoming due dates and correct next-month offset. Keep the domain date assertion unchanged.

Acceptance and correction reread: The implementation uses a statement day no later than the current date while retaining the three/four/five-day due offsets. The read-only reviewer reread the complete demo source and date regression tests and confirmed no domain validation was weakened. The main task reported coverage of 731 calendar dates. Final integrated build/startup evidence still belongs to the new candidate.

### R11-04 — P2: Keep a departed Preferences save from clearing another page's warning

Source mechanism at discovery: Preferences had no unload/foreground or request-generation guards. After awaiting a save, it unconditionally called `wx.disableAlertBeforeUnload()`. That API acts on the active page in the prototype, while `setData()` on a departed instance does not stop the following call.

User impact: A user can save in editor A, confirm leaving while its response is pending, open editor B, and change another setting. A's late success then clears B's unsaved warning, allowing the new unsaved settings to be abandoned without the promised confirmation.

Remote confirmation: The `lateSave` section of `r11-preferences-before.json` records A as instance 2 and B as instance 4. B is dirty with a leave warning before the old response. The old result calls `disableAlertBeforeUnload` while instance 4 is current; B remains dirty but its warning becomes empty. Back then reaches Mine without a modal. The reviewer inspected `r11-preferences-late-save-clears-new-warning.png` and `r11-preferences-new-dirty-back-without-confirmation.png` together with this trace.

Recommendation and acceptance: Scope asynchronous load/save UI effects to a valid instance and current foreground owner. A hidden page should recover its own leave warning when shown again; an unloaded page must not mutate any later page's warning. Cover late success, late failure, load ordering, hidden return, and a newly opened dirty editor.

Correction reread: The management reviewer reread the complete four Preferences files, six new tests, and `ux-loop-preferences-lifecycle.md`. Disposal, foreground ownership, latest-read sequencing, and per-page warning restoration address the mechanism without changing saved preference semantics. The main task reported all six remote regressions passed; the consolidated artifact has a separate acceptance gate.

### R11-05 — P2: Open the participation-only URLs generated by record reminders

Source mechanism at discovery: The reminder worker builds deadline and reward message paths as `pages/detail/index?participationId=...`, and the message builder forwards that path unchanged. Detail's `onLoad()` only populated `activityId` from `id` or `activityId`; `load()` rejected an empty activity ID before calling the service. The service already supports an ownership-checked participation-only activity read.

User impact: A legitimate deadline or expected-reward message cannot open its participation record. The entry displays a missing-activity error even though the owned record exists. This breaks the notification-to-record interaction rather than a malformed URL supplied by a user.

Recommendation: Accept the generated participation-only link and resolve its activity from the authorized record, including previously stored message paths. Preserve both the activity-and-participation route and invalid/foreign-record failures. All later actions must use the resolved activity and exact participation.

Remote confirmation: `.qa-native/prototype/candidate-r9/r11-notification-deeplink-repro.json` records two messages generated by the real worker and captured by a dummy sender. The exact deadline and reward paths both fail on cold entry with a valid owned participation, empty `activityId`, no `detail`, and the missing-activity message. An observed subsequent controller read makes zero `activity.get` calls. Adding the correct activity ID to otherwise identical paths succeeds. The reward control opens the exact August historical snapshot instead of September's current record. The reviewer read the message paths, state/query traces, and control identities and inspected `r11-notification-deeplink-reward-broken.png` and `r11-notification-deeplink-reward-control.png`. No real message or cloud authorization was used.

Acceptance: Retest actual generated deadline and reward paths, an older participation, unavailable activity with an owned snapshot, malformed/foreign IDs, and an ordinary full-parameter entry. The corrected Detail loader must resolve the activity only from the authorized record and preserve the exact period. Correction implementation and its fresh regressions are part of the consolidated candidate gate.

Correction reread: The round reviewer read the revised loader and its new real-service controller regressions. The initial participation-only query omits the absent activity ID; a successful authorized result populates `activityId` for subsequent refresh, progress, history, and receipt navigation. Ordinary activity-only entry is unchanged. Foreign and mismatched links remain service-denied without a fallback to public rules, and the owned historical snapshot is retained. No additional source issue was identified in this correction.

## Complete route checklist

Every row includes a fresh read of the route's controller, template, stylesheet, configuration, bindings, and supported initial/loading/refreshing/empty/error/success/busy/read-only/permission/draft/conflict states. Repeated old findings are not counted again.

| Route | Current full-scope coverage | Round 11 result |
| --- | --- | --- |
| `pages/todo/index` | Filters/deadline grouping, primary/detail/progress/complete/receipt, More, skip/resume/undo, history/tab shortcuts, retained refresh and stale locks | No independent page finding; shared bootstrap R11-03 |
| `pages/activities/index` | Bank rail/search/sheet, held-card filter/reset, subscriptions, sharing/detail, retained pagination and read/error recovery | No independent page finding; shared bootstrap R11-03 |
| `pages/rewards/index` | Recorded/pending, month/currency scopes, separate totals/counts, confirm/correct/detail, retained refresh, failure and pagination | No independent page finding |
| `pages/wallet/index` | Card/group/archive states, expansion, paid/undo/date changes, reminders/preferences, matching activities, refresh locks and stale callbacks | R11-02; seed path R11-03 |
| `pages/mine/index` | Status-specific attention, every menu, privacy, moderator/demo role, load/error and request sequencing | No independent page finding |
| `pages/detail/index` | All participation/card states, scoped card choice, prepare/cancel, every sheet/context, progress/receipt/correction/revoke, tracking, expected-date editing, images, reminders/history/entry, stale responses | R11-05; round 10 sheet and build fixes reread |
| `pages/progress/index` | Progress/registration, validation/focus, drafts/leave, latest comparison and explicit conflict reapplication, busy/read-only and return | No independent native finding; prototype refresh R11-01 |
| `pages/receipt/index` | Actual amount/date/period and benefit copy, absence/version assertions, exact-card read, drafts/migration, recovery/reapply, save/return | No independent native finding; prototype refresh R11-01 |
| `pages/history/index` | Global/activity scope, filters/detail, retained pages/retry, audit states, independent requests, registration/progress descriptions | No new finding |
| `pages/card-edit/index` | All identity/card/billing fields, locked identity, error links, shared/independent targets, pending creation recovery, explicit period rebase/date confirmation, remove/save and late responses | No independent new native finding; round 10 corrections and tests reread |
| `pages/submissions/index` | Create, lead/full routing, statuses/reasons, account verification, hidden retained rows, pagination/retry and stale results | No new finding |
| `pages/submission-lead/index` | Required/source alternatives, upload/cancel/remove/retry/preview, creation identity, drafts/conflicts, full continuation, submit/update and access/return | No new finding |
| `pages/submission-edit/index` | All sections/conditional inputs, image identity/lifetime, source verification, linked errors, pending creation/expiry recovery, submit/update/publish/return and completed destination | No new finding; latest round 10 pre-ledger error handling reread |
| `pages/review/index` | Permissions/statuses, private-content verification, retained windows, disabled actions, retry and changed accounts/roles | No new finding |
| `pages/preferences/index` | Four settings, load/ready/error, dirty/saved/saving, asynchronous lifecycle, leave and return | R11-04; prototype refresh R11-01 |
| `pages/web-entry/index` | Invalid/restricted/approved URL decisions, source address, load/error/retry/copy and safe return | No new finding |

## Shared, service, prototype, and build coverage

All three components were freshly read across their 12 files. The review covered content/title/visibility measurement, stale callbacks, bounded scrolling and safe areas, dismissal ownership and busy states, native tab hide/restore, page lifecycle, privacy subscription/consent/policy behavior, and explicit demo disclosure. No additional independent shared-component issue was found.

All client service files were read in full. API inspection included immutable submitted payloads, canonical creation/consent identities, in-flight deduplication, unknown-result retry persistence, per-resource retirement of old intentions, observed wallet/month relationships, explicit bill targeting, preflight-dispatch boundaries, and native image/entrance/reminder adapters. Draft review included owner/entity isolation, recovery confirmation, revisions, pending creation metadata, and safe late cleanup. Display/benefit/identity helpers and navigation/privacy services were also read.

The native build and package checker were freshly read, including output-relative shared imports, configuration/API/privacy singleton assertions, demo placement, generated page/component dependencies, and registration-only checks. Round 10's module-resolution correction is not a new round 11 finding. The reviewer also read the explicit-bill domain tests, rollover creation/rebase tests, and sheet-context tests that support the revised Card/Detail behavior; no test was run locally and no assertion was weakened.

The independent prototype reviewer reread all five source files, every renderer/control/event path, conditions/loops/expressions, tag and viewport projection, embedded assets, source reuse, forced demo configuration, page/tab lifetime, parameters/focus/scroll, platform/sheet keyboard ownership, dirty navigation, storage fallback/reset, gallery selection, action inventory/locations, fixtures and workbench controls. The only new independent prototype mechanism was R11-01. Its changes were subsequently read again as correction evidence, not a clean round.

## Corrected round 11 checkpoint and next gate

The main task declared the consolidated round 11 product source frozen and reported successful remote complete type checking, **499/499 business/controller tests**, and the complete source build, including native package integrity for all **23 modules**. The reviewer then read `.qa-native/prototype/candidate-r11/report.json`, completed at `2026-09-22T19:16:09.469Z`, and verified its recorded identity and results:

| Corrected checkpoint evidence | Result |
| --- | --- |
| Prototype SHA-256 | `237678044f91be5da9ba1e8a6500f3461b511eb74f588a68d38808f4f0c95d1e` |
| Remote browser scenarios | 122 passed, 0 failed |
| Captured runtime exceptions | 0 |
| Screenshots | 160 |
| Source handlers exercised through UI | 96 |
| Inventory | 16 routes, 3 components, 266 bindings, 188 unique source handlers |
| Environment | Linux `test-env`, Node 20.19.2, Chromium 153.0.8010.12 |

The corrected suite includes dirty-preference refresh decisions and canceled-effect isolation, an abandoned save's warning ownership, unrelated dirty-page protection during pagination preparation, fresh startup on October 1/2/3, current and historical participation-only reminder entries, and unavailable-reminder disclosure on archived unpaid bills. It also covers the preceding round's exact creation replay across date changes, bill-period preservation, and card-preparation/guide coordination. Inventory coverage is not a claim that all 188 handlers and every possible branch were executed.

The round reviewer inspected the entire matching `contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png`, and `workbench-overview.png` in `candidate-r11`. The images show coherent hierarchy, readable narrow controls and fixed actions, explicit demo disclosure, the five-tab structure, and the connected complete workbench. No additional concrete visual-layout issue was identified in those images. Their sizes are 375 by 812, 320 by 720, and 768 by 375; the suite also checks the nested narrow device in the desktop workbench.

These results close the verification record for the corrected **round 11 checkpoint**, not the entire requested review loop or later source changes. The before-reproduction `candidate-r9` hash remains distinct. Round 12 edits already in progress are outside this sealed review; they were not mixed into its source or artifact conclusions.

After all five fixes and their focused regressions pass, perform two consecutive complete reviews of the same unchanged final candidate with no new actionable recommendation. Round 11 remains at clean count **0**. Real WeChat rendering, physical-device text/keyboard/screen-reader behavior, native image/privacy authorization, cloud ownership integration, subscription delivery, cross-mini-program navigation, and approved embedded-web configuration remain separate boundaries, not passed checks.

Moderated public submissions remain in scope. Ownership, transactions, receipt-date attribution, period snapshots, request identity, version checks, and idempotency remain required. Disabled-account notification semantics are not expanded into a new automatic delivery feature.
