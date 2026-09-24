# Complete UI/UX review: round 20

## Result and method

Round 20 confirmed one new actionable P2 finding in session-cache ownership after a demo-role change. The consecutive clean-review count remains **0**. The complete source/script pass, consolidated report/provenance, four current global images and focused remote proof are closed. This findings round is sealed against the frozen incoming round 19 candidate; a later correction or passing regression cannot retrospectively make it clean.

The team reread all 16 routes across 64 TS/WXML/WXSS/JSON files, all three components across 12 files, every binding and applicable state, all nine client services, all eight domain files, shared contracts/catalog, global application/runtime/package/TypeScript configuration and styles, the native source builder/package checker, and all five prototype files. The lead covered Detail, services, global/build integration and cross-page state ownership; independent readers covered eight primary/record/card routes, six management routes and the components, Receipt plus the domain/contracts, and the full prototype. This is a new source pass after the complete round 19 correction freeze, not just regression review of rounds 17 through 19.

UI/UX Pro Max, all ten quick-reference categories, its professional checklist, the interaction-design contract, and the complete round 18/19 reports guide this review. Recommendations require a supported visible consequence or an explicit primary platform constraint. New features, decorative preferences, a new theme/chart, and unmeasured operating-system behavior are excluded from the finding threshold.

This reviewer modifies only this English report. No local test, build, validation suite, runtime probe or smoke test ran. All executable evidence is produced by the designated owners on `ssh test-env`. Local work is limited to reading source/documentation and inspecting copied remote evidence. No deployment, actual notification, account authorization, experience upload or publication occurred.

## Frozen candidate and evidence

The current frozen incoming round 19 prototype has SHA-256 `e19900395fad83fd538145333bcfa6ec0ef00d0f1e366b6885e8230a7b2b38a4`. The root reports successful full type checking, **686/686** business/controller tests and the complete source build, including integrity for **23 native modules**. These checks include the Receipt save-preflight lock and the prototype URL adapter correction.

The final `.qa-native/prototype/candidate-r19/report.json` identifies that same HTML and finished at `2026-09-22T22:54:14.869Z`:

| Evidence | Frozen value |
| --- | --- |
| Browser result | 167 passed, 0 failed, 0 captured runtime exceptions |
| Browser evidence | 264 screenshots; 108 source handlers exercised through UI |
| Generated inventory | 16 routes, 3 components, 272 bindings, 193 unique handlers |
| Source fingerprint | `f68e078d7e9ff3412291c6fdd55b305a586c4883cab158478982f85660c2b885` |
| Fingerprint scope | 147 files; unchanged during the run |
| Report SHA-256 | `29aba86e648215e47bf173f1723f6ad063fb5f6db6f37b7f2a1aa58dc9e09750` |
| Environment | Chromium `153.0.8010.12`, Node `v20.19.2`, Linux; declared `--no-sandbox` and `--disable-gpu` arguments |

The lead reviewed every scenario result, summary, environment, diagnostics, limitations, source provenance and the matching component compiler record. The manifest covers application, domain, shared, cloud-function, prototype and script directories plus package/TypeScript configuration; dependencies, output, QA evidence, Git internals, documentation and tests are excluded. The sole HTTP/console resource error is the unprovided `favicon.ico`, not a page asset. Binding inventory and representative handler execution are not exhaustive execution of every branch. This run completed directly with all global images; previous candidate-r18 results or its infrastructure retries are not substituted for current acceptance.

The lead inspected all four current global images: `contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png` and `workbench-overview.png`. The complete 16-route atlas and connected activity/card/submission/settings flows retain readable hierarchy, narrow/landscape wrapping, native-style tabs, fixed-action clearance and explicit demo disclosure. This fresh image pass produced no additional concrete visual recommendation. The ordinary Mine state in the atlas does not exercise the delayed-session sequence below.

`candidate-r19/wcsc/frozen-source-match.json` matches all four App Sheet hashes to the current source fingerprint and explicitly reuses the historical round 16 diagnostics; WCSC was not rerun for round 19. The historical official `miniprogram-compiler@0.2.3` binary reports `v0.4me_20190328_db`. This source-match record does not establish modern WeChat compilation or physical-device behavior.

## Confirmed finding

### R20-01 — P2: Prevent an obsolete session response from replacing the newly selected demo role

Source mechanism at discovery: `miniprogram/services/api.ts:263` reads a 30-second session cache, but line 265 unconditionally writes every completed `session.get` response into that cache with its completion time. `setDemoRole()` at line 269 changes the demo actor and clears the cache without invalidating previously started session reads. An earlier response can therefore repopulate the cache after the new role's successful read. Mine's `load()` at `pages/mine/index.ts:19` uses the nonforced cache; its markup derives the displayed role and Review entry from `session.isModerator`. Review's request generation at `pages/review/index.ts:12` and line 20 correctly prevents an unloaded page from updating its own data, but it cannot prevent the service cache update that occurs before its continuation resumes.

Independent remote proof uses the fixed incoming HTML and actual visible controls. The user selects the moderator role in Mine, opens Review, and leaves through native-style Back while one already-calculated genuine moderator `session.get` response is held before delivery. The old Review instance is unloaded. The user then selects ordinary user through Mine's real picker and waits for a fresh ordinary-user session and matching page. Releasing the unchanged old response repopulates the shared cache; after normal Activities/Mine tab navigation, Mine again displays the moderator role and exposes the Review menu.

The result is explicitly bounded. Independent direct `api.query('session.get', {})` still reports an ordinary user. A real moderation query is rejected with `FORBIDDEN`, and actually clicking the reappearing Review menu produces the no-permission page after its forced session check. This is inconsistent demo-role feedback and an unusable advertised entry, **not an authorization bypass** or a production-role claim.

The transition completes in under one second, excluding normal TTL expiry as the cause. The proof delays delivery of a genuine response without changing its contents or invoking a hidden business handler. It injects neither actor nor cache state and dispatches zero business commands. The record has zero runtime exceptions.

Evidence: `.qa-native/prototype/r20-before/r20-session-role-cache-report.json` and the four same-directory screenshots `r20-session-role-cache-01-review-session-held.png`, `r20-session-role-cache-02-ordinary-picker-completed.png`, `r20-session-role-cache-03-stale-moderator-menu-real-user.png`, and `r20-session-role-cache-04-real-review-force-check-denies.png`. The lead read the full chronology, original and new responses, page instances/generations, visible menu/picker state, real authorization control, query/command trace and artifact identity, and inspected all four images.

Recommendation: Give session-cache updates explicit ownership across new requests and role invalidation. An older completion must not overwrite a newer successful session or refill a cache cleared by a later role selection. Preserve the existing cache lifetime, forced-read behavior, per-call response contract, production role restriction and server-side authorization. Do not solve a stale display by allowing the denied operation or removing the demo selector.

Acceptance: Repeat the real picker/Review/Back/tab sequence while holding an unmodified older response. The latest selected role and available menu must remain consistent after release and reentry. Verify overlapping session reads and role changes in both directions, retain ordinary cache reuse and forced refresh, and keep the real moderation denial and zero-write control. Relevant service tests and a current browser regression must accompany complete type/business/build checks; the incoming 167-case pass does not certify this correction.

## Complete native route checklist

Each row covers all four source files, every bound action and applicable initial/loading/refreshing/empty/error/success/busy/read-only/permission/draft/conflict/return states.

| Route | Fresh full scope | Current result |
| --- | --- | --- |
| `pages/todo/index` | Stage and deadline filters, next action, detail/progress/complete/receipt, More, skip/resume/undo, history/bills/discovery, retained reads and locks | No new confirmed finding |
| `pages/activities/index` | Bank rail/search/sheet, held-card label and control, reset, subscriptions, sharing/detail, paging and local recovery | No new confirmed finding |
| `pages/rewards/index` | Recorded/pending, month/currency scopes, separate totals/counts, actual-month attribution, correction/confirmation/detail, retained refresh and paging | No new confirmed finding |
| `pages/wallet/index` | Cards/names, independent/shared/archive groups, expansion, payment/undo/dates, reminder eligibility, preferences, matched activities and late reads | No new confirmed finding |
| `pages/mine/index` | Attention reads, all menus, privacy, operator entry, explicit demo-role picker, loading/error and asynchronous state | R20-01 |
| `pages/detail/index` | Exact owned participation/snapshot, notification entry, card matching/preparation/cancel, all sheets and dirty dates, progress/receipt/revoke/tracking, guides/images, reminders/history/entrances, foreground effects | No new confirmed finding |
| `pages/progress/index` | Progress and registration, error focus, ordinary drafts/leave, latest comparison/reapply, busy/read-only and safe return | No new confirmed finding |
| `pages/receipt/index` | Amount/date/actual month, exact scope/period, first-write checks, ordinary/pending/legacy recovery, pure replay, versions, date freshness, Save preflight ownership and return | No new confirmed finding |
| `pages/history/index` | Global/activity scope, filters/detail, retained pagination, local retries, audit loading/identity/close and operation wording | No new confirmed finding |
| `pages/card-edit/index` | Identity/nickname, repayment/shared choices, actual date versus rules, all draft and replay types, period/target validity, rebase/date review, validation, save/remove and late results | No new confirmed finding |
| `pages/submissions/index` | Lead/full creation, status/reason disclosure, current-account verification, private cached rows, paging/retry and stale reads | No new confirmed finding |
| `pages/submission-lead/index` | Source alternatives, required fields, images/consent/cancel/upload/preview/remove, intent/draft/conflicts, full continuation, submit/update and ownership | No new confirmed finding |
| `pages/submission-edit/index` | Four sections and conditional fields, validation links, gallery/source identity, dates/periods, pending creation/drafts, moderation and completion return | No new confirmed finding |
| `pages/review/index` | Role and status states, private-row verification, loading/error/retry, paging, submission navigation and stale responses | R20-01 crosses the shared service boundary; authorization remains enforced |
| `pages/preferences/index` | All four switches, readiness/loading/errors, dirty/saved feedback, leave-warning ownership, disposal and return | No new confirmed finding |
| `pages/web-entry/index` | Shared address eligibility/normalization, missing/restricted/approved states, loading/failure/retry, source/copy and cold-entry return | No new confirmed finding |

## Components, services, domain and build

App Sheet was reread across title/content measurement, supported component classes, stale measurement revisions, viewport/keyboard/safe-area bounds, busy dismissal, scrolling and native-tab lifecycle. Privacy Gate was reread across observers, foreground visibility, policy, agreement/refusal and persistent actions. Demo Notice's visibility and typography remain explicit. No new component finding has been identified.

All nine client services were reread in full: API, benefit wording, card labels, demo initialization/persistence, entrance eligibility, form drafts, formatting, navigation and privacy. Coverage includes immutable request payloads, canonical form/consent intents, separated read-only replay, retry retirement and affected resources, session/cache consumers, image identity and cancellation, owner/entity/revision-bound draft cleanup, safe navigation, dates/currencies/benefit terminology and demo/production separation. R20-01 was confirmed through the supported visible role-switch sequence rather than arbitrary cache injection.

All eight domain files plus shared contracts/catalog were freshly read, with an independent domain crosscheck. Transactions and rollback, ownership, card/user scope, period snapshots, actual receipt dates and month attribution, expected versions/periods, first-creation absence, exact bills, request fingerprints, reminder eligibility and finite grants remain required. Read-only replay cannot create an absent operation. No weakening of these guarantees is proposed.

The source builder and native package checker were read completely with the global configuration and styles. Shared API/privacy/configuration stay external singleton modules, demo state is bundled once, cross-page components are injected from source, and route/component artifacts and package-relative dependencies are checked. Registration-only CommonJS integrity is not native rendering, lifecycle or cloud acceptance.

## Prior corrections and full prototype pass

The Card target recovery now tests account, bill and period identity rather than the presence of any old bill ID. Ordinary stale drafts expose explicit rebase, preserve input and require actual-date review. Valid historical bills, rule-only edits, independent-account splits and pending/legacy replay retain their distinct rules. This is the closed round 17 correction, not a new recommendation.

Receipt's explicit existing-record Save owns `busy` before the authoritative date read, retains its submission boundary through validation and command, and releases it on failure. Visibility/save generations cancel an abandoned preflight. Ordinary foreground date refresh remains nonwriting and amount-editable. The Receipt reviewer reread all other creation, replay, version and date paths as well; this pass is not limited to the round 18 fix.

The five prototype files were freshly read: `scripts/prototype-build.mjs`, `prototype/runtime.js`, `prototype/index.html`, `prototype/workbench.css`, and `prototype/README.md`. Coverage includes expressions, branches, loops/keys, every current control/event family, source bindings, native selector/preview-unit mapping, embedded assets, source controller/domain reuse, demo enforcement, route options/lifetimes, input/scroll/focus preservation, sheet/platform-dialog ownership, browser composition, storage/reset, galleries, action inventory, role/scenario claims, and write/read-only fault behavior.

The round 19 URL correction keeps canonical options separate from the Web Entry `onLoad` argument copy. Only that controller's `url` argument is encoded for its explicit decode; `pageUrl`, Back and reload continue serializing canonical options. Other record parameters and native eligibility/validation remain unchanged. No general WeChat query-decoding contract is inferred from this source-specific browser adaptation.

An independent reviewer freshly read the final acceptance script continuously from line 1 through line 7,855, covering all 167 cases, fixtures, assertions, cleanup, source/artifact provenance and output handling. No new assertion-integrity issue was found. The prototype reviewer also reread the runner and the complete new URL regression section, including actual browser clipboard checks. The two URL cases contain eight cold-address variants and navigation-boundary controls; the Receipt regression distinguishes explicit Save locking from editable nonwriting foreground refresh. Their evidence limits include browser-managed composition rather than operating-system IME, simulated host foreground callbacks, platform adapters, legacy-schema fixtures and worker-shaped deep links. Static ownership checks and passing representative cases cannot be relabeled as exhaustive native or cloud testing.

## Ten-category assessment and closure gate

All ten UI/UX Pro Max categories were considered: accessibility, touch/interaction, performance, visual consistency, responsive layout, typography/color, animation, forms/feedback, navigation, and charts/data. They were applied to the existing utility's labeled semantic controls, textual state cues, comfortable targets, busy/retry feedback, retained and paginated reads, calm blue/white hierarchy, wrapping and fixed-action clearance, readable type, stable/reduced motion, predictable returns, and distinct currencies/periods. The single new finding concerns state/feedback consistency across supported navigation. The fresh final-image pass added no finding.

The complete source/script review, supported session-cache proof, final report/provenance and all four current global images are closed. The main task accepted R20-01 and assigned a scoped service correction. This review's source conclusion was completed against the frozen incoming candidate before that later edit; the correction is not mixed into the incoming evidence or counted as another review. Clean count remains **0**.

After correction and relevant remote regressions plus full checks, generate a new source-linked candidate and begin another fresh complete review. The loop exits only after two consecutive complete reviews of the same unchanged candidate have no new actionable recommendation. The targeted correction and its acceptance cannot retrospectively change round 20's findings classification.

Physical WeChat rendering, keyboard/screen-reader/system-text behavior, real privacy/photo authorization, external mini-program/web-view behavior, actual cloud authorization and notification delivery remain separate integration boundaries.
