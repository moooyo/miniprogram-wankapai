# Complete UI and UX review: round 3

## Review status

This is a completed findings round, not a clean round. The consecutive clean-review counter is **0**. All sixteen native routes and the prototype source were fully reviewed. The prototype author declared the round 3 source ready, and the reviewer reread its final generator, navigation, focus/scroll restoration, switch naming, viewport projection, and workbench changes. Native fixes are being integrated and fresh remote evidence is pending. This document must not be used to claim completion of the two-clean-round exit condition.

## Scope and method

The reviewer read the TypeScript controller, WXML, and WXSS of all sixteen routes, the three shared components, global styles and navigation, the prototype generator, workbench, and browser adapter. The review used UI UX Pro Max `SKILL.md`, the full `references/quick-reference.md`, and `references/pro-rules.md`, prioritizing accessibility, touch interaction, state preservation, feedback, responsive layout, forms, and predictable navigation. A separate read-only accessibility cross-check inspected all page WXML, global styles, shared components, and navigation; it found no additional evidence-backed native finding.

The product remains a Chinese-language native WeChat utility with moderated public submissions. Platform-neutral skill recommendations are adapted to native controls; browser behavior is not treated as proof of WeChat behavior. No local test, build, runtime probe, or validation suite was run by this reviewer. Remote verification is coordinated by the main task.

The reviewer read `docs/interaction-design.md`, `docs/ux-loop-round2.md`, `docs/ux-loop-core.md`, and `docs/ux-loop-management.md` before reviewing. Round 2 corrections were inspected directly in source: entrance labels use the shared dispatcher decision; sheet content revisions trigger measurement; submission error links follow visible fields; Wallet retains loaded rows during refresh; Mine uses status-specific existence queries. Round 2 prototype selector, shared-component, explicit-focus, and viewport corrections are checked as part of the final prototype reread rather than assumed from documentation.

## New actionable findings

### R3-01 — P2: Preserve loaded task and reward content during refresh

Evidence at discovery: `pages/todo/index.ts` sets `loading: true` at the start of every `load()`. `complete()`, `toggleSkip()`, and `undoComplete()` call this method after their commands. `pages/todo/index.wxml` uses a top-level loading/failure/list branch, removing the entire task rail while the refresh is pending. Rewards uses the same top-level replacement in `pages/rewards/index.wxml` and calls `load()` from `onShow()`.

Impact: A successful operation on a lower task or returning from receipt correction can collapse the scroll range while the request is pending. A failed follow-up read hides previously loaded records, making it difficult to confirm what changed or retry in context. Wallet's round 2 correction did not cover these two screens.

Recommendation: Distinguish initial loading from refreshing; keep a loaded same-scope view mounted with inline progress or retry feedback. Retain context after failure and prevent mutations against unreconciled task data. A changed month or currency must not display data as though it belongs to the new scope.

Acceptance: Use a long task list, complete/skip/resume/undo a lower row, delay the follow-up read, and fail it. Keep surrounding records visible, offer retry, and freeze unsafe mutations until reconciliation. Return from a lower receipt correction with a delayed or failed refresh; retain the previous same-scope ledger visibly marked as stale. Change currency/month and verify that no old-scope amount is represented as current.

### R3-02 — P2: Preserve the loaded pagination extent when returning to lists

Evidence at discovery: Activities and History call `load(true)` on every `onShow()`, query only 20 or 30 rows respectively, and construct their replacement map from an empty list when resetting. Submissions and Review call `load()` on every `onShow()` and replace `items` with the first 20 rows. Rewards replaces `received` with the first 30 rows. These paths run when returning from a record, editor, or moderation screen, even if nothing changed. Submissions and Review also remove their current list while `loading` is true.

Impact: Opening a row after the first page and returning discards later loaded pages and their cursor context. Repeated correction or moderation becomes a cycle of loading the same earlier pages again. Native scroll restoration cannot preserve a position whose rows have been removed.

Recommendation: Refresh the previously loaded same-filter window, or reconcile the relevant records without discarding the retained extent. Capture query scope before asynchronous work, reject obsolete responses, and keep the prior window and cursor on failed reconciliation. Clear deliberately when filters change. Recheck moderator authorization before exposing a retained moderation list.

Acceptance: For Activities, History, Rewards, Submissions, and Review, load at least two pages, open a later row, and return both without changes and after a change. Preserve the loaded extent and appropriate position; reconcile removed/reordered rows safely. Delay and fail the return refresh, then retry. Change filters during an outstanding refresh and verify no mixed rows, duplicate IDs, stale cursor, or permission leakage.

### R3-03 — P2: Match native navigation lifetime and restore preview context

Evidence at discovery: the prototype `navigate(..., 'tab')` unloads every page and creates a fresh tab page. `goBack()` explicitly assigns `pageHost.scrollTop = 0`, and departure does not save the page's scroll context. These are separate from the adapter's within-page rerender preservation. The prototype author independently confirmed the tab-page lifetime mismatch during this round.

Impact: Tab filters and loaded data disappear when switching tabs, and detail-to-list return always starts at the top. These behaviors differ from retained native tab instances and normal native back restoration. The prototype cannot validate the list-context corrections while its own navigation discards that context.

Recommendation: Cache the five tab page instances with appropriate show/hide lifecycles; unload only pages native navigation would unload. Preserve per-page primary and internal scroll context across push/back, and restore a useful keyboard focus target after returning. Dismiss transient sheets through their owner lifecycle without bypassing unsaved-change rules.

Acceptance: Set a tab filter, load additional rows, scroll, switch to another tab, and return. Open a lower list row and return with the visible back control. Verify the same tab instance, filter, loaded extent, primary/internal scroll state, and meaningful focus; verify that removed pages cannot update the current view.

### R3-04 — P2: Preserve visible switch labels in the browser projection

Evidence at discovery: `prototype/runtime.js` assigns every rendered switch input `aria-label` from the native attribute or the literal fallback `"\u5f00\u5173"`. Full Submission supplies meaningful visible names through surrounding labels for registration, invitation, and source verification, but does not set explicit `aria-label` on those switches.

Impact: The browser adapter overrides the associated label with the same generic accessible name for three different controls. Keyboard or screen-reader inspection cannot distinguish their purpose even though the native source supplies the necessary context.

Recommendation: Retain explicit native accessible labels; otherwise allow a valid associated visible label to provide the name, or derive the name from that label. Use a generic fallback only where there is genuinely no available contextual name.

Acceptance: Inspect the accessible names of registration, invitation, and source-verification switches in Full Submission and the four preference switches. Each must describe its setting, remain keyboard operable, and retain checked/disabled state.

## Fix status at round closure

- R3-01 and R3-02 were accepted by the main task. Their native implementation and remote regression checks remain part of the integration gate, followed by a new full review.
- R3-03 source now caches tab instances, stores primary/internal scroll and focus per page, restores them after navigation, and unloads non-tab pages appropriately. The final source reread confirms the identified mechanism is corrected; remote interaction acceptance remains required.
- R3-04 source now preserves explicit accessible labels and uses associated visible labels instead of overriding them with a generic fallback. The final source reread confirms the correction; remote accessible-name checks remain required.
- The final prototype source also retains round 2 native-selector mapping, shared-component action inventory, policy reading and return, nondismissible sheet handling, new explicit-focus precedence, preview-scaled viewport units, and preview-relative media conditions. No further evidence-backed actionable recommendation was found during this reread. This does not make the findings round clean or establish runtime acceptance.

## Complete route checklist

Each route below was reviewed across its controller, markup, and styles. The review covered every bound action and applicable initial, refreshing, loading-more, empty, error, disabled, success, and conditional state; a source conclusion is not runtime certification.

| Route | Actions and states inspected | Round 3 conclusion |
| --- | --- | --- |
| `pages/todo/index` | Three filters, deadline filter, grouped rail, detail, next action, progress, completion, receipt, skip/resume, undo, action sheet, history, activity/reward/wallet navigation, current-period and discount terminology | R3-01 |
| `pages/activities/index` | Bank rail, searchable bank sheet, held-card filter, clear filters, subscription busy state, lead entry, activity detail, initial/refresh/page failure, stale requests, return navigation | R3-02 |
| `pages/rewards/index` | Recorded/pending tabs, month and currency, independent counts and subtotals, receipt confirmation/correction, detail, pagination/retry, empty selections, return navigation | R3-01 and R3-02 |
| `pages/wallet/index` | Card add/edit/naming, account expansion, shared/independent and archived accounts, mark/undo payment, due dates, reminder authorization/preference recovery, activity matching, retained refresh and stale locks | No additional actionable finding; R2-04 source correction confirmed |
| `pages/mine/index` | Submission attention, history, sharing, preferences, privacy, operator entry, explicit demo role, loading/error, role switch | No additional actionable finding; status-specific existence queries confirmed |
| `pages/detail/index` | Scope, participation and card choice, another card, completion/progress/receipt, correction/revoke, skip/resume/undo, tracking, expected-date save/clear/discard/locks, rules/source/guide, image retry, reminders, history, invalid deep link | No additional actionable native finding; dispatcher-aligned entrance labels confirmed |
| `pages/progress/index` | Progress/registration input, validation and focus, draft recovery, dirty leave, busy/read-only state, version conflict, latest read, explicit reapply, save/return and deep-link fallback | No additional actionable finding |
| `pages/receipt/index` | Benefit terminology, actual amount/date and month attribution, create/correct, validation/focus, draft recovery, dirty leave, conflict/reapply, skipped/future read-only state, save/return | No additional actionable finding |
| `pages/history/index` | Activity/global scope, all/unfinished/pending filters, detail, paginated loading/retry, request isolation, audit open/loading/error/retry/close, asynchronous sheet content, return navigation | R3-02; R2 sheet refresh binding confirmed |
| `pages/card-edit/index` | Create/edit/identity locks, bank/issuer/kind/network/nickname, conditional repayment, shared/independent choices, error summary and expansion, drafts, save/remove locks, confirmation, safe return | No additional actionable finding |
| `pages/submissions/index` | New lead, lead/full routing, pending/returned/published rows, reasons, loading/error/empty, local page retry, obsolete page requests, return navigation | R3-02 |
| `pages/submission-lead/index` | Bank/title/source alternatives, image limits/add/remove/preview/retry, draft persistence/recovery, conflict/latest read, conversion to full rules, submit/update, access denial, published read-only, return | No additional actionable finding |
| `pages/submission-edit/index` | Four sections, every field and conditional entrance, issuer/network choices, dates/reward/period, image/source reuse, linked errors, draft/conflict/latest read, submit/update, verify/publish/return, unsaved rule-change confirmation | No additional actionable native finding; R2 hidden-field error correction confirmed; browser switch names in R3-04 |
| `pages/review/index` | Authorization, status tabs, detail, initial/loading/error/empty, pagination/retry, request generations, return from moderation | R3-02 |
| `pages/preferences/index` | Four switches, unavailable/loading, dirty warning, save lock, success and failure feedback, native back | No additional actionable finding |
| `pages/web-entry/index` | Invalid/restricted/allowed address decisions, load/error, retry, copy, navigation loading, safe return | No additional actionable finding |

## Shared and cross-cutting checklist

| Area | Inspected behavior | Round 3 conclusion |
| --- | --- | --- |
| `components/app-sheet` | Content revision and title observation, owner-controlled dismissal, busy dismissal lock, native tab ownership/restoration, lifecycle, viewport/keyboard measurement, stale measurement guard, safe area, close target and bounded scrolling | No additional actionable native finding; dynamic source binding present in all eight uses |
| `components/privacy-gate` | Observer subscription, active-page handling, policy reading/failure, accept/reject, scrollable content and persistent actions | No additional actionable native finding |
| `components/demo-notice` | Explicit demo condition, readable disclosure, production separation | No additional actionable finding |
| Global styles and navigation | Chinese interface text, typography/supporting hierarchy, wrapping, fixed-bar padding, touch targets, press/disabled feedback, five native tabs, deep-link fallbacks | No additional actionable native finding |
| Prototype generator | Registered routes, complete page/component bindings, WXML expressions/conditions/loops, source-controller reuse, native type-selector mapping, responsive unit/media projection, embedded assets, demo-only runtime configuration | Final source reread completed; fresh generated artifact and screenshots pending |
| Prototype browser runtime | Controls, keyboard focus, form requests, sheet dismissal, platform/privacy simulations, action inventory, error/latency fixtures, pagination/concurrency fixtures, scoped local storage/reset, navigation and return | R3-03 and R3-04; final corrected source reread completed |
| Prototype workbench | Route atlas, linked flow map, scenarios, action locations and conditions, viewport controls, disclosure of platform boundaries, responsive panels | Final source reread completed; fresh visual acceptance pending |

## Validation and retained limits

The main task reported that the preceding round 2 revision passed remote type checking, production build, and 181 business/controller tests. That result does not certify the new round 3 changes. Remote regeneration and verification must run after integration. The old `iteration-4` screenshots are baseline evidence only: their preview viewport projection was known to be wrong and is not used to certify the corrected layout.

Physical-device WeChat rendering, keyboard and screen-reader behavior, large system text, image/privacy integration, real cloud authorization, subscription delivery, cross-Mini-Program navigation, and business-domain web-view configuration remain separate acceptance boundaries. No cloud deployment, real notification, experience upload, or production release is authorized or performed by this review. The accepted moderated public submission feature and transaction, ownership, receipt-date, period-snapshot, version, and idempotency guarantees remain in scope and must not be weakened.

After fixes, regenerate from source, complete the remote acceptance, then perform two consecutive complete reviews of the unchanged final revision with no new actionable recommendation before ending the loop.
