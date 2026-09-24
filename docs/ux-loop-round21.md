# Complete UI/UX review: round 21

## Result and method

Round 21 confirms **three new actionable findings: two P2 and one P3**. The consecutive clean-review count remains **0**. This complete round is sealed against the frozen incoming round 20 candidate. Later fixes and their regression results cannot retrospectively turn this findings round into a clean round.

The review team freshly read all 16 native routes across 64 TS/WXML/WXSS/JSON files, all three shared components across 12 files, every binding and applicable state, all nine client services, all eight domain files, shared contracts/catalog, application/runtime/package/TypeScript configuration and global styles, the source builder and native package checker, all five prototype files, and the entire 169-case prototype acceptance script. The lead integrated the service, component, global/build and cross-page review. Independent readers covered six core routes, seven management routes, Progress/Receipt/History, the domain support, and the complete prototype/runner. This was a fresh pass after the round 20 freeze, not a review restricted to the previous cache correction.

The review applied UI/UX Pro Max, all ten quick-reference categories, its professional checklist, the interaction-design contract, and the prior round/cache report. Native WeChat constraints take precedence over web-only prescriptions. Recommendations require a supported user-visible consequence or an explicit applicable platform constraint. New features, decorative redesign, arbitrary persistence corruption and unmeasured operating-system behavior do not qualify.

This lead changes only this English report. No local test, build, validation suite, smoke test or runtime probe ran. All executable evidence below was produced through `ssh test-env`; local work consisted of source/document reads and inspecting copied remote evidence. No cloud deployment, real notification, account authorization, experience upload or publication occurred.

## Frozen candidate and complete evidence

The root reports a successful complete type check, **694/694** business/controller tests, and the complete source build, including integrity for **23 native modules**. The frozen browser projection is `.qa-native/prototype/incoming-r20/index.html`. The final consolidated report and current images are under `.qa-native/prototype/candidate-r20/`.

| Evidence | Frozen value |
| --- | --- |
| Prototype SHA-256 | `f12b374888cc749c798facea4d424fad99bc8a7638a43ce851100b3183b4b9b9` |
| Source fingerprint | `39f185d5a43b8e00031cd381225471c84e21d9ec80d1c49a989b4b6b08f560fd` |
| Source provenance | 147 files; unchanged during the complete browser run |
| Report SHA-256 | `b732df57926f3a7b2bdba947cc851a660f88ce49e5cdcab71ad38440ff09a04f` |
| Run interval | `2026-09-22T23:02:32.249Z` to `2026-09-22T23:06:05.351Z` |
| Browser result | 169 passed, 0 failed, 0 captured runtime exceptions |
| Browser evidence | 272 screenshots; 110 source handlers exercised through UI |
| Generated inventory | 16 routes, 3 components, 272 source bindings, 193 unique handlers |
| Environment | Linux, Node `v20.19.2`, Chromium `153.0.8010.12`, declared `--no-sandbox` and `--disable-gpu` arguments |

The lead read the complete scenario-result inventory, summary, coverage, diagnostics, environment, provenance and limitations. The fingerprint covers application, domain, shared, cloud-function, prototype and script directories plus package/TypeScript configuration. Dependencies, generated output, QA evidence, Git internals, documentation and tests are excluded. The sole recorded HTTP/console resource error is the missing `favicon.ico`; it is not a native UI asset failure. Binding inventory and representative action execution are distinct from exhaustive execution of every branch.

The lead inspected all four current global images: `contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png` and `workbench-overview.png`. They show the complete 16-route atlas and connected activity, card, submission and settings flows. The hierarchy, narrow-screen wrapping, native-style tabs, fixed-action clearance and explicit demo disclosure yield no additional concrete visual recommendation. Secondary-page landscape captures show the top of scrollable content; they do not imply all controls must fit the first screen. Independent readers also inspected the three record/editor routes at all three sizes, their conflict/audit states, and the management/session examples.

`candidate-r20/wcsc/frozen-source-match.json` records that all four App Sheet hashes match this source fingerprint. It reuses historical round 16 scoped diagnostics from the official `miniprogram-compiler@0.2.3` binary, banner `v0.4me_20190328_db`; the compiler was **not rerun** for this candidate. This record does not establish modern WeChat compilation or device behavior.

All three focused before proofs below use the same frozen HTML identity. The reminder proof additionally records nine exact source snapshots and unchanged source hashes. Subsequent local corrections are outside this incoming evidence and are not counted as accepted by the 169-case run.

## Confirmed findings

### R21-01 — P2: Apply the verified Mine identity independently of optional submission counts

At discovery, `miniprogram/pages/mine/index.ts` reads a session, then awaits a `Promise.all` of pending and returned submission counts before applying the session and counts together. If either secondary count read fails, the catch sets an error and the finally block releases loading, but the previously displayed session remains. The WXML renders the menus and demo-role picker from that retained session alongside the visible retry error.

The remote proof changes roles through the actual Mine picker in both directions. The genuine `session.get` succeeds with the newly selected identity. Only one ordinary `submissions.list` response with `limit: 1` is converted into a one-shot network failure after its real successful read. User to moderator leaves the UI at ordinary user with no Review entry; moderator to user leaves the UI at moderator with one Review entry. The page clearly displays the count error, but that error does not explain why the successfully changed identity is still represented as its previous value.

The session cache already contains the correct new role. Actual Retry aligns the UI **without another `session.get`**, which distinguishes this page-level coupling from the round 20 service-cache race. Direct moderation authority remains correct, and an ordinary user cannot perform a moderation query. Both directions dispatch zero business commands and capture zero runtime exceptions. No actor, cache or hidden business handler is injected.

Evidence: `.qa-native/prototype/r21-before/r21-session-role-count-report.json`, its QA reproduction, and six same-prefix screenshots for stale UI, aligned retry and real Review authority. The lead read the real/visible role values, error and menu measurements, query/command chronology, retry cache control and authorization result, and inspected the two stale-state images. Their initial viewport shows the error; exact lower-page picker/menu state is recorded by the DOM measurements rather than inferred from that viewport.

Recommendation: Apply a successfully verified current-generation session independently of optional counts. On count failure, retain accurate identity and permissions, expose a specific retryable count error, and use a generic submission description rather than presenting stale counts as fresh. An initial session failure must not expose unverified privileged identity. Preserve load-generation ownership, role-change busy state and actual domain authorization.

Acceptance: Repeat both real role-picker directions with a single count failure; the role and Review entry must match the successful new session before Retry. Verify successful count recovery, initial session failure, overlapping loads and retained authorization denial. The service cache must keep its existing generation/latest-read correction.

### R21-02 — P2: Explain the disabled preference prerequisite at Detail reminder entry

The product has two separate requirements for deadline and expected-reward messages: a saved overall preference and authorization for the individual reminder. Preferences explicitly states that closing the preference prevents those messages while retaining in-app tasks. `domain/service.ts` defaults the relevant preferences to false. Its reminder authorization stores a grant but does not enable the deadline/reward preference. The worker intentionally filters candidates by that saved preference before creating a job.

At discovery, Detail's two enabled reminder buttons offer to enable a current-period deadline reminder or an expected-reward reminder. `miniprogram/pages/detail/index.ts:357` calls `requestReminder` without reading or explaining the preference. The client saves accepted consent and shows the current-period application-success toast. Detail contains no local disabled-preference explanation or route to the existing settings page. A user following this enable flow therefore has no indication that a second switch still prevents the requested reminder from becoming eligible.

The remote source/controller/service/worker proof covers four paths: deadline and reward, each with its corresponding preference false and true. It runs actual Detail loading and reminder logic, actual client API and authorization, the real transactional domain store, and the real reminder worker. Native `Page`/`setData`, cloud transport, accepted subscription callbacks and the sender boundary are simulated in isolation. The actual WXML visibility/disabled expressions are evaluated against the controller state; exact native toast/modal/navigation payloads are captured. This is not a browser screenshot, physical-device gesture or real WeChat authorization claim.

For each false-preference path, the source button is enabled, one native acceptance callback occurs, one grant is genuinely stored, the application-success toast appears, the preference stays false, and there is no preference read, disabled-preference explanation or settings navigation. At a genuinely due date with configured templates and an owned eligible record, the actual worker creates **0 jobs** and invokes the dummy sender **0 times**. The corresponding true-preference control creates **1 job** and invokes the dummy sender **once**. These controls isolate the intentional preference filter as the cause.

The grant is real and the toast does not literally claim completed delivery. The finding is the missing second prerequisite at an enable entry, **not a fabricated delivery result, authorization bypass or worker defect**. The general settings-page explanation does not supply the missing context to this Detail flow.

Evidence: `.qa-native/prototype/r21-before/r21-detail-reminder-preference-report.json`, `r21-detail-reminder-preference-repro.ts`, `r21-detail-reminder-README.md`, and nine `r21-detail-reminder-current-*` snapshots. The lead read all four request sequences, button states, exact feedback, unchanged preference values, stored grants and worker/dummy-send controls. The frozen HTML identity is `f12b374888cc749c798facea4d424fad99bc8a7638a43ce851100b3183b4b9b9`; the report confirms source hashes remained unchanged throughout the proof. No real cloud call, message, external navigation or product build was performed by this probe.

Recommendation: Check the corresponding preference at this entry and clearly direct the user to the existing reminder settings when it is disabled, following the already established Wallet explanation pattern. Preserve explicit consent, current-page/record ownership, busy and late-read guards, configured-template failures and the distinct demo explanation. Do not silently enable the overall preference or weaken the worker's preference filter.

Acceptance: Cover disabled/enabled deadline and reward preferences, settings cancellation and return, failed preference reads and stale/hidden Detail continuations. Disabled preferences must have a clear actionable explanation without unintended authorization. Enabled preferences must preserve genuine per-reminder consent. Demo mode must remain an explicit non-sending explanation. Worker controls must continue to respect disabled preferences; no real notification is required for these isolated checks.

### R21-03 — P3: Keep retired pagination preparation from replacing the new workbench feedback

At discovery, `prototype/runtime.js` checks scenario/page ownership around the pagination fixture's writes, but emits its progress feedback immediately after awaiting `submission.lead.save` without a new ownership check. The final reload-to-success-feedback boundary also lacks that check. A newer scenario can own the visible workbench before the older awaited operation returns.

The proof uses actual pagination and Review scenario controls on the frozen browser candidate. It holds the first genuine lead-save response **after the command has committed**, then enters the new Review scenario and waits for its correct ready state and operator explanation. Releasing the unchanged old response replaces that explanation with pagination preparation progress at item 1 of 32. The old preparation subsequently stops, so the remaining progress message no longer describes an active task.

This is narrowly a demo-workbench feedback issue. Command count stays exactly **5** before and after release. The new Review instance, URL hash, stack and selected role do not change; the fixture-complete marker remains false; the already committed lead and received reward remain intact. The pagination button is released again. There is no continued stale write, role corruption, data loss or recurrence of the earlier scenario-ownership defect. The proof records zero runtime exceptions.

Evidence: `.qa-native/prototype/r21-before/r21-pagination-feedback-report.json`, its QA reproduction and three same-prefix screenshots, including `r21-pagination-feedback-stale-progress-overwrites-new-review.png`. The lead read the held-commit timeline, old/new feedback, unchanged route/instance/role, command sequence and committed records, and inspected the stale workbench image. The independent prototype reviewer also read the complete proof and source path.

Recommendation: Recheck the same existing scenario/page ownership immediately after the final awaited per-item command and before any resulting progress feedback. Apply the same check after the final reload before publishing completion feedback. Retain committed demo data and the existing rule that a retired preparation performs no later commands.

Acceptance: Hold the genuine committed lead response, finish the newer visible scenario, then release it. The newer scenario's feedback must remain unchanged, with no additional writes or role/page changes. Retain successful current-scenario preparation and completion feedback.

## Complete native route checklist

Each row covers all four files, all bound actions, and applicable initial/loading/refreshing/empty/error/success/busy/read-only/permission/draft/conflict/navigation states.

| Route | Fresh full scope | Result |
| --- | --- | --- |
| `pages/todo/index` | Filters, stage/deadline groups, next action, detail/progress/complete/receipt, More, skip/resume/undo, history/bills/discovery, retained refresh and mutation locks | No additional finding |
| `pages/activities/index` | Bank rail/search/sheet, held-card labels and hit area, reset, subscription, sharing/detail, pagination and local retry | No additional finding |
| `pages/rewards/index` | Recorded/pending, month/currency filters, separate totals/counts, receipt-month attribution, correction/detail, retained refresh and paging | No additional finding |
| `pages/wallet/index` | Card labels, independent/shared/archive groups, expansion, payment/undo/dates, reminder eligibility/preferences, matching activities and late reads | No additional finding; existing reminder explanation is relevant to R21-02 |
| `pages/mine/index` | All menus, privacy, operator entry, explicit demo picker, count reads, loading/error/retry and asynchronous identity | R21-01 |
| `pages/detail/index` | Owned exact participation/snapshot, deep links, card matching/preparation/cancel, all sheets, dirty dates, progress/receipt/revoke/tracking, guides/images, reminders/history/entrances, lifecycle ownership | R21-02 |
| `pages/progress/index` | Progress/registration, validation focus, ordinary drafts, busy/read-only, conflicts/latest comparison/reapply and return | No additional finding |
| `pages/receipt/index` | Amount/date/actual month, exact user/card/period target, first-write guard, ordinary/pending/legacy recovery, read-only replay, version conflicts, date freshness and explicit Save boundary | No additional finding |
| `pages/history/index` | Global/activity scope, filters/detail, pagination/retry, audit loading/identity/close and operation wording | No additional finding |
| `pages/card-edit/index` | Identity/nickname, billing rules versus actual dates, independent/shared choices, ordinary/pending/legacy creation recovery, exact target/period rebase, validation, save/remove and result lookup | No additional finding |
| `pages/submissions/index` | Lead/full entry, status/reason, current-account verification, private cached rows, paging/retry and stale loads | No additional finding |
| `pages/submission-lead/index` | Required fields/source alternatives, image selection/consent/cancel/upload/preview/removal, drafts and intent recovery, full continuation, submit/update and ownership | No additional finding |
| `pages/submission-edit/index` | Four form sections and conditional fields, validation links, image identity, dates/periods, creation/draft/replay, moderation and return | No additional finding |
| `pages/review/index` | Role/status states, private-data verification, loading/error/retry, paging, submission navigation and stale responses | No additional finding; actual authorization remains intact in R21-01 |
| `pages/preferences/index` | All four switches, loading/readiness/error, dirty/saved feedback, leave ownership, disposal, return and stated authorization dependency | No additional finding; policy defines R21-02's expected behavior |
| `pages/web-entry/index` | Shared eligibility and normalization, missing/restricted/approved state, loading/failure/retry, source/copy and cold-entry return | No additional finding |

## Components, services, domain and build

All three components were reread in full. App Sheet coverage includes supported native classes, title/content measurement revisions, long text, viewport/keyboard/safe-area bounds, scrolling, busy dismissal and native-tab lifecycle. Privacy Gate covers observers, foreground state, agreement/refusal, policy and actions. Demo Notice retains explicit demonstration disclosure. The fresh visual/source pass produced no additional component recommendation.

All nine services were reread: API, benefit wording, card labels, demo persistence, entrance eligibility, form drafts, formatting, navigation and privacy. The pass covered immutable command payloads and consent intents; transaction retries and retirement; separate read-only replay; affected-resource invalidation; current session/cache consumers; owner/entity/revision-bound draft cleanup; image identity and callback cancellation; safe return; dates/currencies; and demo/production boundaries.

All eight domain files and shared contracts/catalog were reread, with an independent support crosscheck. Transactions, ownership, period snapshots, actual receipt dates, first-creation absence, exact bill identity, versions and request fingerprints remain enforced. Read-only lookup cannot create a missing operation. Reminder-worker configuration, due filtering, preference semantics and finite authorization grants were additionally traced for R21-02. No domain guarantee is proposed for relaxation.

The source builder and package checker were read completely alongside global configuration and styles. Shared API/privacy/configuration remain package-relative singleton modules, demo state is bundled once, and common components are injected from source. Route/component artifacts, static dependencies and registrations are checked. CommonJS registration integrity does not establish native rendering, lifecycle or real cloud operation.

The round 20 API correction retains cache generation and actual-read sequence ownership. Every permitted role selection, including the same role, invalidates the cache; obsolete reads still return to their original callers without republishing shared cache state. TTL, forced reads, cache reuse and production-role rejection remain intact. The eight dedicated regression sources and both current real-picker delayed-response browser cases were reviewed. R21-01 is the separately evidenced controller coupling of successful identity to optional counts, not a claim that this cache correction failed.

## Complete prototype and acceptance-script review

The five prototype files were freshly read: `scripts/prototype-build.mjs`, `prototype/runtime.js`, `prototype/index.html`, `prototype/workbench.css` and `prototype/README.md`. Coverage includes generated expressions/branches/loops/keys, all control and event families, binding inventory, native selector and preview-unit mapping, assets, source-controller/domain reuse, explicit demo enforcement, canonical routes/options/lifetimes, text composition and editing, scroll/focus retention, sheets/platform dialogs, storage/reset, gallery identity, action inspector, scenario claims and separate read/write fault behavior. R21-03 is the only new actionable prototype finding.

An independent reader reviewed the complete current acceptance script continuously from line 1 through line 8,040, including all 169 cases, setup, assertions, cleanup, diagnostics and provenance. The prototype reviewer also reviewed the runner and current integration boundaries. The script does not erase failed cases to manufacture a pass, and no new assertion-integrity issue was identified. The source/binding inventory is broader than the 110 handlers executed by representative UI scenarios; neither is described as full execution of every possible state combination.

Previous corrections remain distinct and were reread within the full scope: exact Card bill-target recovery; Receipt ordinary/pending/legacy period binding and read-only result resolution; date freshness across foreground/midnight; explicit Save preflight locking with nonwriting foreground refresh; Detail leave-warning ownership; image identity; native sheet styles; browser composition; modal focus/scroll; and canonical Web Entry options. No additional concrete failure was confirmed in those paths.

## Ten-category assessment and closure

| UI/UX category | Complete-round assessment |
| --- | --- |
| Accessibility | Labeled semantic controls, state text, switch/checkbox activation, visible focus, modal containment and image identity were reviewed. No additional concrete finding. |
| Touch and interaction | Comfortable targets, busy locks, dismissal, duplicate actions, picker/label hit areas and current action ownership were reviewed. Reminder entry needs R21-02's prerequisite context. |
| Performance | Retained reads, pagination, scoped retries and cancellation were reviewed. R21-01 concerns applying available authoritative data despite optional metadata failure. |
| Visual style and consistency | Existing calm blue/white utility direction, components and state hierarchy remain coherent. No decorative change is proposed. |
| Layout and responsiveness | All 16 routes were inspected at 320, 375 and short landscape; scroll and fixed actions remain intentional. No additional measured overflow or visual issue. |
| Typography and color | Chinese platform typography, readable supporting text, numerical hierarchy and text-backed state colors were reviewed. No additional finding. |
| Animation | Stable controls, composition lifecycle and restrained/reduced-motion behavior were reviewed. No additional finding. |
| Forms and feedback | Drafts, conflicts, errors, explicit Save boundaries and retry feedback were reviewed. R21-01, R21-02 and R21-03 identify concrete feedback inconsistencies. |
| Navigation | Five tabs, safe secondary return, deep links, preserved query/scroll, settings paths and scenario ownership were reviewed. R21-02 needs an existing-settings route; R21-03 must not overwrite its successor's feedback. |
| Data presentation | Currency separation, actual receipt-month attribution, immutable participation periods, progress/registration wording and history/billing identity were reviewed. No additional finding. |

The complete source/script review, all four current global images, consolidated provenance and all three focused before proofs are closed. The root accepted the three scoped corrections and assigned their implementation. Their later validation belongs to a new candidate and cannot be inferred from the incoming 169-case result. Clean count remains **0**.

After the corrections, run their relevant remote regressions and the complete type/business/source-build checks, generate a fresh source-linked candidate, and begin another complete review. The user-requested loop ends only after two consecutive complete reviews of the same unchanged final candidate yield no new actionable recommendation. A targeted correction review is not a substitute for either clean round.

Browser projection is not WeChat Developer Tools or physical-device acceptance. Native pickers/navigation/privacy/photos/clipboard/subscriptions are adapted; foreground callbacks and nested native-dialog events are simulated; composition checks use calibrated Chromium CDP rather than a system IME. Real WeChat rendering, system accessibility/text/keyboard behavior, real authorization, cloud ownership, external navigation and actual notification delivery remain separate integration boundaries.
