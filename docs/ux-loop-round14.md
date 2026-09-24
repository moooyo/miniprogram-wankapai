# Complete UI/UX review: round 14

## Result and review method

Round 14 confirmed four new actionable P2 findings. The consecutive clean-review count remains **0**. This is a findings round; fixes and regression results cannot turn it into the first clean round retroactively.

The team freshly reread all 16 native routes and their 64 TS/WXML/WXSS/JSON files, all three shared components and their 12 files, every bound action and supported state, all nine client services, global configuration/styles, relevant authoritative contracts and domain paths, the complete five-file prototype subsystem, and native build/package-checker integration. The lead reviewer covered Detail, the complete API and display/draft/navigation/privacy services, contracts/domain integration, configuration and build; independent read-only reviewers covered the eight other core routes, Receipt, six management routes and all components, and the prototype. Finding mechanisms were independently checked before remote reproduction.

UI/UX Pro Max's skill, all ten quick-reference categories, its professional checklist, the interaction contract, and rounds 12 and 13 guided the review. The pass was not limited to regression checking. It considered accessibility, touch/feedback, performance, visual consistency, responsive layout, typography/color, motion, forms, navigation, and existing financial-data presentation. No new feature, subjective redesign, unimplemented dark theme, or chart interaction is introduced to manufacture findings.

The product source was frozen for this review. This reviewer edits only this document. No local tests, builds, validation suites, smoke tests, or runtime probes were run. Local work consisted of source/document reads and inspecting remote evidence. All executable proofs belong to `ssh test-env`; no cloud deployment, real notification, actual WeChat authorization, experience upload, or publication occurred.

## Frozen incoming candidate

The main task reported successful complete remote type checking, **573/573 business/controller tests**, and the full source build with native package integrity for **23 modules**. The reviewer read `.qa-native/prototype/candidate-r13/report.json` and its source provenance:

| Evidence | Frozen value |
| --- | --- |
| Prototype HTML SHA-256 | `dac92caa1785b82f582608c2324467db3179b73fe9328ee73dda1cf9d6ba5d39` |
| Source fingerprint | `08371d7c20a25e486234da6eb8d5d5a66282c60f286d6ecde8034bcee3d2bb02` |
| Fingerprint scope | 147 files; unchanged during the run |
| Browser result | 140 passed, 0 failed, 0 captured runtime exceptions |
| Browser evidence | 198 screenshots; 98 source handlers exercised through UI |
| Generated inventory | 16 routes, 3 components, 269 bindings, 191 unique source handlers |
| Report completion | `2026-09-22T20:10:01.367Z` |

The fingerprint includes `miniprogram`, `domain`, `shared`, `cloudfunctions`, `prototype`, and `scripts`, plus package and TypeScript configuration files. It excludes generated output, QA evidence, Git internals, documentation, and tests. Inventory completeness and executed-handler coverage are distinct measurements.

The reviewer inspected the entire matching `contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png`, and `workbench-overview.png`. The ordinary-data images have coherent hierarchy, readable controls, the intended five-tab navigation, fixed-action clearance, explicit demo disclosure, and the complete connected workbench. No additional issue was found in those representative images. The long-title case below is a separately tested content condition absent from those normal-data views.

The manifest's hash for `index.html` identifies the acceptance-report page; its `interactive-prototype.html` entry matches the prototype hash above. This is not a digest mismatch. The older `candidate-r11` artifact and the intermediate `iteration-1` report are not final acceptance for this candidate. The focused proofs below use the frozen `candidate-r13` HTML and do not rewrite its passing baseline report.

## Confirmed findings

### R14-01 — P2: Invalidate an old review scenario when a new scenario changes the same page's role

Source mechanism: `prototype/runtime.js`, in `seedReview()`, records the Review page instance, awaits its preparation query, and then checks `workbenchReady(targetPage)`. Those checks do not establish that this scenario or its selected role is still current. The permission-denied scenario can switch the same Review instance to an ordinary user and finish its revalidation without replacing the instance. The old preparation then continues its fixture writes and final feedback.

User impact: After explicitly selecting the ordinary-user permission scenario, a stale operator scenario can create two demo submissions and replace the current explanation with an operator-role success message. The displayed permission state, feedback, and initiated action disagree. This is a prototype scenario-ownership defect, not a production authorization bypass: the ordinary user is permitted to create their own private submissions.

Remote confirmation: `.qa-native/prototype/r14-before/r14-review-role-repro.json` records a real empty moderation preparation response with `limit: 50`, held independently of the native page's `limit: 20` read. Review instance 2 becomes ready as moderator, then the rendered denied control keeps instance 2 but changes its verified session to an ordinary user and shows no-review-permission state. Releasing the old result produces one real lead save and one real full-submission save, both with `roleAtCall: false`; two pending private records are persisted. The page remains denied while feedback claims the operator scenario is active. The proof has zero runtime exceptions and the frozen HTML hash above. The reviewer inspected its final workbench and feedback images.

Recommendation: Bind scenario continuations, fixture writes, reloads, and feedback to a scenario/role generation in addition to page ownership. A newer explicit scenario or role assignment must invalidate the old continuation even when the same page instance remains current. Keep normal review preparation and permitted private submissions intact.

Acceptance: Repeat the precise same-instance review-to-denied sequence, normal uninterrupted setup, a newer explicit assignment of the same role, and navigation away before a delayed result. Old continuations must neither write fixtures nor overwrite current feedback. Existing pagination role-lease safeguards must remain effective.

### R14-02 — P2: Refresh the valid actual-date range when an existing receipt editor crosses a day

Source mechanism: Receipt initializes `serverToday` and `maxDate` when it reads the record, and exposes `maxDate` as the date picker's end. It has no resume-date refresh. Only the new-creation save path performs the fresh authoritative preflight; an already-loaded participation continues validating against its old maximum date.

User impact: A user who keeps an existing participation's receipt editor open or returns after midnight cannot choose the actual new-day receipt date. Reopening the whole editor is required even though the server permits that date for the original participation. The actual income date and the activity period are deliberately separate; the correct fix must preserve that distinction.

Remote confirmation: `.qa-native/prototype/r14-before/r14-receipt-date-repro.json` loads an owned completed September participation on September 30 and keeps that same page while the browser clock advances to October 1. The stored server date, projected WXML end, and HTML maximum remain September 30. Filling October 1 through the projected date input records `rangeOverflow: true`; the source save handler rejects it locally, sends zero commands, performs no new session read, and leaves the ledger unchanged. A separate real-API control using the same participation and expected version accepts October 1 while preserving the September period and snapshot. The reviewer inspected the blocked-date image and read the UI/control traces. This does not claim a physical WeChat calendar was operated.

Recommendation: Refresh authoritative current-date bounds for a resumed existing-record editor and before a date-sensitive save without replacing its dirty amount/date or retargeting its participation. Keep failed-refresh feedback and busy ownership clear. Do not derive the activity period from the actual receipt date or prohibit a valid later-period payment.

Acceptance: Hold existing cashback and discount editors across midnight and a month/year boundary, resume, select the actual new date, and save against the original record. Preserve inputs, versions, snapshots, and actual-month attribution; retain future-date rejection and the separate ordinary-new versus uncertain-creation flows fixed earlier.

### R14-03 — P2: Keep a sheet's close control visible with a long unbroken title

Source mechanism: Todo passes the activity title directly to the shared sheet. A valid 60-character ASCII title reaches the header's plain text flex child. That child has no shrinkable minimum width or long-token wrapping rule. The close button retains a fixed 48 px width while the sheet clips overflow. The browser sheet mirrors that structure.

User impact: A supported activity title can push the visible close control entirely outside a narrow phone preview. The ordinary close affordance disappears, and the title itself is clipped.

Remote confirmation: `.qa-native/prototype/r14-before/r14-sheet-title-report.json` creates the valid 60-character title through the real demo submission/publication/join path and opens Todo More through its rendered control. At both 320 px and 375 px, the title's right edge is approximately 982.73 px and the close button's right edge is approximately 1030.73 px; its center does not hit the button within the visible device. A pointer click at the visible right side of the header does not close it. The reviewer inspected both initial-state PNGs and the recorded geometry.

The proof also records that Playwright's locator can programmatically scroll the hidden overflow horizontally and then click the off-screen control. The finding is therefore **initial clipping of the close affordance**, not a claim that every possible dismissal mechanism is permanently unusable. The runtime exception count is zero; an isolated favicon 404 is identified separately from UI resources. This is rendered-browser evidence; native WeChat geometry is not claimed.

Recommendation and acceptance: Give the shared title an explicit shrinkable, wrapping text region while reserving the close control's target. Apply the same semantics in the browser projection. Verify long unbroken and ordinary Chinese titles at 320/375 px and short landscape; title growth should trigger the existing size measurement without hiding the close button, body controls, or safe-area clearance.

### R14-04 — P2: Expose safe result checking when the original card intent survives but its pending marker does not

Source mechanism: Card Save writes pending-creation metadata through `markChanged()` and then dispatches the creation even if the draft write reports failure. An older ordinary draft can still retain the exact same creation identity and form payload. After a committed response is lost and that older draft is explicitly recovered, the absent pending marker prevents the special retry path, and duplicate-name validation rejects the original unchanged request before it can be safely resolved.

Remote confirmation: `.qa-native/prototype/r14-before/r14-card-draft-report.json` uses a fresh debit-card form with an already persisted ordinary draft. A fault at the native-style `wx.setStorageSync` boundary rejects only the pending-creation draft write, retaining the ordinary draft; this is not the browser adapter's session-storage fallback. The real `card.save` then commits, and its response is reported lost. After native-style Back and explicit draft recovery, the original intent and exact payload remain, but Save produces a nickname collision and dispatches zero additional API commands. A separate read-only control using that exact payload and original identity finds the committed card; the ledger is unchanged and only one matching card exists. The proof records zero runtime exceptions. The reviewer read the request/storage/recovery traces and inspected all three screenshots.

The existing warnings are material: the user saw the failed local-draft notice, the uncertain-result notice, and a leave confirmation explicitly warning that changes would be lost. This finding does not claim unannounced draft loss or a demonstrated duplicate write. Its narrow consequence is that an original result which is still safely identifiable cannot be checked through the recovered form's normal path; the UI instead asks for a different nickname.

Recommendation: Provide an explicit read-only original-result check when the restored intent and exact submitted payload remain identifiable. Keep ordinary new-card nickname validation intact. A failed or absent lookup must not automatically become a fresh creation, bypass naming rules, discard a genuinely uncertain operation, or guess an unknown payload.

Acceptance: Reproduce the precise storage-warning/lost-response/recovery path and resolve the original single card without mutation. Keep the warnings visible. Also cover a never-committed lookup, mismatched or incomplete metadata, a changed payload, ordinary new-card naming conflicts, late lookup completion, and deliberate new creation after an explicit user decision.

## Other evaluated candidates

The request-replay fault-injection concern was not counted. The visible Card result-check button is bound to `save()`, and its applicable billing payload necessarily triggers `ensureSession(true)` before read-only resolution. The proposed no-preceding-read path therefore does not describe that visible operation. A command-method naming difference alone is not a concrete user-visible defect.

The broader fact that unpersisted input can be lost after an explicit storage/leave warning is not counted as another defect. A lower-priority multi-step API-preflight/no-dispatch extension was not independently demonstrated and is not included. R14-04 is limited to the specifically proven recoverable original identity and blocked read-only result path.

## Complete route checklist

Each row covers the complete current controller, template, stylesheet, configuration, bound actions and supported initial/loading/refreshing/empty/error/success/busy/read-only/permission/draft/conflict states.

| Route | Fresh full-scope coverage | Round 14 result |
| --- | --- | --- |
| `pages/todo/index` | Filters/deadline groups, next action/detail/progress/completion/receipt, More, skip/resume/undo, history/tab shortcuts and stale locks | R14-03 shared-sheet surface |
| `pages/activities/index` | Bank/search/sheet/filter/reset, held-card matching, subscription, sharing/detail, retained windows and paging/read recovery | No new independent issue |
| `pages/rewards/index` | Recorded/pending, month/currency scope, independent amounts/counts, confirmation/correction/detail, refresh and pagination | No new independent issue |
| `pages/wallet/index` | Card/group/archive states, expansion, payment/date changes, reminder eligibility and preferences, stale operations and refresh | No new independent issue |
| `pages/mine/index` | Attention queries, all menus, privacy, operator entry, explicit demo roles, loading/error and sequencing | No new independent issue |
| `pages/detail/index` | Owned record/snapshot, notification entry, card matching/preparation/cancel, all sheets, dirty date decisions, progress/receipt/correct/revoke/tracking, galleries, reminders/history/entrances | No new independent issue |
| `pages/progress/index` | Progress/registration, validation/focus, drafts/leave, latest comparison/reapply, busy/read-only and return | No new independent issue |
| `pages/receipt/index` | Amount/date/actual month, exact scope/period, first-write preflight, normal/pending/legacy recovery, matching explicit record, pure replay, conflict/reapply and save/return | R14-02 |
| `pages/history/index` | Global/activity scope, filters/detail, retained pages/retry, audit states, request isolation and descriptions | No new independent issue |
| `pages/card-edit/index` | All identity/billing fields, error links, normal/pending/legacy drafts, exact bill/period targets, rebase/date decisions, pure replay, save/remove and late completion | R14-04 |
| `pages/submissions/index` | Creation routes, lead/full/status/reasons, account verification, hidden retained rows, paging/retry and obsolete requests | No new independent issue |
| `pages/submission-lead/index` | Alternative sources, image limits/cancel/preview/remove, creation intent/drafts/conflicts, full continuation, submit/update and ownership/return | No new independent issue |
| `pages/submission-edit/index` | All sections/conditional inputs, errors, source/gallery identity, creation/expiry recovery, moderation and completion navigation | No new independent issue |
| `pages/review/index` | Permissions/statuses, hidden unverified rows, retained pagination, disabled/busy feedback, role/account changes and retry | No native permission issue; prototype R14-01 |
| `pages/preferences/index` | Four settings, readiness/loading/errors, dirty/saved state, async ownership, leave warnings and navigation | No new independent issue |
| `pages/web-entry/index` | Missing/restricted/approved URL decisions, loading/error/retry, visible source, copy and safe return | No new independent issue |

## Shared, service, domain, and build coverage

The complete three-component review covered all 12 files, title/content measurement, stale callbacks, viewport/keyboard bounds, safe areas, close/busy ownership, native tab lifecycle, privacy observers/consent/policy, and demo disclosure. R14-03 is the only new independently evidenced component-layout finding at this checkpoint.

All nine services were reread in full. The review covered immutable payload capture, creation/consent identities, uncertain-result retirement, read-only replay isolation, wallet/month resource tracking, preflight versus dispatch, image identity/lifetime, entrance decisions, draft owner/entity/revision boundaries, and Chinese benefit/amount/period/card wording. Related domain/contracts checks preserve owned lookup, immutable period snapshots, actual-date attribution, expected-period assertions, first-creation absence, optimistic versions, request fingerprints, rollback, and finite reminder grants. Read-only replay neither materializes data nor first-executes a missing request.

Global app configuration/styles and the complete source builder/package checker were freshly read. Output-relative shared imports, API/privacy/configuration singleton rules, demo placement, injected components, route artifacts and registration-only integrity remain explicit. No hand-edited generated implementation is introduced.

All five prototype files were reread, including the renderer/event families, expressions/conditions/loops/keys, native selector and preview-unit mapping, source controller reuse, explicit demo configuration, modal/sheet keyboard ownership, native/workbench navigation, role generations and leases, input/scroll/focus restoration, storage/reset, gallery behavior, action inventory, asynchronous fixtures and fault controls. The normal-data images add no further visual issue; the specific same-instance continuation in R14-01 remains outside the passing baseline's exact scenarios.

## Next gate

This round cannot count toward the two-clean-round exit condition. Resolve all four confirmed findings, reread changed source, and run relevant remote regressions plus complete type/business/build checks. The corrected artifact must receive its own source fingerprint, HTML hash, report and visual evidence. The incoming 573-test/140-scenario checkpoint does not certify later edits.

Begin each subsequent complete review from the corrected stable candidate. End the loop only after two consecutive complete reviews of the same unchanged final candidate find no new actionable recommendation. Native WeChat rendering, physical text/keyboard/screen-reader behavior, real image/privacy integration, actual cloud authorization and notification delivery, cross-mini-program navigation and approved web domains remain separate integration boundaries. Moderated public submissions and all ownership, transaction, receipt-date, period-snapshot and idempotency guarantees remain in scope.
