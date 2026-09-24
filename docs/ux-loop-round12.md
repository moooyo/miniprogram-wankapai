# Complete UI/UX review: round 12

## Result and review scope

Round 12 found two new actionable P2 issues. Both were confirmed with rendered controls and the real demo service on the frozen incoming round 11 artifact. The consecutive clean-review count is **0**. This is a complete findings round, not a clean round, and subsequent fixes do not change that classification.

This was a fresh review of all 16 routes across their 64 TS/WXML/WXSS/JSON files, all three components across their 12 files, every bound operation and supported state, all nine client services, global configuration/styles, the native build and package checker, the complete five-file prototype subsystem, and the relevant authoritative business boundaries. The round reviewer covered six primary/detail routes, the components, services and build; independent read-only reviewers covered seven management routes, the progress/receipt/history routes, and the full prototype. The round reviewer independently reread both finding mechanisms and inspected their remote traces and screenshots. Files affected by the final round 11 integration were read after the main task declared the product source frozen.

UI/UX Pro Max's skill, all ten quick-reference categories, its professional checklist, the interaction-design contract, and the preceding review records guided the pass. The application remains a Chinese-language, explicitly light-themed native WeChat utility. Platform guidance was applied according to the actual native capabilities. No new feature, speculative redesign preference, unsupported dark theme, or chart interaction was used to manufacture a finding.

No local test, build, validation suite, smoke test, or runtime probe was executed. Local work consisted of reading source/documents and remotely generated evidence. All executable verification and focused interaction proofs ran through `ssh test-env`. The reviewer did not modify product source.

## Candidate evidence and limits

The main task declared the consolidated round 11 product source frozen and reported successful complete remote type checking, **499/499 business/controller tests**, and the source build from `scripts/build.mjs`, including native package integrity for all **23 modules**. These checks establish the incoming source baseline, not the correctness of later round 12 changes.

The focused proofs used the newly generated frozen `.qa-native/prototype/incoming-r11/index.html` on the remote environment, with SHA-256 `237678044f91be5da9ba1e8a6500f3461b511eb74f588a68d38808f4f0c95d1e`. The consolidated `.qa-native/prototype/candidate-r11/report.json` subsequently completed at `2026-09-22T19:16:09.469Z` with the same artifact hash: **122/122 scenarios**, **160 screenshots**, **0 runtime exceptions**, and **96 handlers exercised through browser UI**. Its inventory covers all **16 routes**, **3 components**, **266 bindings**, and **188 unique handlers**. Inventory completeness is distinct from runtime branch coverage. Older candidate-r9/r7 reports are not substituted for this evidence.

The round reviewer and prototype reviewer inspected all four fresh incoming overview images: `candidate-r11/contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png`, and `workbench-overview.png`. No additional concrete layout defect was found. The finding screenshots cited below belong to the same incoming HTML hash. The corrected round 12 implementation is a later candidate and will require its own source fingerprint and artifact evidence; the incoming passing suite does not certify those later changes.

The receipt proof used a real published demo activity and real receipt controllers/domain transactions; only the browser clock and the deliberately lost response were controlled. The legacy-card proof additionally supplied a documented persisted legacy-draft shape, then used rendered recovery/save controls. Neither proof bypassed the current page guards or weakened a domain assertion. No real account, bank integration, notification, or deployment was used.

## New findings

### R12-01 — P2: Bind receipt drafts and uncertain creation recovery to the original period

Source mechanism at discovery: `miniprogram/pages/receipt/index.ts` defines a creation draft with only `amountInput` and `receivedOn`. Its `new:<activity>:<scope>` identity does not include the activity period. `load()` considers that generic creation key even when the route explicitly identifies a historical participation. Recovery can migrate the generic draft into the historical record's key and remove the original creation draft. With no participation ID, `activity.get` selects the current period, so a later-month recovery does not find an earlier first receipt whose response was lost.

The round reviewer confirmed both mechanisms against the complete Receipt controller and the authoritative activity query. `expectNew` correctly prevents an unversioned first-save form from silently correcting an existing current-period record, but it does not identify which period the draft or uncertain save originally belonged to.

**Confirmed unsaved-draft path:** A September user-scoped activity already had a receipt for CNY 10.00 dated September 20. On October 1 there was no October participation. A new Receipt form for the activity saved a local draft for CNY 99.99 dated October 1. The reviewer left that form and explicitly opened the September receipt by its participation ID. The editor offered the October creation draft, restored it into the September editor, and deleted the generic creation key after migrating it. Selecting the explicit reapply-and-save action changed the September participation and reward ledger to 99.99/October 1; there was still no October participation. This is incorrect draft-target recovery, not an assertion that the save happened without user action.

Evidence: `.qa-native/prototype/incoming-r11/r12-receipt-period-repro.json`, including before/after records, request payloads, and draft keys. The reviewer inspected `r12-receipt-period-october-new-draft.png`, `r12-receipt-period-september-offers-october-draft.png`, `r12-receipt-period-october-draft-migrated-into-september.png`, and `r12-receipt-period-september-record-overwritten.png`.

**Confirmed uncertain-save path:** On September 30 a first receipt for CNY 88.88 dated September 30 was committed and persisted, then its response was reported as a network error. On October 1, reopening the activity and restoring the draft produced `participation: null`, `minDate: 2026-10-01`, and the original September 30 date. Retry was rejected by current-period client validation before another command was sent, even though the original September participation, reward, and request result existed. The observed defect is blocked recovery of the original result; this proof did not create a duplicate October record.

Evidence: `.qa-native/prototype/incoming-r11/r12-receipt-retry-repro.json`, `r12-receipt-retry-september-committed-response-lost.png`, and `r12-receipt-retry-october-recovery-blocks-original-retry.png`. Both receipt proofs recorded zero runtime exceptions.

User impact: Recovery can attach a new-period draft to an explicitly selected old record, or describe an already-saved earlier receipt as an unsaved current-period creation. The recovery path loses the original record intent even though ownership and actual-date validation remain enforced.

Recommendation: Persist and validate the original activity period and scope with a creation draft, and only migrate it to an explicitly matching participation. Recover an uncertain original-period result through an exact owned record before offering correction or an explicit current-period action. Existing history queries can locate the original scope/period; do not treat the 24-item `detail.history` window as exhaustive. Preserve the original draft when no original record is found and explain the available recovery decision. A server-side expected-period assertion should also reject a stale first-creation form after its target period changes; it must not enable arbitrary historical creation.

The actual receipt date and activity period are deliberately independent. An October payment for a September activity can be valid. Do not fix this issue by restricting receipts to the activity end date or by deriving the activity period from `receivedOn`. Preserve the period snapshot, card/user scope, exact record ID, version checks, transaction rollback, actual-month attribution, and idempotent recovery.

Acceptance: Cover current creation drafts versus explicit older receipt editors, known and unknown original save results, current and previous periods, user/card scopes and different cards, page/process reopening, more than 24 historical records, and a first form left open across a period boundary. No wrong-period draft should be offered, consumed, or silently converted to a new intent. An original committed receipt must remain one receipt with its original record identity and actual date.

### R12-02 — P2: Distinguish legacy creation replay from a new cross-month execution

Source mechanism at discovery: Card Edit intentionally reconstructs a legacy `pendingCreation` payload without `billing.periodKey` or `billId` so that retry retains the original signature and request identity. `retryingCreation()` then bypasses the ordinary local period-rebase check. The authoritative wallet service preserves legacy compatibility by interpreting an omitted period as the current month. The request ledger safely replays a previously committed request, but if the old request never reached the service, the same retry is a first execution against the new month.

The source review confirmed that the existing API path has no separate read-only resolution step for this legacy intent. The new explicit-period payload path is safe; the issue is the combination of a recognized old draft, a pending-but-uncommitted request, and month rollover. Removing support for existing legacy records is not the recommendation.

**Confirmed uncommitted case:** The legacy September 30 draft used statement day 5, regular due day 10 in the following month, and an actual September-bill date of October 10. It preserved the September target but the original command had not committed. On October 1, the UI restored that target and promised that retry would confirm the same creation and retain the September date. Saving through the real control sent the old payload without a period, created one new card/account, and created an October bill with statement date October 5 and actual due date October 10. The ordinary October bill under those rules would be due November 10. No explicit rebase/date decision preceded the new execution.

**Committed control:** With the otherwise corresponding legacy command committed on September 30, October retry returned the original card ID. The September bill remained due October 10 and the separately generated October bill remained due November 10. This control confirms that the old request identity must be retained for genuine replay; merely issuing a different command would risk duplicate creation.

Evidence: `.qa-native/prototype/candidate-r11/r12-legacy-card-report.json`, with exact legacy draft/payload shapes, outbound commands, original and recovered identities, and ledger/audit results. The reviewer inspected `r12-legacy-card-uncommitted-october-recovered.png`, `r12-legacy-card-uncommitted-october-result.png`, and `r12-legacy-card-committed-control-october-result.png`. The proof identifies the same frozen incoming HTML hash and reports zero runtime exceptions.

User impact: A control presented as confirmation of the September creation can instead create an October bill using the September actual-date override. The displayed target and the stored target disagree.

Recommendation: Resolve a committed legacy intent with its original request identity, while preventing an uncommitted old-period intent from becoming a new execution in the current month. If the old operation did not commit, require an explicit current-period rebase and date review before a new creation. Enforce the boundary at the authoritative execution point so a client-only preflight cannot race the calendar or another writer. Preserve old committed replay and the supported same-month legacy behavior.

Acceptance: Test committed and never-committed legacy pending requests on both sides of a month/year change, unchanged retries, edited input, explicitly rebased dates, and ordinary current-format requests. The committed control must retain its old ID and original bill, and the uncommitted control must not create a current-month bill before a deliberate rebase. Retain transaction, ownership, request-fingerprint, and idempotency assertions.

## Complete native route checklist

Every row represents the fresh complete controller, template, stylesheet, configuration, all event bindings, and applicable loading/refreshing/empty/error/success/busy/read-only/permission/draft/conflict states. A source conclusion is not a real-device acceptance claim.

| Route | Full-scope actions and states reviewed | Round 12 conclusion |
| --- | --- | --- |
| `pages/todo/index` | All filters, deadline grouping/switch, next action/detail/progress/complete/receipt, More, skip/resume/undo, history/tab links, retained refresh and stale locks | No new finding |
| `pages/activities/index` | Bank rail/search/sheet, held-card filter/reset, subscription, sharing/detail, initial/refresh/page failures, retained cursor/window and obsolete reads | No new finding |
| `pages/rewards/index` | Recorded/pending, month/currency scope, accurate failed-month labels, distinct counts/subtotals, confirm/correct/detail, retained refresh, empty scopes and pagination | No independent new finding |
| `pages/wallet/index` | Add/edit/name cards, independent/shared/archived accounts, expansion, payment/undo/date actions, enabled/disabled reminder eligibility, preference recovery, stale callbacks and refresh | No new finding; R11 archived-reminder correction reread |
| `pages/mine/index` | Submission attention queries, every menu, privacy, moderator entry, explicit demo-role selection, loading/error and read ordering | No new finding |
| `pages/detail/index` | Exact participation/user/card scope, notification deep links, current-rule card choice, preparation/cancel, every sheet/context, dirty date decisions, progress/receipt/correction/revoke, tracking, guide/image identity, reminders/history/entrances | No new finding; final R11 deep-link source reread |
| `pages/progress/index` | Progress/registration, validation/focus, relevant retained fields, draft/leave, conflict/latest comparison/reapply, busy/read-only and safe return | No new finding |
| `pages/receipt/index` | Amount/date/actual-month attribution, creation/correction, exact-card query, absence/version guard, draft candidates/migration, conflict/reapply, period/lifetime and save/return | R12-01 |
| `pages/history/index` | Global/activity scopes, filters/detail, retained windows, local page retry, audit loading/error/retry/close, independent reads, progress/registration descriptions | No new finding |
| `pages/card-edit/index` | Identity locks, all card/billing inputs, error links, draft and pending creation, shared/independent targets, period rebase/date review, legacy signatures, save/remove and late responses | R12-02 |
| `pages/submissions/index` | Create, lead/full routing, statuses/reasons, current-account verification and hidden cached rows, paging/retry, changed accounts and obsolete reads | No new finding |
| `pages/submission-lead/index` | Required/alternative source inputs, image selection/cancel/limits/preview/removal, creation identity and retry, drafts/conflicts, full continuation, submit/update and ownership | No new finding |
| `pages/submission-edit/index` | All sections and conditional fields, source/image identity and lifecycle, errors and section links, pending creation/expiry recovery, validation, publish/return, completion navigation | No new finding |
| `pages/review/index` | Authorization, statuses, hidden unverified data, retained pages, visible busy/disabled states, errors/retry and changed roles/accounts | No new finding |
| `pages/preferences/index` | Four switches, ready/loading/error, dirty/save feedback, foreground warning ownership, late load/save disposal, hidden return and navigation | No new finding; R11 lifecycle correction reread |
| `pages/web-entry/index` | Invalid/restricted/approved address, source URL, loading/load/error, retry/copy and direct-entry return | No new finding |

## Shared, service, build, and prototype checklist

All three shared components were reread across all 12 files. The review covered sheet content/title/visibility measurement, stale callbacks, keyboard/viewport bounds, safe area, close/busy ownership, tab restoration and page lifecycle; privacy observer/consent/policy behavior; and explicit demo disclosure. No additional shared-component issue was identified.

All nine services were reread in full. Review included immutable request payloads, command-intent identities, retry retirement, shared API/module lifetime, observed wallet/month relationships, ledger replay, preflight-versus-dispatch errors, native image identity/validity gates, per-consent reminder identity, entrance dispatch, draft owner/entity/revision boundaries, navigation, card labels, and amount/period/benefit wording. The new-period receipt creation guard and legacy billing execution boundary are the two specific missing distinctions described above. No broad weakening of existing assertions is proposed.

The native source build and package checker were reread, including output-relative imports, API/privacy/configuration singletons, demo placement, injected components, declared route artifacts, module resolution, and registration-only checks. They remain separate from WXML rendering, lifecycle, real-device, and cloud integration acceptance.

The prototype reviewer freshly read all five source files and the native build/checker. Coverage included the complete route/component inventory, every renderer/control/binding class, null-safe expressions, conditions/loops, stable keys, native selector and viewport projection, embedded assets, source-controller reuse, explicit demo configuration, keyboard/visible-focus ownership, modal/sheet nesting, navigation parameters and lifecycle, scroll restoration, storage fallback/reset, galleries, action location, fixtures and refresh effects. The frozen runtime includes the complete R11 dirty/operation-owned refresh guards. No new independent prototype-source issue was found.

All ten UI/UX Pro Max categories were considered. Forms/feedback and navigation/state recovery produced the two findings. Accessibility, touch targets, performance, style consistency, responsive layout, typography/color, motion, and existing textual financial data presentation produced no additional evidence-backed recommendation. There are no chart interactions or implemented dark theme to certify; largest native system text remains a separate physical-device check.

## Closure and next gate

The full source pass remains a findings round despite the incoming consolidated browser suite passing its existing scenarios. The reviewer has read that report, both receipt proofs, the paired legacy-card proof, and their representative screenshots. The focused proofs identify real draft/intent transitions outside the passing suite's exact paths. The fresh global image review did not add a third finding. Later corrected source needs its own artifact and verification record.

The main task has accepted both findings and assigned their minimal corrective work. After the corrected source is frozen, reread all changed product files and supporting contracts, run the relevant remote regressions and complete type/business/build checks, and regenerate the prototype. Begin a new complete round only from that corrected stable candidate. Exit the loop after two consecutive full reviews of the same final candidate find no new actionable recommendation. Round 12 remains at clean count **0**.

Moderated public submissions remain in scope. No real notification, cloud deployment, actual account authorization, experience upload, or publication was performed. Native WeChat rendering, physical text/keyboard/screen-reader behavior, actual image/privacy integration, real cloud ownership, subscription delivery, cross-mini-program navigation, and approved embedded-web configuration remain separate acceptance boundaries.
