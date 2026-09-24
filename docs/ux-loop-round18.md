# Complete UI/UX review: round 18

## Result and method

Round 18 confirmed one new actionable P2 finding in the existing-participation Receipt save flow. The consecutive clean-review count remains **0**. This is a complete findings round. A later correction or passing regression does not retrospectively make it clean.

The team freshly read all 16 routes across their 64 TS/WXML/WXSS/JSON files, all three components across their 12 files, every binding and supported state, all nine client services, all eight domain source files, shared contracts/catalog, application configuration/styles, all five prototype files, the native source builder/package checker, and the complete formal acceptance script. The lead reviewer covered six primary/detail routes, components, services, configuration/build and the finding's source chain; independent read-only reviewers covered seven management routes, Progress/Receipt/History plus domain/contracts, and the prototype. An independent reviewer continuously read the 7,371-line formal script, including 48 route-matrix cases and 114 further cases. This was a fresh complete pass, not only a check of prior fixes.

UI/UX Pro Max's skill, all ten quick-reference categories, its professional checklist, the interaction contract and round 17's complete record guided the review. Findings require a supported path and a concrete visible effect. The review does not demand a new feature, subjective restyling, dark theme, chart, or hypothetical operating-system behavior.

No local executable tests, builds, smoke tests, validation suites or runtime probes were run. Local work consisted of source/document reads and inspection of remote evidence. The reviewer did not change product source. All executable acceptance and the focused proof ran through `ssh test-env`; no deployment, real notification, WeChat account authorization, experience upload or publication occurred.

## Frozen incoming candidate

The main task declared the complete source frozen after the Card billing-target recovery fix. It reported successful full type checking, **680/680 business/controller tests**, and the source build including integrity checks for all **23 native modules**.

The final `.qa-native/prototype/candidate-r17/report.json` identifies the same HTML as the focused `incoming-r17` proof:

| Evidence | Frozen value |
| --- | --- |
| Prototype HTML SHA-256 | `fe7b07b9dd4c9897068ff07fd245bf16ec5b9f2ea49a79c43d7a28dced5dabac` |
| Source fingerprint | `ba859ad95962782914fd708abc4354e1fa13d476d4672bc4b09504bd9165c7dd` |
| Source scope | 147 files; unchanged during the run and artifact recovery |
| Browser result | 162 passed, 0 failed, 0 captured runtime exceptions |
| Browser evidence | 246 screenshots; 108 source handlers exercised through UI |
| Generated inventory | 16 routes, 3 components, 272 bindings, 193 unique handlers |
| Original run completion | `2026-09-22T22:28:08.027Z` |
| Final report SHA-256 | `d429d7c34abd10dee5961e18b704eb9def1e0d487dc479f23bcc0f0a86bf437f` |

The provenance scope includes `miniprogram`, `domain`, `shared`, `cloudfunctions`, `prototype`, `scripts`, package files and TypeScript configuration. Dependencies, generated output, QA evidence, Git internals, documentation and tests are excluded. Binding inventory and representative handler execution are not exhaustive execution of every conditional branch.

The report transparently retains an artifact-only retry. After the 162 scenarios completed, Chromium failed to capture a contact-sheet page. Fresh remote Chromium pages reconstructed the three contact sheets from the exact existing 48 route screenshots. `artifactRetry` preserves the previous fatal diagnostic and original report, states `businessCasesRerun: false`, lists every input screenshot and new contact-sheet digest, and confirms unchanged source before and after. This is not an unreported passing rerun or a product runtime failure.

The lead reviewed that retry record, the report's summary, scenarios, diagnostics, provenance and limitations, the current Card recovery measurements, and all four current global images: `contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png`, and `workbench-overview.png`. The images show readable ordinary page hierarchy, narrow/landscape controls, five native-style tabs, fixed-action clearance, explicit demo disclosure and the connected flow workbench. They yielded no additional concrete visual recommendation. The only recorded HTTP/console resource error is the unprovided `favicon.ico`, not a page asset.

`candidate-r17/wcsc/frozen-source-match.json` explicitly reuses the historical round 16 scoped compiler diagnostics after all four App Sheet source hashes match this current fingerprint. It says the compiler was not rerun for round 17. The recorded official package is `miniprogram-compiler@0.2.3`, with historical WCSC `v0.4me_20190328_db`; this evidence is not a modern WeChat compilation or physical-device claim. Older candidate-r16 browser results are not substituted for the current report.

## Confirmed finding

### R18-01 — P2: Hold a stable submission while the receipt save checks today's date

Source mechanism at discovery: `miniprogram/pages/receipt/index.ts:508` awaits `refreshDateRange()` for an existing participation before parsing the amount. The refresh sets `dateRefreshing`, but leaves `busy` false. The amount field and `onAmountInput()` do not block ordinary date refresh, allowing edits during that wait. Once the response arrives, the same Save continuation parses the newly edited value, issues the receipt command, and returns. The new-creation preflight already has an operation lock; this existing-record save path does not acquire equivalent ownership until after the date read and validation.

This is not a recommendation to disable all editing whenever date information refreshes. Ordinary foreground date refresh is intentionally a read-only background operation and can preserve an editable amount. The issue is specifically the continuation of an already initiated Save using input entered after that submission began.

Remote proof: `.qa-native/prototype/r18-before/r18-receipt-save-date-repro.json` uses the fixed incoming HTML, actual Receipt controls and real demo API/domain records. It delays delivery of one unmodified real `session.get` response; it does not replace a business handler, inject a storage value, or change a domain result. The user enters CNY 18 and clicks Save once. While that request waits, the actual UI has:

- `dateRefreshing: true`, `busy: false`;
- a disabled Save button with loading indication and the date-checking label;
- visible date-check progress text and a disabled date picker;
- an amount input which remains enabled.

The user then edits the amount to 23 through the visible field. Releasing the date response results in exactly one `reward.confirm` command, with `amountMinor: 2300`, and a real reward ledger amount of 2300. The trace records one Save click whose amount was 18. Reopening the saved record shows 23.00. The lead inspected the held-at-18, edited-to-23 and persisted-23 screenshots as well as the command, click and ledger traces.

The control case triggers only the source-host foreground date refresh, makes the same amount edit while the date response waits, and releases it without a Save click. The editor retains 23 as an unsaved draft, dispatches zero commands, and leaves the reward ledger unchanged. The proof records two completed cases and zero runtime exceptions. The control's host lifecycle callbacks are simulated, not physical operating-system foreground gestures.

The visible progress and disabled Save state are material and are not omitted from the finding. This is not a no-feedback defect, a save without any user request, or demonstrated data loss. Its visible consequence is an inconsistent submission boundary: a form that appears to be completing a save can still accept a later edit and commit it without another submission decision. A response arriving mid-edit can likewise capture an intermediate valid amount.

Recommendation: Make the explicit Save operation own the editable values across its date preflight and command, with consistent input, duplicate-submit and page-return behavior. Release that ownership on date-read failure or validation failure while retaining entered values. Preserve ordinary foreground/midnight date refresh as a nonwriting operation that can keep amount editing available. Do not weaken authoritative date, ownership, period, version or idempotency checks.

Acceptance: Delay the real date read after one existing-record Save; attempts to edit, submit again, or use the page Return control must not change the intended submission or start another one. Verify failed date reads release the lock and retain input, successful saves use the intended amount/date, version conflicts still preserve the draft, and an ordinary foreground date refresh allows editing while issuing zero writes. Cover both cashback and discount copy and preserve exact participation/period and actual receipt-month attribution.

## Complete route checklist

Each route pass includes all four source files, every event binding, and applicable initial/loading/refreshing/empty/error/success/busy/read-only/permission/draft/conflict/navigation states.

| Route | Fresh full-scope review | Round 18 result |
| --- | --- | --- |
| `pages/todo/index` | Stage/deadline filters and groups, primary/detail/progress/complete/receipt, More, skip/resume/undo, history/bill/discovery links, retained refresh and stale locks | No independent finding |
| `pages/activities/index` | Bank rail/search/sheet, held-card label/control, reset, subscription, sharing/detail, retained windows and paging/read recovery | No independent finding |
| `pages/rewards/index` | Recorded/pending, month/currency scope, separate amounts/counts, actual-month attribution, confirmation/correction/detail, refresh/pagination/empty/error | No independent finding |
| `pages/wallet/index` | Cards and names, independent/shared/archive groups, expansion, payment/undo/dates, reminder eligibility/preferences, matched activities, late reads and refresh locks | No independent finding |
| `pages/mine/index` | Attention queries, every menu, privacy explanation, operator entry, explicit demo role, loading/error and sequencing | No independent finding |
| `pages/detail/index` | Owned exact participation/snapshot, notification links, matching card selection/preparation/cancel, all sheets and dirty dates, progress/receipt/revoke/tracking, galleries, reminders/history/entrances, current-page warning/feedback | No independent finding |
| `pages/progress/index` | Progress/registration, validation/focus, draft recovery/leave, latest comparison/reapply, busy/read-only and safe return | No independent finding |
| `pages/receipt/index` | Amount/date/actual month, exact targets, first-write assertions, ordinary/pending/legacy recovery, pure lookup, versions, initial/resume/midnight date freshness, explicit Save and return | R18-01 |
| `pages/history/index` | Global/activity scope, filters/detail, retained pagination/retry, audit identity/loading/error/close, operation descriptions | No independent finding |
| `pages/card-edit/index` | Identity/nickname, repayment/shared choices, actual date versus rules, draft/intent/lookup types, exact period/target, same-period recovery, errors/confirmation, save/remove and late effects | No independent finding; R17 correction confirmed |
| `pages/submissions/index` | New lead/full routes, status/reason disclosure, account verification, hidden cached rows, pagination/retry and obsolete reads | No independent finding |
| `pages/submission-lead/index` | Source alternatives, required fields, images/consent/cancel/upload/preview/removal, creation identity, drafts/conflicts, full continuation, submit/update and ownership | No independent finding |
| `pages/submission-edit/index` | Four sections and conditional inputs, error links, source/gallery identity, date/period rules, pending creation and drafts, moderation, completion navigation | No independent finding |
| `pages/review/index` | Permission/status states, private-content verification, loading/error/retry, paging, submission entry, account/role changes | No independent finding |
| `pages/preferences/index` | Four switches, ready/loading/error, dirty/saved feedback, foreground leave-warning ownership, disposed responses and return | No independent finding |
| `pages/web-entry/index` | Shared URL eligibility/normalization, missing/restricted/approved states, loading/error/retry, source/copy and fallback return | No independent finding |

## Components, services, domain and build

All three components were freshly read in full. App Sheet uses the supported title class, adaptive header/content measurement, revision guards, bounded scrolling, dismissal/busy ownership and native-tab lifecycle. Privacy Gate preserves observer, foreground, policy and consent/refusal semantics. Demo Notice remains explicit. No additional independent component issue was found.

All nine services were reread: API, benefit wording, card identity, demo initialization/persistence, entrance decisions, draft storage, formatting, navigation and privacy. The review covered immutable payloads, canonical creation/consent intent identity, read-only replay isolation, uncertain-result retirement, wallet/month dependency observations, image selection/URL identity and stale-preview gates, owner/entity/revision draft cleanup, safe returns, Chinese status/date/currency copy, and production/demo separation.

All eight domain files and shared contracts/catalog were reread, including store/transaction behavior. Owned lookup, card/user scope, period snapshots, actual receipt date, expected period/version, first-create absence, exact billing target, request fingerprints, rollback, finite reminder grants and eligibility remain intact. R18-01 does not propose changing these business rules.

The R17 same-period billing-target correction now uses matching account, bill and period identities for both validation and visibility of recovery. It offers the instructed reread, preserves the draft, and requires explicit date review before the new target is used. Current successful and failed-read browser cases accompany source/controller tests. Valid history corrections, rule-only edits, deliberate independent-account splitting, and pending/legacy replay retain their separate behavior.

The native builder and package checker were read in full, along with app/package/TypeScript configuration. Shared API/privacy/configuration imports, one demo runtime, injected page components, declared route artifacts and registration-only module checks remain explicit. Native package integrity is not native rendering or cloud integration acceptance.

## Prototype, formal script and ten-category review

The complete fresh prototype pass includes `scripts/prototype-build.mjs`, `prototype/runtime.js` (1,133 lines at this checkpoint), HTML, workbench CSS and README. Reviewers crosschecked all source WXML bindings and current tag/event/key families. Covered behavior includes expression/condition/loop conversion, native-selector and viewport projection, embedded assets, original controllers/domain reuse, explicit demo configuration, route parameters/lifetimes, focus/scroll/input restoration, sheet/platform-dialog ownership, Chinese composition, storage/reset, gallery identity, action location, role/scenario claims, read-only result lookup and fault/refresh ownership. No new independent prototype mechanism was confirmed.

The formal 7,371-line acceptance script was independently read continuously through its 162 cases, fixtures, assertions, cleanup, provenance and output steps. No assertion-integrity issue was identified. Its calibrated Chromium composition cases do not establish every possible operating-system IME behavior. The artifact recovery described above preserves original business-case evidence rather than changing it.

All ten UI/UX Pro Max categories were considered: accessibility, touch/interaction, performance, style consistency, responsive layout, typography/color, animation, forms/feedback, navigation and data presentation. The single finding concerns a supported save-state interaction. Other categories produced no additional concrete recommendation within this product: semantic labels/state cues, comfortable controls, loading/retry feedback, retained and paginated content, consistent blue/white hierarchy, wrapping/safe areas, readable type and distinct currencies, stable/reduced motion and predictable navigation remain in the reviewed scope. New charts, a dark theme or unmeasured native behavior were not treated as missing requirements.

## Closure and next gate

The complete source review, current consolidated report/provenance, four global images, focused Save/control proof and their visible-state evidence are closed. There is one confirmed new recommendation and no additional finding from the final evidence pass. The main task accepted R18-01 and assigned its correction. The old 160-case candidate is not called current acceptance, and the passing 162-case baseline does not override the separate focused proof.

After the correction, reread affected source and run the relevant remote regression plus full type/business/build checks, then generate a new source-linked candidate. That targeted closure is not another clean round. Start a fresh complete review on the corrected stable source; the loop ends only after two consecutive full reviews of that same candidate find no new actionable recommendation. Round 18 remains at clean count **0**.

Moderated public submissions remain in scope. No transaction, ownership, actual-date attribution, period snapshot, version or idempotency guarantee was weakened. Physical WeChat rendering, keyboard/screen-reader/system-text behavior, real privacy/image authorization, external mini-program/web-view navigation, cloud account configuration and actual notification delivery remain separately disclosed integration boundaries.
