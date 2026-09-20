# Product UX refinement

The 2026-09-21 refinement keeps the accepted five-tab structure and moderated public submissions. It reduces decisions in the main flows while preserving transaction, ownership, version, and publication safeguards.

## User journeys

| Area | Result |
| --- | --- |
| Instant discounts | Discount records use actual savings and the date the benefit was used. Cashbacks continue to use actual receipt amounts and dates. Monthly totals expose separate cashback and discount subtotals in the selected currency. |
| Todo priorities | Unfinished tasks are grouped into overdue, due within seven days, and other activities. Each row has one primary action based on its stage and benefit kind, with secondary shortcuts in More. |
| Activity submissions | The default form accepts a bank, title, and at least one source: a public link, a bank-app path or explanation, or an owned screenshot. The complete rule editor remains available. |
| Card identity | Lists prefer nicknames, then bank/network/type descriptions, then stable friendly ordinals for legacy duplicates. New indistinguishable cards require a more useful nickname. System references are confined to advanced details. |

Todo still permits direct completion and recording from More. Users are not required to enter every intermediate progress step. Historical records remain accessible independently of the current-period tabs.

Moving from a new lead to the complete rule editor carries over the bank, title, and source text. Recovering an existing complete draft takes precedence over this prefill. Unknown dates and financial rules remain empty. Source screenshots remain references in the local draft and never become public entrance images automatically; the original lead draft is retained.

## Data and publication boundaries

- Benefit labels derive from each participation's immutable rule snapshot. The existing ledger, actual-date attribution, corrections, reversals, currencies, and idempotency semantics are unchanged.
- `rewards.get` returns benefit kinds and currency-specific subtotals in the same query; the client does not fetch each row separately.
- `Submission.draft` can be `null` when a submission contains an `ActivityLead`. `submission.lead.save` stores no invented dates, thresholds, or reward amounts.
- Pending leads are private to their owner and moderators. Publishing still requires a trusted moderator, the current version, verified sources, a complete validated draft, and authorized immutable images.
- Publication requires a positive reward amount. A full private draft can retain a zero placeholder, but that placeholder cannot be published.
- Lead screenshots are source evidence. They only become public entrance images when a moderator explicitly selects them for that purpose and publication validates their ownership.
- Lead forms retain local draft recovery and delayed-response protections. A response from an unloaded editor cannot erase a newer draft or navigate another editor.
- Legacy duplicate cards remain readable without migration or deletion. Nickname guidance is a client usability constraint; server ownership rules continue to authorize every write.

## Verification scope

Local verification was explicitly authorized for this task. All 148 business, adapter, controller, and native-contract tests passed, and TypeScript checking passed. The source build passed through `scripts/build.mjs`. The SDK suite additionally exercises discount recording and separated totals, lightweight lead submission, private visibility, and incomplete publication rejection. See [Scripted UI acceptance](ui-acceptance.md) for artifacts, isolation, and execution requirements.

The final 24-scenario SDK run did not complete: eight scenarios passed before the DevTools connection closed during the monthly workflow. Three subsequent case results recorded the closed connection, and the runner then stopped. An earlier expanded run had 16 passes and eight automation/navigation timeouts. Neither run establishes complete UI acceptance for this refinement. The previous 22-scenario remediation result applies to the earlier version only.

The interrupted run could not restore its isolated demo project's storage. Its backup remains in the ignored local acceptance directory for recovery; no production or cloud data was used. The user subsequently requested main-branch delivery and task closure without another simulator run.

The SDK checks use an isolated demo project. They do not verify physical devices, real photo selection, production authorization, deployed CloudBase integration, or WeChat message delivery. No cloud deployment, preview upload, or publication is part of this refinement.
