# Complete UI/UX review: round 16

## Result and method

Round 16 confirmed three new actionable P2 findings. The consecutive clean-review count is **0**. The expected first clean round is a possible outcome of a complete review, not a target that overrides evidence; the confirmed issues make this a findings round.

The team freshly read all 16 native routes across their 64 TS/WXML/WXSS/JSON files, all three components across their 12 files, every binding and supported state, all nine client services, all eight domain files, shared contracts, global application configuration/styles, the complete five-file prototype subsystem, and the native builder/package checker. The lead reviewer covered Detail, Receipt, services, configuration/build and the UI/domain boundary. Independent reviewers covered seven primary routes, seven management routes and the components, the complete prototype, and the domain contracts. This was not limited to regression checking the four round 15 fixes.

After the acceptance owner froze `scripts/acceptance-prototype.mjs`, the team also freshly read the entire script in continuous ranges: lines 1–3000 and 3001 through the end. Review checked real service state versus simulated platform/clock/transport boundaries, retained assertions, native/source-control interactions, fixture cleanup, scenario dispatch, captured runtime errors, and the source/artifact fingerprint gates. Script reading is not a claim that its scenarios have run successfully.

UI/UX Pro Max's skill, all ten quick-reference categories and professional checklist, `docs/interaction-design.md`, and the complete round 14 and 15 records guided the review. The product remains the accepted Chinese-language light-theme WeChat utility, including moderated public submissions. No new feature, decorative preference, unsupported chart or dark theme, or arbitrary external-storage mutation is used to manufacture a finding.

This reviewer edits only this report. No local executable test, build, validation suite, smoke test or runtime probe was run. Local work was source/document reading and viewing remote evidence. All executable verification belongs to `ssh test-env`. No real notification, cloud deployment, account authorization, experience upload or publication occurred.

## Incoming candidate and evidence boundaries

The main task declared the round 15 product source frozen and reported complete remote TypeScript checking, **664/664 business/controller tests**, and the source build from `scripts/build.mjs`, including native package integrity for all **23 modules**.

The focused browser proofs below use frozen `.qa-native/prototype/incoming-r15/index.html`, SHA-256 `4b02638f4afa9d9efec7c2587e5ef70e2bf615be9bbfd30c28d54a315a16c14d`. The final `.qa-native/prototype/candidate-r15/report.json` identifies that same artifact and completed at `2026-09-22T21:41:50.728Z`.

| Evidence | Frozen value |
| --- | --- |
| Browser result | 154 passed, 0 failed, 0 captured runtime exceptions |
| Browser evidence | 229 screenshots; 104 source handlers exercised through UI |
| Generated inventory | 16 routes, 3 components, 272 bindings, 193 unique handlers |
| Source fingerprint | `6458abc90d07199b88f4272e7e8372a09b8a7f5337e8a813368dd2f1cdb2e11f` |
| Fingerprint scope | 147 files; unchanged during the run |
| Report SHA-256 | `a5e4325b324d4a4b55a40487290cce000ad659b18f6dd90e177b6e2588638dd3` |

The manifest covers the product/source/build directories and package/TypeScript configuration while excluding generated files, QA evidence, dependencies, documentation, tests and Git internals. `candidate-r15/interactive-prototype.html` matches the prototype hash; `candidate-r15/index.html` is the human-readable acceptance report. The reviewer read the report, all scenario names/results, source provenance and relevant artifact-manifest entries. Inventory coverage is not a claim that every conditional branch was executed. A separate console warning is identified as the local test server's `favicon.ico` 404, not a missing UI resource or runtime exception. The older candidate-r14 report is not used as current acceptance.

Both lead and prototype reviewers inspected the full matching `contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png` and `workbench-overview.png`, covering the 16-page overview. The prototype reviewer additionally checked switch-label, disabled-switch, checkbox, and initial-midnight success/failure/retry images `218` through `228`. These representative views show coherent hierarchy, readable controls, expected narrow-screen wrapping, fixed-action clearance and explicit demo disclosure. No additional concrete layout issue was found. These passing baseline scenarios do not negate the three separately demonstrated paths below or certify subsequent round 16 changes.

The reviewer also read the separate passing `candidate-r15/r15-web-port-after-report.json` and `r15-privacy-after-report.json` summaries, configurations, source-hash/unchanged records and evidence boundaries. Both identify the same HTML. The port harness runs the actual validator, decision/label helper, Detail handlers, dispatcher and Web Entry loader with mocked navigation/data host and isolated configuration. It covers omitted/default/normalized default ports, nondefault fallback, unlisted hosts and disabled web views without external navigation. The privacy harness runs both real editor handlers, API upload, component reject and privacy resolver with the documented native callback, distinguishing privacy refusal, album refusal and cancellation without losing inputs/images. These results are separate from the 154 browser scenarios; they do not establish real external web-view or physical WeChat permission behavior.

## Confirmed findings

### R16-01 — P2: A hidden Detail refresh must not clear the current form's leave warning

Source mechanism: `miniprogram/pages/detail/index.ts` reconciles a retained expected-date sheet after a successful `load()`. When the loaded date leaves that sheet clean, it calls the global `wx.disableAlertBeforeUnload()`. Hiding Detail does not retire that request, and the call checks neither visibility nor the current page owner. A late read can therefore clear a different form's active warning. This path is a read completion, distinct from the saving-page workbench race fixed in round 13.

The source-linked prototype exposes a supported sequence. Open a completed activity and its unchanged expected-date sheet, use the atlas to visit History, then use native-style Back. The retained Detail `onShow()` starts a real refresh. While its response is delayed, use the atlas to open Preferences and change an unsaved switch. Detail is hidden but still retained. Its eventual read completion removes the current Preferences warning even though Preferences remains dirty.

Remote proof: `.qa-native/prototype/r16-before/r16-detail-late-load-report.json` uses the frozen incoming HTML above and actual Todo, Detail, History and Preferences controls. It transparently holds one real `activity.get` result after native Back triggers Detail `onShow()`. It invokes no hidden controller method and injects no draft/storage fixture. Before releasing the response, Back on dirty Preferences opens the expected departure confirmation; the reviewer cancels it. After release, the trace records old Detail instance 3 calling `disableAlertBeforeUnload()` while Preferences instance 5 is current. The warning becomes empty. A second native Back produces no new dialog and disposes Preferences while `dirty: true`; the stored preference remains false.

The lead reviewer read the complete proof and inspected `r16-detail-late-load-03-new-preferences-has-leave-confirmation.png`, `r16-detail-late-load-04-old-detail-read-clears-current-warning.png` and `r16-detail-late-load-05-back-leaves-dirty-preferences-without-confirmation.png`. The run records zero runtime exceptions; its separate 404 is explicitly the local test server's `favicon.ico`. This is rendered-browser/source-lifecycle evidence, not a physical WeChat test.

User impact: A previously working unsaved-settings confirmation disappears due to an unrelated page's successful read. The next ordinary Back loses those edits without the promised decision.

Recommendation: Tie the leave-warning side effect to the Detail instance that currently owns the foreground, or invalidate the hidden read's global side effects while preserving correct state reconciliation on return. Retain normal background/read navigation and the existing dirty expected-date decision. Do not broadly block every read-only navigation to mask an ownership error.

Acceptance: Repeat the exact retained-page/late-read/dirty-Preferences sequence through rendered controls. After the old read, Back must still ask before losing the new form. Cancellation must retain its input and warning. Also cover visible clean and dirty expected-date refreshes, hidden/unloaded instances, normal return, and successful expected-date save without introducing duplicate prompts or preventing ordinary source navigation.

### R16-02 — P2: Use a supported component class selector for the sheet title

Source mechanism: `miniprogram/components/app-sheet/index.wxss:5` applies the title's shrink/wrap protection through `.sheet-head > text`. The title at WXML line 4 has no class. The component declares `component: true` and `styleIsolation: "apply-shared"`.

The current [official component template/style documentation](https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/wxml-wxss.html) prohibits tag, ID and attribute selectors in component styles and directs authors to class selectors. Its `apply-shared` option changes propagation of page styles into a component; it does not exempt component-local styles from the restriction. A separate webview note about page/app tag selectors is not a component-local exception.

An independent remote compiler proof used the frozen component files from the incoming round 15 source manifest. The available official `miniprogram-compiler@0.2.3` WCSC binary identifies itself as `v0.4me_20190328_db`. Its emitted stylesheet contains the diagnostic `Some selectors are not allowed in component wxss`, specifically identifying `index.wxss:5:15`. Both exit code and stderr are clean, so those alone would incorrectly suggest this selector is supported. An isolated QA control changes the title to an explicit `.sheet-title` class and removes this diagnostic. Product files were not changed by that proof.

Evidence: `.qa-native/prototype/r16-before/wcsc/findings.md`, `compiler-report.json`, `frozen-component/wrapper-default.stdout.txt`, `class-selector-control/wrapper-default.stdout.txt`, and the saved official page/headers/excerpt. The lead reviewer read the complete findings/report and relevant official text. The frozen WXSS hash is `825a527d545a6af9ccc5b81c6656d93a91fc06eb02776f99093c0db9888fb18c`; all four component source hashes and the incoming HTML identity were checked unchanged by the remote owner.

User impact and limit: The long-title protection uses an explicitly unsupported native component selector, so its browser success cannot establish the required native close-control/title behavior. The observed compiler result is the invalid-selector diagnostic. This report does **not** claim that the 2019 binary proves a current device ignored the rule, nor that new physical-device clipping was measured. The current official support contract and exact emitted diagnostic justify the compatibility correction without inventing a device result.

Recommendation and acceptance: Add a class to the title and target that supported class while preserving its existing shrink/wrap declarations and the close target. Keep the source-linked browser representation aligned. Verify the compiled component no longer carries this diagnostic, retain the long-token and ordinary Chinese title checks at narrow/landscape sizes, and preserve content/header measurement and busy dismissal behavior. Current native rendering remains a separately disclosed integration check.

### R16-03 — P2: Preserve the composing input while the browser owns a Chinese preedit session

Source mechanism: The prototype binds each `input` event directly to its source handler, including events whose `isComposing` flag is true. Source `setData()` schedules a render that replaces the shadow root's controls with new nodes. Restoring focus and selection after replacement does not preserve the browser composition session attached to the original node.

Remote proof: `.qa-native/prototype/r16-before/r16-ime-report.json` uses Chromium `153.0.8010.12`, the frozen incoming HTML, and actual source UI to reach Lead's activity-title input and Full Submission's conditions textarea. CDP `Input.imeSetComposition` applies `z`, `zh`, `zhong`, `zhongw`, `zhongwen`, then the Chinese preedit; `Input.insertText` commits the Chinese result. The same sequence is calibrated against plain input and textarea controls. No DOM event is manually dispatched.

Both plain controls finish with the intended two-character Chinese value, retain their original node, and record one composition start and one end. Both source-linked fields instead finish with accumulated intermediate Latin preedit text and a duplicated Chinese commit: `zzhzhongzhongwzhongwen` followed by the intended Chinese text twice. Their source data and displayed DOM value agree on this corrupted result. The original node is disconnected, and each records six composition starts, zero ends and six composing input events. All observed input events are browser-trusted. The run reports zero runtime exceptions.

The lead reviewer read the protocol/calibration/result/identity/event-count evidence and inspected `r16-ime-lead-title.png` and `r16-ime-full-conditions.png`. The evidence establishes a Chromium-managed composition defect. It does not claim an operating-system IME gesture, a particular physical keyboard or native WeChat's text-input implementation was tested.

User impact: A normal Chinese text-entry path writes intermediate preedit strings into the activity title or conditions instead of the committed text. Direct fill/paste tests do not exercise this interaction and had not exposed it.

Recommendation: Retain the browser's active composing control and composition ownership until commit or cancellation, then synchronize the final value to the source controller exactly once as appropriate. Unrelated scheduled renders must not replace that node mid-session. Clear composition ownership when its page/control is disposed, without transferring it to a new editor or preventing ordinary Latin input, paste, focus, validation, modal or navigation behavior.

Acceptance: Repeat calibrated real browser-composition sequences on an input and textarea, checking committed DOM/source/draft values, node ownership and event order. Include cancellation, repeated compositions, surrounding existing text, selection replacement, blur/navigation and an unrelated asynchronous render. Keep ordinary input, label activation, source validation and the existing focus/modal regressions intact. Report browser-managed composition separately from physical/native input testing.

## Complete route checklist

Every row covers the complete current controller, markup, stylesheet and configuration, all bindings and applicable initial/loading/refreshing/empty/error/success/busy/read-only/permission/draft/conflict states.

| Route | Fresh full-scope review | Round 16 result |
| --- | --- | --- |
| `pages/todo/index` | Filters/deadlines, next action, detail/progress/completion/receipt, More, skip/resume/undo, history/tab links and stale locks | No independent finding |
| `pages/activities/index` | Bank/search/sheet/filter/reset, held-card label activation, subscription, sharing/detail, retained windows and page failures | No independent finding |
| `pages/rewards/index` | Recorded/pending, month/currency scopes, independent counts/totals, confirm/correct/detail, retained refresh/pagination and failed scope labels | No independent finding |
| `pages/wallet/index` | Card/group/archive states, expansion, payment/undo/date changes, reminder eligibility/preferences, activity links and late refreshes | No independent finding |
| `pages/mine/index` | Attention reads, menus, privacy explanation, operator entry, explicit demo roles, loading/error and sequencing | No independent finding |
| `pages/detail/index` | Exact owned record/snapshot, notification entry, card preparation/eligibility/cancel, every sheet, dirty-date decisions, progress/receipt/revoke/tracking, guide/gallery identity, reminders/history/entrances | R16-01 |
| `pages/progress/index` | Progress/registration, validation/focus, drafts/leave, latest comparison/reapply, busy/read-only and safe return | No independent finding |
| `pages/receipt/index` | Amount/date/actual month, exact target, first-write checks, ordinary/pending/legacy recovery, pure replay, versions, day refresh/resume/midnight/loading, errors and save/return | No independent finding |
| `pages/history/index` | Global/activity scope, filters/detail, retained pages, local retries, audit states/ownership and operation descriptions | No independent finding |
| `pages/card-edit/index` | Identity/billing fields, error links, ordinary/pending/legacy drafts, bill/period/date decisions, exact recovered-creation lookup, save/remove and late responses | No independent finding |
| `pages/submissions/index` | Create routes, lead/full/status/reasons, verified-account visibility, paging/retry and obsolete results | No independent finding |
| `pages/submission-lead/index` | Alternative sources, image limits/cancel/privacy/album/errors/preview/remove, creation identity/drafts/conflicts, conversion, submit/update and ownership | R16-03 in the browser input projection; no independent native-page finding |
| `pages/submission-edit/index` | Sections/conditional fields, validation links, gallery/preview identity, image consent feedback, pending creation/expiry, moderation and completion navigation | R16-03 in the browser input projection; no independent native-page finding |
| `pages/review/index` | Permission and status states, private-row verification, retained pages, busy feedback, role/account changes and retry | No independent finding |
| `pages/preferences/index` | Four settings, readiness/loading/errors, dirty/saved feedback, foreground warning ownership, leave and disposal | R16-01 exposes the lost warning from another page |
| `pages/web-entry/index` | Missing/restricted/approved addresses, shared eligibility/normalization, loading/error/retry, source/copy and direct-entry return | No independent finding |

## Shared, supporting and prototype coverage

The complete three-component pass covered all 12 files: title/content measurement and stale callbacks, viewport/keyboard/safe-area bounds, close/busy ownership, tab/lifecycle restoration, privacy observation/resolution/policy, and explicit demo disclosure. R16-02 is the concrete native compatibility finding from this pass; no additional component issue was found.

All nine services were freshly read in full: API, form drafts, navigation, demo, entrance, privacy, formatting, benefit wording and card labels. Coverage includes immutable payloads, creation/consent namespaces, write/replay separation, uncertain-result retirement, resource dependencies and observed wallet/month relationships, image identity/validity/lifetime, entrance decisions, draft owner/entity/revision cleanup, and exact financial/period wording. The shared web eligibility helper normalizes an explicit default HTTPS port consistently across labels, dispatch and Web Entry, and preserves nondefault-port fallback.

All eight domain files and shared contracts were independently reread in full, with the cloud-store boundary crosschecked. Transaction rollback, owner checks, exact user/card scope, period snapshots, actual-date attribution, expected versions, first-creation absence, expected-period assertions, request fingerprints and finite reminder grants remain required. `request.replay` is an owned exact result lookup and does not execute or materialize a missing mutation. No unsupported business feature or relaxed assertion is proposed.

The main application configuration/styles, complete source builder and package checker were freshly read. Review included source generation, relative package dependencies, singleton API/privacy/configuration, demo placement, component injection, route artifacts, registration-only checks and native integration limits.

The prototype reviewer freshly read all five files: `scripts/prototype-build.mjs`, `prototype/runtime.js`, `prototype/index.html`, `prototype/workbench.css` and `prototype/README.md`. Coverage includes all tag/event families, condition/loop/key handling, native selector and preview-unit mapping, source controller reuse, keyboard and modal/sheet ownership, route parameters/lifecycle, scroll/input restoration, storage fallback/reset, gallery identity, action inventory, role/scenario claims, fault projection and read-only lookup behavior. The switch's source ID is now on its labelable input and event translation retains the source target identity.

The complete acceptance script review found no independent assertion-integrity issue. Checks inspect actual demo records, requests, audits, draft values and mutation counts rather than relying only on toasts. Delays and response-loss fixtures preserve the real operation and API parameters. Existing lifecycle simulations, worker-shaped deep-link fixtures, legacy stored shapes and wx adapter events are documented as such; they are not upgraded into real-device or cloud claims. The R15 source/native harnesses remain necessary for port/consent semantics.

All ten UI/UX Pro Max categories were considered. The confirmed issues concern navigation/form-state ownership, supported native layout rules and text-input composition. Accessibility, touch, performance, visual consistency, responsive layout, typography/color, motion and data presentation were also covered; the fresh global-image review added no other recommendation. Each finding uses a concrete support-contract or interaction proof with its platform boundary stated explicitly.

## Next gate

This complete findings round is sealed against the incoming frozen round 15 candidate and cannot count toward the two-clean-round exit condition. Its source, full acceptance-script review, fresh consolidated report, four global images and three focused proofs have all been reviewed. The main task has accepted the findings and assigned their corrections. Those later corrections require changed-source rereads and relevant remote regressions plus complete type/business/build checks; they cannot inherit the incoming artifact's passing status. Initial corrective Detail source has been inspected, but this report does not present that as consolidated corrective acceptance.

After all confirmed findings are closed, begin a new complete review of the corrected stable candidate. Exit only after two consecutive complete reviews of the same unchanged final candidate produce no new actionable recommendation. Moderated public submissions and transaction, ownership, actual-date, period-snapshot, version and idempotency guarantees remain in scope. Native rendering, physical text/keyboard/screen-reader behavior, real privacy/image authorization, external mini-program/web-view navigation, cloud authorization and notification delivery remain separate integration boundaries.
