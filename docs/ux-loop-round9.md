# Complete UI/UX review: round 9

## Review status

Round 9 found **two new actionable P2 issues**, both confirmed through focused remote interaction. This is a completed findings round. The consecutive clean-review count remains **0**, and later fixes do not retroactively make this round clean.

The main task declared the round 8 corrected implementation frozen before this review and reported a successful complete remote type check, **313/313 business/controller tests**, and a source build from `scripts/build.mjs`. The older candidate-r7 94-scenario report is not used as acceptance for the corrected candidate.

The reviewer read `.qa-native/prototype/candidate-r8/report.json`, completed at `2026-09-22T17:32:48.399Z`: **103 passing browser scenarios**, **0 failures**, **120 screenshots**, **0 runtime exceptions**, and **86 source handlers exercised**. The inventory contains **16 routes**, **3 shared components**, **263 source bindings**, and **185 unique source handlers**. Inventory completeness and exercised-branch coverage remain separate measurements.

The prototype SHA-256 is `1c4473af73de0165eb9122fddba6d0a587e1e0407f2b80b138fb55941f8e00f1`. The reviewer inspected its 375 px, 320 px, and 768 by 375 px landscape contact sheets and complete workbench overview. No additional concrete layout defect was identified. Both focused reproductions below used that same artifact and cover paths beyond the passing baseline suite. Their JSON and screenshots were also read and inspected.

## Scope and method

The team freshly reread all **16 routes** and their **64 TS/WXML/WXSS/JSON files**, all **three shared components** and their **12 files**, relevant API/navigation/draft/display/privacy services, global configuration/styles, transaction and idempotency integration, the complete source-to-browser generator, the complete runtime, the HTML/CSS workbench, the prototype README, and the production build integration. The round reviewer covered Detail, the services, domain boundaries, and the entire prototype subsystem. Independent read-only reviewers covered the other eight core routes and all seven management routes/components. A separate contract cross-check examined the failure/retry boundary. The round reviewer independently reread both finding mechanisms.

The UI/UX Pro Max skill, all ten categories of its quick reference, its professional checklist, the interaction-design contract, and previous review records guided this review. It was not limited to regression checks. Every bound operation and applicable initial/loading/refreshing/empty/error/success/busy/read-only/permission/draft/conflict state was considered. The review does not invent new product features or count visual preferences as defects.

The product remains a Chinese-language, explicitly light-themed native WeChat utility with moderated public submissions. Native platform constraints and browser projection behavior are kept distinct. No local test, build, validation suite, smoke test, or runtime probe was run. All executable verification belongs to the coordinated `ssh test-env` workflow; local review consists only of reading source/documents and inspecting remotely produced artifacts.

## New actionable findings

### R9-01 — P2: End a pending image preview when its guide is dismissed

Source mechanism at discovery: Detail's `previewImage()` captures the page read sequence, latest-preview sequence, foreground page, and exact gallery membership; the shared `previewAssets()` checks that callback again after its final URL read. `miniprogram/pages/detail/index.ts:212`, in `closeGuide()`, only changes `showGuide` to false. It neither invalidates the preview sequence nor makes the callback at lines 229-234 reject a closed guide.

A user can click a guide screenshot, dismiss the guide while its URL request is delayed, and begin a different task on the same Detail page. The original preview still has a valid page, sequence, and gallery, so the late response opens a gallery over the new task. This is a distinct explicit dismissal boundary from the already protected page hide/unload or a later image selection.

Remote confirmation: Through rendered controls, the reviewer opened a completed activity's guide, clicked its image while the final URL response was deferred, closed the guide, and opened the expected-date editor. Before release, `showGuide` was false and `showExpected` was true. Releasing the original response still invoked `wx.previewImage` and opened the gallery above that editor. `.qa-native/prototype/candidate-r8/r9-detail-late-preview-repro.json` records the full state and API sequence; `r9-detail-late-preview-over-expected-sheet.png` shows the interruption. No runtime exception occurred.

Recommendation and acceptance: Dismissing the guide should invalidate its pending preview, retaining ordinary valid previews and the existing foreground/gallery/ID safeguards. Repeat the close-button, mask/Escape projection paths and close/reopen with a new selected image. A dismissed request must neither open a late gallery nor surface an obsolete error over the new task. Valid previews in an open guide must still work.

### R9-02 — P2: Distinguish an old lost-response retry from a later new operation

Source mechanism at discovery: `miniprogram/services/api.ts:46-50`, in `api.command()`, retains a request ID under `action + JSON.stringify(payload)` after `NETWORK_ERROR`. A later successful command with another payload does not clear that retained fingerprint. `domain/service.ts:518-521` and lines 533-536 correctly replay the stored result for a previously committed request ID rather than running it again.

For a state toggle, the earlier payload can become a new user intention after another successful state change. Example: mark a bill paid; the server commits but its response is lost; refresh and observe the paid state; undo the payment mark successfully; then mark paid again. The final identical payload reuses the first request ID and receives a replayed success while leaving the bill unpaid. Completion/undo/completion and skip/resume/skip use the same retry pattern.

Remote confirmation: The reviewer used rendered Wallet controls and fault-injected one `NETWORK_ERROR` inside the actual API execution path, immediately after the real demo persistence write. The first paid command therefore committed and stored its request result before the client received failure. Refresh showed the paid state. Undo succeeded with a second request ID. Marking paid again returned success using the first ID; both the actual and refreshed `paidAt` stayed null, the action still read Mark Paid, and the toast reported a successful paid mark. `.qa-native/prototype/candidate-r8/r9-bill-idempotency-repro.json` records all three payloads/results and the two actual request-ledger entries. `r9-bill-idempotency-stale-success.png` shows the contradictory success feedback. This was not a pre-command failure or a throw outside `api.command()` after its retry cleanup.

Recommendation and acceptance: Distinguish the same unresolved operation's retry from subsequent new intent without removing lost-response retry idempotency or weakening the transactional request ledger. Retest the exact paid/refresh/undo/paid sequence and analogous completion and skip flows. Also retain immediate lost-response retry safety, in-flight deduplication, independent-entity isolation, failed follow-up operations, and creation retries that must not create a duplicate resource.

## Complete route checklist

Every row includes the current controller, template, stylesheet, configuration, bound actions, and supported alternative states. These are complete source-review conclusions with the named remote evidence, not physical-device acceptance.

| Route | Fresh coverage | Result at source-review closure |
| --- | --- | --- |
| `pages/todo/index` | All filters, deadline switch/grouping, next action, detail/progress/complete/receipt, More sheet, skip/resume/undo, history/tab links, retained refresh and stale locks | No independent page finding; shared retry finding R9-02 |
| `pages/activities/index` | Bank rail/search/sheet, held-card filter/reset, subscriptions, sharing/detail, initial/refresh/page errors, retained windows/cursors and obsolete responses | No additional finding |
| `pages/rewards/index` | Recorded/pending, month/currency and failed-scope labels, independent counts/totals, confirm/correct/detail, empty scopes, same-scope refresh and pagination | No additional finding |
| `pages/wallet/index` | Add/edit/naming, shared/independent/archived accounts, expand/collapse, paid/undo/date updates, reminders/preference recovery, matching activities, retained refresh and locking | Shared retry finding R9-02 |
| `pages/mine/index` | Submission attention queries, all menus, privacy, moderator entry, explicit demo role, loading/error and request sequencing | No additional finding |
| `pages/detail/index` | All user/card scopes, eligible/unavailable choices, join/another card, progress/complete/receipt/correct/revoke, skip/resume/undo/tracking, expected-date dirty/save/clear/discard, refresh/retry, rules/source/guide/images, reminders/history/deep links | R9-01; shared retry finding R9-02 |
| `pages/progress/index` | Progress/registration, validation/focus, drafts/leave, read-only/busy, latest registration comparison, version conflicts and explicit reapplication, save/return | No additional finding |
| `pages/receipt/index` | Cashback/discount copy, amount/date/actual-month attribution, create/correct, exact-card lookup and transactional absence guard, draft recovery/migration, conflict/reapply, limits and safe return | No additional finding |
| `pages/history/index` | Global/activity scope, filters/detail, retained pagination/retry, audit loading/error/retry/close, independent requests and accurate progress/registration descriptions | No additional finding |
| `pages/card-edit/index` | Identity locks, all card/repayment fields, shared/independent choices, conditional error links and focus, drafts, save/remove locks/confirmation, late responses and return | No additional finding |
| `pages/submissions/index` | Create, lead/full routing, statuses/reasons, account verification and hidden cached rows, retained window, pagination/retry and account/request changes | No additional finding |
| `pages/submission-lead/index` | Required/alternative sources, images/limits/upload/cancel/remove/retry/preview, local drafts, conflict/latest read, full-rule continuation, submit/update, access/read-only and return | No additional finding |
| `pages/submission-edit/index` | All four sections/conditional fields and switches, dates/rewards/entrances, source/entry galleries, ID-accurate preview and missing target, validation links, drafts/conflicts, submit/update/verify/publish/return, imported-lead success destination and failed-navigation recovery | No additional finding |
| `pages/review/index` | All statuses and permission boundaries, hidden unverified content, retained pages, unavailable actions, error/retry, account/role changes and return | No additional finding |
| `pages/preferences/index` | Four settings, loading/unavailable, dirty leave, save locking, success/failure and return | No additional finding |
| `pages/web-entry/index` | Invalid/restricted/approved URL branches, source address, loading/load/error, retry/copy and fallback return | No additional finding |

## Shared components, services, and prototype

| Area | Fresh review coverage and conclusion |
| --- | --- |
| `app-sheet` | Visibility/title/content observers, stale measurement guards, keyboard/viewport bounds, safe area, owner dismissal and busy lock, native-tab ownership, show/hide/unload lifecycle, template/styles. No new independent component finding. |
| `privacy-gate` | Observer subscription, active-page lifecycle, policy success/failure, consent/rejection resolution, bounded scrolling, persistent actions and semantics. No additional finding. |
| `demo-notice` | Explicit demo condition, readable disclosure, build injection, source projection and production authorization separation. No additional finding. |
| Global/navigation/draft/display services | Five tabs and direct-entry fallbacks, Chinese copy, hierarchy/color/status text, touch targets, press/disabled feedback, wrapping, fixed-bar clearance, owner/entity draft keys, revision-aware cleanup, recovery decisions, card naming, currency/period and benefit text. No additional finding. |
| API/domain | Upload/preview, URL-to-ID mapping, final preview validity, entrance decisions/labels, reminder boundaries, session/error behavior, exact-card ownership, first-create assertion, version/date/snapshot guards, transactional idempotency and replay. R9-02 concerns client retry intent; authoritative service guarantees remain required. |
| Generator and build | Every registered route/component/binding, tokenizer, null-safe expressions, native selector mapping, preview-relative units/media, asset embedding, original controller reuse, forced demo configuration, shared-service bundling and component injection. No additional finding. |
| Complete browser runtime | Storage override/tombstone/reset/read fallback and persistent notice; every native adapter, keyed rendering, controls and labels, explicit focus, modal/sheet ownership, active keyboard visibility, scroll, tab/page lifetime, route serialization, single departure decision, action locators, privacy, fixtures, errors, uploads/clipboard/entrances and startup. No additional finding. |
| Workbench | Full route atlas and connected flows, scenarios, source action list and state conditions, shared operations, width controls, reset, responsive chrome and platform disclosure. Current screenshots were inspected; no new visual finding. |

## Ten-category assessment and prior corrections

Accessibility, touch interaction, performance, style selection, layout/responsiveness, typography/color, motion, forms/feedback, navigation, and data presentation were all reviewed. The two findings concern cancellation and reliable success feedback rather than new features or subjective visual changes. The current product has no chart interaction and no implemented dark theme; these are not claimed as tested features.

All four round 8 mechanisms were reread. The prototype now prioritizes failed-write overrides, preserves deletion tombstones, isolates reset uncertainty, and shows a persistent session-only warning. Complete submissions imported from a lead now skip the retained lead page on success and reach Submissions, or remain in a read-only success view with a retry action if navigation fails. The original source draft and unused images remain deliberately available for later recovery. The implementation uses a clear successful destination; it does not require a newly invented persistent completion-marker feature. Card choices now expose specific mismatch reasons and cannot proceed with an incompatible card; the service still enforces eligibility. Image previews retain clicked IDs through partial or reordered URL responses and report a missing selected image without opening a substitute.

Earlier retained-list, permission-recheck, visible registration, first-receipt conflict, draft migration, sheet measurement, modal/sheet focus, keyed scroll, deep-link, image timing/gallery separation, and audit-description corrections were included in the new complete pass. Native asynchronous image measurement, largest system text, physical keyboard and screen-reader behavior remain integration observation boundaries, not new confirmed defects or passed checks.

## Next gate and retained limits

During integration, the reviewer reread the revised Detail preview chain and the complete API module. Guide open/close now advances its preview sequence, and the final callback also requires the guide to remain the active local context. The API now groups retry intents for known records and retires older intents after a confirmed later mutation of that record. These source corrections still require their own remote evidence. The creation-intent boundary also needs an explicit regression: a creation may commit with a lost response, become visible through a query, be edited, and later be followed by a deliberately new creation with the earlier payload. Resource-less retry entries must not turn that new intent into an old success replay, while a true retry of the original creation must remain idempotent. This is a completion check on R9-02, not a separate new finding or clean round.

Correct both confirmed findings, regenerate from source, and run the relevant remote regressions plus the required complete checks before another fresh full review. The incoming 103-scenario artifact is the discovery baseline and cannot certify later corrections. This round remains at clean count **0** even after its fixes. Exit requires two consecutive complete clean reviews of the same final candidate.

Moderated public submissions remain in scope. No transaction, ownership, eligibility, receipt-date, period-snapshot, version, or idempotency guarantee may be weakened to satisfy a test. No cloud deployment, real notification, experience upload, or publication is performed. Native WeChat rendering, physical accessibility, privacy/image integration, actual cloud authorization, subscription delivery, cross-mini-program navigation, and configured business-domain web views remain distinct acceptance boundaries.
