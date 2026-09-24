# Complete UI/UX review: round 15

## Result and method

Round 15 confirmed four new actionable P2 findings. One additional keyboard-navigation candidate was disproved by remote interaction and is excluded. The consecutive clean-review count remains **0**. Corrections made after these findings cannot retroactively make this a clean round.

The team freshly read all 16 native routes across their 64 TS/WXML/WXSS/JSON files, all three components across their 12 files, every binding and supported state, all nine client services, all eight domain files, shared contracts, global application configuration and styling, the complete five-file prototype subsystem, and the native builder/package checker. The lead reviewer covered six primary/detail routes, shared components, services and build integration; independent read-only reviewers covered seven management routes, the progress/receipt/history routes plus domain/contracts, and the prototype. Finding mechanisms and evidence were independently reread by the lead reviewer.

The new `resolveRecoveredDraftCreation` path was read explicitly. It performs an exact, owner-bound read-only lookup, preserves the recovered payload and draft on unresolved/error results, and does not silently execute a new creation. The complete source pass also reread the final prototype classification of read-only commands. This review was not limited to the four previous findings.

The UI/UX Pro Max skill, all ten quick-reference categories, its professional checklist, the interaction contract, and preceding review records guided the pass. Recommendations follow the supported native product and browser projection. No new feature, subjective restyling, unsupported interaction, dark theme, or chart is required to create a finding.

No local executable test, build, validation suite, smoke test, or runtime probe ran. Local operations were source/document reads and viewing evidence produced on `ssh test-env`. Product source remained read-only for this reviewer. No cloud deployment, real notification, actual WeChat authorization, experience upload, or publication was performed.

## Incoming candidate and evidence boundaries

The focused browser proofs use frozen `.qa-native/prototype/incoming-r14/index.html`, SHA-256 `9d42ec13bd01b17818309cfb175aec1bc25917baab12ba9a265bc3932d320504`. The final `.qa-native/prototype/candidate-r14/report.json` identifies the same HTML and completed at `2026-09-22T21:22:08.927Z`:

| Evidence | Frozen value |
| --- | --- |
| Browser result | 149 passed, 0 failed, 0 captured runtime exceptions |
| Browser coverage | 218 screenshots; 102 source handlers exercised through UI |
| Generated inventory | 16 routes, 3 components, 272 bindings, 193 unique handlers |
| Source fingerprint | `910c9501cbe88625b30562669250aa39d2f4ff2a30f76a4fa7e3dd5a10621dfc` |
| Source scope | 147 files; unchanged during the run |
| Report SHA-256 | `6497433c70806b6c985adbb2b4706299b6562ddb1546bbbd2357de7741018209` |

The source-provenance record covers `miniprogram`, `domain`, `shared`, `cloudfunctions`, `prototype`, `scripts`, package files and TypeScript configuration. It excludes generated output, QA artifacts, documentation, tests and dependencies. Inventory completeness is distinct from execution of every branch. The old candidate-r13 report and intermediate `iteration-1-report.json` are not used as final acceptance.

The lead reviewer inspected the full matching `contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png`, and `workbench-overview.png`. These ordinary-state views show coherent hierarchy, readable controls, native-style navigation, fixed-action clearance, explicit demo disclosure and the connected workbench. They produced no additional concrete layout recommendation. The four focused failures below are different paths from the passing baseline's exact scenarios. Subsequent R15 corrections require their own artifact and cannot inherit this baseline's passing status.

Two findings use rendered browser controls against that immutable HTML: initial Receipt loading across midnight and switch-label activation. Two findings use isolated remote source/native-callback harnesses, with captured source hashes: configured web-entry eligibility and privacy-refusal error classification. Their narrower evidence boundaries are explicit below. No claim about physical WeChat controls or real external page compatibility is inferred from them.

## Confirmed findings

### R15-01 — P2: Recheck the actual-date bound when initial Receipt loading crosses midnight

Source mechanism at discovery: Receipt reads `serverToday` in `readRecord()`, then awaits the activity and optional card reads. Initial `onShow()` calls `scheduleDateRefresh()`, which returns while `loading` is true. If the whole initial load stays visible and finishes after midnight, `dateRefreshOnLoad` remains false. The load finalizer schedules the next midnight from completion time instead of checking whether the day changed while loading. The displayed picker can therefore retain the previous day's `maxDate` for another full day.

Remote proof: `r15-before/r15-receipt-midnight-repro.json` holds a real `activity.get` result after the September 30 session response, keeps the host's initial Receipt page visible, advances China time from 23:59:59 to October 1 at 00:00:01, and releases the unmodified result. No synthetic `onShow()` or `onHide()` is invoked. The page has `hasShown: true`, `visible: true`, `dateRefreshOnLoad: false`, and only one session read. `serverToday`, `maxDate`, the projected WXML end, and the HTML date maximum all remain September 30. Its next date timer is scheduled for October 2, 24 hours later.

The browser's date constraint rejects October 1 as out of range. The lead reviewer inspected `r15-receipt-midnight-loaded-october-with-september-max.png` and `r15-receipt-midnight-october-date-fails-stale-picker-constraint.png`. The proof has zero runtime exceptions. It deliberately does not press Save, because the round 14 save-time refresh would obscure the initial picker problem. This finding does not claim that the new save guard still rejects the date after refreshing, or that a physical WeChat calendar was operated.

User impact: The user first sees an already-stale date selector and cannot select the valid current-day receipt date through it without another recovery action. The activity's original participation and period remain correct; the defect is the freshness of the actual-date choice.

Recommendation and acceptance: After the initial asynchronous read finishes, reconcile date freshness before deferring the next refresh to tomorrow. Preserve amount/date drafts, participation identity, version and period snapshot. Test a visible initial record read and an optional card read crossing midnight, as well as ordinary initialization, resumed pages, failed date refresh and pending creation recovery. Keep actual-date and activity-period semantics independent, and retain the existing future-date guard.

### R15-02 — P2: Use one web-entry eligibility decision for labels, dispatch, and destination

Source mechanism at discovery: `validatePublicHttps()` accepts a valid public HTTPS address with an explicit port. `services/entrance.ts` extracts the hostname before the colon, so an enabled web-view configuration with that host on its allowlist labels and dispatches the action as an embedded webpage. `pages/web-entry/index.ts` instead requires the hostname to be followed immediately by a path, query, fragment, or end of string; the colon makes its hostname extraction fail.

Remote proof: `r15-before/r15-web-port-repro.json` exercises the actual validator, entrance decision/label helper, Detail activity/source handlers, shared API dispatcher, and Web Entry loader using an isolated configuration with embedded web views enabled and `cc.cmbchina.com` allowed. `https://cc.cmbchina.com:443/promotion/` passes validation and produces open-webpage/open-bank-rules labels and navigation. The destination immediately sets the unsupported-page error, an empty active URL, and `canRetry: false`. The otherwise identical address without an explicit port reaches the destination's normal loading state for both purposes.

The proof captures seven source hashes and the incoming artifact hash. It mocks the page host, Detail query, native navigation, and loading display. It performs no external navigation and makes no assertion that a physical WeChat web view supports explicit ports. This is an internal decision-consistency proof, not a network or device compatibility result.

User impact: A valid configured entrance is presented as one operation but immediately rejected by a different interpretation in the destination. The user takes an unnecessary failed-navigation step before reaching the copy fallback.

Recommendation and acceptance: Share a consistent eligibility decision across the action label, dispatcher and target page. If the supported embedded configuration excludes explicit ports, use the accurate copy fallback from the start; if an address is eligible, the destination must apply the same normalization. Cover explicit default port, omitted port, unsupported port/configuration, activity entrance, and rule-source actions without expanding the real platform compatibility claim.

### R15-03 — P2: Distinguish privacy refusal from album permission denial

Source mechanism at discovery: The actual privacy component's reject handler calls `resolvePrivacy(false)`. The installed official native typings document that resolving with `event: 'disagree'` fails the pending API with `API:fail privacy permission is not authorized`. `uploadImage()` forwards the native failure object. Both submission editors classify any `chooseMedia`/`chooseImage` message containing an authorization or permission term as album access denial, so the documented privacy refusal produces instructions to enable album permissions in WeChat settings.

Remote proof: `r15-before/r15-privacy-decline-report.json` uses the actual two `addImage()` handlers, actual `uploadImage()`, privacy initialization/observation, the actual privacy component reject handler, and the real privacy resolver. The simulated native callback receives `{ event: 'disagree' }` and returns the documented `chooseMedia:fail privacy permission is not authorized` failure. Full Submission writes the album-settings message into `errors.imageIds` and its error summary; Lead writes the same message into `imageError`. Ordinary album-denial controls retain the same album message. Existing images and drafts remain unchanged in all four cases.

The report records the official typings version `4.1.3`, documentation location, ten source hashes, and an unchanged-source check. This is a native-callback simulation, not a real OS gesture or physical WeChat consent test. The browser's independent privacy scenario is not used as proof that its file-input adapter implements native privacy authorization.

User impact: The user is directed to a system permission setting that does not address the choice they just made. Intentional refusal of the in-app privacy agreement is confused with inability to access the photo album.

Recommendation and acceptance: Recognize the privacy-specific failure before generic album-permission matching. Respect the refusal, retain the form/images, and provide accurate optional retry guidance without forcing consent. Preserve the distinct album-permission, user-cancel, network/upload, and invalid-image feedback. Test both editors through the real resolver and documented callback shape, while continuing to disclose the physical-device boundary.

### R15-04 — P2: Preserve native label activation when projecting switches

Source mechanism at discovery: Activities uses a native label with `for="mine-switch"`. The prototype places the switch's ID on its generated nonlabelable `span` wrapper and leaves the internal checkbox without that ID. HTML therefore cannot associate the label with the actual control, even though the switch retains a descriptive accessible name and works when clicked directly.

Remote proof: The label section of `r15-before/r15-focus-label-repro.json` records `label.control: null`, a `SPAN` with ID `mine-switch`, and an internal input with no ID. Clicking the visible held-card-filter label text leaves `mineOnly` false, performs no handler, and retains all 13 activity items. Clicking the actual input changes it to true, invokes `changeMine`, and produces four matching items. The lead reviewer inspected the text-click and input-control screenshots. The run has zero runtime exceptions.

User impact: The label's visible hit area does not activate the filter in the source-linked prototype, unlike the operation expressed by the native source. A reviewer can mistake a working native interaction for an unresponsive feature.

Recommendation and acceptance: Associate the projected label with the actual form control while preserving source selector markers, unique IDs, accessible names, disabled state, hit-area sizing, and render identity. Verify text and control clicks in both directions, exactly one change event per activation, disabled behavior, and the other generated switch/checkbox label patterns.

## Candidate excluded after evidence

The proposed first-forward-navigation keyboard escape is **not** a finding. The remote reviewer used real Tab key events to reach an Activity control, Enter to open Detail, then Tab again; the first Tab reached Detail's management control. The same real-keyboard sequence from Detail to Progress reached the progress input. Although `document.activeElement` was briefly `BODY` after old content was removed, the next sequential focus remained in the new source page. No programmatic focus assignment or Back restoration was used. `r15-focus-label-repro.json` marks both focus cases unconfirmed. No change is requested for that disproved effect.

## Complete route checklist

Every route was freshly read across its controller, markup, styling and configuration, including all bindings and applicable initial/loading/refreshing/empty/error/success/busy/read-only/permission/draft/conflict states.

| Route | Fresh full-scope review | Round 15 result |
| --- | --- | --- |
| `pages/todo/index` | Filters/groups/deadlines, primary/detail/progress/complete/receipt, More, skip/resume/undo, history/tab shortcuts, retained refresh and stale locks | No independent finding |
| `pages/activities/index` | Bank rail/search/sheet, held-card filter/reset, subscriptions, sharing/detail, retained pagination and read/failure recovery | R15-04 in browser projection |
| `pages/rewards/index` | Recorded/pending, month/currency scopes, independent totals/counts, confirmation/correction/detail, empty selections, retained refresh and pagination | No independent finding |
| `pages/wallet/index` | Card/group/archive states, expansion, payment/undo/date changes, reminder eligibility/preferences, late responses, matching activities and refresh | No independent finding |
| `pages/mine/index` | Attention queries, all menus, privacy explanation, moderator entry, explicit demo roles, load/error and sequencing | No independent finding |
| `pages/detail/index` | Exact owned records and snapshots, notification entry, card eligibility/preparation/cancel, all sheet/context transitions, dirty date decisions, progress/receipt/correct/revoke/tracking, image identity, reminders/history/entrances | R15-02 configured entrance/source path |
| `pages/progress/index` | Progress/registration fields, validation/focus, drafts/leave, latest comparison and explicit reapply, busy/read-only and safe return | No finding; forward-focus candidate excluded |
| `pages/receipt/index` | Amount/date/actual month, scoped targets, first-write preflight, ordinary/pending/legacy draft recovery, pure replay, versions/reapply, date-only resume/timer/save refresh and navigation | R15-01 |
| `pages/history/index` | Global/activity scope, filters/detail, retained pages, local retry, audit states and request isolation, progress/registration descriptions | No independent finding |
| `pages/card-edit/index` | All identity/billing fields, validation links, ordinary/pending/legacy drafts, explicit target/rebase/date decisions, pure replay, recovered ordinary-draft lookup, save/remove and late effects | No independent finding; new read-only recovery path confirmed in source |
| `pages/submissions/index` | Create routes, lead/full/status/reasons, account verification, hidden retained content, paging/retry and stale results | No independent finding |
| `pages/submission-lead/index` | Alternative sources, all image operations, creation identity, drafts/conflicts, full continuation, submit/update, ownership and return | R15-03 |
| `pages/submission-edit/index` | All sections and conditional inputs, error links, gallery/source identity, creation/expiry recovery, moderation, completion navigation and image feedback | R15-03 |
| `pages/review/index` | Permissions/statuses, private-row verification, retained pages, disabled/busy feedback, role/account changes and retries | No native finding; R14 scenario-claim correction reread |
| `pages/preferences/index` | Four settings, readiness/loading/errors, dirty/saved state, asynchronous foreground ownership, leave warnings and navigation | No independent finding |
| `pages/web-entry/index` | Missing/restricted/approved address decisions, loading/error/retry, source/copy and safe return | R15-02 |

## Shared, supporting, and prototype coverage

All three components were reread across 12 files. The sheet title now has a shrinkable wrapping text region with a reserved close target; content/header measurement and stale-measurement guards remain intact. The review also covered safe areas, keyboard bounds, dismissal/busy ownership, tab restoration and lifecycle, privacy observers/consent/policy behavior, and demo disclosure. The new privacy-feedback finding is in the editors' error classification, not a failure to deliver the component's reject decision.

All nine client services, all eight domain source files and shared contracts were freshly reviewed. Covered guarantees include owned queries, exact scope/period snapshots, actual-date attribution, first-creation absence and expected-period checks, optimistic versions, immutable request payloads, creation/consent identities, uncertain retries, read-only replay, resource retirement, wallet/month relationships, image identity/validity gates, and draft owner/entity/revision cleanup. Read-only replay does not first-execute a missing request or materialize writes. No new unsupported business feature is proposed.

The native build and package checker were reread in full: output-relative shared imports, API/privacy/configuration singletons, demo placement, injected components, route artifacts, module resolution and registration-only boundaries. No hand-edited output implementation was introduced.

All five prototype files were reread in full, including the current 1,073-line runtime. Coverage includes 16 routes, three components, all present tag/event families, conditions/loops/keys, native CSS and preview dimensions, embedded assets, source-controller reuse, modal/sheet focus ownership, route parameters/lifetime, scroll and input restoration, storage fallback/reset, galleries, action location, role/scenario claims, fixture ownership, dirty refresh coordination, and read-only versus write failure simulation. The only confirmed new independent prototype issue is label association; the forward-focus theory was rejected by actual interaction.

The ten-category review found concrete issues in form feedback, supported navigation decisions, date-range freshness and projected label activation. Performance, visual style, ordinary responsive layout, typography/color, motion and existing textual financial presentation produced no additional supported recommendation. No chart or dark-theme implementation is claimed; physical text scaling and assistive-technology behavior remain distinct checks.

## Closure gate

The preceding four fixes were present and freshly reread, including scenario claims, actual-date refresh, long-title wrapping, and exact recovered-card result lookup. The four findings above are newly examined paths, not duplicate descriptions of the passing scenarios. The incoming consolidated report, source fingerprint, and all four fresh overview images have been read and recorded above. They do not override the focused proofs or certify subsequent changes.

Resolve the four confirmed findings, reread the corrected source, regenerate the prototype, and run the relevant remote regressions plus complete type/business/build checks. The corrected stable candidate needs its own provenance. Begin a fresh complete review afterward; end only after two consecutive complete reviews of the same final candidate yield no new actionable recommendation. Round 15 remains at clean count **0**.

Moderated public submissions, ownership, transactions, actual-date attribution, period snapshots, versions and idempotency remain required. Native WeChat rendering, real photo/privacy authorization, physical keyboard/screen-reader/system-text behavior, actual cloud authorization and notifications, cross-mini-program navigation, and approved web-view configuration remain separate integration boundaries.
