# Complete UI/UX review: round 4

## Result and review boundary

Round 4 found three concrete actionable issues. The consecutive clean-review count is **0**. Corrections made during this round do not make this a clean round; the next complete review must start from the corrected and verified candidate.

The review covered all 16 registered routes, all three shared components, global navigation and styling, the source-to-browser generator, the browser runtime, and the prototype workbench. It applied the UI/UX Pro Max `SKILL.md`, all ten categories of `references/quick-reference.md`, and `references/pro-rules.md`, with the interaction contract and rounds 2 and 3 as the baseline. Independent source reviewers covered the seven management routes and the prototype while the main round reviewer read the nine core routes and all shared components. Each controller, WXML file, WXSS file, bound action, and applicable state was included. The main round reviewer also reread all three finding mechanisms and their corrections.

The native platform remains WeChat. Web-only semantics and framework recommendations were not imposed as native requirements. The accepted financial utility direction, Chinese interface, moderated public submissions, explicit demo mode, and authorization and data-integrity guarantees remain unchanged.

No local executable verification was run. Source reads and inspection of remotely produced screenshots were performed locally; executable verification remained on `ssh test-env`.

## Candidate evidence used

The incoming candidate had a reported successful remote type check, 212 business/controller tests, and a production build from `scripts/build.mjs`. The remote browser report at `.qa-native/prototype/iteration-6-candidate/report.json` records 74 passed scenarios, zero failed scenarios, 80 screenshots, and zero runtime exceptions. It inventories 16 routes, three components, 260 source bindings, and 184 unique source handlers; 56 handlers were exercised through browser UI. Inventory completeness and exercised-handler coverage are different measurements.

The reviewed prototype SHA-256 in that report is `e54b83ad86741834a9116f641530ac31b631ed1a552d021e26577d6634bf3011`. The 375 px, 320 px, and 768 by 375 px landscape contact sheets were inspected, as were relevant operation screenshots. Earlier iteration-4 images were not used to certify the corrected viewport projection.

The 74-scenario suite did not cover the first two newly found edge cases. The remote acceptance reviewer reproduced both through actual browser controls during this review. A passing baseline suite therefore did not override concrete source and interaction evidence.

## New findings

### R4-01 — P2: Show the selected reward month even when its read fails

Evidence at discovery: `miniprogram/pages/rewards/index.ts` changed `month` in `changeMonth()` but updated `monthLabel` only after `load()` succeeded. The filter in `index.wxml` displays `monthLabel`. After loading September 2026, selecting August 2026, and failing the next reward query, the remote browser had `data.month` and the picker value set to `2026-08`, with `failed: true`, while the visible filter still displayed September 2026. The reproduction image is `.qa-native/prototype/iteration-6-candidate/rewards-month-failure-review.png`.

Impact: The displayed filter describes the previous month while Retry requests the new month. The user cannot reliably identify the scope of the failed request. Previously loaded totals are correctly hidden for a changed scope, but that alone does not make the filter feedback accurate.

Recommendation: Update the visible month label together with the selected month, before the asynchronous request. Preserve that label through loading and failure. Keep old-scope totals and rows hidden, and retain request-generation protection against obsolete responses.

Acceptance: From a loaded month, choose another month with a delayed read, fail the read, and retry. The visible label must match the selected and requested month throughout, without showing old-scope totals as current. A subsequent successful read must show the same selected month.

Source correction reread: `changeMonth()` now updates `month` and `monthLabel` in one `setData()` call. The existing scope and request-version guards remain intact. Fresh remote acceptance is required after integration.

### R4-02 — P2: Preserve an open prototype sheet's internal scroll on updates

Evidence at discovery: `prototype/runtime.js` manually created `.sheet-body` without `data-render-key`, while `render()` rebuilt the shadow tree on every source `setData()` and saved/restored only keyed elements' internal scroll. `miniprogram/pages/detail/index.ts` keeps the card-choice sheet open when `chooseCard()` changes the selected card. The remote reproduction added eight demo bank cards, opened the annual activity's alternate-card sheet in a short landscape viewport, scrolled down, and selected a lower card. The sheet's `scrollTop` changed from 883 to 0; the selected card was at y=1106.8 while the visible sheet body was at y=174.25 through 375. The reproduction image is `.qa-native/prototype/iteration-6-candidate/card-sheet-after-choice.png`.

Impact: Selecting a card scrolls the user away from the selection and confirmation controls. The restored focus can remain outside the visible sheet because ordinary focus restoration uses `preventScroll`. This is a browser-projection defect and must not be attributed to native WeChat rendering.

Recommendation: Assign the sheet body a stable render key that includes its page instance and sheet identity, allowing the existing internal-scroll preservation to cover it. Keep newly opened sheets independent of previously closed sheets.

Acceptance: In a short landscape viewport with a long card list, select a lower card and verify retained internal scroll, visible selected state, and visible keyboard focus. Repeat updates in other scrollable sheets, then close and reopen to confirm that unrelated sheets do not inherit each other's position.

Source correction reread: `.sheet-body` now has a key combining the owner page instance and the native sheet ID or render path. Both within-page rendering and navigation-context preservation use that key. The source mechanism is corrected; fresh remote scroll and focus checks remain required.

### R4-03 — P2: Hide retained moderation content until authorization is rechecked

Evidence at discovery: `miniprogram/pages/review/index.ts` sets `sessionVerified: false` before `ensureSession(true)`. A session-read failure retains `items`. The corresponding WXML continued rendering private titles, source summaries, and return reasons, only disabling the row buttons. Round 3 explicitly required authorization to be rechecked before exposing retained moderation content; the implementation prevented opening cached rows but did not prevent displaying them during the unverified state.

Impact: On return to a previously loaded moderation list, private submission content remains visible while the current session is unverified, including after session verification fails. This contradicts the permission boundary described by the refresh state and the preceding review requirement.

Recommendation: Retain the data and list height for recovery while hiding the row content and its accessibility tree until the current account is verified as a moderator. Provide clear verification/retry feedback. Keep account-change and forbidden-response clearing, and make pagination visibly unavailable while its controller is blocked.

Acceptance: Load multiple moderation pages, return with delayed session verification, fail that verification, retry successfully, and separately revoke permission or change account. Unverified content must be hidden, successful same-account verification must restore the retained window, and denied or changed-account results must clear it. Pagination must not appear enabled while its handler cannot act.

Source correction reread: The retained list now uses `visibility: hidden` and `aria-hidden` while `sessionVerified` is false, preserving layout height. Loading and failure copy explains that verification precedes redisplay. The controller continues to block open/load-more actions, clear changed-account rows, and clear forbidden results. The final reread confirms that pagination is also visibly disabled while the session is unverified. The same retained-content and pagination treatment was applied to the account-owned Submissions list and reread in full with its controller and styles. No additional actionable finding was identified in these corrections.

## Earlier findings rechecked

| Earlier item | Current source and evidence conclusion |
| --- | --- |
| R2-01: Entrance labels | Detail labels use the same configuration-based entrance decision as the dispatcher for approved web views, clipboard fallback, mini-programs, and guides. |
| R2-02: Dynamic native sheet height | `contentState` and title observation trigger guarded measurement; all eight sheet uses supply content dependencies. Delayed audit content and short landscape handling appear in the remote suite. |
| R2-03: Conditional error links | Full Submission validates issuer selection only with an applicable bank, removes inactive entrance-field errors, and opens the relevant section before locating an error. |
| R2-04: Wallet refresh | Loaded rows and expanded groups remain mounted, stale mutations are locked, and retry feedback is inline. Remote slow/failure refresh cases passed. |
| R2-05: Submission attention | Mine performs status-specific bounded existence queries for pending and returned submissions. |
| R2-06: Native CSS selectors | The generator maps native element selectors to adapter markers while preserving declaration values and non-type selectors. |
| R2-07: Shared actions and platform parity | The inventory includes all three components, policy reading returns to consent, and sheet dismissal observes owner and busy state. |
| R2-08: Explicit input focus | A new explicit source focus request precedes ordinary focus restoration; repeated unchanged requests do not continuously reclaim focus. |
| R2-09: Simulated viewport | Native viewport units, width/height media conditions, switch target/track separation, and demo disclosure styling follow the preview dimensions. Corrected 320 px and landscape images were inspected. |
| R3-01: Todo and Rewards refresh | Same-scope content remains visible, stale mutation actions are locked, and scope changes hide old amounts. R4-01 covers the additional failed-month-label edge case. |
| R3-02: Retained pagination windows | Activities, History, Rewards, Submissions, and Review refresh the previously loaded window, deduplicate records, retain cursors on failure, and reject obsolete requests. R4-03 covers the remaining visible moderation authorization boundary. |
| R3-03: Navigation lifetime and position | The prototype retains native tab instances and page scroll/focus context. Actual list-to-detail return and cross-tab filter/position cases passed. R4-02 covers the separate unkeyed sheet container. |
| R3-04: Switch names | Explicit accessible labels are retained; associated visible labels name otherwise unlabeled switches. Remote Full Submission switch-name checks passed. |

## Complete route checklist

Every route below includes controller, markup, styling, each bound operation, and applicable initial/loading/refreshing/empty/failure/success/disabled and conditional states. A source conclusion is not a real-device acceptance claim.

| Route | Actions and states reviewed | Round 4 result |
| --- | --- | --- |
| `pages/todo/index` | Three filters, deadline filter, grouped rail, detail, next action, progress, completion, receipt, skip/resume/undo, action sheet, history and tab shortcuts, retained refresh and stale locks | No additional actionable finding |
| `pages/activities/index` | Bank rail, search sheet, held-card filter, clear filters, subscription, sharing, detail, pagination/retry, refresh window and request isolation | No additional actionable finding |
| `pages/rewards/index` | Recorded/pending tabs, month/currency filters, independent counts and subtotals, receipt confirmation/correction, detail, empty scope, pagination, same-scope refresh and scope changes | R4-01 |
| `pages/wallet/index` | Add/edit/name cards, expand shared/independent/archived accounts, mark/undo payment, actual due dates, reminder preference and authorization, activity matching, retained refresh and locking | No additional actionable finding |
| `pages/mine/index` | Attention hints, history, submissions, sharing, preferences, privacy explanation, moderator entry, demo-role selection, load/error feedback | No additional actionable finding |
| `pages/detail/index` | User/card scope, join/card choice/another card, complete/progress/receipt/correct/revoke, skip/resume/undo/tracking, expected-date dirty/save/clear/discard, rules/source/guide/images, reminders, history and invalid deep link | No additional native finding; projected card-sheet update in R4-02 |
| `pages/progress/index` | Amount and registration fields, validation and focus, drafts and dirty leave, busy/read-only states, conflict/latest read/explicit reapply, success and safe return | No additional actionable finding |
| `pages/receipt/index` | Actual amount/date, receipt-month attribution and benefit terms, create/correct, validation/focus, drafts, conflict/latest read/reapply, skipped/future read-only, success and safe return | No additional actionable finding |
| `pages/history/index` | Global/activity scope, three filters, detail, retained window, pagination/failure/retry, audit open/loading/failure/retry/close, independent request generations | No additional actionable finding |
| `pages/card-edit/index` | Create/edit identity locks, bank/issuer/kind/network/nickname, conditional repayment and shared accounts, errors and section focus, drafts, save/remove locks and confirmation, safe return | No additional actionable finding |
| `pages/submissions/index` | New lead, lead/full routing, pending/returned/published rows and reasons, window retention, pagination/retry, request and account changes | No additional actionable finding |
| `pages/submission-lead/index` | Required fields and source alternatives, image add/remove/preview/retry/limits, drafts, conflict/latest read, conversion, submit/update, ownership, published read-only and return | No additional actionable finding |
| `pages/submission-edit/index` | Four sections, all conditional inputs, issuer/network/date/period/reward/entrance fields, images and source reuse, linked errors, drafts/conflicts, submit/update, verify/publish/return and unsaved moderation changes | No additional actionable finding |
| `pages/review/index` | Authorization, statuses, detail, initial/refresh failure, retained window, pagination/retry, account change, permission denial and return | R4-03 |
| `pages/preferences/index` | Four switches, loading/unavailable settings, dirty warning, save lock, success/failure, return | No additional actionable finding |
| `pages/web-entry/index` | Invalid/restricted/allowed addresses, navigation loading, load/error, retry, copy and safe return | No additional actionable finding |

## Shared and cross-cutting checklist

| Area | Review conclusion |
| --- | --- |
| `components/app-sheet` | Native content/title observation, stale measurement guards, keyboard/viewport bounds, safe area, owner-controlled dismissal, busy lock, tab hide/restore and lifecycle were reviewed. No additional native finding. |
| `components/privacy-gate` | Observer lifecycle, active page, consent/rejection, policy success/failure, scrollable content and persistent actions were reviewed. No additional native finding. |
| `components/demo-notice` | Demo-only condition and readable disclosure remain explicit. No additional finding. |
| Navigation and global style | Five native tabs, secondary back/deep-link fallbacks, visible labels and selected states, touch targets, wrapped long values, fixed-dock clearance, contrast hierarchy and stable press feedback were reviewed. No additional source-backed finding. |
| Generator and workbench | All registered routes/components enter the generated inventory; source controllers and demo domain logic are reused. CSS projection, conditions/loops, embedded assets, action locations, route atlas, flow map, viewport controls and disclosed simulation boundaries were reviewed. No additional finding. |
| Browser runtime | Tab lifetime, main/internal scroll, focus, form controls, explicit focus requests, keyboard sheets, policy return, nondismissible state, platform simulations, fixtures and isolated storage were reviewed. R4-02 is the new defect. |

## Closure requirements and retained limits

The final source reread confirms that all three identified mechanisms and the pagination-state tail item are corrected. No additional actionable finding was identified during that reread. Regenerate the prototype and run the relevant remote regressions plus the required full type check, business suite, and source build. New remote evidence must identify the corrected artifact; the incoming 74-scenario report does not certify later edits.

After integration and verification, perform two consecutive complete reviews of the same stable candidate with no new actionable recommendation. This findings round remains at clean count **0** regardless of its fixes.

Physical WeChat rendering, native keyboard/screen-reader behavior, large system text, privacy/image integration, real cloud authorization, subscription delivery, cross-mini-program navigation, and business-domain web views remain separate acceptance boundaries. The application is explicitly light-themed; no dark-theme implementation or acceptance is claimed. No cloud function deployment, real notification, experience upload, or production publication was performed. No transaction, ownership, receipt-date, period-snapshot, version, or idempotency assertion was weakened.
