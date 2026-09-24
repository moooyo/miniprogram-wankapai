# Product UX review 4

## Result

No new actionable recommendation was identified on the final frozen candidate. This is clean review **1 of 2** for the current whole-product UX refinement.

This result follows a complete independent review of all 19 pages, their states and actions, source and data contracts, actual browser interactions, and visual evidence. The findings in product reviews 1 through 3 retain their historical results. Earlier held-benefit clean rounds, the original product review loop, and observations made before this candidate was frozen do not count toward this clean result.

## Frozen revision and evidence

| Property | Value |
| --- | --- |
| Remote checkout | `/var/tmp/wankapai-entitlements-20260924` |
| Source manifest | 162 files |
| Reviewed source SHA-256 | `aeb1d8796089f14122adb4b75049b64ef4f449649a7dbec9ed67db1666209b98` |
| Reviewed prototype SHA-256 | `50c792ad4f01b5e58f2dffa8f8a309c2b7ca59af26afabf6135f8278ba8043df` |
| Main independent browser evidence | `/var/tmp/wankapai-product-review-4/review.json` and adjacent PNG files |
| Additional expired-deadline UI evidence | `/var/tmp/wankapai-product-review-4/deadline-ui/review.json` and adjacent PNG files |
| Independent reminder service/worker evidence | `/var/tmp/wankapai-product-review-4-reminder-final/review.json` and `verify.ts` |
| Local visual evidence | `.qa-native/product-review-4-images/` |
| Excluded browser helper | `.qa-native/product-review-4.mjs` |

The main browser run completed **36 of 36** paths with all assertions satisfied, no probe errors, and zero page exceptions. A separate expired-deadline UI path also completed successfully. Both browser runs asserted the expected source and HTML digests before execution and confirmed that the complete source snapshot and HTML were unchanged at completion. The main run occurred from `2026-09-24T08:49:37Z` to `2026-09-24T08:49:56Z`.

The source digest includes acceptance scripts. After this independent runtime review had ended, the integration owner authorized a separate coordinate/hit-test correction to a disabled-control QA probe. That later harness-only digest is not substituted for the digest above. This document does not claim that a later full-tool-source digest is identical; any application-equivalence claim must use the actual per-file comparison and unchanged product HTML.

All 19 route-entry screenshots were opened and visually inspected in full-size two-by-two boards. Focused captures were inspected for pending and recovered forms, historical period identity, archived bill identity, supported banks, picker fields, account tools, settings, and expired reminder explanations. The browser used isolated contexts, `zh-CN`, `Asia/Shanghai`, and reduced motion. Entry captures used 375 x 812; focused checks also used 320 x 720 and 768 x 375.

All executable verification ran through `ssh test-env`. Local activity only read source, prepared excluded helpers, copied/opened images, and wrote this report. No implementation source or source acceptance script was changed by this reviewer. No cloud deployment, real notification, experience upload, or publishing action occurred.

## Creation and recovery verification

The card fix from review 3 was independently verified through real persisted response loss, rather than a mocked successful command result. The fixture writes the actual service seed and request ledger before raising a transport error.

| Path | Observed result |
| --- | --- |
| Current new-card uncertainty | Nickname and other mutation fields are disabled. Direct activation of the nickname handler cannot change the draft. Reload and recovery retain the original intent and payload; retry leaves exactly one card and one creation request. |
| Legacy edited card draft | A historical local draft with a later nickname and hidden billing preferences retains those values after confirming the original creation. The form becomes an edit of the recovered card ID, bank selection remains immutable, and the next save updates that same card. |
| Legacy hidden-only changes | A legacy pending draft whose only later changes are seven-day reminder timing and same-month offset retains both values. Confirmation resolves to the original ID and preserves the local edit; it does not discard these fields merely because the serialized creation command omitted them. |
| Cross-period card confirmation | Advancing the service date into the next month makes confirmation call `card.save` with the original payload and `replayOnly: true`. One card and one original creation request remain, and the original September bill retains its September-period due date. |
| New lead uncertainty | The original lead body remains locked against UI and direct-handler edits. Automatic restoration and retry confirm one pending submission and the original request. |
| New full-submission uncertainty | The original creation body remains locked while sections can still be inspected. Reload and retry confirm one pending submission and one creation request. |

The final static review also covered malformed recovery information, owner and draft-revision checks, immutable bank/issuer identity, newer server content, separate retained input, and late-response guards. Cross-period card lookup still cannot fall back to executing an expired creation body. Receipt and entitlement creation retain their existing exact-payload and version protections; their complete creation paths were reread rather than weakened to accommodate the card correction.

## Identity, accessibility, and reminder boundaries

The earlier Todo and Wallet findings remain fixed. Actual persisted historical records for the same month in two different years display different full periods. More identifies the selected period and ISO deadline, and completing the older record changes only that participation ID. Two normally created and removed independent cards retain their distinct account labels before and after expansion; payment marking changes only the selected bill.

All ten full-submission pickers now expose their field purpose and current value. The two empty dates are independently named as start and final end dates. Wallet date controls include the human bank/account identity, bill period, and current date; Mine's selector identifies the demonstration role. The final browser inspection confirms these names. Two normally created, otherwise identical user-scoped activities from different banks also render distinct bank-prefixed history titles.

Expired reminder behavior was checked across UI and the actual configured domain/worker chain:

- An expired unpaid bill retains payment and date-edit controls while its reminder entry is replaced with an explanation. Moving the same bill's due date to today restores the entry.
- A historical unfinished participation retains progress, completion, receipt, and management actions while the expired deadline reminder entry is absent. Direct handler activation cannot open an authorization dialog.
- With valid parsed template configuration, new expired repayment and deadline authorizations return `REMINDER_UNAVAILABLE` for both accepted and declined outcomes. Each attempt leaves the entire MemoryStore seed unchanged, including grants and request receipts.
- The expired cases produce no jobs or mock sends at three subsequent dates. Future repayment, future deadline, and past-expected-date reward controls each still authorize and produce one simulated send. The reward path is intentionally not treated as an expired deadline.

The worker check uses real `MemoryStore`, `createService`, reminder configuration parsing, and `createReminderWorker`. Its sender is an in-memory callback only. It also serializes/reloads the accepted control grants and confirms that replay preserves their original identifiers. No WeChat send or real subscription request is involved.

These corrections were investigated before the final freeze, then reviewed again on the source and HTML hashes above. The earlier prototype used for preflight observations is not counted as clean evidence. One retained helper case name contains the word `prefreeze`; the final run's recorded digest, assertions, and output establish that the history-bank case was executed again on this final candidate.

## Complete 19-page coverage

| Page | Final reviewed scope and conclusion |
| --- | --- |
| Todo | Deadline groups, filters, historical/current scope, stage actions, More, refresh guards, visible period identity, and target-specific mutation. No new issue. |
| Activities | Intentional horizontal bank rail, bank search, held-card filter, discovery, loading/empty/paging/error states, subscriptions and moderated lead entry. No new issue. |
| Detail | Saved participation snapshot, phase-specific primary action, More, card selection, direct completion/receipt, expected dates, historical identity, rules, guide, history and reminder eligibility. An actual More-to-receipt save succeeds. |
| Progress | Progress and registration fields, historical context, local drafts, versions, conflict recovery, owner and return behavior. No new issue. |
| Receipt | Actual amount/date, saved period, new and existing record paths, pending payload, replay, conflicts and navigation. No new issue. |
| Rewards | Month/currency identity, compact empty total, pending destination, populated accounting, correction and refresh/pagination. Empty-to-pending navigation remains effective. |
| Wallet | Active/shared/archived account identity, bills, selected payment/date actions, retained history, service-date reminder eligibility and secondary tools. No new issue. |
| Card editor | Single/multiple issuer presentation, immutable identity, billing targets, date review, storage failure, pending creation, ordinary and legacy recovery, same-ID edits, and cross-period lookup. Review-3 correction confirmed. |
| History | Bank and period identity, amounts and dates, scope/help disclosure, filters, paging/retry, record navigation and separate audit. Actual help and audit paths remain operable. |
| Mine | Management order, compact tools, submission attention, privacy/sharing, moderator permission and explicit demo role. Tool titles remain above their descriptions at narrow and landscape widths. |
| Preferences | Loading/error, switches, dirty/saving/saved state, optional guidance, fixed Save dock and leave/lifecycle guards. A changed preference is persisted from the visible 320px dock. |
| Submission lead | Minimum-source copy, all source inputs, images, drafts, unknown creation, restore, conversion lock, conflict and published read-only behavior. No new issue. |
| Full submission | Four sections, field-specific picker names, validation, hidden source/entrance data, pending body, retained legacy input, original-ID recovery, server-version conflict and moderation paths. No new issue. |
| Submissions | Owner-scoped states, reasons, source-kind routes, empty/paging/retry behavior and submitted-record identity. No new issue. |
| Review | Trusted moderator boundary, status filtering, loading/retry, source evidence and editor navigation. Ordinary-user denial is visible and coherent. |
| Web entry | Address validation, unsupported/error state, copy, retry and predictable return. No new issue. |
| Held benefits | Adjacent remaining uses, validity and transfer state, details/management disclosure, usage/history, archival restoration, stale/conflict state and ledger guards. No new issue. |
| Benefit editor | Fixed periods, quotas and opening history, owner/version checks, persistent/pending intent, per-lounge rules and supported-bank input. No new issue. |
| Airport lookup | Information-only supported banks, airport/code/city and terminal/zone filtering, scope, unknown/empty/stale states and practical rules. No usage, edit, personal-quota or balance action has returned. |

The supported-bank path was again exercised through normal editor controls and a real save. Mixed separators and duplicate entries produce the exact deduplicated bank list shown by lookup. Search by name, lowercase code and city remains effective. Optional-field compatibility, exact old pending payloads, and conservative legacy-demo annotation were reread and remain intact; no support claim is inferred from a provider or associated card.

Cross-page review also covered shared sheets, safe-area spacing, field/state labels, source-generated navigation, generalized demo copy, and the private-data/moderated-public boundary. Transaction, ownership, receipt-date, period-snapshot and idempotency assertions remain in place.

## Verification boundary

The integration owner reported 895 passing business tests, the complete type check, source build and prototype build before this freeze. Full feature and complete browser suites are separately recorded checks; their counts are not replaced by this review's 37 focused/route paths or the independent service/worker cases.

Browser projection and persisted-demo evidence do not certify WeChat Developer Tools, physical devices, native screen readers, real account/cloud configuration, live bank admission, or notification delivery. The accepted Chinese utility interface, five tabs, manually maintained bank/lounge data, and moderated public submissions remain in scope.

This clean review is frozen for the candidate identified above. One further complete independent clean review of the final application candidate is still required.
