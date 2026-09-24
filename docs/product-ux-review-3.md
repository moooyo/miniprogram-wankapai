# Product UX review 3

## Result

This complete independent review of the current product candidate found **one actionable P2 issue**: a new card with an unconfirmed save result can still accept a changed nickname and submit another creation request, producing a second card. No other actionable recommendation was identified.

This is a findings round, **not a clean review**. The consecutive clean-review count for the current whole-product refinement remains **0 of 2**. The three findings from product review 2 were independently rechecked and their bounded corrections behaved as intended. Earlier held-benefit and original-product clean rounds do not count toward this task.

## Frozen candidate and evidence

| Property | Value |
| --- | --- |
| Remote checkout | `/var/tmp/wankapai-entitlements-20260924` |
| Source manifest | 162 files |
| Source SHA-256 | `705dcff5c8cc170450bfe0036ada52177d9e32c5bfd91ab26db42564627cd40d` |
| Prototype SHA-256 | `cea664b1e5dfc0017bf4ccd5942ccf067a692b6d44506f958169c836e6e391d6` |
| Generated HTML size | 1,172,544 bytes |
| Build timestamp | `2026-09-24 15:57:49 +0800` |
| Main browser evidence | `/var/tmp/wankapai-product-review-3/review.json` and `screenshots/` |
| Card finding evidence | `/var/tmp/wankapai-product-review-3-card/review.json` and adjacent PNGs |
| Submission recovery evidence | `/var/tmp/wankapai-product-review-3-pending-independent/review.json` and `supplemental/review.json` |
| Other creation evidence | `/var/tmp/wankapai-product-review-3-other-creations/review.json` and adjacent PNGs |
| Local evidence copy | `.qa-native/product-review-3-independent/` |

The fixed HTML digest was checked before and after the browser runs and remained unchanged. The card reproduction also independently checked the source digest before and after its run. Browser page exceptions were zero. Helpers and evidence were kept in excluded or external directories; this reviewer did not modify product source or source acceptance scripts.

All executable verification ran through `ssh test-env`, with browser temporary files under `/var/tmp/wankapai-entitlements-browser`. Local activity was limited to source reading, copying/opening screenshots, and writing this report. No local test/build/runtime check, deployment, actual notification, experience upload, or publishing action was performed.

The review reused the loaded UI/UX Pro Max guidance, reread the current source, and combined all-page inspection with bounded independent checks of the other page controllers and the complete creation-retry surface. All 19 route screenshots were visually inspected using full-size two-by-two boards. Focused Todo, Wallet, pending-result, and card-finding screenshots were also inspected.

## PUX3-01: Resolve the original card creation before accepting a changed creation body

**Priority: P2.**

### Reproduction

1. Open a new card form, choose a debit card without a repayment plan, and enter the nickname `Review Pending Card A`.
2. Submit normally. The fixture lets the real demo service commit the card and its request ledger, invokes the original persistent-storage write, confirms that the request is in the saved seed, and only then raises `NETWORK_ERROR`.
3. The page displays an unconfirmed-result notice and a retry-save action, but the nickname remains editable.
4. Change the nickname to `Review Pending Card B`. The action becomes ordinary Save again, with text suggesting that the user first check the wallet.
5. Submit. No modal or explicit decision to end the original creation intent is shown. The wallet contains both cards.

The recorded entities are `card_fc79c0349fc70edf7418ca408ecf7e45` and `card_4de80285b141aa11e2497d9ff1fbed09`. Their requests are respectively `intent_b8cd523f036469f6e39d350f0619de08` and `intent_8b77f0680e4127632859b6dcee695145`. The evidence retains both original fingerprints, both card rows, `dialogs: []`, and `duplicate: true`. The fault was injected after real service persistence, not after a mocked successful `api.command` return.

The three focused screenshots are `card-first-result-unknown.png`, `card-changed-pending-input.png`, and `card-second-save-wallet.png`. The JSON also preserves the complete rendered wallet text containing both nicknames.

### Source and bounded correction

On the reviewed source, `miniprogram/pages/card-edit/index.ts:322` only blocks the special pending-lookup state, while ordinary unconfirmed creation still permits nickname changes. The save path around lines 603-615 builds the changed payload, overwrites `pendingCreationSignature`, and sends it as a new card creation. The nickname control in `miniprogram/pages/card-edit/index.wxml:25` remains enabled. `miniprogram/services/api.ts:171` correctly includes the payload in the request identity, so the changed body cannot replay the original creation.

Retain the original pending payload and intent until its result is known. During uncertainty, Save should only confirm the original request. After recovering its card ID, later edits should target that card. Preserve already-entered changes from older drafts separately during recovery. A passive warning to inspect Wallet does not establish whether the original write succeeded and does not prevent the demonstrated duplicate.

The correction must preserve existing cross-period `replayOnly`, billing-target, owner, date, request-fingerprint, and legacy-draft protections. The observed reproduction uses a debit card; it does not require weakening or replacing the credit-card billing rules.

Acceptance: after a real committed-response loss, changed form input cannot produce another card from the same unresolved form. Reloaded and legacy edited drafts retain the original request and recover its result safely. Once confirmed, retained unsent changes update the recovered ID. Existing cross-period result lookup must continue to avoid executing an expired creation payload as a fresh write.

## Complete creation-retry matrix

The review checked every record-creation entry in the API allowlist, plus first receipt creation. It specifically tested unknown result followed by attempted input changes, rather than relying only on a same-body retry test.

| Entry | Actual result |
| --- | --- |
| `card.save` without an ID | PUX3-01: changed nickname produces a second card and second request after the original commit. |
| `submission.lead.save` without an ID | Real commit followed by response loss locks input and conversion. Automatic restoration retains the original body, intent and recovery key; retry confirms one submission and one original request. |
| `submission.save` without an ID | Real committed-response loss locks mutation controls and retains the original request across automatic restoration. Retry does not create a second submission. |
| Legacy edited full-submission pending draft | The original pending body is replayed, while later title/target/reward changes and a hidden `entrance.url` remain in an unsent local input snapshot. Confirmation moves to editing the original submission ID; saving that retained edit advances the same record to version 2. |
| Legacy pending submission with a newer server version | A genuine API update first advances the original record to version 2. Recovery retains the local edited copy with its original base version 1, shows a conflict, disables Save, and rejects direct save-handler activation without overwriting the newer server record. |
| `entitlement.save` without an ID | Pending title, total-use and date changes are blocked. Reload and retry preserve the exact payload/intent/fingerprint. One record remains at version 1 with total 7, used 2 and remaining 5. |
| `reward.confirm` with `expectNew` | Pending amount/date controls and handlers cannot alter the submitted request. Reloaded retry retains one participation at version 2 and one reward at version 1, amount `1234` minor units and date `2026-09-24`. A separate real `expectNew` command with another intent and changed amount returns `VERSION_CONFLICT`; rows, versions and amounts remain unchanged. |

The entitlement evidence identifies `ent_1cd5d9730f3aab1d6f8d7c358a77dc45`, request `intent_3dc246a1fea694d5a2820f2bf431cb9d`. The receipt evidence identifies participation `p_bcf72f1eb44fff8e70d1d9009b5559aa`, reward `r_2aef6d36ff2065570ecd54e2ad072055`, and request `intent_6f363a360060c5b87a0f29ccdabf2ba0`. Complete snapshots and fingerprints are retained in the separate JSON evidence.

The submission compatibility fixture altered only an old-style local form copy to represent unsent edits; it did not fabricate a committed submission or request ledger. One helper initially tried to inspect a title input while its section was collapsed. The supplemental run opened the section and completed the same real path; this setup error was not a product finding. The card helper likewise corrected an initial nested locator before its complete unchanged-candidate reproduction.

## Review-2 corrections independently confirmed

**Submission uncertainty.** Both lead and full forms now preserve the submitted body, lock mutations and conversion, and restore the pending request rather than replacing it with a changed creation body. Legacy hidden fields and separately retained unsent edits survive. A newer server version requires an explicit conflict-resolution step, as verified above.

**Historical Todo identity.** The fixture retains the existing historical participation and its genuine saved activity snapshot, then creates an otherwise equivalent prior-year unfinished record in the persisted demo seed. After reload, the real dashboard renders the 2025-08 and 2026-08 periods distinctly at both 320px and 375px. More displays the selected full period and ISO deadline. Executing completion from the 2025 sheet changes only that participation ID; the 2026 record remains unfinished. The fixture does not replace page data or rendered text.

**Archived billing identity.** Normal `card.save` and `card.remove` commands create and archive four independent accounts: two different labels and two duplicate labels. All four retain different visible identities after removal. The two repeated labels acquire card-based distinctions. Payment marking and a due-date change on the selected account alter only its original bill ID; the other account's payment and date remain unchanged. Identity is visible before and after account expansion, and archived reminder restrictions remain in place.

The Mine column-layout correction from review 1 also remains effective at 320px and 768 x 375. Each tool title lies above its description, and the two destinations remain intact.

## Complete 19-page coverage

| Page | Current reviewed scope and conclusion |
| --- | --- |
| Todo | Deadline groups, current/historical scope, filters, primary actions, More, stale guards and full target-period identity. Review-2 correction confirmed through actual targeted writes. |
| Activities | Bank rail/search, held-card filtering, loading/empty/pagination states, subscription, detail and lead entries. The intentional clipped horizontal bank rail is not page overflow. No additional finding. |
| Detail | Saved-snapshot hierarchy, phase-specific primary action, More, card choice, direct recording, expected dates, rules, guide/history and reminders. No additional finding. |
| Progress | Progress/registration fields, draft and version recovery, owner/return guards and saved-period context. No additional finding. |
| Receipt | Actual amount/date, saved activity period, pending result, reload, same-request replay and domain protection against another first receipt. No additional finding. |
| Rewards | Month/currency identity, compact empty state, pending records, populated accounting, correction and refresh/pagination. No additional finding. |
| Wallet | Card/account identity, active/shared/archived groups, unpaid and settled history, payment/date/reminder guards and secondary tools. Review-2 correction confirmed. |
| Card editor | Bank/issuer and card identity, compact single issuer, billing settings, recovery and new-card creation. PUX3-01. |
| History | Full period scope, optional explanation, filters, paging/retry, amount/date semantics, detail navigation and audit action. No additional finding. |
| Mine | Primary menu, compact tools, submission attention, sharing/privacy, trusted moderator boundary and explicit demo role. Prior layout correction remains effective. |
| Preferences | Load/error, switches, dirty/saved states, optional help, fixed dock and leave/lifecycle behavior. At 320px and landscape, the final explanation stays above the visible Save dock and a changed preference saves normally. |
| Submission lead | Minimum-source fields, images, drafts, pending creation, restore, conversion lock, conflict and published read-only state. Review-2 correction confirmed. |
| Full submission | Four sections, source/entrance data, hidden input preservation, validation, pending creation, legacy recovery, newer-server conflict and moderation/return paths. Review-2 correction confirmed. |
| Submissions | Owner-scoped statuses, reasons, source-kind routes, empty and pagination/error states. No additional finding. |
| Review | Verified moderator permission, filtering, loading/retry, source and editor navigation. Ordinary-user denial was opened and visually inspected. No additional finding. |
| Web entry | Address validation, unsupported/error state, copy and predictable return. No additional finding. |
| Held benefits | Adjacent quota, validity/transfer labels, details/management disclosure, usage/history, archived restore and stale/conflict guards. No additional finding. |
| Benefit editor | Fixed periods, quotas, owner/version checks, pending creation, bank input, per-lounge rules and drafts. Pending creation was independently proved safe against changed input. |
| Airport lookup | Information-only supported banks and admission rules, search/filter/scope, missing-bank and empty/stale states. No record-use, edit, personal quota or balance action has returned. |

Source review also covered shared sheet sizing/focus, safe-area treatment, generalized demo copy, privacy and moderation boundaries, source-generated navigation, optional supported-bank compatibility, strict demo migration, and the API/domain ownership, date, snapshot, transaction and idempotency contracts.

## Verification boundary and next round

The main browser run completed all 19 route inspections and five focused flows, producing 33 screenshots. The creation matrix adds four submission recovery paths, two other-creation paths and the card defect reproduction. The separately recorded integration-owner business/type/build and complete regression suites are not substituted by these independent paths, and passing suite counts do not override PUX3-01.

Evidence is from a source-generated browser projection and persisted demonstration service. It does not certify WeChat Developer Tools rendering, physical devices, native screen readers, real account/cloud configuration, live bank admission or actual notification delivery.

This round is frozen with one P2 finding. Integrate the bounded card-creation correction, retain the existing replay and billing safeguards, rebuild from source, and start the two-clean-review sequence on the next frozen candidate.
