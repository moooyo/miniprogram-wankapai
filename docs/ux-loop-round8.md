# Complete UI/UX review: round 8

## Review status and scope

Round 8 found **four new actionable P2 issues**, all confirmed through focused remote browser interaction. The consecutive clean-review count remains **0**. This is a completed findings round, not a clean round; fixes made afterward do not retroactively change its result.

This was a fresh complete pass through all 16 registered routes, every TS/WXML/WXSS/JSON file, all three shared components, global configuration and styling, relevant API/navigation/draft services, the receipt transaction guard, and the entire prototype generator/runtime/workbench. The round reviewer covered the nine core routes and shared services. Independent read-only reviewers covered all seven management routes and three components, and the complete prototype subsystem. The round reviewer independently reread every reported source mechanism and the relevant backend contracts.

The UI/UX Pro Max skill, all ten categories in its quick reference, its professional checklist, the interaction-design contract, and preceding review records guided the pass. This was not limited to regression checking. Each bound action and its applicable loading, refresh, empty, failure, success, busy, read-only, permission, draft, and conflict state was considered. Recommendations require a concrete user-visible effect. The application remains a Chinese-language, light-themed native WeChat utility with moderated public submissions.

No local executable verification was performed. Source/document reading and inspection of remotely produced files were the only local review activities. Executable checks and focused reproductions belong to the main task's `ssh test-env` acceptance workflow.

## Incoming verification and visual evidence

The main task reported a successful complete remote type check, **292/292 business/controller tests**, and the source build before the incoming round 7 candidate review. During this round, the round 7 image guard received its final latest-selection sequence correction in three controllers. Those final source paths were reread after the implementation author declared them ready; the incoming executable evidence must not be assumed to cover later source changes.

The reviewer read `.qa-native/prototype/candidate-r7/report.json`, completed at `2026-09-22T17:09:57.436Z`. It records **94 passing browser scenarios**, **0 failures**, **102 screenshots**, **0 runtime exceptions**, and **80 source handlers exercised**. Its generated inventory contains **16 routes**, **3 shared components**, **262 bindings**, and **184 unique source handlers**. Source inventory completeness and executed branch coverage are different measurements.

The reported prototype SHA-256 is `32bf6bfc476b4093782e0a9812b3e530f3574643704ea731f9db1a6e8a730bf8`. The reviewer inspected the matching `contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png`, and `workbench-overview.png`. They show consistent hierarchy, readable narrow-width controls, correct demo disclosure and native-control proportions, and the complete connected workbench. No additional concrete layout defect was found in that image set. The older candidate-r6 88-scenario report is not this round's current browser evidence.

The four focused reproductions below cover paths outside the 94 passing baseline scenarios. The report's passing status does not override these separately observed failures. All four reproductions identify the same `32bf6bfc...` candidate, and their JSON records and screenshots were copied back into `candidate-r7` for review. None required a real cloud, real notification, publication, or a source mutation.

## New actionable findings

### R8-01 — P2: Read the latest fallback value after a browser storage write fails

Source evidence at discovery: `prototype/runtime.js:52`, in `setStorageSync()`, writes a clone to `memoryStorage` before attempting `localStorage.setItem()`. On a persistent-storage write error it reports a session-only fallback and returns success. `getStorageSync()` at line 48 uses the memory map only if the localStorage read or JSON parse throws. A normal read returning an older stored value or no value bypasses the newer memory copy. Quota failure on write does not require reads to fail.

The upload adapter stores browser image data under a generated file ID through that same function and reports `saveFile` success. `imageSource()` later uses `getStorageSync()` to resolve the ID. The draft service also believes the nonthrowing write succeeded and later reads through the same adapter.

User impact: After the prototype promises to keep data until the page closes, a new image can immediately have an empty preview and a draft can disappear or recover an older value within the same browser session. This is a prototype storage-adapter defect, not evidence of native WeChat storage failure.

Remote confirmation: With only `Storage.prototype.setItem` made to throw a quota error and reads left unchanged, the reviewer saved a new Lead draft through the UI, left, and reopened an empty form. Updating an already persistent Lead draft then recovered its old title and source. A new Card nickname draft was also lost on reentry. A normal PNG upload returned an image row without an error, but its thumbnail had an empty source and zero natural dimensions; opening it produced an empty image dialog. All four cases are recorded in `.qa-native/prototype/candidate-r7/r8-storage-repro.json`. The reviewer inspected `r8-storage-new-lead-saved.png`, `r8-storage-new-lead-reopened-empty.png`, `r8-storage-older-lead-recovered-old.png`, and `r8-storage-image-preview-blank.png`.

Recommendation: Make the newest fallback value authoritative for subsequent reads after a failed persistent write, including deletion and reset semantics. Alternatively, propagate failure accurately instead of claiming an available fallback. Preserve storage namespace isolation and explain the lifetime of session-only data.

Acceptance: Keep persistent reads available while forcing writes to fail with a quota error. Save a new draft, update an existing persistent draft, navigate away and recover, and upload/preview an image. Verify the latest same-session values, deletion/reset, and a clear persistence boundary.

### R8-02 — P2: Complete the lead-to-full-submission workflow after success

Source evidence at discovery: `miniprogram/pages/submission-lead/index.ts:306`, in `fillFullRules()`, saves the new lead draft and pushes `submission-edit?fromLead=1`. Full Submission imports that lead and submits a new complete submission. Its `finish()` at `miniprogram/pages/submission-edit/index.ts:551` clears only the full-form draft and returns one page at line 557. The retained lead page has no success handoff: it is still dirty, has no submission ID, and continues showing its new-lead Submit action. The lead and full-submission commands at `domain/service.ts:397` and line 409 each create a new submission when no ID is supplied.

The full form deliberately preserves original lead source images for recovery and explains that unused images are not published automatically. That accepted preservation behavior should remain. It does not establish that a successful complete submission should return to an apparently unfinished, independently submittable copy of the same activity.

User impact: A user who completes the optional full-rule path returns to an unfinished-looking first step and can submit a second lead for the activity already sent for review. The workflow lacks a clear completed destination and a relationship between the retained source draft and the submitted full record.

Remote confirmation: Starting from an empty Submissions list, the reviewer used rendered controls to create a lead with an original source image, continued to the complete form, filled its rules, and submitted. The service contained one pending full submission, but the active page returned to the original lead with `dirty: true`, `submitted: false`, an empty `submissionId`, and an enabled Submit Lead action. Clicking it created a second pending submission with the same title and source; the list showed both full and lead entries. Record counts were **0 -> 1 -> 2**. `.qa-native/prototype/candidate-r7/r8-lead-full-report.json` records the controls, state checkpoints, and actual service records, with no direct submission command or controller-data mutation used for the sequence. The reviewer inspected `r8-lead-full-03-full-success-back-on-dirty-lead.png` and `r8-lead-full-04-two-pending-records.png`.

Recommendation: Give successful conversion a clear result/list destination and associate the retained source draft with the completed full submission, so it does not silently offer the same new-lead submission again. Preserve source images and unrelated or newer drafts, and keep cancellation and failed full submission editable.

Acceptance: Enter a new lead through the interface, continue to the full form, complete its rules, and submit. Verify a clear completed state, one intended submission, preserved original image references, and no accidental second new-lead action. Also cancel the full form, fail its save, recover an unrelated existing full draft, and change the lead draft while the full save is pending.

### R8-03 — P2: Match card-selection guidance to enforced card eligibility

Source evidence at discovery: Detail's `prepareAction()` at `miniprogram/pages/detail/index.ts:132` lists every active card from the activity's bank. For cards that fail its issuer/network/kind match, line 138 explicitly promises that manual recording is still possible. Those rows and the Continue action remain enabled. `domain/service.ts:77`, in `scopeFor()`, always requires an explicitly selected card to be owned, active, and matched; otherwise it raises `CARD_NOT_ELIGIBLE`. The current per-card service contract intentionally enforces matching and separate card scopes.

User impact: A user can deliberately select a card under the displayed manual-recording promise, proceed through a confirmed action, and receive an inevitable eligibility rejection. The selector offers a path that its authoritative service does not support. For a per-card activity with no matching card, the general no-match note makes the same inaccurate promise.

Remote confirmation: The reviewer selected an owned Macau-issued BOC Visa credit card for the annual Mastercard activity through the rendered sheet. The row was enabled and displayed the manual-recording promise. Continue issued `activity.join` with that card ID, received `CARD_NOT_ELIGIBLE`, closed the sheet, and showed the rejection toast. The existing Mastercard participation remained unchanged. Evidence: `.qa-native/prototype/candidate-r7/r8-ineligible-card-repro.json`, `r8-ineligible-card-promise.png`, and `r8-ineligible-card-rejected.png`. The round reviewer read the JSON and inspected both images.

Recommendation: Make card rows, Continue availability, and no-match guidance accurately express the existing service constraint. Show a useful explanation and a way to correct or add a matching card. Do not loosen the ownership or eligibility check to make misleading interface copy true. Preserve the distinct per-user flow that can record without selecting a card.

Acceptance: For a per-card activity, supply same-bank cards with a wrong network, issuer, or kind alongside a matching card. Check that unsupported choices cannot lead to a promised-success path, the reason is clear, and adding/selecting the matching card works. Repeat with no matching cards, direct completion/receipt, and an existing historical participation whose card details have since changed.

### R8-04 — P2: Resolve the selected image by ID after partial URL retrieval

Source evidence at discovery: `cloudfunctions/shared/assets.ts:78`, in `authorizedAssetUrls()`, deliberately omits assets whose cloud response has no successful HTTPS temporary URL. `miniprogram/services/api.ts:88-90`, in `previewAssets()`, filters the returned files into a URL array but still uses the original asset-array index to choose `current`. For original assets `[A, B, C]`, selecting B at index 1 and receiving only URLs for `[B, C]` selects C. Selecting unavailable A can silently open B.

Detail also replaces its rendered `entryImages` with available URL rows while its preview handler indexes the separate full asset list. The correction must preserve the actual clicked image identity through both the page and shared helper, including an initially partial thumbnail read followed by a different final URL response.

User impact: A user inspecting a specific rule or source screenshot can be shown a different screenshot, or see an unrelated available image instead of an explanation that the selected one failed. This is independent of request timing and gallery-membership guards.

Remote confirmation: The reviewer created three visibly distinct A/B/C image assets through the demo service and opened Full Submission with all three intact. The rendered B control was clicked, and only its final `assets.urls` response omitted A. The real shared preview helper passed `[B, C]` as `urls` and C as `current`; the displayed modal contained the green C image. No image was removed from the draft and no runtime exception occurred. Evidence: `.qa-native/prototype/candidate-r7/r8-gallery-repro.json`, `r8-gallery-before-click.png`, and `r8-gallery-click-b-shows-c.png`. The round reviewer read the complete JSON and inspected both images. This reproduction uses the same partial-response behavior already supported by the cloud URL adapter; it does not call the real cloud.

Recommendation: Retain the clicked asset ID through the final URL lookup, reconstruct the available gallery in the intended order, and resolve the selected URL from that ID. If the selected image is unavailable, give specific retry feedback instead of silently substituting another image. Keep the final validity callback, foreground check, latest-selection guard, and source/entrance gallery isolation.

Acceptance: With at least three distinct images, omit an earlier URL, omit the clicked URL, and reorder the URL response. Preview each remaining target from Lead, Full Submission's source/entrance galleries, and Detail. The intended image must open or be reported unavailable. Include an initially partial thumbnail set and a late obsolete URL response.

## Complete route checklist

| Route | Fresh action and state coverage | Source result |
| --- | --- | --- |
| `pages/todo/index` | All filters and deadline groups, primary/detail/progress/completion/receipt actions, skip/resume/undo, More sheet, history/tab shortcuts, retained refresh and stale locks | No additional finding |
| `pages/activities/index` | Bank rail/search/sheet, held-card filter/reset, subscriptions/sharing/detail, initial/refresh/page errors, retained pagination and obsolete-response guards | No additional finding |
| `pages/rewards/index` | Recorded/pending tabs, month/currency selectors and failed-scope labels, independent counts/totals, confirm/correct/detail, same-scope refresh, empty scopes and page retry | No additional finding |
| `pages/wallet/index` | Add/edit/nickname cards, shared/independent/archived accounts, expand/collapse, payment/undo/due dates, reminder preference/authorization recovery, matching activities and refresh locks | No additional finding |
| `pages/mine/index` | Status-specific attention queries, all menus, privacy explanation, operator entry, demo role, loading/error and response sequencing | No additional finding |
| `pages/detail/index` | All user/card scopes and lifecycle actions, card selection, progress/complete/receipt/correct/revoke, skip/resume/undo/tracking, expected-date editing and dirty leave, refresh recovery, rules/source/guide/images, reminders/history/deep links | R8-03 and R8-04 |
| `pages/progress/index` | Numeric and registration inputs, validation/focus, draft/leave, read-only/busy, version conflicts, latest registration comparison and explicit reapplication, save/return | No additional finding |
| `pages/receipt/index` | Amount/date/actual-month attribution and benefit terminology, new/corrected receipts, exact-card queries, transactional absence condition, draft recovery/migration, conflicts/reapplication, limits and save/return | No additional finding |
| `pages/history/index` | Global/activity scopes, filters/detail, retained pages and retries, audit loading/failure/close, independent request generations, progress and registration audit descriptions | No additional finding |
| `pages/card-edit/index` | Identity locks, all card/repayment fields, shared/independent choices, conditional errors and focus, drafts, save/remove locks and confirmation, late responses and safe return | No new native finding; prototype fallback in R8-01 |
| `pages/submissions/index` | Create, lead/full routing, all statuses/reasons, account recheck and hidden retained rows, retained window, pagination/retry and account/request changes | No independent finding; duplicate workflow result in R8-02 |
| `pages/submission-lead/index` | All required/alternative sources, image limits/cancel/upload/remove/retry/preview, drafts, conflicts/latest read, full-rule continuation, submit/update, access/read-only and return | R8-02 and R8-04; prototype fallback in R8-01 |
| `pages/submission-edit/index` | All four sections and conditional inputs, issuers/networks/dates/period/reward/entrances, switches, images/source reuse, localized errors and summaries, drafts/conflicts, submit/update/verify/publish/return | R8-02 and R8-04 |
| `pages/review/index` | Authorization and all statuses, hidden unverified content, retained pagination, disabled actions, initial/refresh failures, retry, account/permission changes and return | No additional finding |
| `pages/preferences/index` | Four switches, loading/unavailable, dirty leave, save lock, success/failure and return | No additional finding |
| `pages/web-entry/index` | Invalid/restricted/approved URLs, source address, loading/load/error, retry/copy and fallback return | No additional finding |

## Shared and cross-cutting checklist

| Area | Fresh review result |
| --- | --- |
| `components/app-sheet` | Read visibility/title/content observers, asynchronous measurement guards, viewport/keyboard bounds, safe areas, owner dismissal/busy lock, tab ownership, hide/show lifecycle, template and stylesheet. No additional confirmed defect. |
| `components/privacy-gate` | Read subscription/active-page lifecycle, policy success/failure, accept/reject, bounded scrolling, persistent actions and semantic labels. No additional finding. |
| `components/demo-notice` | Read explicit demo condition, readable disclosure, source projection and production-role separation. No additional finding. |
| Global/navigation/drafts | Read all route registration, five native tabs, direct-entry return, type/color/status hierarchy, targets, feedback, wrapping and fixed-bar clearance; owner/entity draft keys, recovery and revision-aware cleanup. R8-02 concerns one completed workflow, not the general navigation helper. |
| API/transaction integration | Read errors, retry IDs, production/demo distinction, image upload/preview, entrance decisions, reminder boundaries, exact-card queries, first-create assertion, version checks, actual receipt date, period snapshots, transactional ownership and idempotency. R8-04 is a preview identity mismatch; these data guards remain required. |
| Prototype generator | Fresh complete read of route/component binding inventory, WXML tokenizer and null-safe expression conversion, native selector mapping, preview-relative units/media, embedded assets, reused source controllers, forced demo configuration and output assembly. No additional finding. |
| Prototype runtime | Fresh complete read of controls/events, keyed rendering, focus/scroll and page/Tab lifetime, modal/sheet ownership and keyboard navigation, locator wrappers, serialized deep links, single departure coordination, privacy/platform adapters, fixtures/errors, storage/reset and startup. R8-01 concerns storage fallback. |
| Workbench | Fresh complete read and visual review of the connected flow overview, all routes/scenarios, source action list and conditions, shared operations, viewport controls, responsive shell and explicit simulation boundary. No additional finding. |

## Ten-category outcome and previous corrections

The ten-category review considered accessibility, touch interaction, performance, style, layout, type/color, motion, forms/feedback, navigation, and data presentation. The new findings concern reliability, feedback, workflow completion, and action/target accuracy. No additional evidence-backed style or layout redesign is recommended. Currency-specific totals, semantic status text, and visible labels remain intact. There is no chart interaction or implemented dark theme to certify.

The prior modal-focus, deep-link, keyed-list, retained-scroll, privacy/authorization, request-generation, conflict-recovery, and dirty-leave corrections were included in the current full pass. The round 7 sheet changes reveal keyboard targets, keep busy sheets focusable, respect platform-modal ownership, and allow the inspector to locate real controls inside wrappers. The revised history formatter accurately distinguishes registration-only, progress-only, combined, and incomplete legacy information.

The final round 7 image paths were reread after integration: image-set changes invalidate older reads; entrance and original-source galleries remain separate; a validity callback is checked after the final URL response; page disposal/departure and exact gallery membership are checked; each valid image selection now advances a preview sequence so the latest choice wins. None of these timing safeguards resolves the distinct final ID-to-URL mapping finding in R8-04.

Asynchronous native `widthFix` image decode and sheet height remain an explicit physical-WeChat observation point. Source alone does not establish a faulty native initial-image height or measured final viewport, and the browser sheet's adaptive height cannot prove that behavior. This is not counted as a confirmed new defect or a passed native test.

## Next gate and retained boundaries

Correct all four confirmed issues, regenerate from source, and run the relevant remote regressions plus complete required checks. The incoming 94-scenario artifact is the discovery baseline; it does not certify subsequent corrections. This completed findings round remains at clean count **0** after fixes. End the loop only after two consecutive complete reviews of the same stable final candidate find no new actionable recommendation.

Moderated public submissions remain in scope. No transaction, ownership, receipt-date, period-snapshot, version, eligibility, or idempotency guarantee should be weakened. No cloud deployment, real notification, experience upload, or production publication is performed. Physical WeChat rendering, keyboard/screen-reader integration, largest system text, privacy/image integration, real cloud authorization, subscription delivery, cross-mini-program navigation, and business-domain web views remain distinct integration acceptance boundaries.
