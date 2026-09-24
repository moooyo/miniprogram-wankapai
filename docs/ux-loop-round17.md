# Complete UI/UX review: round 17

## Result and method

Round 17 confirmed one new actionable P2 finding in Card Edit's ordinary-draft recovery. The consecutive clean-review count remains **0**. The complete source pass, final consolidated browser results, source provenance, four global images and focused two-client proof have been reviewed. This findings round is sealed against the incoming frozen round 16 candidate. Corrections made after this finding cannot retroactively make the round clean.

The review team freshly read all 16 native routes across their 64 TS/WXML/WXSS/JSON files, all three components across their 12 files, all nine client services, all eight domain files, shared contracts and catalog, global application configuration and styling, the native source builder/package checker, and all five prototype files. Every route pass included its bindings and supported loading, empty, error, success, busy, read-only, permission, draft, conflict and navigation states. The prototype pass began only after the final composition runtime and README were frozen. An independent reviewer read the final 7,171-line acceptance script continuously in full, covering its 48 route-matrix cases and 112 further cases. This review is not limited to prior findings.

The UI/UX Pro Max skill, all ten quick-reference categories, its professional checklist, the interaction-design contract, and the round 15/16 records guide the review. Reviewers use concrete supported interactions and visible effects. They do not add features, a new visual direction, a dark theme, charts, or hypothetical operating-system behavior to manufacture findings.

All executable verification was performed through `ssh test-env` by the assigned verification owners. This reviewer performed only source/document reads, documentation edits, and inspection of remotely generated evidence. No cloud deployment, real notification, WeChat authorization, experience upload or publication was performed.

## Incoming candidate and evidence boundaries

The fixed incoming round 16 HTML has SHA-256 `e797bdb5e72a785fa11dcbca5996cf7d29ecf48927904bb216eeaec22cf41653`. The independent Card proof uses that artifact. The root reports a successful final source type check, **672/672** complete business tests with no skips, and a complete source build whose native package checker passed all **23 modules**. An initial test-harness omission of `getCurrentPages` was corrected before the full passing rerun; no product assertion was relaxed.

The final `.qa-native/prototype/candidate-r16/report.json` identifies the same HTML and finished at `2026-09-22T22:11:16.806Z`:

| Evidence | Frozen value |
| --- | --- |
| Browser result | 160 passed, 0 failed, 0 captured runtime exceptions |
| Browser coverage | 239 screenshots; 106 source handlers exercised through UI |
| Generated inventory | 16 routes, 3 components, 272 bindings, 193 unique handlers |
| Source fingerprint | `9d646f6701b23da6ddd4a362e303cf86d2ff571f04edf6a365165ada24a3d139` |
| Source scope | 147 files; unchanged during the run |
| Report SHA-256 | `5454ac6b7737595f27c9a74b29fb057c64a78993ae2066eb3bf49fafc8fcd4a1` |
| Browser/runtime | Chromium `153.0.8010.12`, Node `v20.19.2`, Linux |

The source manifest covers application, domain, shared, cloud-function, prototype and script files plus package/TypeScript configuration. Generated output, QA artifacts, dependencies, documentation and tests are excluded. The lead reviewed every scenario result, diagnostics, environment, limitations, source provenance and detailed composition-phase measurements. The sole recorded HTTP/console resource error is the unprovided `favicon.ico`; no page-asset failure is reported. Binding inventory and representative handler execution are distinct from exhaustive execution of every conditional branch.

The lead inspected all four current global images: `contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png`, and `workbench-overview.png`. They show the 16-route atlas, narrow and landscape layouts, explicit demo mode, readable form/action hierarchy, fixed-action clearance, and the connected activity/card/submission/settings flows. No additional concrete visual recommendation arose from this fresh image pass. Their ordinary-state views do not contradict the different two-client path in R17-01.

The final `wcsc/frozen-source-match.json` matches all four App Sheet source hashes to this same 147-file fingerprint and records three scoped compiler runs without the old invalid-selector diagnostic. It uses the previously identified official `miniprogram-compiler@0.2.3` WCSC `v0.4me_20190328_db`; it is not a modern compiler or device-rendering claim. The two final Detail lifecycle cases and four calibrated browser-composition cases pass in the same consolidated run.

Old candidate-r15 evidence is contextual only and is not promoted to current acceptance. Source changes that implement this round's finding belong to the next candidate and cannot inherit the incoming artifact's pass status. This review was complete on the frozen source before the scoped Card fix was started; it does not mix that later implementation into the incoming-source conclusion.

## Confirmed finding

### R17-01 — P2: Expose the recovery action requested for an obsolete bill target

Source mechanism at discovery: `miniprogram/pages/card-edit/index.ts:208` restores a structurally valid ordinary draft's original `billingTarget`. This correctly preserves its exact bill identity rather than silently retargeting an intended date correction. However, `updateBillingContext()` at line 267 considers the target existing whenever the current card has a reusable independent account and the draft has any bill ID. It does not verify that those identities match. The visibility condition at line 277 also depends on a previous period when no server conflict has occurred. Meanwhile, validation at line 533 recognizes the stale account/bill relationship and directs the user to update to the current billing period. The sole visible `rebaseBillingPeriod` control is gated by `periodRebaseNeeded` in `index.wxml:31`.

The supported transition is within the same billing period. Client A modifies the actual due date while the card uses independent account X and retains an ordinary editing draft. Client B normally links the card to a shared account Y which has another member, then normally selects independent billing again. `domain/wallet.ts:160` correctly creates a new independent account Z because Y cannot be reused exclusively. When A reloads the card and explicitly restores its draft, the current account is Z but the preserved target is X. The old nonempty bill ID and unchanged period hide the rebase action even though the date validator requires it.

Independent remote proof used two real browser pages sharing one browser context and the same demo owner. A's draft was written through the visible date field and normal leave/recovery flow; B's two relationship changes used the normal `card.save` API. The proof did not inject a storage draft or seed, invoke the hidden recovery handler, or bypass the domain transition. On A's visible Save action, the page reports that the original bill target is unavailable and asks for the current period to be rechecked. `periodRebaseNeeded` is false, the rendered recovery-button count is zero, and the save issues no command. The retained original and current targets both belong to September 2026.

The probe also establishes the limit: this is **not a permanent inability to save**. A user can switch the visible billing picker to shared Y and back to independent billing. That workaround retains the desired September 28 date, resets the target to Z, and permits a normal Save. Only Z's bill date changes; X's original bill remains unchanged. The error is an unavailable instructed recovery path, not duplicate creation, incorrect ledger mutation, unannounced data loss, or a broken ownership guard.

Evidence is `.qa-native/prototype/r17-before/r17-card-billing-target-report.json` and its three screenshots. The lead reviewer read the full before/after record, commands, saved drafts, recovery state and ledger comparison and inspected all three images. The error image visibly requests a current-period update without presenting that action. The independent run reports zero runtime exceptions; its sole console resource error identifies the unprovided `favicon.ico`, not a page asset.

Recommendation: Determine target validity from the current account, bill and period identities, and expose the existing explicit reload/rebase action when an ordinary editable draft's bill target is obsolete, including within the current month. Preserve its entered values, obtain the current owned account/bill, and require the user to review the actual date before applying it. Do not silently redirect the date correction, weaken exact-target validation, or alter pending/legacy creation replay behavior.

Acceptance: Reproduce the normal two-client X-to-Y-to-Z workflow, restore the ordinary same-period draft, reach the visible recovery action, retain the date, confirm the replacement target, and save only the intended current bill. Include read/identity failures during rebase, historical targets that remain valid, existing period-conflict recovery, and pending/legacy creation lookup controls. Preserve the old bill, period assertions, ownership and idempotency guarantees.

## Complete native route checklist

Each row covers the complete controller, markup, stylesheet and page configuration, all bindings and all applicable alternate states, rather than only the named previous regression.

| Route | Fresh scope | Round 17 result |
| --- | --- | --- |
| `pages/todo/index` | Stage/deadline filters, next action, detail/progress/completion/receipt, More, skip/resume/undo, history, bills and discovery links, stale/busy locks | No independent finding |
| `pages/activities/index` | Bank/search/filter sheets, held-card control and label, subscription, sharing/detail, retained pagination, local failures and reset | No independent finding |
| `pages/rewards/index` | Recorded/pending states, month/currency selection, independent totals, actual-month attribution, confirm/correct/detail, retained refresh/pagination and scope errors | No independent finding |
| `pages/wallet/index` | Cards, independent/shared groups, archived bills, expansion, payment/undo/dates, reminders/preferences, match links and late reads | No independent finding |
| `pages/mine/index` | Attention reads, menus, history/submissions/preferences/privacy, operator entry, explicit demo-role changes and sequencing | No independent finding |
| `pages/detail/index` | Owned exact participation and snapshots, notification entry, card preparation/eligibility/cancel, all sheets, dirty expected-date choices, progress/receipt/revoke/tracking, gallery, reminders/history/entrances and foreground feedback | No independent finding |
| `pages/progress/index` | Progress and registration, labels/validation/focus, draft/leave/recovery, latest-version comparison/reapply, busy/read-only and safe return | No independent finding |
| `pages/receipt/index` | Actual amount/date/month, exact targets, first-write assertions, ordinary/pending/legacy recovery, pure lookup, versions, date refresh/resume/loading/midnight, errors and save/return | No independent finding |
| `pages/history/index` | Global/activity scope, filters/detail, retained pagination, retries, audit identity and operation wording | No independent finding |
| `pages/card-edit/index` | Identity, nickname, repayment/shared billing, actual date/rule distinction, all draft types, period and exact targets, lookup recovery, error links, save/remove and late results | R17-01 |
| `pages/submissions/index` | New lead/full routes, status and reason disclosure, verified-account visibility, pagination/retry and obsolete results | No independent finding |
| `pages/submission-lead/index` | Source alternatives, required fields, image limits/consent/cancel/upload/preview/remove, creation intent, drafts/conflicts, conversion, submit/update and owner checks | No independent finding |
| `pages/submission-edit/index` | Four form sections and conditional requirements, summary/field links, gallery identity and feedback, dates/periods, pending creation, drafts/conflicts, moderation and completion routing | No independent finding |
| `pages/review/index` | Permission/status states, private-row verification, loading/error/retry, paging, submission navigation, stale and role/account changes | No independent finding |
| `pages/preferences/index` | All four switches, readiness/loading/errors, dirty/saved feedback, leave, foreground warning ownership and disposed responses | No independent finding |
| `pages/web-entry/index` | Restricted/missing/approved addresses, shared eligibility and normalization, loading/failure/retry, source/copy and cold-entry return | No independent finding |

## Components, services, domain and build

The three complete components were reread: App Sheet's supported `.sheet-title` class, adaptive content/header measurement, stale measurement revisions, dismissible behavior, tab-bar and page lifetimes; Privacy Gate's observers, foreground visibility, agreement/refusal/policy and scrolling actions; and Demo Notice's explicit disclosure and source typography. No new independent component issue was found. Browser representation cannot establish WeChat's measurements, keyboard or screen-reader behavior.

All nine services were read in full: `api`, `benefit-copy`, `card-labels`, `demo`, `entrance`, `form-draft`, `format`, `navigation`, and `privacy`. The review includes immutable command payloads, separate read-only replay, retry/consent identities, uncertain-result retirement and relationship dependencies, session/owner checks, image identity and stale-preview guards, entrance eligibility/labels, owner/entity/revision-bound drafts, deterministic card distinctions, date/currency wording and explicit demo behavior. Demo seeding keeps dates valid across month starts; no real notification is implied.

All eight domain files and the shared contracts/catalog were freshly reviewed, with independent crosschecks of transaction and storage boundaries. Ownership, participation scope, immutable period snapshots, actual receipt dates, expected versions, first-creation absence, billing period and exact target, request fingerprints, reminder eligibility and finite grants remain required. Read-only `request.replay` does not issue a missing write or materialize new records. R17-01 is a client recovery-path issue; the domain prevents the stale target from being written.

Application routes, page/global styles, runtime configuration, package/TypeScript configuration, source builder and native package checker were reviewed. The build preserves shared API/privacy/configuration modules, bundles demo state once, injects the two cross-page components, and validates native route/component artifacts and relative CommonJS dependencies. Registration-only Node checks remain distinct from native lifecycle/rendering and cloud acceptance.

## Prototype and all-category review

The complete fresh prototype pass covers `scripts/prototype-build.mjs`, `prototype/runtime.js`, `prototype/index.html`, `prototype/workbench.css`, and `prototype/README.md`. It includes parsing and expression translation, every control/event family, conditional/loop/key behavior, native selectors and preview-relative units, source controllers and domain reuse, route parameters/lifetimes, sheet/platform-dialog focus ownership, scroll/input preservation, storage fallback/reset, gallery identity, action inventory, role/scenario ownership, fault controls and read-only lookup behavior.

The final composition change preserves the browser-owned input/textarea node while source handlers receive real input values, delays replacement through the composition boundary, and clears the old ownership on navigation/disposal. Platform dialogs retain their focus ownership. The source/native sheet title class is reflected in the browser projection. No new prototype mechanism was identified as a supported visible defect in the complete source pass.

The complete acceptance-script review found no new assertion-integrity issue. Its composition cases calibrate plain inputs/textareas, exercise trusted Chromium preedit events with stable nodes, commit/cancellation/continued Latin input/repeated composition, compare DOM/source/draft values, and leave/restore drafts after composition. They do not individually establish selection replacement during composition, unfinished-composition navigation, or an unrelated asynchronous render during composition. Static ownership review is not presented as measured coverage of those additional paths. All Chromium evidence remains distinct from an operating-system input method or WeChat keyboard.

All ten UI/UX Pro Max categories are applied: accessibility, touch/interaction, performance, style consistency, responsive layout, typography/color, animation, forms/feedback, navigation and charts/data. R17-01 concerns error recovery and explicit form decisions. The other categories are assessed within the existing mobile utility: labeled semantic controls, textual state cues, touch targets, busy feedback, efficient retained/paginated reads, consistent blue/white hierarchy, wrapping/safe-area/landscape layout, readable type and separate currencies, stable/reduced motion, predictable return paths and accurate period/amount presentation. Unsupported native capabilities, a new chart or a new theme are not proposed as defects.

## Next gate

This complete findings round cannot count toward the two-clean-round exit condition. Its frozen source, complete acceptance-script review, consolidated results/provenance, four global images and focused Card proof are closed. The main task has accepted R17-01 and assigned its correction. Subsequent fixes require their own focused regressions, full type/business/build checks and new source-linked artifact; their targeted reread is not a clean review.

After correction, start a fresh complete round on a stable candidate. The loop exits only after two consecutive complete reviews of the same unchanged candidate find no new actionable recommendation. Native rendering, physical keyboard/screen-reader behavior, real privacy/image authorization, external mini-program/web-view navigation, actual cloud authorization and notification delivery remain separately disclosed integration boundaries.
