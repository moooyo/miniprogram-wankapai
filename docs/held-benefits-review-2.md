# Held benefits review 2

## Scope and frozen evidence

This is the second independent review of the new held-benefit feature. It covers all three new routes, their page handlers and states, Wallet and Mine entry points, the source-generated prototype, and domain/API/demo/infrastructure consistency. The completed 24-round review of the existing product is not reopened; only the new feature and its integration points are in scope.

The review applied UI/UX Pro Max, its professional app rules, and the accessibility, interaction, and performance quick-reference sections. It retained the accepted native blue-and-white utility design and manual-data product boundary. No new design system, live bank integration, or authoritative lounge directory is proposed.

The frozen remote checkout was `/var/tmp/wankapai-entitlements-20260924`. Its prototype was built on `2026-09-24 14:34:04 +0800`, with SHA-256 `3c16afd94b001024be0e29cff70522048002266ed7bfd963e85e248ab0e8b574`. The 162-file source manifest from the integration acceptance has SHA-256 `5d04a242412288586eac2632fa08558db806485194f14644563a8c84c9035b61`; its start and end values match.

Independent evidence is stored in `/var/tmp/wankapai-held-review-2`. The final `review-probes.json` contains 12 targeted observations, all completed without a probe error or browser runtime exception. The prototype hash was unchanged during the run. Browser contexts used Chromium, `zh-CN`, `Asia/Shanghai`, and reduced motion. Checks ran only through `ssh test-env`; no local executable verification was performed. Review helpers were outside the frozen product source directories.

The integration owner's separate report at `/var/tmp/wankapai-entitlements-evidence/r2/report.json` records 29 passing acceptance cases, 30 screenshots, and no runtime, console, or HTTP errors on the same prototype and source manifest. That suite supports the coverage below but does not override the independent findings.

## Result

Two actionable P2 findings were identified. No P0 or P1 finding was identified. This is a findings round, not a clean round. The consecutive clean-review count remains zero until the fixes pass subsequent complete reviews on the final candidate.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| HB2-01 | P2 | Lounge-sheet fields and the cancel control lose their intended borders because a page-local variable is unavailable in the sibling sheet. | `review-probes.json`, case `sheet-control-borders`; `sheet-control-borders.png` |
| HB2-02 | P2 | Reclassifying a benefit hides the saved lounge name from its historical usage rows. | `review-probes.json`, case `historical-lounge-after-kind-edit`; `historical-lounge-after-kind-edit.png` |

### HB2-01: Use an inherited border token in the lounge sheet

Reproduction: add or edit a benefit, expand the lounges section, open a lounge, select reservation required, and enter an advance-hour value. Before focus, the sheet's text fields, selectors, and text areas have no visible boundary against the white sheet. The cancel control loses its intended border as well. The integration owner first raised the visual concern; the independent probe confirmed the source cause and computed styles.

`miniprogram/pages/entitlement-edit/index.wxss` defines `--editor-border` only on `.entitlement-editor`, while `app-sheet` is a sibling of that element in `index.wxml`. The shared `.form-input`, `.select-input`, `.form-textarea`, and `.cancel-button` styles reference that unavailable variable. The main title input computes to `1px solid`, but all 12 inspected sheet controls compute to `0px none`. In the sheet, `--editor-border` is empty while the inherited `--control-border` remains `#98a8be`.

Use the existing globally inherited `--control-border` token for those borders, or define the alias at a common ancestor. Preserve the current field spacing, focus indicators, and input semantics. The issue affects recognition of editable areas throughout a long form; the focus outline on one active input does not restore the other boundaries.

Acceptance: unfilled and filled text inputs, all sheet selectors, text areas, and the cancel control retain their intended border before focus. Main editor controls remain consistent. Confirm on the generated prototype and in focused small-phone and landscape captures.

### HB2-02: Render historical lounge snapshots independently of the current category

Reproduction through normal controls: record one use of the demonstration lounge benefit and select its first specific lounge; open history and observe the saved lounge name. Edit the benefit, remove both lounge registrations, change its type to other benefits, and save. Reopen history. The date, quantity, and reversal action remain, but the lounge name disappears. A read of `entitlement.get` still returns the original `loungeName` and `loungeId` in the usage event.

The history markup in `miniprogram/pages/entitlements/index.wxml` conditions the entire location line on `selected.kind === 'lounge'`. This fixes the original non-lounge placeholder problem but uses mutable current metadata to hide an existing historical snapshot. A type correction should not obscure where the saved usage occurred.

Render a nonempty `item.loungeName` regardless of the current benefit category. Retain the unspecified-lounge fallback only for current lounge benefits. The condition can therefore include either an existing historical name or the current lounge category. Do not alter the usage ledger, allow invalid lounge registrations on non-lounge benefits, or restore a placeholder on ordinary health-check usage.

Acceptance: after removing lounge rules and changing the benefit category, an existing lounge usage still shows its stored name; genuine health-check and other-benefit usage without a lounge snapshot remains free of lounge-only placeholder text. Reversal and balance behavior remain unchanged.

## First-round fix verification

| Prior finding | Frozen-revision verification |
| --- | --- |
| HB1-01: Archived edit dead end | Archived cards expose only history and restoration. Direct activation of the stale edit handler stays on the inventory route. Restoring the record opens a ready editor normally. |
| HB1-02: Picker names | All nine editor pickers and both usage-sheet pickers have nonempty, mutually distinct field-and-value accessible names, including the three unknown-value selectors and date controls. |
| HB1-03: Zero reservation hours | The input guidance identifies zero as an unverified advance duration. Saving zero retains a reservation requirement; lookup and the usage sheet both state that advance duration needs verification. No unrestricted-access claim remains. |
| HB1-04: Compact type filter | At 320px, all four type controls are 66px wide and 48px high, with the shortened all-types label on one line. |
| HB1-05: Non-lounge placeholder | A newly recorded health-check use has no lounge placeholder. HB2-02 is an additional historical-snapshot branch exposed by the fix, not a failure of this original path. |
| HB1-06: Raw confirmation template | A new lounge shows the resolved add action and an existing lounge shows the resolved confirmation action. Neither confirmation label exposes a raw interpolation. |

## Complete feature coverage

| Area | Review coverage and conclusion |
| --- | --- |
| Inventory states and handlers | Read initial load, refreshing, failed, stale, empty, filtered, current, future, expired, depleted, and archived branches. Independent remote probes confirmed initial retry, retained stale data, disabled usage mutation during stale state, recovery, archived edit protection, restoration, health-check history, and compact filters. The separate acceptance covers all scopes and remaining-count states. Only HB2-02 was identified in history. |
| Usage, reversal, and archival | Read dirty-dismiss, detail retry, pending payload, version conflict, quantity/date validation, selected-lounge cost/rules, history snapshots, reversal, and archive/restore handlers. The integration acceptance independently exercises committed-response loss with one persisted usage, preserved conflict input, reversal, and shared zero balance. No additional counter, double-write, or owner issue was found. |
| Benefit editor | Read initial and owner errors, ready/saving/saved states, persistent new-record intent, draft recovery, unknown-result retry, quota and historical opening balance, date validation, conflict reread, card selection, section targeting, and navigation. Independent initial-failure retry succeeds. The integration acceptance covers draft recovery and conflict preservation. |
| Lounge editor | Read add/edit/remove/cancel, dirty confirmation, field and summary errors, conditional reservation hours and customer notes, advanced details, verification-date limits, 30-item limit, and per-visit consumption. Independent controls confirm the prior labels and zero-hour meaning. HB2-01 is the only new form presentation issue. |
| Airport lookup | Read airport name/code/city search, case folding, terminal/zone and entitlement filters, manual-directory empty copy, unknown rules, shared balance, affordability, and routes into usage/editor. Independent failure and stale-refresh probes preserve data and block mutation until recovery. Source and the integration acceptance retain per-lounge reservation, bank/region restrictions, guests, source/date, and explicit grey-transfer qualification. |
| Wallet, Mine, and navigation | New entry handlers use the three registered secondary routes, preserve the existing five tabs, and do not rely on moderator authorization. The integration acceptance exercises each entry and native back route. Draft and usage exit guards remain consistent with the existing navigation helpers. |
| Visual and accessibility | Read wrapping, labels, state text, touch targets, safe-area padding, and scrollable sheet structure. Independently inspected the 320px filter capture and targeted 375px sheet/history captures. The integration report covers all three new pages at 320px, 375px, and 768px landscape. No new color-only transfer state or visible raw-template issue was found. HB2-01 remains actionable despite layout acceptance passing. |
| Domain, API, and cloud adapter | A separate read-only business review found no new issue in owner checks, mandatory versions, transactional request ledger and audit, balance/date limits, quota-history preservation, archived usage protection, reversal idempotency, client resource coordination, or trusted cloud identity. Historical snapshots remain intact in storage, confirming HB2-02 is a rendering defect. |
| Demo and infrastructure | Explicit fictional airport code `ZZZ`, lounges, and eligibility conditions remain manual demonstrations. Collection migration retains existing records. Private collection rules and owner/order indexes align with the queries. No live bank, booking, notification, or provider integration is claimed or invoked. |
| Source-generated prototype | Routes, navigation atlas, journeys, controller bindings, editor initial-read guard, and dynamic route count include all three pages. Actual probes operate the generated native-source controls and persisted demo API. No divergent hand-edited product implementation in `dist/` was used. |

## Verification limits and next round

Browser projection checks are distinct from WeChat Developer Tools, physical-device rendering, operating-system screen readers, dynamic system text, real cloud authorization, and real provider eligibility. No deployment, real notification, experience upload, or publication was performed. The accepted moderated-submission scope is unchanged.

The read-failure fixtures replace query transport behavior only; they do not fabricate balances or usage history. The historical-context finding is reproduced through normal UI mutations and confirmed with a read-only API query. The 12 completed probes are targeted review evidence, not a clean acceptance claim.

This round is frozen with the two findings above. Implementation owners may now integrate the corrections, rebuild from source, and repeat complete reviews on the new frozen candidate. The two consecutive clean reviews required for this feature remain outstanding; this document must not be rewritten as a clean pass after the fixes.
