# Product UX review 2

## Result

This independent whole-product review identified **three actionable P2 findings**. No P0 or P1 finding was identified. The Mine compact-tool issue from product review 1 is fixed on the reviewed candidate.

This is a findings round, not a clean review. The consecutive clean-review count for the current product UX refinement remains **0 of 2**. Earlier held-benefit clean rounds and the original product's historical review loop do not count toward this task. The findings below remain valid even where the affected behavior predates this refinement: the current request covers the complete UI/UX and safe action context.

| ID | Priority | Finding |
| --- | --- | --- |
| PUX2-01 | P2 | Editing an unconfirmed new submission before retry can create a second pending submission. Both lead and full-submission forms are affected. |
| PUX2-02 | P2 | Unfinished records from the same month in different years are visually indistinguishable in Todo, including its action sheet. |
| PUX2-03 | P2 | Removing cards with independent billing accounts hides their retained account identity, leaving indistinguishable archived bills that can still be changed. |

## Frozen candidate and independent evidence

| Property | Value |
| --- | --- |
| Runtime checkout | `/var/tmp/wankapai-entitlements-20260924` |
| Source manifest | 162 files |
| Source SHA-256 | `7fbf8cfd153e1ec255365ec330cdb039ee9dd8b4569f006de5ee882af8add381` |
| Prototype SHA-256 | `fdffac87de94430f7a755bd5fc247f515763b125a6f662a61d7188a602af3ff4` |
| Main independent evidence | `/var/tmp/wankapai-product-review-2/review.json` and adjacent PNG files |
| Full-submission supplemental evidence | `/var/tmp/wankapai-product-review-2/full-submission/review.json` and adjacent PNG files |
| Local visual evidence | `.qa-native/product-review-2-images/` |
| Excluded browser helper | `.qa-native/product-review-2.mjs` |

The helpers asserted the expected source and prototype digests before starting and compared the complete source snapshot and HTML again at completion. Both runs retained the same frozen digests and reported zero browser page exceptions. No product source or source acceptance script was changed by the reviewer.

The completed independent paths comprise 19 route-entry inspections and ten focused interaction/defect paths. All 19 route screenshots were visually inspected through full-size two-by-two boards. Focused captures were also inspected for the changed interfaces and each finding. Browser contexts used `zh-CN`, `Asia/Shanghai`, and reduced motion. Route-entry captures used 375 x 812; focused paths also used 320 x 720 and 768 x 375.

The final main report retains a setup timeout for the full-submission path: the helper had not yet accepted the existing leave-page confirmation during transfer from a lead. The supplemental run accepted that normal dialog and completed the full path, confirming PUX2-01. Earlier helper corrections excluded the intentionally scrolling bank rail from page-overflow assertions and used the actual projected sheet selector. These were review-fixture corrections, not product findings.

All executable work ran through `ssh test-env`. Local activity was limited to reading source, preparing excluded helpers, copying and opening images, and writing this document. The review reused the previously loaded UI/UX Pro Max guidance and independently reread current source, supported by bounded read-only reviews of navigation, management, and supported-bank compatibility.

## PUX2-01: Resolve the original submission before accepting an edited create request

### Reproduction and observed impact

For a new lead, enter a bank, title, and valid source note. Submit through the normal control. The review fixture lets the real demo service commit its submission and request record, persists the actual seed, and only then raises a transport error. The page remains unsubmitted and its title remains editable. Change that title and submit again. The submissions collection now contains two separate pending leads, and the request ledger contains two different request identifiers and fingerprints.

The main evidence records:

- Original submission: `submission_f7e14464603ba4879df4dc5ccd666185`, request `intent_01b7b1420c44f989c04f91164f174447`.
- Revised submission: `submission_cde712ce7f70c4f6276b5ea4153cf846`, request `intent_cd30b17d83efc9afbdb47c577f27dbb3`.
- Both records remain pending; the second action does not update or reconcile the first.

The full-submission path was independently reproduced through normal lead-to-full transfer, normal form controls, the same committed-response-loss fixture, a changed title, and a second save. Its pending-result notice is visible, but the form still accepts the changed creation body. The supplemental evidence contains two pending full submissions: `submission_ac3aca431d5065726dd63bdf615970f0` and `submission_1495f761c1111930f50c856da9d9c256`. Their separate requests are `intent_c661167db190f1823528d465e3e59954` and `intent_db2aebe8a1d6c6faaa1179fe52bce1e2`.

Evidence cases are `lead-unknown-result-changed-input` and `full-submission-unknown-result-changed-input`. Screenshots include `lead-result-unknown.png`, `full-result-unknown.png`, and `full-result-second-submit.png`. The last screenshot displays both full submissions in the real submissions list.

### Source and correction

`miniprogram/pages/submission-lead/index.ts` releases its saving state after an unknown result without freezing the submitted payload. `miniprogram/pages/submission-edit/index.ts` allows further editing and replaces `pendingCreation` with the newly validated draft. In `miniprogram/services/api.ts`, the request identifier includes the payload, so retaining only the same intent key does not make changed content the same request. The domain correctly treats each request without a submission ID as a new record.

Keep the original payload and intent stable until its result is confirmed. A pending creation should only replay that original request; subsequent editing should target the recovered submission ID after the first result is known. Preserve a user's already-edited local copy during recovery of older pending drafts rather than silently replacing it. Do not weaken date, owner, version, fingerprint, or moderation checks to make the retry succeed.

Acceptance: for both forms, commit the real initial request and lose its response. Attempts to edit or submit a changed create body cannot generate another pending record. Recovery across reload retains the original request, confirms one submission, and preserves any separately retained unsent edits. Normal new submissions and rejected-input corrections still work.

## PUX2-02: Keep a visible period identity on historical Todo actions

The dashboard intentionally retains historical unfinished records. In `miniprogram/pages/todo/index.ts`, the row's visible date is reduced to month and day. The full deadline is supplied only as an accessible label in `index.wxml`; neither the visible row nor its More sheet identifies the complete period.

The independent fixture uses the existing `demo-prior-pending` record and its genuine saved activity snapshot, whose validity begins in the preceding year. It preserves that snapshot and owner identity, makes the previous-month record unfinished with its target reached, and adds a valid same-month unfinished record from the preceding year. The stored seed is then reloaded and read through the real `dashboard.get` service; no page data or rendered text is fabricated.

At the reviewed date, the resulting records have deadlines `2025-08-31` and `2026-08-31`, with distinct IDs and periods. Both rendered rows show the same activity, month/day, progress, reward, and direct completion action. Their complete visible `innerText` is identical. The More sheet also omits the period while offering completion and skip actions. The user can therefore change the wrong historical period without being able to distinguish the target from these surfaces.

Evidence: case `todo-cross-year-identity`, the two `todo-period-*.png` captures, and `todo-cross-year-more.png`. The JSON retains both stored fixtures and the resulting real task rows.

Add a concise visible full period or year-bearing deadline to the row and its action-sheet context, using the saved participation's identity. Retain the current grouping and direct actions. Do not drop old unfinished records or alter the period snapshot policy.

Acceptance: two otherwise identical unfinished monthly records from different years are visibly distinguishable before direct completion and again inside More. The displayed period matches the participation ID used by the handler at narrow and standard phone widths.

## PUX2-03: Retain archived billing-account identity beside mutable bills

Reproduction uses normal business commands: create two same-bank, same-issuer credit cards named `Review Card A` and `Review Card B`, each with an independent billing account and the same current-month repayment date. Remove both cards with `card.remove`, then open Wallet and expand each retained account group.

The raw accounts retain their distinct labels and archived card associations, but `accountGroup` in `miniprogram/pages/wallet/index.ts` receives active card members only. Both groups fall back to the issuer title and the same generic archived-account subtitle; their card arrays are empty. The expanded area does not recover their account labels. The two groups have identical complete visible text while each still offers payment marking and date editing.

Evidence case `archived-wallet-identity` retains the created card IDs, archived cards, account labels, and rendered group data. Accounts `account_81fd460b8d9d1da12df15e5df809fdb1` and `account_ea8e9b9accaa44de108423d8582fa2ea` still store the A and B labels. Screenshots `wallet-archived-1.png` and `wallet-archived-2.png` show the indistinguishable groups.

Display the retained account label or corresponding archived-card identity in each archived group, including the context of its payment/date actions. Keep the issuer and archived status as supporting information. The domain already preserves the data; no ownership, grouping, payment, or reminder policy needs to change.

Acceptance: after removing two otherwise identical cards with independent accounts, their outstanding bills remain clearly distinguishable, expanded or collapsed, before payment or date changes. Shared accounts still appear once and settled archived history remains available.

## Review-1 fix and current refinement verification

PUX1-01 is independently closed. At 320px and landscape widths, each Mine tool computes to a column layout; its title lies above its description with a shared left edge. The 375px route capture confirms the same visual result. Both tools still navigate to the intended inventory and airport routes and return to Mine.

The new supported-bank path was also exercised through actual controls: open inventory details, edit a lounge, enter two bank names with duplicate and mixed separators, commit and save, then search by airport name, lowercase code, and city. The saved bank list is trimmed and deduplicated, and lookup renders the exact registered banks. Airport results contain no usage, edit, personal-quota, or balance controls. Reservation and local-bank conditions remain separately visible, and an empty search still states the registry's incomplete scope.

Independent source review confirms `supportedBanks` remains optional for old records and pending drafts. Restoration does not inject a missing array into an old pending payload; only an actual lounge commit or real save normalizes new bank input. No provider, card, or customer note becomes an inferred support claim. The legacy-demo migration requires the original seed request, owner/provider/creation-time match, and exact original lounge fields; existing properties, including empty arrays, are preserved. No new compatibility defect was found in that path.

## Complete 19-page coverage

| Page | Reviewed scope and conclusion |
| --- | --- |
| Todo | Deadline groups, current/history scope, filters, stage actions, More, stale/error guards and target identity. PUX2-02. |
| Activities | Bank rail/search, held-card filter, list and pagination states, subscription and moderated lead entry. The intentional horizontal bank rail is not page overflow. No additional finding. |
| Detail | Saved snapshot hierarchy, primary stage action, More, card selection, direct completion/receipt, expected dates, rules/guide/history and reminders. An actual More-to-receipt save preserved the target and returned to detail. No additional finding. |
| Progress | Focused fields, registration/progress, drafts, expected versions, conflicts, owner and return guards. No additional finding. |
| Receipt | Actual amount/date, saved activity period, pending creations, replay, conflicts and return behavior. No additional finding. |
| Rewards | Month/currency scope, populated accounting, pending records, refresh/pagination and compact empty state. The empty total and pending destination were exercised. No additional finding. |
| Wallet | Card and account grouping, bills, dates, payment/reminder actions, removed cards and the two secondary tools. PUX2-03. |
| Card editor | Bank/issuer identity, one-issuer annotation, multi-issuer selection, error disclosure, immutable edit fields, billing/draft/recovery guards. Both issuer presentation states were exercised. No additional finding. |
| History | Full period scope, optional explanation, filters, paging/retry, saved amounts/dates, row navigation and separate audit. Explanation expansion retained row IDs, and an audit sheet opened at 320px. No additional finding. |
| Mine | Primary management menu, compact tools, submission attention, sharing/privacy, moderation gate and explicit demo role. PUX1-01 fixed. |
| Preferences | Initial/error state, switches, dirty/saved feedback, optional help, fixed dock, lifecycle and leave behavior. A changed preference was saved from the visible 320px dock and confirmed through the API. No additional finding. |
| Submission lead | Minimum-source copy, all source fields, images, local drafts, full-form transfer, unknown result, conflicts and published read-only state. PUX2-01. |
| Submission editor | Four sections, source/entrance fields, error targeting, draft recovery, pending creation, version conflict, moderation/return and success navigation. PUX2-01. |
| Submissions | Owner-scoped list, statuses, reasons, source-kind navigation, empty/paging/error state. Both duplicate examples were visible as separate pending records. No separate finding. |
| Review | Trusted moderator boundary, status filtering, loading/retry, sources and review/edit navigation. The ordinary-user denial state was visually inspected. No additional finding. |
| Web entry | Validated URL boundary, unsupported/error recovery, copy and predictable return. No additional finding. |
| Held benefits | Adjacent counts, visible period and transfer state, details disclosure, direct usage/history, archived restoration, stale/conflict and ledger guards. The new disclosure and edit route were exercised. No additional finding. |
| Benefit editor | Quotas, fixed period, owner and version checks, transfer states, persisted/pending drafts, individual lounge rules and bank input. New bank persistence was exercised. No additional finding. |
| Airport lookup | Information-only bank and admission results, search/filter/scope, unknown/empty/stale states and practical details. No remaining personal-consumption action was found. |

Cross-page review also covered safe-area padding, scrollable sheets, reachable controls, field and state labels, source-generated routes, generalized demo messaging, private data boundaries, and the preserved moderated-public-submission scope. Existing transaction, owner, receipt-date, period-snapshot and same-payload idempotency checks remain in place; PUX2-01 concerns the form's authorization of a different creation payload while the original result is unknown.

## Verification boundary and next round

These are source-generated browser and persisted-demo observations, not WeChat Developer Tools, physical-device, native screen-reader, real-account, deployed-cloud, or current bank-eligibility certification. No real notification, publication, experience upload, or deployment was performed. The integration owner's business, build/type, feature and complete browser suites remain separately recorded checks; their passing counts do not supersede these findings.

This document freezes the current result at three P2 findings. Integrate the bounded corrections, rebuild from source, and conduct complete independent reviews on the new candidate. Two consecutive clean reviews are still required for this whole-product UX task.
