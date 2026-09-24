# Complete UI/UX review: round 6

## Review status

Round 6 found two new actionable prototype issues. Both were reproduced remotely through rendered browser controls after the complete source review. The consecutive clean-review counter remains **0**. This is a completed findings round, not a clean round; subsequent fixes cannot retroactively change that result.

The incoming candidate includes the five round 5 corrections. The main task declared the implementation frozen before this review. No implementation file was modified by this reviewer; only this review record is owned by this round.

## Scope and method

The reviewer freshly read every TypeScript controller, WXML template, WXSS stylesheet, and JSON configuration for all 16 registered routes, all three shared components, global styling and application navigation, the API and form-draft boundaries, the entrance dispatcher, and the new receipt creation guard. The complete prototype generator, browser runtime, HTML workbench, stylesheet, and README were read as well. A second read-only reviewer independently examined the complete prototype subsystem, and the round reviewer independently reread the source behind both reported issues.

The review applied UI/UX Pro Max `SKILL.md`, all ten categories in `references/quick-reference.md`, and the canonical checklist in `references/pro-rules.md`. The reviewer also read `docs/interaction-design.md` and the complete round 2, 3, 4, and 5 review records. This was a new complete pass through the current candidate, including bound actions and meaningful alternative states, rather than a reread of previous findings alone.

The application remains a Chinese-language, explicitly light-themed native WeChat utility. Accessibility and interaction recommendations were adapted to native platform capabilities. Browser-projection defects are recorded separately from native defects. There are no chart interactions or an implemented dark theme to certify.

No local tests, validation suites, builds, smoke tests, or runtime probes were executed. Source reads and inspection of remotely produced artifacts are local read-only work. The main task coordinates all executable verification through `ssh test-env`.

## Candidate evidence

The main task reported that the round 5 corrected candidate passed the remote complete type check, **250 business/controller tests**, and the source build from `scripts/build.mjs`. The reviewer read `.qa-native/prototype/candidate-r5/report.json`, completed at `2026-09-22T16:30:14.668Z`. It records **85 passed browser scenarios**, **0 failures**, **92 screenshots**, **0 runtime exceptions**, and **72 source handlers exercised**. The generated inventory contains **16 routes**, **3 shared components**, **262 event bindings**, and **184 unique source handlers**. Inventory completeness and exercised-handler coverage are different measurements.

The candidate artifact SHA-256 reported by the main task is `c6a44ed521248e26908ab58a32aeed6540d1bfce509079218bb863918bc0c5c1`. The reviewer inspected the candidate's `contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png`, and `workbench-overview.png`. These show coherent hierarchy, readable narrow-width actions, normal switch tracks, and the complete connected workbench. No additional concrete layout defect was found in that image set.

The local `.qa-native/prototype/final/report.json` initially still described the older 78-scenario artifact with SHA-256 `66c3f73c7a4faf0a7c5e639a175378a3a3c4e6856896ff294626a7ec7f1cd3ae`. That report predates the final round 5 corrections and is not used to certify this candidate.

The two focused reproductions below run outside the 85 passing scenarios. The passing baseline therefore does not override their observed failures. The round reviewer inspected both additional reproduction screenshots.

## New actionable findings

### R6-01 — P2: Preserve modal focus ownership during page rendering

Source evidence at discovery: `prototype/runtime.js:222`, in `invoke()`, schedules a page render immediately after invoking a handler. `showModal()` schedules `dialog()` through its Promise queue, and `dialog()` moves focus to its first action at line 112. `render()` then rebuilds the shadow DOM. When no shadow element has focus, its fallback at line 417 unconditionally focuses an existing `[data-request-focus]`, even when that request was already consumed and the platform dialog is open.

The Progress, Receipt, and Card Edit controllers intentionally retain their explicit focus flag after a validation failure. The remote reviewer entered invalid progress, saved to trigger validation, and used the page's own Return button. After the leave confirmation appeared, `document.activeElement` was `#native-page` and the shadow active element was `#progress`. Pressing Tab moved to the background registration checkbox instead of a modal action. The modal's key handler cannot trap Tab events originating from the background input. Evidence image: `.qa-native/prototype/candidate-r5/r6-modal-focus-escape.png`.

User impact: The confirmation appears visually active while keyboard interaction occurs in an obscured form. The apparent safe continue-editing or leave choice no longer owns focus, impairing keyboard and assistive-technology use of the prototype.

Recommendation: Make platform-modal focus ownership explicit and prevent background page rendering, sheet focus restoration, or retained form-focus flags from overriding it. Consume explicit focus requests once and restore a meaningful page control after cancellation. Preserve fresh field-focus requests during ordinary validation.

Acceptance after correction: Enter invalid progress, save, then use the form's Return button to open the dirty-leave confirmation. Confirm initial focus and repeated Tab/Shift+Tab remain inside the dialog, then cancel and continue editing. Repeat with receipt amount and card nickname validation, and with an open native-style sheet beneath a platform dialog. A new validation request should still reach its field when no platform modal is open.

### R6-02 — P2: Keep record parameters in the prototype URL after Back

Source evidence at discovery: `activatePage()` writes both the route and query to the browser hash at `prototype/runtime.js:506`, and `start()` reconstructs the initial page from that hash at line 749. `goBack()` instead writes only `#/${current.route}` at line 516, omitting `current.options`. The cached page continues to look valid until the browser is reloaded or its current URL is reopened.

The remote reviewer opened Detail with `id=monthly`, entered Progress through the visible control, and returned. The displayed Detail still had its cached activity, but the resulting hash contained only its route. Reloading initialized the page with `options: {}` and an empty `activityId`; the page displayed its missing-activity error. Evidence image: `.qa-native/prototype/candidate-r5/r6-back-url-reload-missing-context.png`. Activity-scoped History and other parameterized record/edit routes have the same serialization gap when they are a Back destination.

User impact: A URL copied after an ordinary return cannot restore the record the user is viewing. Refreshing an otherwise valid detail screen unexpectedly produces a missing-record state.

Recommendation: Share one route-and-options serializer between forward activation and Back, retaining all current route parameters. Keep native tab caching, page lifetime, scroll/focus restoration, and the single departure decision intact.

Acceptance after correction: Open a detail record, navigate into a child form, return through the visible Back control, then reload the browser and reopen the copied URL. Both must restore the same activity and participation. Repeat with an activity-scoped History route and another parameterized editor. Cancellation of an unsaved-leave decision must leave both the route and URL intact.

## Complete native-route checklist

Each row includes the current controller, markup, stylesheet, configuration, every bound operation, and applicable initial/loading/refreshing/empty/error/success/disabled/conditional states. A source-review result is not physical-device acceptance.

| Route | Actions and states freshly reviewed | Native-source conclusion |
| --- | --- | --- |
| `pages/todo/index` | All three filters, deadline switch and grouping, next action, detail, progress, completion, receipt, skip/resume, undo, More sheet, history and tab shortcuts, retained refresh, failed reconciliation and action locks | No new actionable finding |
| `pages/activities/index` | Bank rail, searchable bank sheet, held-card filter, clear filters, subscription, sharing, detail, initial/refresh/page failures, retained window, cursor recovery and obsolete reads | No new actionable finding |
| `pages/rewards/index` | Recorded/pending tabs, month and currency selectors, requested-scope labels, separate currency counts and amounts, receipt confirmation/correction, detail, empty scopes, retained window, same-scope refresh and page retry | No new actionable finding |
| `pages/wallet/index` | Add/edit/nickname cards, shared/independent/archived accounts, expand/collapse, mark/undo payment, actual due dates, reminder preference and authorization recovery, matching activities, retained refresh and stale locks | No new actionable finding |
| `pages/mine/index` | Status-specific submission attention queries, all menu entries, privacy explanation, moderator entry, explicit demo-role selector, loading/error and request sequencing | No new actionable finding |
| `pages/detail/index` | User/card participation, join/another card, progress/complete/receipt/correct/revoke, skip/resume/undo/tracking, expected-date edit/clear/save/discard, delayed refresh, stale locks, rules/source/guide/images, reminders, history and deep-link fallback | No new actionable native finding; prototype navigation in R6-02 |
| `pages/progress/index` | Progress and registration inputs, validation and field focus, relevant registration visibility, draft recovery, dirty leave, version conflict, latest-state comparison and explicit reapplication, read-only states, saving and safe return | No new actionable native finding; prototype focus in R6-01 |
| `pages/receipt/index` | Amount/date and actual-month attribution, cashback/discount terminology, new/corrected records, validation/focus, exact-card read, absence assertion, draft migration/recovery, conflict/latest state/reapplication, future/skipped states, saving and safe return | No new actionable native finding; prototype focus in R6-01 |
| `pages/history/index` | Global/activity scope, all three filters, record navigation, retained multi-page refresh, page failure/retry, repeated-cursor guard, audit loading/error/retry/close and independent request generations | No new actionable native finding; parameterized prototype return in R6-02 |
| `pages/card-edit/index` | Create/edit identity locks, bank/issuer/kind/network/nickname, repayment controls, shared/independent accounts, changed shared-account context, summary links and conditional fields, drafts, save/remove locking and confirmation, disposal and safe return | No new actionable native finding; prototype focus in R6-01 |
| `pages/submissions/index` | New lead, lead/full routing, pending/returned/published rows, return reasons, account verification and hidden retained content, retained pagination, local failure/retry and account/request changes | No new actionable finding |
| `pages/submission-lead/index` | Required fields and alternative sources, images and limits, cancel/upload/retry/preview/remove, local draft, conflict/latest read, full-editor conversion, submit/update, ownership, published read-only and return | No new actionable finding |
| `pages/submission-edit/index` | Four form groups, all conditional fields and switches, issuer/network/date/period/reward/entrance choices, source-image reuse, upload cancellation/errors, validation summary destinations, drafts/conflicts, submit/update, verify/publish/return and unsaved moderation edits | No new actionable finding |
| `pages/review/index` | Authorization, all statuses, private-row hiding during verification, loading/failure/retry, retained window, disabled pagination, account/permission changes and return | No new actionable finding |
| `pages/preferences/index` | Four settings, loading/unavailable state, dirty leave, save lock, success/failure recovery and return | No new actionable finding |
| `pages/web-entry/index` | Invalid/restricted/approved addresses, source URL, load/error callbacks, loading indication, retry/copy and deep-link return | No new actionable finding |

## Shared components and prototype checklist

| Area | Fresh review coverage and conclusion |
| --- | --- |
| `components/app-sheet` | Visibility/title/content observation, measurement revision guards, dynamic slot growth, keyboard/viewport bounds, safe area, owner-controlled dismissal, busy lock, native-tab hide/restore and lifecycle. Native page hide releases tab ownership without forcing sheet dismissal. No new native finding. |
| `components/privacy-gate` | Observer lifecycle, active-page handling, policy success/failure, agree/reject resolution, bounded scroll content and persistent actions. No new native finding. |
| `components/demo-notice` | Explicit demo condition, readable disclosure, source reuse and separation from production authorization. No new finding. |
| Global/navigation/services | Five native tabs, deep-link fallbacks, Chinese interface copy, type hierarchy, semantic color and status text, action/field targets, stable press/disabled styles, long-content wrapping, fixed-dock clearance, API errors, draft ownership/revisions and entrance labels. No additional independent finding. |
| Receipt transaction integration | `expectNew` rejects an already-existing participation inside the transaction; conflicting first-time forms retain input and read the exact card scope; existing-record version checks, date attribution and snapshots remain intact. Source correction confirmed; runtime guarantees rely on the separately reported remote suite. |
| Prototype generator | Complete route/component event inventory, quoted-expression tokenization, null-safe WXML expressions, native tag-selector mapping, preview-relative units/media, asset embedding, original controller reuse, forced demo configuration and portable output. No new finding. |
| Browser runtime | Native control/label adaptation, conditional rendering, page/sheet scroll, retained tab instances, explicit field focus, sheet dismissal, platform modal/privacy flows, simulated uploads/clipboard/entrances, fixtures, pagination/concurrent updates, failure injection, storage isolation and reset. R6-01 and R6-02 were confirmed through remote browser interaction. |
| Workbench | Complete route atlas, connected flow overview, scenarios, action list with locations/conditions, shared-component inventory, platform disclosure, responsive shell, width controls and reset confirmation. No additional independent finding. |

## Round 5 corrections reread

The Full Submission image handler normalizes native cancellation objects and preserves existing validation state on cancellation. Detail retains loaded context through reconciliation, marks failed reads stale, locks state-dependent actions, rejects delayed choices after a newer read, and preserves expected-date input while explaining changed record context. Progress exposes the latest registration state and any retained value it will submit. Receipt carries a transactional first-create condition, requests the selected card scope, and migrates the new-record draft when the participation appears. Native sheet hide releases tab ownership only, and prototype navigation uses one departure coordinator rather than asynchronously asking a second discard question after navigation.

These source corrections do not retroactively make round 5 clean and do not substitute for the new candidate's remote acceptance.

## Retained limits and next gate

Correct both findings, regenerate from source, run the relevant remote regressions and required complete checks, then start a fresh complete review. The 85-scenario incoming report cannot certify later corrections. Exit only after two consecutive complete reviews of the same unchanged final candidate produce no new actionable recommendation. This round remains at clean count **0** regardless of the fixes.

Moderated public submissions remain in scope. No transaction, ownership, receipt-date, period-snapshot, version, or idempotency assertion was weakened. No cloud function deployment, real notification, experience upload, or production publication was performed. Native WeChat rendering, physical keyboard/screen-reader behavior, largest system text, privacy/image integration, real cloud authorization, subscription delivery, cross-mini-program navigation, and configured business-domain web views remain distinct integration acceptance boundaries.
