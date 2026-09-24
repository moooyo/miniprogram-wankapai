# Held benefits review 3

## Result and scope

No new actionable recommendation was identified. This is clean review **1 of 2** for the held-benefit feature on the frozen revision below. Reviews 1 and 2 contained findings and do not count toward the consecutive clean-review requirement. The completed 24-round review of the existing product was not reopened.

This round reviewed all states and bound actions of the three new routes, their Wallet and Mine entry points, the API/domain contracts and command flow, demo initialization, private collection/index configuration, and source-generated prototype integration. It reused the previously loaded UI/UX Pro Max guidance for accessible controls, readable manual-rule states, preserved input, touch targets, safe areas, and small-screen layout. The accepted product scope and visual direction were retained.

No implementation source was changed by this reviewer. All executable verification ran through `ssh test-env`; local activity was limited to reading source, writing this document, copying generated evidence, and inspecting screenshots. No deployment, real notification, experience upload, or publishing action occurred.

## Frozen revision and evidence

The runtime review used `/var/tmp/wankapai-entitlements-20260924/dist/prototype/index.html`, after the integration owner confirmed the unified round-3 source/build freeze. The round-2 HTML was not used for this round.

| Property | Value |
| --- | --- |
| Prototype SHA-256 | `4fd8b399e8fda9eab98ffae1df4a9b066046ef25d76154e9c6a57a5c8f6ccfe4` |
| Generated HTML size | 1,140,143 bytes |
| Build timestamp | `2026-09-24 14:41:05 +0800` |
| Runtime checkout | `/var/tmp/wankapai-entitlements-20260924` |
| Browser temporary directory | `/var/tmp/wankapai-entitlements-browser` |
| Independent review helper | `/var/tmp/wankapai-held-review3.mjs` |
| Remote evidence | `/var/tmp/wankapai-held-review-3/review.json` and adjacent PNG files |
| Local evidence copy | `.qa-native/held-review-3-independent/` |

The helper checked the expected HTML digest before starting and again after all six browser flows. The digest remained unchanged. Every flow passed, and the browser reported zero page exceptions. Thirteen generated screenshots were opened and visually inspected. The screenshots include normal transient save toasts where actions followed each other quickly; these were not treated as persistent layout defects.

## Complete static review

| Area | Reviewed behavior and conclusion |
| --- | --- |
| Inventory | Initial load, failure/retry, retained stale data, current/all/archived scopes, category and name filters, empty states, manual quotas, validity/expiry/depletion, transfer labels, archive/restore, editor entry, and scoped airport entry. No additional issue was identified. |
| Usage and history sheets | Detail loading/retry, lounge selection, per-visit rules, quantity/date validation, remaining-balance preview, dirty dismissal, busy controls, uncertain-result retry, version-conflict refresh, history opening balances, reversal confirmation, archived history, and late-response guards. Inputs remain available for correction while mutation guards prevent writes from stale records. |
| Benefit editor | Initial read, archived/foreign record rejection, optional card relationship, type changes, total versus opening historical uses, fixed validity period, transfer notes, draft persistence/recovery, owner checks, field summaries, pending saves, conflict refresh, and safe return behavior. The source keeps a new validity period distinct from an automatic quota reset. |
| Lounge editor | Add/edit/cancel/remove, required airport and lounge names, code normalization, zone, unknown/required/unneeded reservation, advance hours, restricted customer notes, guest rules, per-visit deduction, source and verification date, advanced fields, error targeting, leave warning, and explicit commitment into the parent draft. |
| Airport lookup | Name/code/city matching, terminal and zone filters, benefit scoping, reset actions, shared quota, insufficient/expired states, reservation and customer rules, transfer qualification, and empty results that do not claim a complete airport directory. Record-use navigation still opens a reviewable form. |
| Wallet and Mine | Both entry surfaces retain the existing five native tabs and lead to registered secondary routes. New personal-record actions do not depend on the demo moderator selector. |
| Domain and API | Owner-scoped reads and linked cards, mandatory expected versions, integer balances, actual-date validation, lounge membership/cost checks, atomic usage/reversal/audit/request-ledger changes, fixed-period history protection, archive/restore, stable creation intent, and shared benefit resource identity for usage and reversal retries. No guarantee was weakened by the UI corrections. |
| Demo and infrastructure | Fictional airport/lounge records remain explicitly identified. Existing stored personal entries are not reseeded when the collection exists. Private collections, owner indexes, expiry/history ordering, and deny-by-default client rules match the query paths. No live cloud configuration was modified. |
| Prototype | The three pages are generated from native source, registered in the atlas/journeys, and included in the dynamic 19-page count. The new editor participates in existing form-loading and departure behavior. No parallel business implementation was introduced. |

## Independent runtime flows

The browser used fresh isolated contexts, `zh-CN`, the `Asia/Shanghai` timezone, and reduced-motion preference. Normal UI controls drove the action paths. Read-only queries inspected resulting records. One explicit query-failure fixture was used to test stale-list recovery; it did not fabricate or alter business balances.

| Flow | Viewport | Observed result |
| --- | --- | --- |
| Wallet/Mine entries and archive/restore | 375 x 812 | Wallet opens the inventory; archived benefits expose no edit action; restoration restores editing; Mine opens airport lookup. |
| Editor fields, lounge borders, labels, and zero-hour rules | 375 x 812 | Invalid submission exposes the field summary; picker names identify their purposes; lounge inputs, textareas, and selector surfaces compute to a `1px solid rgb(152, 168, 190)` border; required local-bank details are enforced; zero advance hours retains the documented unknown-duration meaning after save. |
| Historical lounge name through category conversion | 375 x 812 | Record a real demonstration lounge visit, remove both current lounge rules through the editor, change the benefit to another category, save, and reopen history. The original lounge name remains visible before and after reversal; reversal restores the shared balance once. A fresh health-check record has no unrelated lounge placeholder. |
| Compact portrait layout and lookup filters | 320 x 720 | The shortened all-category label remains on one line with its peer controls; airport/code, terminal, and region filters match the correct entry; clearing restores results; an empty query retains the incomplete-directory explanation; no horizontal control overflow was measured. |
| Landscape layout and lounge sheet | 768 x 375 | Inventory, filters, lookup, and the scrollable lounge sheet stay within the device content width. Sheet controls retain visible boundaries and reachable scroll content. |
| Failed refresh, recovery, and invalid use | 375 x 812 | A failed inventory refresh retains the prior rows and disables record-use actions. Successful retry restores freshness. An overdrawn quantity cannot change the ledger, and cancelling the discard prompt retains the entered quantity. |

## Prior findings rechecked

Round 1 corrections remain consistent: archived editing is hidden and guarded, picker names include field purpose, the all-category label fits at 320px, non-lounge history omits the unrelated fallback, zero-hour help agrees with lookup semantics, and the new-lounge confirmation label resolves to its exact intended text rather than exposing interpolation.

Both round 2 corrections were independently exercised:

- Lounge sheet form controls now reference the global `--control-border` token. Their computed borders remain present even though the sheet is outside the editor wrapper.
- A saved historical `loungeName` remains visible after the current benefit category changes. The `item.loungeName || selected.kind === 'lounge'` condition also preserves the fallback for lounge records that genuinely have no selected lounge. Normal health-check history remains free of that fallback.

## Boundaries

This clean review records complete static coverage plus the six independent actual-UI paths above. The integration owner's complete business suite, full type/source build, 30-case feature acceptance, and full existing-product browser regression remain separately recorded runs; this document does not substitute these six flows for those suites.

Browser projection demonstrates behavior of the source-generated review application and its persisted demo service. It does not certify WeChat Developer Tools rendering, physical-device interaction, native screen-reader behavior, deployed cloud ownership configuration, or actual airport admission rules. A second complete clean review of this same frozen revision is still required.
