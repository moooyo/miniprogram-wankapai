# Held benefits and airport lounge lookup

## Scope and interaction design

The personal benefit inventory is separate from activity participation and recorded cashback. Wallet and Mine lead to the inventory and airport lookup while retaining the existing five tabs. Three secondary routes provide the inventory, benefit editor, and airport lookup. The source-linked prototype includes all three routes and their bound operations.

Each benefit records a fixed validity period, total uses, an initial historical used balance, and subsequent usage events. Remaining uses equal total minus historical used balance minus active usage events. Editing a quota is distinct from recording a visit. Usage reversal preserves its event, restores the balance once, and retains history. A new validity period is a new benefit record; no implicit reset rewrites earlier usage.

Transfer labels have three distinct meanings: explicitly permitted, grey/unclear, and prohibited. The grey choice is an unverified personal annotation, not official permission. Guest access is a separate lounge rule and never implies transfer permission.

Airport lookup searches personally registered airport names, codes and cities. Each result prioritizes an explicitly registered supported-bank list and its reservation/customer rules. It has no per-result usage or editing actions and does not display a personal balance. Recording, reversal, remaining uses and transfer notes belong to the held-benefit inventory. Multiple lounges attached to one benefit still share the same underlying balance. Airport results retain advance hours, customer/card/region restrictions, terminal and zone, guest conditions, opening hours, location, and source/check date. Missing bank lists remain unregistered and are never inferred from a held card, provider name, or free-text customer note. An empty search does not claim that an airport has no lounges.

The first release uses manual records. Seeded airports and lounges are explicitly fictional demonstration data. It does not claim a live bank balance, authoritative lounge directory, booking integration, or current eligibility verification.

## Visual and interaction guidance

The existing calm blue and white utility design is retained. The initial UI/UX Pro Max design-system query produced a generic marketing/demo layout with glass effects and handwritten fonts; it did not fit this native utility and was not applied. A narrower finance/mobile utility product query matched Banking/Traditional Finance and Personal Finance Tracker. Minimalism, legible counts, ordinary native controls, and accessible feedback fit the existing design. Focusable validation summaries and contextual count-status guidance were applied to the native platform's supported controls.

The new screens use visible labels, inline errors, 48px touch targets, text labels for all three transfer states, safe-area clearance, and wrapping rule descriptions. Long lounge forms use a scrollable sheet with field targeting. Unknown-result retries retain their exact payload; conflicting versions require rereading before a new decision. Error and retry states preserve entered information.

## Data and authorization

`entitlements` and `entitlement_usages` are private owner-scoped collections. The existing deny-by-default client rules apply to both. All reads and mutations go through the authenticated service. New collection/index definitions are listed in `infra/collections.json`; no cloud deployment was performed as part of implementation.

Mutations use the existing transaction, request ledger, expected-version and owner checks. A visit cannot make the balance negative, consume a foreign benefit, or reference another benefit's lounge. Date validation uses the server's current day and the saved validity period. Quota/date edits preserve the usage history. Archived records retain their ledger and can be restored.

Creating a benefit uses a persistent client intent. Retrying a lost response recovers the original result. Usage writes and reversals share the benefit resource identity in the client retry coordinator. Queries do not turn missing results into fresh writes.

## Original feature review loop

This feature has a separate review sequence from the completed 2026-09-23 application-wide loop. Each feature review covers all three new routes, their states and bound actions, wallet/Mine entry points, shared-sheet changes, prototype fidelity, data/API guarantees, demonstration migration, and infrastructure declarations. An actionable finding resets the consecutive-clean count.

| Round | Findings | Resolution |
| --- | --- | --- |
| [1](held-benefits-review-1.md) | Six: archived edit dead end, ambiguous picker names, inconsistent zero-hour wording, wrapped compact filter, non-lounge history placeholder, unresolved prototype button label | Fixed in source; exact-label and unresolved-template browser assertions added |
| [2](held-benefits-review-2.md) | Two: missing sheet control borders and a historical lounge name hidden after changing benefit type | Fixed by using the shared border token and preserving nonempty historical names independently of the current benefit type |
| [3](held-benefits-review-3.md) | No new actionable recommendation | Clean review 1 of 2 on the frozen candidate below |
| [4](held-benefits-review-4.md) | No new actionable recommendation | Independent clean review 2 of 2 on the same frozen candidate; exit condition satisfied |

The loop closed after round 4. Eight findings from rounds 1 and 2 were corrected, then rounds 3 and 4 found no new actionable recommendations against identical source and prototype identities. The independent runtime reviews included six flows with 13 visually inspected screenshots in round 3, and 15 flows with 18 visually inspected screenshots in round 4. These reviews supplement the automated suites below; they are not additional native-device acceptance.

The feature browser suite includes normal create/edit/save flows, usage and reversal, response loss after a real persisted write, explicit concurrent updates, archive/restore, airport restrictions, shared balances, lounge add/edit/remove, control-border inspection, and a normal type-change flow that retains historical lounge context. No bank or airport fixture is presented as a real service catalogue.

## Original verified candidate

The original delivered source candidate was built remotely on 2026-09-24. The later product-wide refinement and bank-first lookup are documented separately in [Product UX refinement](product-ux-refinement-20260924.md). The original candidate identities below remain historical evidence and do not certify a later revision. Generated Mini Program, bundled cloud functions, and portable prototype files are copied back into `dist/`; none is hand-edited locally.

| Check | Result |
| --- | --- |
| Full business/controller suite | 762 passed, zero failed |
| Type checking and source build | Passed; native package integrity registered 19 pages and three shared components |
| Complete browser regression | 184 passed, 297 screenshots, zero runtime exceptions |
| Held-benefit browser acceptance | 30 passed, 31 acceptance screenshots and 12 supplemental focused screenshots, zero runtime/console/HTTP errors |
| Source provenance | 162 source files; both browser runs retained the same start/end manifest |
| Prototype operation inventory | 367 bindings and 243 distinct source handlers across 19 pages and three shared components |
| Source manifest SHA-256 | `f6fc815d21fe03f0c9617ceae4449ee009a5cc5132e5c657de9ee38b99b820b4` |
| Prototype SHA-256 | `4fd8b399e8fda9eab98ffae1df4a9b066046ef25d76154e9c6a57a5c8f6ccfe4` |

Local generated evidence is available in [feature acceptance](../.qa-native/entitlements-20260924/r3/index.html), [complete browser regression](../.qa-native/entitlements-20260924/full-regression-r3/index.html), and the [business test log](../.qa-native/entitlements-20260924/r3/business-tests.log). These ignored artifacts include exact prototype snapshots and source manifests. The portable [current prototype](../dist/prototype/index.html) contains all 19 routes and their source bindings; an operation inventory is distinct from operations actually exercised by automation.

## Verification boundary

Executable checks run only through `ssh test-env`, using the task checkout at `/var/tmp/wankapai-entitlements-20260924` and disk-backed browser temporary/output directories. Business tests, the complete type/source build, browser prototype checks and visual inspection are distinct from current WeChat DevTools, physical-device, real cloud authorization or real notifications. No deployment, notification, experience upload or publishing is performed.
