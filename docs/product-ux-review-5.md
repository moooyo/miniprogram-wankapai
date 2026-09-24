# Product UX review 5

## Result

No new actionable recommendation was identified. This is clean review **2 of 2** for the final whole-product application and generated prototype.

This result comes from a fresh complete review of all 19 pages, their source states and actions, actual browser interactions, visual evidence, all creation-recovery entry points, and reminder eligibility. Review 4 supplied scope and method references, not this round's conclusions. Product reviews 1 through 3 retain their findings; earlier held-benefit and original-product review loops do not contribute to this clean sequence.

The two consecutive clean reviews cover identical application source and identical generated HTML. Their full source-manifest digests differ because one QA script changed between the runs, as documented below.

## Frozen candidate and application equivalence

| Property | Value |
| --- | --- |
| Remote checkout | `/var/tmp/wankapai-entitlements-20260924` |
| Current manifest size | 162 files |
| Review-5 full source SHA-256 | `a5f87df5d00601cc1fd3522cd701f2b3841f8ab4db951ae6a621501bcb9edb8a` |
| Review-4 full source SHA-256 | `aeb1d8796089f14122adb4b75049b64ef4f449649a7dbec9ed67db1666209b98` |
| Shared prototype SHA-256 | `50c792ad4f01b5e58f2dffa8f8a309c2b7ca59af26afabf6135f8278ba8043df` |
| Generated HTML size | 1,193,100 bytes |
| Build timestamp | `2026-09-24 16:46:41 +0800` |

An independent per-file comparison of `regression-freeze/source-manifest.sha256` and `regression-freeze-final/source-manifest.sha256` found exactly one changed entry: `scripts/acceptance-prototype.mjs`. The other **161 file hashes are identical**. The changed entry is the QA coordinate, scroll, and hit-test correction; it is not application implementation. The generated prototype is byte-for-byte identical across the clean reviews. This report does not claim that the two full-tool-source digests are equal.

The main review helper independently regenerated the current complete source manifest before running, asserted the expected source and HTML digests, and compared both again at completion. Both remained unchanged within this round. The creation and reminder reviewers likewise checked the frozen source and prototype before and after their runs.

## Evidence and execution boundary

| Evidence | Location |
| --- | --- |
| Main actual-UI report | `/var/tmp/wankapai-product-review-5/review.json` |
| Main source snapshots | `/var/tmp/wankapai-product-review-5/source-manifest-start.sha256` and `source-manifest-end.sha256` |
| Main screenshots and visual boards | `/var/tmp/wankapai-product-review-5/screenshots/` and `boards/` |
| Creation matrix summary | `/var/tmp/wankapai-product-review-5-creation/final-summary.json` |
| Creation details and screenshots | The adjacent `submissions/`, `other/`, `card/`, and `card-supplemental/` directories |
| Reminder service/worker report | `/var/tmp/wankapai-product-review-5-reminder-source/review.json` and `verify.ts` |
| Main local visual evidence | `.qa-native/product-review-5-independent/` |

The main browser review completed **28 of 28** paths: 19 route entries and nine focused paths. It produced 40 screenshots, all opened and visually inspected through full-size two-by-two boards and separate landscape images. The independent creation matrix completed **11 valid paths**, and the independent configured reminder service/worker completed **five groups**. Browser page exceptions were zero. These are separate review paths, not replacements for the complete regression suite.

All executable work ran through `ssh test-env`, with browser temporary files under `/var/tmp/wankapai-entitlements-browser`. Local work only read source, copied/opened generated images, and wrote this document. No product source or source acceptance script was changed by this reviewer. No local executable verification, cloud deployment, real notification, experience upload, or publishing action occurred. Synthetic activity publication used only an isolated demonstration context.

One creation fixture initially used a 41-character nickname, outside the application's 40-character limit. It was shortened and that path alone was rerun successfully. The original report and corrected supplemental evidence are retained; this was a fixture correction, not an application defect or a weakened assertion.

## Creation uncertainty and retained input

Every API record-creation entry was exercised after a real service commit and persistent request-ledger write followed by response loss. The review attempted to change the same form before retry, inspected the persisted result, reloaded the form, and verified the original request identity. It did not rely only on successful same-body retries.

| Entry or recovery variant | Independently observed result |
| --- | --- |
| New `card.save` | Mutation controls and direct handlers are blocked while confirmation is pending. Reload retains the submitted payload and intent; retry leaves one card and one creation request. |
| Legacy edited card input | Later nickname and hidden form values survive confirmation and become an edit of the recovered original card ID. Immutable bank/issuer identity remains enforced. |
| Legacy hidden-only card input | Hidden repayment preferences are retained even when the original command omitted them. They are not discarded by a comparison of serialized command fields alone. |
| Card confirmation after month change | The original request is sent with `replayOnly: true`; no fresh expired-period creation is dispatched. The original bill keeps its original period and date. |
| Legacy card with retained billing edit | Recovery preserves original owner, card, account, bill, and period identities. An unconfirmed retained date blocks Save without dispatching a command. After explicit date confirmation, only the original bill changes; other bills remain unchanged. |
| New `submission.lead.save` | Input and lead-to-full conversion remain locked while the result is unknown. Automatic restoration retains the original recovery key, payload and intent; retry confirms one pending submission and one creation request. |
| New `submission.save` | Fields remain locked while sections can be inspected. Reload and retry preserve the original creation request and leave one submission. |
| Legacy edited full submission | Hidden entrance fields and later title/target/reward input survive in a separate local input snapshot. Confirmation resolves the original ID, and a later ordinary save updates that record rather than creating another. |
| Legacy submission with newer server content | A real API update advances the server record. Confirmation preserves the unsent local copy with its older base version, exposes a conflict, disables Save, and prevents direct-handler overwriting. |
| New `entitlement.save` | Title, quota and validity edits cannot replace an unconfirmed creation body. Restored retry retains one version-1 record with total 7, used 2 and remaining 5. |
| First `reward.confirm` | Amount/date controls and handlers preserve the unconfirmed body. Reloaded retry retains one participation and one reward. A genuinely different `expectNew` command returns `VERSION_CONFLICT` and leaves the existing amounts, dates and versions unchanged. |

The matrix summary retains complete IDs, request IDs, fingerprint hashes, record counts, and all raw evidence links. Examples include card `card_f6da13006e21c5d83190f39eae6b70d4`, entitlement `ent_4afe1a2bdac6c5f5d96773e516d69e39`, and the two separately verified submission creation results. Each has one original creation request. No duplicate-creation recommendation remains from the demonstrated review-2 or review-3 paths.

## Target identity, field semantics, and reminders

Historical Todo records for the same month in 2025 and 2026 were rebuilt from the genuine stored historical snapshot and read through the real dashboard. Both 320px and 375px rows expose different full periods. More repeats the selected period and ISO deadline. Completing the older record changes only its participation ID; the newer record remains unfinished.

Four normally created and removed cards, including two repeated labels, retain four distinct archived billing identities. Actual payment marking and due-date editing affect only the selected original bill ID. The other account's payment and date remain unchanged. The identity remains readable before and after expansion, and archived notification restrictions are retained.

Thirteen picker instances were inspected in the current browser projection: all ten full-submission selectors/dates, two different Wallet bill-date controls, and the Mine demo-role selector. Each name includes its field purpose and selected value. The empty start and final-end dates have distinct names; bill dates include human account and period context. Two normally created same-title activities from different banks render different bank-prefixed history titles at 320px.

Expired reminder behavior was independently checked in both UI and the configured service/worker:

- An expired unpaid bill has no reminder action and displays its explanation. Payment and date editing remain available. Changing the same bill's date to today restores its reminder action.
- An expired unfinished activity has no deadline-reminder action and retains its progress/result controls. Direct reminder-handler activation cannot open authorization. After the record is completed and assigned a past expected-receipt date, the reward reminder remains available.
- In fresh `MemoryStore`, `createService`, configuration-parser, and worker instances, expired repayment and deadline authorizations return `REMINDER_UNAVAILABLE` for both accepted and declined outcomes. Each attempt leaves the entire seed, including request receipts and grants, unchanged.
- The expired cases create no jobs or sends on three later dates. Future repayment and deadline controls each generate one mock send, do not resend on a repeated worker run, and retain their grant IDs after serialization/reload and replay.
- A reward whose expected date is already past still authorizes and generates one mock send. After receipt is recorded, both new accepted and declined authorization attempts are rejected without writes, and the next worker run sends nothing.

The worker sender is an in-memory callback, not a WeChat transport. None of these checks sends a real message.

## Complete 19-page review

The review reused UI/UX Pro Max guidance for action clarity, accessibility, touch targets, readable state/field identity, safe areas, and retained user input. It reread the current source and did not inherit a prior clean conclusion.

| Page | Reviewed states/actions and conclusion |
| --- | --- |
| Todo | Deadline groups, filters, current/historical scope, stage actions, More, stale/error guards and full period identity. Target-specific historical mutation verified; no new issue. |
| Activities | Bank rail/search, held-card filter, discovery, subscription, loading/empty/pagination/error states and moderated lead entry. The intentional clipped bank rail is not page overflow. No new issue. |
| Detail | Saved activity snapshot, one primary stage action, More, card choice, direct completion/receipt, historical context, expected date, rules/guide/history and reminders. Expired and past-reward controls verified; no new issue. |
| Progress | Progress/registration, period context, drafts, versions, conflicts, ownership and return behavior. No new issue. |
| Receipt | Actual amount/date, saved period, first and existing receipt paths, pending body, reload/replay, conflict and navigation. Real creation uncertainty and domain uniqueness verified; no new issue. |
| Rewards | Month/currency scope, compact empty state, pending records, populated totals, actual-date accounting, correction and refresh/pagination. No new issue. |
| Wallet | Active/shared/archived identity, unpaid/settled history, selected payment/date actions, server-date reminder eligibility and secondary tools. Identity and eligibility paths verified; no new issue. |
| Card editor | Single/multiple issuer presentation, immutable identity, billing targets and date confirmation, storage/pending creation, ordinary/legacy restoration, same-ID edits and cross-period lookup. The review-3 defect remains fixed. |
| History | Bank and period identity, amount/date semantics, scope/help, filters, paging/retry, detail and audit actions. Same-title bank distinction verified; no new issue. |
| Mine | Management hierarchy, compact tools, submission attention, sharing/privacy, trusted moderator gate and named demo role. Column layout and destinations remain intact. |
| Preferences | Load/error, switches, dirty/saving/saved status, help disclosure, fixed Save dock and leave/lifecycle guards. At 320px and landscape, the last help text remains above the dock and a change saves normally. |
| Submission lead | Minimum-source fields, all source/image inputs, local drafts, unknown result, automatic restore, conversion lock, conflict and published read-only behavior. Real uncertainty verified; no new issue. |
| Full submission | Four sections, purpose-specific picker names, validation, hidden entrance/source input, pending body, retained copy, recovered-ID edit, newer-server conflict and moderation paths. No new issue. |
| Submissions | Owner-scoped statuses/reasons, source-kind routes, submitted identity, empty/paging/error states. No new issue. |
| Review | Verified moderator permission, status filters, loading/retry, source evidence and review/editor navigation. Ordinary-user denial remains coherent. |
| Web entry | Address validation, unsupported/error state, copy/retry and predictable return. No new issue. |
| Held benefits | Adjacent remaining uses, validity/transfer labels, management disclosure, direct usage/history, archival restoration and stale/conflict guards. No new issue. |
| Benefit editor | Fixed periods, opening/recorded use separation, owner/version checks, persistent/pending intent, per-lounge rules and supported-bank input. Creation uncertainty verified; no new issue. |
| Airport lookup | Information-only supported banks and admission rules, airport/code/city and terminal/zone filters, scope, missing/empty/stale state and practical details. No usage, edit, quota or personal-balance action has returned. |

Cross-page reading included shared sheets and focus/scroll behavior, generalized demo messaging, private-data and moderated-public boundaries, source-generated routes, optional supported-bank compatibility, exact old pending payloads, conservative demo annotation, and the transaction/owner/date/snapshot/idempotency guarantees. Missing bank data remains unknown; provider and card identity are not inferred as support claims.

## Final verification boundary

The integration owner separately reports 895 business tests, full type/source/prototype builds, 31 feature cases, and 199 complete browser cases passing on this final application. Those suite counts are not substituted by this review's 28 UI paths, 11 creation paths, or five reminder groups. The main review's original evidence records all assertions and the unchanged digests.

Browser projection, persisted demonstration service, and mock-worker evidence do not certify WeChat Developer Tools, physical devices, native screen readers, deployed account/cloud configuration, actual bank admission, or real notification delivery. The accepted Chinese utility interface, five tabs, manual bank/lounge records, and moderated public submissions remain in scope.

This report freezes clean review **2 of 2** for the same application source and generated HTML as clean review 4, with the single QA-only manifest difference explicitly retained above.
