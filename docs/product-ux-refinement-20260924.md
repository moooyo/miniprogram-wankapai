# Product UX refinement: lookup, holdings, and next actions

## Product intent

This refinement responds to the request to reconsider the complete UI/UX, starting with airport lookup. Lookup answers where a lounge is, which banks are registered as supported, and what admission conditions apply. Recording personal consumption belongs to the held-benefit inventory. A manually registered bank does not establish that every card or customer of that bank qualifies.

The native blue-and-white design, five tabs, Chinese interface, moderated public submissions, and transaction, ownership, date, snapshot, and idempotency guarantees remain in scope. UI/UX Pro Max and frontend-design guidance informed information hierarchy, compact secondary content, explicit next actions and progressive disclosure. Earlier review reports retain their original historical results.

## Complete page review

| Page or area | Decision |
| --- | --- |
| Todo | Retain deadline-led actions and filters; distinguish historical/cross-year periods and show exact period/deadline in More. |
| Activities | Retain bank selection, matching-card filter, discovery and moderated lead entry. |
| Detail | Place existing participation before the bank entrance; show one stage-specific primary action and More. Keep guarded direct completion/receipt; explain why expired cutoff reminders are unavailable. |
| Progress and receipt | Retain focused fields, drafts, date checks and conflict recovery. |
| Rewards | Keep month/currency and total visible; omit empty breakdowns and list headings. Offer pending records or activity discovery directly in the empty state. |
| Wallet | Retain card and bill identity, with holdings and airport shortcuts. Archived independent accounts keep their names and disambiguating owned-card metadata. |
| Card editor | Present a single issuer as a compact bank annotation; multiple issuers retain the picker. Unknown creation results retain an immutable original request and lock edits until recovery. |
| History | Lead with scope and records; disclose explanatory copy and align secondary metadata with the audit action. |
| Mine | Prioritize history, submission status and reminders. Keep holdings and airport lookup in a compact tool area. |
| Preferences | Keep Save visible in a bottom dock with dirty/saved feedback. Disclose the detailed notification process on request. |
| Submission lead | Clarify that bank, title and one source suffice; retain source inputs. An uncertain creation locks its original payload and restores the same retry intent. |
| Full submission, submissions and review | Retain status, reasons, drafts, sources, moderation and versions. Resolve an uncertain creation before allowing a different payload; retain legacy edited drafts against the resolved original record. |
| Web entry | Retain entry fallback, error recovery and predictable return. |
| Held benefits | Put remaining uses beside identity; keep validity and transfer state visible. Disclose notes and maintenance. History, usage and archived restoration remain direct actions. |
| Benefit and lounge editor | Add independent supported-bank lists per lounge. Preserve reservation, customer, guest and source fields. |
| Airport lookup | Replace personal quotas and mutation actions with supported banks, admission rules and practical information. Keep unknown banks explicit without inferring them from cards or providers. |
| Shared components | Retain sheet focus/scroll and privacy behavior. Generalize the compact demo banner to cover current records and remove the duplicate inventory warning. |

See [Navigation refinement](product-ux-navigation-refinement.md) and [Management refinement](product-ux-management-refinement.md) for the detailed changes and tradeoffs.

## Supported-bank data and compatibility

`LoungeAccess.supportedBanks` is optional for backward compatibility. A save validates at most 30 nonempty names, each at most 120 characters, trims names and removes duplicates. The editor accepts one bank per line and common list separators. Missing or intentionally empty lists remain unregistered. Service providers, card associations and customer notes are never converted into support claims.

Old pending drafts retain their exact payload and intent. Missing arrays are not injected during draft restoration, so the original request fingerprint remains usable. Bank text is normalized only when committing a lounge edit or validating a real save.

Fresh demonstration lounges explicitly name the fictional example bank. Legacy-demo annotation requires the original seed request, matching owner/provider/creation time, and an exact match for every original lounge field. It never replaces an existing bank property, including an empty array. Custom data, balances, versions, usage history and prior request fingerprints remain unchanged.

## Verification and review

| Review | Result and follow-up |
| --- | --- |
| [1](product-ux-review-1.md) | One P2: Mine tool titles and descriptions inherited a horizontal layout. Explicit vertical stacking corrected it. |
| [2](product-ux-review-2.md) | Three P2s: unknown submission results could produce duplicate creations after edits; cross-year Todo entries lacked visible period identity; archived independent bills lost their names. Each finding has a targeted source correction and regression coverage. |
| [3](product-ux-review-3.md) | One P2: changing a new card's nickname after an unknown save result could create a second card. The review also checked all other creation endpoints; their protected retry paths passed. |
| [4](product-ux-review-4.md) | No new actionable recommendation; clean review 1 of 2 on the corrected application and prototype. |
| [5](product-ux-review-5.md) | No new actionable recommendation; clean review 2 of 2 after independent source, interaction and visual review of the same application and prototype. |

The loop closed after review 5. Reviews 4 and 5 each completely reviewed all 19 pages and independently found no new actionable recommendation on the same application source and generated prototype. Review 4 includes 37 actual UI paths and five configured reminder service/worker cases. Review 5 includes 28 actual UI paths, 11 creation/recovery paths and five reminder groups, with all 40 main screenshots visually inspected. Their source-manifest difference is confined to the QA probe correction documented below. Findings rounds and historical held-benefit/original-product reviews do not count toward this two-consecutive-clean-review result.

### Corrections before the final freeze

Preparation for the next frozen review identified a finite accessibility batch: ten full-submission pickers, two bill-date picker templates, and the demo-role picker needed field-specific accessible names. Both empty activity dates now have distinct names; bill dates include the human-readable account and billing period. History includes its already-available bank name in the visible record title, so identical activity names at different banks remain distinguishable without relying on logos.

Configured in-memory service/worker checks also established that expired deadline and repayment targets could previously accept authorization while no future job could be created for those dates. Authorization and UI eligibility now reject those targets. Current-day and future targets remain eligible for advance authorization; overdue expected-reward dates remain eligible under the existing worker rules. The worker sending window and original request-ledger replay are unchanged, and no real notification was sent.

The card correction preserves the complete original creation signature and intent. Pending fields are locked; reopening uses the existing explicit recovery dialog. Choosing to discard retains the explicit warning that discarding a local draft does not cancel an already dispatched operation. Legacy later input, including hidden repayment-offset and reminder-day changes, is retained; identity mismatches cannot silently become another creation. Old cross-period lookup-only and explicit billing-rebase protections remain intact.

These preparation checks were not counted as complete clean reviews. Subsequent clean reviews inspect the corrected frozen revision and its current generated prototype in full.

All executable verification runs on `ssh test-env`. Existing acceptance cases use real visible controls in their new locations; ownership, date, receipt, version, pending-result and balance assertions remain intact. Additional UI checks cover action phases, direct recording from More, empty rewards, fixed settings controls, issuer disclosure, account tools, supported-bank persistence and inventory disclosure.

### Final implementation acceptance

| Check | Final result | Evidence |
| --- | --- | --- |
| Complete business/controller suite | 895 passed, 0 failed, 0 skipped | [Test log](../.qa-native/product-ux-20260924/business-tests-freeze.log) |
| Complete TypeScript check | Passed | `npm run typecheck` on the remote frozen candidate |
| Source and prototype builds | Passed | `scripts/build.mjs` and `scripts/prototype-build.mjs` on the remote frozen candidate |
| Native package integrity | Passed: 19 pages and 3 components | Remote CommonJS dependency and page/component registration check |
| Complete browser acceptance | 199 passed, 0 failed, 0 runtime exceptions; 329 screenshots | [HTML report](../.qa-native/product-ux-20260924/regression-freeze-final/index.html), [JSON results](../.qa-native/product-ux-20260924/regression-freeze-final/report.json) |
| Held-benefit acceptance | 31 passed, 0 failed; 0 runtime, console or HTTP errors; 34 formal and 15 supplemental screenshots | [HTML report](../.qa-native/product-ux-20260924/entitlements-freeze/index.html), [JSON results](../.qa-native/product-ux-20260924/entitlements-freeze/report.json), [supplemental capture metadata](../.qa-native/product-ux-20260924/entitlements-freeze/supplemental/metadata.json) |

The final prototype contains all 19 routes, 3 shared components, 371 source event bindings and 244 distinct source handlers. The complete automated browser suite exercised 131 distinct source handlers; the source inventory is not a claim that every handler was automatically executed. The full browser report records one default `favicon.ico` HTTP 404 and its corresponding console entry; it records no native UI asset failure or runtime exception. The feature suite recorded no console or HTTP errors.

Browser captures cover 320 x 720, 375 x 812 and 768 x 375, with the desktop workbench available in the portable [interactive prototype](../dist/prototype/index.html). The screenshot sets and independent review reports record visual inspection separately from automated assertions.

### Candidate identity

| Artifact | SHA-256 |
| --- | --- |
| Final generated `dist/prototype/index.html` | `50c792ad4f01b5e58f2dffa8f8a309c2b7ca59af26afabf6135f8278ba8043df` |
| Final application-and-tooling source manifest, 162 files | `a5f87df5d00601cc1fd3522cd701f2b3841f8ab4db951ae6a621501bcb9edb8a` |
| Review 4 and held-benefit-suite manifest, 162 files | `aeb1d8796089f14122adb4b75049b64ef4f449649a7dbec9ed67db1666209b98` |

The manifests include `miniprogram`, `domain`, `shared`, `cloudfunctions`, `prototype`, `scripts` and the package/type configuration files. They exclude generated output, dependencies, tests, documentation and evidence folders. The two manifest digests differ only in `scripts/acceptance-prototype.mjs`: a disabled-input probe now scrolls the intended input into view and verifies the hit target before a raw click. Previously the fixed Save dock could intercept that probe. This corrects the test's target and preserves its duplicate-prevention assertions; it makes no application change. The other 161 files and generated HTML are identical. The [per-file difference](../.qa-native/product-ux-20260924/regression-freeze-final/qa-only-source-diff.txt) records that distinction explicitly. The final full browser run passed all 199 cases after the probe correction.

Generated artifacts come from `scripts/build.mjs` and `scripts/prototype-build.mjs`. Local `dist/` is copied from the remote build. Browser projection and demo-service evidence do not certify WeChat DevTools, physical devices, native screen readers, real bank admission, deployed cloud configuration or publishing.
