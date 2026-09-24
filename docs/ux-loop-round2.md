# Complete UI/UX review: round 2

## Result and review boundary

Round 2 found new actionable issues. The consecutive clean-review count is **0**. This round must not be counted toward the two consecutive clean rounds required by `interaction-design.md`.

The review covered all 16 registered routes, all three shared components, the source-to-browser prototype generator, and the browser adapter. It used the UI/UX Pro Max `SKILL.md`, `references/quick-reference.md`, and `references/pro-rules.md`, with emphasis on accessibility, touch interaction, recovery, forms, navigation, and responsive layout. The native stack remains WeChat; no unsupported web framework rule was treated as a native requirement.

The source base was `f06ce162ac8579e8b1cade64f1897d8000a7d6d6` with the current task's uncommitted changes on 2026-09-22. First-round fixes and prototype integration were still being completed during the audit. Finding locations were re-read before reporting. The prototype author addressed the selector, component-parity, and focus findings during this round; those changes still need acceptance and a new complete review. This is a source-review record, not a claim that a stable final revision passed browser or native-device acceptance.

No local tests, builds, validation suites, browser probes, or runtime checks were executed. Remote acceptance is owned by the main task through `ssh test-env`. Previous local acceptance results in older documentation do not establish acceptance for this revision.

## New findings

### R2-01 — P2: Web-entry action labels must match the configured behavior

Evidence: `miniprogram/pages/detail/index.ts:44` labels every web entrance as a copy operation, and `miniprogram/pages/detail/index.wxml:56` gives the rule-source action the same promise. `miniprogram/services/api.ts`, in `openEntrance`, instead navigates to Web Entry when the configured HTTPS host is allowed, and copies only for the fallback path.

Impact: With an approved embedded-web configuration, the user expects a copied address but is navigated to another screen. This affects both the principal activity entrance and the rule-source action.

Recommendation: Use an accurate general label for opening/viewing the webpage, or derive the label from the same configuration decision used by `openEntrance`. Keep the copy fallback explanation explicit.

Acceptance: Exercise an approved host and a restricted host for both entry buttons. Each displayed label and resulting feedback must describe the action actually performed.

### R2-02 — P2: Remeasure sheets after asynchronous content changes

Evidence: `miniprogram/components/app-sheet/index.ts:94` sets `bodyHeight` to the content height measured at opening, bounded by the viewport. Its triggers are visibility, page visibility, window resize, and keyboard resize. `miniprogram/components/app-sheet/index.wxml:5` uses that value as a fixed height. `miniprogram/pages/history/index.ts:122` opens the audit sheet with an empty audit array, and line 133 later replaces it with loaded records without a content remeasurement.

Impact: A sheet measured while it contains a short loading message remains a small scrolling window after a long audit history arrives. The same issue affects transitions to a longer failure/retry state. The viewport can have substantial unused space while only a fragment of one record is readable.

Recommendation: Add a supported content-revision/refresh hook or a layout that grows with its slot content up to the viewport limit. Preserve safe-area, keyboard, and native-tab ownership behavior.

Acceptance: Open a delayed audit with multiple entries, fail and retry the audit, and transition between short and long content. The sheet should expand within its viewport limit without hiding the close control or losing access to content.

### R2-03 — P2: Keep error-summary links aligned with visible conditional fields

Evidence: `miniprogram/pages/submission-edit/index.ts:365` emits an issuer error even when no bank has been selected; `index.wxml:23` hides the issuer control until issuer options exist. `select()` around lines 221-239 clears only the changed field's error when the entrance kind changes. `syncErrorSummary()` and `goToError()` around lines 328-342 consequently retain a URL/AppID error whose target is no longer rendered by `index.wxml:53-54`.

Impact: A visible error-summary action can do nothing because its field does not exist. Changing a form mode also leaves an obsolete error in the summary, making a corrected form still look invalid.

Recommendation: Gate dependent issuer validation on a valid bank, or route its error to the prerequisite bank field. Clear inactive entrance-field errors when changing entrance kind while retaining unrelated errors. All summary destinations must be rendered when selected.

Acceptance: Submit without a bank; select each summary entry; then generate a web-entry error and change to a guide, and generate a mini-program error and change to a web entrance. Only applicable errors should remain, and every link must reach its field.

### R2-04 — P2: Keep loaded wallet content mounted during refresh

Evidence: `miniprogram/pages/wallet/index.wxml:3-5` replaces the entire account/bill tree whenever `loading` or `failed` is set. `index.ts:82` and the following due-date flow reload the whole wallet after successful payment-state and date changes.

Impact: Updating a bill lower in a long wallet removes the surrounding content during refresh, collapsing the scroll range and losing the user's position. A refresh failure also hides previously loaded cards and bills that would still provide useful context.

Recommendation: Separate initial loading from refreshing. Retain loaded rows and expanded groups, show an inline refresh/retry state, and prevent mutations against stale bill data until reconciliation succeeds.

Acceptance: Update and undo payment on a lower historical bill, edit its due date, and fail the follow-up refresh. The surrounding bill context should remain visible and stable, with a clear retry path and safe action locking.

### R2-05 — P2: Check submission attention states independently of the first page

Evidence: `miniprogram/pages/mine/index.ts:20-25` derives pending/returned indicators from only the latest 50 submissions. `domain/service.ts:289-290` orders and paginates the list by update time. The Mine template uses these values as existence hints rather than displaying an exact count.

Impact: An older returned submission needing correction, or an older pending submission, stops appearing in the Mine attention hint once newer updates push it past the first page.

Recommendation: Use the existing status filter with bounded `limit: 1` queries for returned and pending existence, or a reliable aggregate query. Do not present first-page counts as complete account state.

Acceptance: Provide more than 50 newer published records plus an older returned/pending record. Mine must retain the appropriate attention hint.

### R2-06 — P1: Preserve native tag selectors in the browser prototype

Evidence at discovery: `scripts/prototype-build.mjs` converted `rpx` and `page` selectors only, while `prototype/runtime.js:268` maps `view`, `text`, `image`, and other native tags to different HTML tags. Native selectors such as `.grid-mark view`, `.income-breakdown > view`, and `.entry-image-link image` therefore matched no projected elements.

Impact: The supposedly source-linked prototype silently drops layout and image rules across multiple pages. Its visual output cannot reliably guide implementation review while those selectors are missing.

Recommendation: Map native type selectors safely to the adapter's semantic markers, without rewriting declaration values, class names, or attribute strings. Include a representative set of descendant, child, grouped, and media-query selectors in remote coverage.

Status during this round: The prototype author added `mapNativeSelector()` and a rule-prelude conversion at `scripts/prototype-build.mjs:47-73`. This addresses the identified mechanism in source. The generated artifact and representative layout comparisons still need remote verification and a new review round.

### R2-07 — P2: Complete shared-component action coverage and behavior

Evidence: The prototype generator reads action inventories only from the 16 page WXML files. Native shared components have additional bindings, including the privacy policy, consent, rejection, and sheet dismissal. `prototype/runtime.js` skips `privacy-gate` nodes, and `privacyScenario()` presents a generic consent dialog without the native policy-reading action. The initial browser `renderSheet()` also ignored the native `dismissible` property.

Impact: The action inventory and prototype omit a user-visible privacy operation, while the sheet's close affordance initially appeared enabled during a native nondismissible state. A reviewer cannot inspect every operation promised by the prototype contract.

Recommendation: Include shared-component bindings in the generated coverage inventory, expose the privacy policy-reading path in the explicitly simulated privacy flow, and mirror sheet dismissal semantics for the close button, mask, and Escape key. The demo disclosure should retain the shared component's readability treatment.

Status during this round: The final source re-read confirmed that `renderSheet()` reads `dismissible` and disables its close action and button, that all three components enter the generated inventory, and that the browser privacy flow offers policy reading and return to consent. Remote checks must verify each simulated action and the nondismissible state.

### R2-08 — P2: Honor explicit field-focus requests in the browser projection

Evidence: `prototype/runtime.js:373-376` restores `focusKey` before considering `[data-request-focus]`. Native Progress and Receipt set an input's `focus` property after validation fails, but a click on Save leaves a valid old focus key for that button.

Impact: The prototype scrolls toward an invalid field but leaves keyboard focus on Save, so it does not reproduce the native form's correction flow. Keyboard review can miss a real field-focus request.

Recommendation: Detect and prioritize a new explicit focus request before ordinary focus restoration. Avoid repeatedly stealing focus when a previously requested field remains marked true during later edits.

Acceptance: Enter invalid progress and receipt amounts, submit by pointer and keyboard, and verify that focus enters the relevant field. Then tab away or edit another field and ensure normal focus is preserved until a new explicit request occurs.

Status during this round: The final source re-read confirmed that a newly requested field now takes priority over ordinary focus restoration, using a remembered request key. Remote interaction acceptance and a new full review are still required.

### R2-09 — P1: Project viewport and primitive styling against the simulated device

Evidence: The main reviewer and remote-acceptance reviewer independently identified this issue while comparing the 320 px contact sheet. The simulated device was 320 px wide inside an 840 px browser viewport. `miniprogram/pages/submission-lead/index.wxss:39` computes fixed-dock padding with `100vw`, while line 48 applies a narrow-screen media query. In the browser projection, both used the outer browser dimensions instead of the simulated device dimensions. The resulting excessive horizontal dock padding squeezed the submission action into a vertical label. The same screenshot review found that the native Todo switch's 48 px minimum target height was applied directly to the browser track, distorting it into a rounded ball, and that the projected demo notice retained a hardcoded 12 px font instead of the native component's 14 px treatment.

Impact: A nominal 320 px preview does not actually exercise the native small-screen layout, and projected native controls and disclosure text differ from their source. This can both hide real responsive defects and create false ones during prototype acceptance.

Recommendation: Resolve viewport units and width/height-dependent conditions against the simulated device, using scoped container queries or an equivalent device-aware transformation. Separate a switch's touch target wrapper from its fixed-size visual track. Reuse the demo-notice source style instead of maintaining a smaller parallel declaration.

Acceptance: Regenerate and capture the same 320 px device inside a wider browser, then compare 390 px and 430 px previews and a short/landscape device. The lead actions must remain readable and usable, responsive conditions must follow device size, switches must retain a normal track within a sufficiently large target, and the disclosure must match the native 14 px source. Keep this remote screenshot evidence distinct from real-device acceptance.

Status during this round: The main task assigned the device-viewport and primitive-fidelity corrections to the prototype author. Implementation and remote re-acceptance are in progress. This is an additional finding in round 2, not a new round; the consecutive clean-review count remains **0**.

## Complete route coverage

Every row below includes its controller, WXML, and WXSS. Reviewers checked each bound action and applicable loading, failure, empty, success, disabled, and conditional state. Items marked as having no new finding are not runtime certification.

| Registered route | Actions and states inspected | New conclusion |
| --- | --- | --- |
| `pages/todo/index` | Unfinished/completed/all filters, month deadline filter, task detail, next action, progress, completion, receipt, skip/resume, undo, action sheet, history, discovery, rewards and wallet links; deadline groups and benefit terminology | No new actionable finding |
| `pages/activities/index` | Bank rail/sheet/search, held-card filter, clear filters, subscription, submission entry, detail, initial read, background read, page loading/retry, stale response isolation | No new actionable finding |
| `pages/rewards/index` | Recorded/pending tabs, month and currency selection, independent currency counts and amounts, receipt confirmation/correction, activity detail, pagination and retry, empty month/currency, discount terminology | No new actionable finding |
| `pages/wallet/index` | Add/edit/name card, account expansion, independent/shared and archived accounts, mark/undo payment, due-date editing, reminder preference/authorization states, matching activities, mutation locking and reload | R2-04 |
| `pages/mine/index` | Submission attention hint, history, lead entry, preferences, privacy explanation, operator entry, explicit demo-role change, load/error states | R2-05 |
| `pages/detail/index` | Public/user/card scope, join and card selection, another card, progress, complete, receipt/correction/revoke, skip/resume/undo, tracking, expected date dirty/clear/save/cancel, reminders, rules, source, guide/preview, history, deep-link recovery | R2-01 |
| `pages/progress/index` | Amount and registration editing, validation/focus, local draft recovery, dirty leave, save lock, version conflict, latest-record reload, explicit reapply, read-only states, safe return | No new native finding; prototype focus covered by R2-08 |
| `pages/receipt/index` | Cashback/discount terminology, amount/date validation and month attribution, create/correct, local draft recovery, dirty leave, save lock, conflict/reapply, future/skipped read-only states, safe return | No new native finding; prototype focus covered by R2-08 |
| `pages/history/index` | Global/activity scope, all/unfinished/pending filters, detail navigation, paginated history/retry, audit loading/error/retry, overlapping list and audit requests, close behavior | R2-02 through the shared sheet |
| `pages/card-edit/index` | Create/edit/locked identity, bank/issuer/network/kind/nickname, conditional repayment controls, shared/independent account choices, error summary and field navigation, drafts, save/remove locks, removal confirmation, safe return | No new actionable finding |
| `pages/submissions/index` | New lead, lead/full edit routing, pending/returned/published rows, return reasons, initial loading/error/empty states, pagination recovery and stale responses | No new actionable finding |
| `pages/submission-lead/index` | Bank/title/source alternatives, image add/remove/preview/retry, limits, drafts, conflict recovery, convert-to-full, submit/update, access denial, published read-only, safe return | No new native finding; projected narrow-device dock covered by R2-09 |
| `pages/submission-edit/index` | Four sections, every conditional field, issuer/network choices, period/reward rules, entrance modes, image states, source copying, error summary, draft/conflict reload, submit/update, moderator verification/publish/return and unsaved-edit confirmation | R2-03 |
| `pages/review/index` | Authorization boundary, status tabs, detail opening, initial loading/error/empty, pagination recovery, stale filter/page responses | No new actionable finding |
| `pages/preferences/index` | Four switches, loading/unavailable states, dirty leave warning, save locking, success/failure recovery and back navigation | No new actionable finding |
| `pages/web-entry/index` | Invalid/restricted/approved address decisions, navigation loading, load/error callbacks, retry, copying, safe deep-link return | No new actionable finding |

## Shared components and cross-cutting coverage

| Component or integration | Inspected behavior | New conclusion |
| --- | --- | --- |
| `components/app-sheet` | Visibility, owner dismissal, disabled dismissal, native tab hide/restore/retry, multiple-sheet ownership, page lifecycle, content/viewport/keyboard measurements, scrolling, close target and modal semantics | R2-02; browser parity in R2-07 |
| `components/privacy-gate` | Privacy observer lifecycle, active-page handling, accept/reject resolution, policy opening/failure, scrollable copy, persistent actions and safe area | No new native finding; missing browser policy path in R2-07 |
| `components/demo-notice` | Explicit demo-only condition, readable disclosure, production separation | No new native finding; projection typography covered by R2-09 |
| Global styles/navigation | Action sizing, press/disabled styles, Chinese interface copy, body/supporting hierarchy, wrapping, fixed-bar padding, five native tabs, direct-entry return fallback | No additional actionable finding |
| Prototype generation/runtime | All registered route loading, WXML conditions and loops, source-controller reuse, action inventory, CSS projection, browser controls, focus/scroll restoration, sheets, platform simulations, state controls, local data namespace and reset | R2-06, R2-07, R2-08, R2-09 |

## Preserved requirements and next gate

No finding proposes removing moderated public submissions or relaxing authorization, transaction, ownership, receipt-date, period-snapshot, version, or idempotency guarantees. Demo role selection remains restricted to demo mode. No cloud deployment, real notification, experience upload, or publication was performed.

After the findings are resolved, regenerate the prototype from source, run the required remote business tests and complete type/build checks, and complete the browser acceptance paths above. Then review the entire final revision again. Exit the loop only after two consecutive complete rounds of that unchanged final revision find no new actionable recommendations. Physical-device rendering, native keyboard and screen-reader behavior, large system text, and real WeChat/cloud integrations remain distinct acceptance boundaries.
