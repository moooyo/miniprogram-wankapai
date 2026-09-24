# Held benefits review 1

## Scope and evidence

This is the first review of the new held-benefit feature. It covers the three new secondary routes (`entitlements`, `entitlement-edit`, and `lounges`), Wallet and Mine entry points, the source-generated prototype, and domain/API/demo/infrastructure consistency. It does not reopen or renumber the completed 24-round review of the existing product.

The review applied the previously loaded UI/UX Pro Max guidance to the accepted blue-and-white native utility design. The focus was reachable actions, meaningful accessible names, accurate manual-rule semantics, clear quota/history states, small-screen layout, and preservation of ownership and ledger guarantees. It did not propose a new navigation system or an authoritative lounge directory.

Static reading used repository source. Executable probes ran only through `ssh test-env`, against the frozen build in `/var/tmp/wankapai-entitlements-20260924`. No local test, build, runtime probe, deployment, notification, upload, or publishing action was performed.

The reviewed prototype was `dist/prototype/index.html`, with SHA-256 `05b25baf8d735571dee4e9db2e13eed6765a17a09c16aa0c481de5855a6e7c94` and build timestamp `2026-09-24 14:27:58 +0800`. Review browser contexts used Chromium, the `zh-CN` locale, and the `Asia/Shanghai` timezone. Evidence is stored outside the source tree in `/var/tmp/wankapai-held-review-1`.

## Result

Six actionable findings were identified: four P2 findings and two P3 findings. No P0 or P1 finding was identified. This is a findings round, not a clean round. The consecutive clean-review count must restart after the fixes are integrated and verified on a new frozen revision.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| HB1-01 | P2 | An archived benefit still offers an edit action that the editor always rejects. | `review-probes.json`, case `archived-edit`; `archived-edit-error.png` |
| HB1-02 | P2 | Multiple new picker controls have indistinguishable or value-only accessible names. | `review-probes.json`, case `picker-labels`; `new-lounge-defaults.png` |
| HB1-03 | P2 | A required reservation with zero advance hours has different meanings in the editor and lookup. | `additional-probes.json`, case `zero-reservation-hours`; `zero-reservation-hours.png` |
| HB1-04 | P3 | The all-types filter label wraps unnecessarily at a 320px viewport. | Integration-owner visual review; `/var/tmp/wankapai-entitlements-evidence/screenshots/001-entitlements-320.png` |
| HB1-05 | P3 | Health-check usage history displays a lounge-specific missing-location label. | `additional-probes.json`, case `health-history-context`; `health-history.png`; independently also found by the integration owner |
| HB1-06 | P2 | The lounge confirmation button exposes an unresolved template in the generated prototype. | Feature-acceptance visual review; independently reproduced in `lounge-confirm-template.json` and `lounge-confirm-template.png` |

### HB1-01: Remove the unreachable archived edit action

Reproduction: open the held-benefit inventory, archive the demonstration health-check benefit, select the archived scope, and activate the still-enabled edit-details-and-quota action. The editor navigates successfully but sets `ready` to `false` and displays the rejection for an archived or foreign record. This makes a valid same-owner action look like a loading or access failure.

The mismatch is between `miniprogram/pages/entitlements/index.wxml` and the archived-record checks in `miniprogram/pages/entitlement-edit/index.ts`. Keep history and restoration available, but hide the edit action for archived records and guard its controller against stale or direct activation. After restoration, editing should work normally. There is no need to expand archived-edit permissions.

Acceptance: an archived card offers history and restoration without an enabled dead-end edit action; restoration exposes the normal editor and preserves quota and usage history.

### HB1-02: Give every picker a field-specific accessible name

Reproduction: create a benefit, open the lounge editor, and inspect the departure-zone, reservation, and customer-scope selectors in their default states. All three projected controls have the same accessible name meaning unknown/select. The benefit-start date similarly exposes only the selected date and a generic selection suffix. A user navigating controls with a screen reader cannot distinguish the fields reliably.

The visible field text is outside the native picker, and the new WXML initially supplied no explicit `aria-label`. The browser adapter therefore derives the name from the selected value. Add labels that include the field purpose and current value to all new editor pickers, including dates and transfer rules, and to the lounge/date pickers in the usage sheet. Keep native visible labels and existing validation behavior.

Acceptance: the three unknown-state lounge selectors have distinct names; filled date selectors still identify whether they represent the start date, end date, usage date, or verification date. Browser accessible-name checks are evidence for the projection only; native screen-reader behavior remains a separate device check.

### HB1-03: Make zero advance hours mean the same thing throughout the flow

Reproduction: edit the demonstration local-bank lounge, keep reservation required, and enter `0` using the editor's instruction that zero means no advance time limit. Commit the lounge, save the benefit, and open airport lookup. The saved rule is presented as requiring reservation with an unverified advance duration. Thus a known no-advance requirement becomes an unknown rule after saving.

The conflict is between the advance-hours help text in `miniprogram/pages/entitlement-edit/index.wxml` and `reservationLabel` in `miniprogram/services/entitlement-view.ts`. The smallest correction is to document `0` consistently as an unverified advance duration, keeping the existing conservative lookup behavior. Do not add new booking capabilities or treat unknown rules as unrestricted access.

Acceptance: the input instruction, saved lounge summary, airport result, and usage-sheet rule agree on the meaning of zero; a positive value such as `4` continues to show a four-hour advance requirement.

### HB1-04: Keep the compact all-types filter readable at 320px

The integration owner's independent 320px visual inspection found that the all-types filter wraps its short label into an avoidable second line. This makes one peer filter taller and harder to scan. The finding is limited to this compact label; it is not a request to redesign the filter row.

Use the shorter equivalent of all for this filter while preserving its `all` value, selected semantics, wrapping behavior for the collection, and existing touch target size.

Acceptance: the four category filters remain legible and aligned at 320px without shrinking text or reducing the touch area; filtering behavior is unchanged.

### HB1-05: Keep non-lounge usage history free of lounge-only text

Reproduction: record one use of the demonstration annual health-check benefit, open the all-benefits scope, and open that benefit's usage history. The new row includes the missing-lounge placeholder even though health-check use cannot select a lounge. The same issue affects other non-lounge benefit categories.

The unconditional lounge-name fallback is in the usage-row markup in `miniprogram/pages/entitlements/index.wxml`. Render that line only for lounge benefits, retaining the current historical lounge-name snapshot behavior for actual lounge usage.

Acceptance: health-check and other-benefit history shows date, quantity, note, and reversal status without a lounge placeholder; lounge history still shows its recorded name or the meaningful unspecified-lounge fallback.

### HB1-06: Preserve the lounge confirmation label through prototype generation

Reproduction: open a new benefit, expand its lounges section, add a lounge, and scroll to the sheet confirmation button. The generated button exposes the unresolved `loungeIndex` interpolation instead of its intended add-to-benefit label. The independent probe reproduced the same malformed template reported by the feature-acceptance reviewer, using the frozen acceptance copy at `/var/tmp/wankapai-entitlements-evidence/interactive-prototype.html`.

The existing XML tokenizer splits the raw less-than operator inside the text interpolation in `miniprogram/pages/entitlement-edit/index.wxml`. Use the equivalent `loungeIndex === -1` new-record check in that text expression. This preserves source behavior without broadening the scope into a parser rewrite.

Acceptance: a new lounge displays the exact add-to-benefit label, an existing lounge displays the exact confirmation label, and no visible raw interpolation remains. The feature-acceptance owner added exact-label and unresolved-template checks.

## Cross-layer coverage

| Area | Review conclusion |
| --- | --- |
| Inventory and usage sheet | Read loading, stale-refresh, empty, filter, current/expired/depleted/archived, dirty-dismiss, pending-result, conflict, usage, reversal, and archive/restore branches. Runtime probes confirmed the archived edit and non-lounge history findings. No additional ledger mutation issue was identified. |
| Benefit and lounge editor | Read draft restoration, owner checks, fixed-period quotas, historical opening balance, per-lounge rules, conditional customer notes, field validation, conflicts, and retained save intent. Runtime probes confirmed picker-name and zero-hour-rule inconsistencies. |
| Airport lookup | Verified source logic for case-insensitive airport/code/city lookup, terminal/zone filters, entitlement scoping, empty-state wording, shared balances, per-visit cost, unknown rules, and the route into a reviewable usage sheet. No claim of a complete directory or current bank eligibility is introduced. |
| Wallet and Mine | Entry handlers target the three registered secondary routes and retain the five-tab structure. The new entries do not depend on moderator authorization. |
| Prototype | New routes are sourced from native WXML/WXSS/controllers, appear in the navigation atlas and journeys, and use the dynamic route count. The editor is included in the existing initial-read guard. No separately maintained benefit business implementation was found. |
| Domain and API | Reads and mutations retain owner checks, mandatory versions, transaction/request-ledger behavior, balance limits, validity-date checks, usage reversal history, and historical lounge-name snapshots. The client maps usage IDs to benefit resources so usage and reversal retries share the existing coordinator. No additional P0/P1 issue was identified. |
| Demo | Seeded airport/lounge names and rules are explicitly fictional. Migration seeds the new collection only when absent; existing manual records are retained. Grey transfer text does not establish official permission. |
| Infrastructure | Private collections, owner indexes, entitlement expiry ordering, and usage ordering match the new queries. Client database rules remain deny-by-default. This review did not deploy or certify real cloud integration. |

## Verification limits and follow-up

The browser probes used real projected controls, page handlers, and the persisted demo service. The archived-edit and zero-hour observations were reproduced through normal user interactions; the health-check history observation followed a normal usage command. Accessible-name observations inspected the browser projection's generated controls. Probe scripts asserted the observed defects; their successful execution is not an application acceptance pass.

The integration owner coordinates the complete business suite, type/source build, the new feature acceptance cases, visual review, and the existing regression suite. Those runs are distinct from this bounded independent review. The implementation owners reported source fixes for all six findings before this round was frozen. This document records the original findings and does not claim that the corrected revision has already passed re-review.

After integration, repeat the affected paths and complete two clean reviews of the same final revision within the new-feature scope. Native WeChat rendering, device screen readers, real cloud ownership configuration, and real external service eligibility remain separate integration checks.

This round is frozen with six findings. Subsequent independent re-review belongs to a new round rather than revising this result into a clean pass.
