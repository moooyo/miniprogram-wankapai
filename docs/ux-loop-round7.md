# Complete UI/UX review: round 7

## Result and scope

Round 7 found three new actionable issues: two P2 interaction defects and one P3 audit-description defect. All three were confirmed through focused remote browser interaction after the source review. The consecutive clean-review count remains **0**. Fixing a finding during this round does not make the round clean.

This was a fresh complete review of the frozen round 6 candidate, not only a regression check. The team reread every TS, WXML, WXSS, and JSON file for all 16 registered routes and all three shared components. The round reviewer covered the six primary/detail routes, shared components, global configuration/styles, API, navigation, drafts, entrance dispatch, privacy, display helpers, and transaction integration. Independent read-only reviewers covered the seven management routes, the three progress/receipt/history routes, and the complete prototype generator/runtime/workbench. The round reviewer independently reread the mechanisms behind every finding and inspected the corresponding remote evidence.

The UI/UX Pro Max skill, all ten quick-reference categories, the professional checklist, the interaction-design contract, and the complete round 5 and 6 records were applied. Accessibility, touch interaction, recovery, state continuity, forms, navigation, and responsive behavior received priority. The product remains a Chinese-language, light-themed native WeChat utility. No unsupported web framework convention was imposed as a native requirement, and no speculative visual redesign was counted as a finding.

No local executable validation, build, test, or runtime probe was run. Local work consisted of source/document reads and inspection of remotely produced files. Executable verification and the focused reproductions ran through `ssh test-env` under the main task's remote acceptance workflow.

## Candidate and visual evidence

The main task reported a successful complete remote type check, **263/263 business/controller tests**, and the source build from `scripts/build.mjs` before this review. The reviewer read `.qa-native/prototype/candidate-r6/report.json`, completed at `2026-09-22T16:45:10.002Z`. It records **88 passed browser scenarios**, **0 failures**, **95 screenshots**, **0 runtime exceptions**, and **73 source handlers exercised through browser UI**. The generated inventory contains **16 routes**, **3 shared components**, **262 bindings**, and **184 unique source handlers**. Inventory completeness does not mean every branch was executed.

The reviewed prototype SHA-256 is `85a80717e8f3881f3ef9f2689594a4bd086ee8d3c5641ac04cad9a3dc3de2cf9`. The following current-candidate images were inspected in full:

- `candidate-r6/contact-sheet-375.png`
- `candidate-r6/contact-sheet-320.png`
- `candidate-r6/contact-sheet-768-landscape.png`
- `candidate-r6/workbench-overview.png`

These images show coherent hierarchy, readable narrow-width controls, normal switch tracks, source-based disclosure text, and the connected route/operation workbench. No additional concrete page-layout defect was found. The old candidate-r5 report was not treated as final evidence. The three focused reproductions below cover paths absent from the 88 passing scenarios; the passing suite does not override their observed behavior.

## New actionable findings

### R7-01 — P2: Keep deleted images out of a delayed Full Submission preview

Source evidence at discovery: `miniprogram/pages/submission-edit/index.ts:308-312` allowed `removeImage()` during `loadingImages` and removed the ID from the draft and current `assets`, but did not invalidate `imageGeneration`. `loadImages()` captured the old IDs at line 325 and later wrote the entire response into `assets` and `assetUrls` at line 331. `previewImage()` at lines 337-342 then passed all cached assets to `previewAssets()`. The page calls `loadImages()` without awaiting it during initial loading, so these controls are reachable while that read is pending. The Lead editor already has generation invalidation and current-ID filtering for its corresponding path.

Remote reproduction: A full submission contained entrance images A and B, with no source-image IDs. The reviewer deferred the initial `assets.get` and `assets.urls` results, removed A through its rendered control, released the original results, and previewed B through the rendered remaining row. The UI and draft contained only B, but the actual `wx.previewImage` call received both A and B in `urls`, with B as `current`. `.qa-native/prototype/candidate-r6/r7-image-repro.json` records this complete sequence and the exact preview arguments. The associated images are `r7-image-before-remove.png`, `r7-image-removed-while-loading.png`, and `r7-image-preview-b.png`.

User impact: A removed attachment is absent from the form yet remains available in the native preview gallery. This undermines confidence that removal took effect and lets the preview disagree with the content that will be submitted. The stored draft IDs were not restored; the defect is the inconsistent preview/cache state.

Recommendation: Invalidate older image reads whenever the effective image set changes, synchronize cache/loading state, and filter previews against the current valid image set. Preserve source images that remain intentionally available as original evidence rather than treating every removed entrance reference as deletion of the source asset.

Acceptance: Repeat removal during a deferred read, failure and retry, removal of the last image, add/remove/reuse-source operations, and preview after each transition. Deleted entrance-only assets must never return through a late result; retained source evidence must remain accessible. An obsolete request must not overwrite loading or validation feedback belonging to a newer request.

### R7-02 — P2: Keep sheet keyboard focus visible and inside the active sheet

Source evidence at discovery: `prototype/runtime.js:417-418` uses `focusPageControl()` for sheet Tab wraparound. That helper always calls `focus({ preventScroll: true })`; its `getClientRects()` check only establishes layout presence, not visibility inside the scroll container. Shift+Tab from the top close control can therefore focus the last offscreen action without revealing it. Separately, when a sheet rerender disables its previously focused control, focus restoration can fail without placing focus on the sheet itself. The underlying page is not inert for native-style sheets, allowing subsequent Tab navigation to enter background controls.

Remote reproduction: In the 768 by 375 px landscape preview, Shift+Tab from the card sheet's close control moved focus to the final action at y=1272.9 while `sheet-body.scrollTop` remained 0. A second case saved an expected date with the request delayed; all sheet controls became disabled, and Tab reached the background copy-link action. Evidence images are `.qa-native/prototype/candidate-r6/r7-sheet-backward-focus-offscreen.png` and `r7-sheet-busy-focus-escape.png`.

User impact: Keyboard users can act on a control they cannot see, or navigate to obscured page actions while a busy nondismissible sheet remains visible. This is a browser-projection defect, distinct from the corrected platform-modal ownership issue in round 6 and not a claim about native WeChat keyboard behavior.

Recommendation: Separate passive focus restoration from active keyboard navigation; active navigation must reveal its target within the sheet. Give the sheet a safe focus target when no action is enabled, maintain focus ownership through rerenders, and exclude the background from keyboard interaction while the sheet is active. Preserve platform-modal priority and the existing scroll restoration for ordinary state updates.

Acceptance: Exercise Tab and Shift+Tab through long sheets in both directions, including wraparound, at phone and short-landscape sizes. Keep the focused control visible. During a pending save that disables every control, focus must remain inside the sheet with no background Tab escape. After completion or dismissal, restore a meaningful visible destination without interfering with an active platform dialog.

### R7-03 — P3: Describe registration changes in the operation history

Source evidence at discovery: `miniprogram/pages/history/index.ts:40-41` described `participation.progress` using the before/after numeric progress and added registration wording only when the new `registeredAt` value was truthy. The same command also changes registration, and positive progress retains the `in_progress` stage regardless of registration. Clearing registration while leaving progress unchanged therefore produced a description that did not identify the actual change.

Remote reproduction: The reviewer kept progress at 2, unchecked the registered control, and saved through the Progress form. The stored record correctly had `progress: 2` and `registeredAt: null`. The newest History operation showed only `2 -> 2` with the progress unit; it did not state that registration changed from registered to unregistered. The preceding seeded operation did show the registered state. Evidence: `.qa-native/prototype/candidate-r6/r7-registration-audit-ambiguous.png`.

User impact: The audit entry looks like a no-op even though the user's registration record changed. This is an information-clarity defect, not a failed save or data-integrity defect.

Recommendation: Describe registration before/after values when they change, alongside any progress change. Preserve an appropriate description for progress-only changes and avoid inventing a previous state when older audit data does not provide it.

Acceptance: Change only registration in both directions with positive progress, change progress without changing registration, and inspect a legacy audit item without a complete prior state. Each summary must accurately explain the known change without implying an unknown historical value.

## Complete route coverage

Every row covers the fresh complete controller, template, stylesheet, configuration, all bound actions, and applicable initial/loading/refreshing/empty/failure/success/disabled/read-only/conditional states. A source conclusion is not physical-device acceptance.

| Route | Actions and states reviewed | Round 7 conclusion |
| --- | --- | --- |
| `pages/todo/index` | Three filters, deadline grouping and switch, next action, detail/progress/complete/receipt, skip/resume/undo, More sheet, history and tab links, retained refresh and stale locks | No new actionable finding |
| `pages/activities/index` | Bank rail/search/sheet, held-card filter, clear filters, subscriptions, sharing, detail, initial/refresh/page failures, retained window, obsolete reads and pagination | No new actionable finding |
| `pages/rewards/index` | Recorded/pending tabs, month/currency filters, failed-scope label, independent counts/subtotals, confirm/correct/detail, same-scope refresh, stale locks, empty scope and pagination | No new actionable finding |
| `pages/wallet/index` | Add/edit/name cards, independent/shared/archived accounts, expand/collapse, payment/undo, due dates, reminders and preference recovery, matching activities, retained refresh | No new actionable finding |
| `pages/mine/index` | Pending/returned attention queries, every menu entry, privacy explanation, moderator entry, explicit demo-role change and load/error handling | No new actionable finding |
| `pages/detail/index` | All user/card participation actions, another card, progress/complete/receipt/correction/revoke, skip/resume/undo/tracking, expected-date editing/dirty close/save/clear, refresh reconciliation, rules/source/guide/images, reminders/history/deep links | No new native finding; projected sheet focus in R7-02 |
| `pages/progress/index` | Progress and registration, validation/focus, draft/dirty leave, busy/read-only, registration comparison, conflict/latest read/reapply, successful save and safe return | No new actionable finding |
| `pages/receipt/index` | Actual amount/date/month attribution, cashback/discount copy, create/correct, exact-card queries, transactional absence guard, draft recovery/migration, conflicts/reapply, date limits, save/return | No new actionable finding |
| `pages/history/index` | Global/activity scope, filters/detail, retained window, page failures/retry, audit loading/error/retry/close, independent requests, audit descriptions | R7-03 |
| `pages/card-edit/index` | Identity locks, bank/issuer/kind/network/nickname, conditional repayment, shared/independent accounts, error summaries and focus, drafts, save/remove locks/confirmation and safe return | No new actionable finding |
| `pages/submissions/index` | New lead, lead/full routing, statuses and reasons, identity verification and hidden retained rows, pagination/retry, account and request changes | No new actionable finding |
| `pages/submission-lead/index` | Required/source alternatives, image limits/add/remove/cancel/preview/retry, drafts, conflict/latest read, conversion, submit/update, ownership, published read-only and return | No new actionable finding |
| `pages/submission-edit/index` | All four groups and conditional fields, issuer/network/date/period/reward/entrance inputs, upload cancellation and localized errors, source reuse, error links, drafts/conflicts, submit/update/verify/publish/return | R7-01 |
| `pages/review/index` | Permission verification, all statuses, hidden unverified content, retained pagination, disabled paging, initial/refresh errors, retry, account change and revoked permission | No new actionable finding |
| `pages/preferences/index` | Four settings, unavailable/loading state, dirty leave, save lock, success/failure and return | No new actionable finding |
| `pages/web-entry/index` | Invalid/restricted/approved URLs, source address, loading and load/error events, retry/copy and fallback return | No new actionable finding |

## Shared, service, and prototype coverage

| Area | Fresh review conclusion |
| --- | --- |
| `components/app-sheet` | Visibility/title/content observation, asynchronous measurement guards, dynamic content growth, keyboard/viewport bounds, safe area, owner dismissal, busy lock, tab ownership and lifecycle were reviewed. No new native finding. |
| `components/privacy-gate` | Observer subscription, active-page behavior, policy read/failure, agree/reject resolution, bounded scrolling and persistent actions were reviewed. No new native finding. |
| `components/demo-notice` | Explicit demo condition, readable disclosure, source projection and production separation were reviewed. No new finding. |
| Global configuration and navigation | All JSON route/configuration files, five tabs, ordinary/deep-link return, page styling, Chinese interface, action sizing, feedback, wrapping and fixed-bar clearance were reviewed. No additional independent finding. |
| Services and transaction boundary | API error and retry behavior, demo authorization distinction, entrance decision/labels, privacy events, owner/entity draft keys, revision-aware cleanup, card naming, amount/period/benefit copy, `expectNew`, exact-card scope, version assertions, actual-date attribution, snapshots and transactional idempotency were reviewed. No new finding. |
| Prototype generator | Every route/component/action inventory, WXML expression/condition/loop handling, native type-selector mapping, viewport units/media projection, embedded assets, source controller reuse and explicit demo configuration were reread. No new finding. |
| Prototype runtime | All adapters, page/Tab lifetime, retained main/internal scroll, stable `wx:key` identity, explicit focus, platform-modal ownership, serialized route options, departure coordination, sheets, privacy, fixtures, uploads/clipboard/entrances, isolated storage/reset were reread. R7-02 is the new defect. |
| Workbench | Complete route atlas and flow overview, scenarios, state controls, action locations/conditions, shared-component operations, viewport controls, responsive chrome and simulation disclosures were reread and visually inspected. No new finding. |

## Ten-category outcome

Accessibility and touch/interaction found the sheet keyboard issue. Forms/feedback and data clarity found the image-preview inconsistency and registration audit omission. Performance, style consistency, responsive layout, typography/color, motion, and navigation were checked without another evidence-backed recommendation. There are no charts to audit; financial amounts and statuses remain textual, currency-specific, and paired with labels. The application does not implement a dark theme, and native system-text enlargement remains a separate device check rather than a passed browser check.

The round 5 cancellation, Detail reconciliation, registration comparison, first-receipt concurrency, and dirty-sheet navigation corrections are present in the new source and covered by the current remote suite's relevant scenarios. The round 6 modal focus ownership and route-parameter serialization corrections, plus stable list identity and localized native upload errors, were reread. Their corrections do not imply that every neighboring interaction is covered; R7-02 records a distinct sheet behavior.

## Integration and next gate

During integration, the reviewer reread the corrected History page in full. Its shared audit formatter now distinguishes registration-only, progress-only, and combined changes, and does not invent missing legacy values. The Full Submission page was also reread in full: image-membership changes invalidate old reads, caches are filtered to current IDs, and entrance/source previews use their respective image sets. A final source reread also confirms that `previewAssets()` now accepts a validity callback and checks it after URL resolution, immediately before opening the native preview. The editor checks page ownership, disposal, load generation, departure sequence, and the exact current gallery membership; a changed or abandoned preview request returns without opening or writing obsolete error feedback.

The revised prototype sheet focus chain was reread across rendering, platform dialogs, sheets, and navigation. Active keyboard movement reveals its destination, empty/busy sheets retain focus on a named focusable panel, and background content becomes inert while the sheet owns focus. The operation-locator tail item was subsequently reread and closed: it resolves an enabled real control inside an event wrapper, or scrolls a permitted container, while respecting platform-modal and active-sheet ownership. No further source correction remained at round closure.

The incoming 88-scenario artifact is the discovery baseline. The main task subsequently reported the corrected source passing complete remote type checking, **292/292 tests**, and the source build. Corrected browser evidence is `.qa-native/prototype/candidate-r7/report.json`: **94/94 scenarios**, **102 screenshots**, and **0 runtime exceptions**, with artifact SHA-256 `32bf6bfc476b4093782e0a9812b3e530f3574643704ea731f9db1a6e8a730bf8`. The remote reviewer confirmed the image gates, registration audit description, short-landscape and busy-sheet focus, nested platform dialogs, and wrapper-control operation locator through rendered UI. Before images in this document describe the findings at discovery, not remaining defects in that corrected artifact.

After integration, start a fresh complete review. Exit only after two consecutive full reviews of the same stable final candidate find no new actionable recommendation. Round 7 remains at clean count **0**.

Moderated public submissions remain in scope. No transaction, ownership, actual receipt date, period snapshot, version, or idempotency guarantee was relaxed. No cloud function deployment, real notification, experience upload, or publication was performed. Native WeChat rendering, physical keyboard and screen-reader behavior, largest system text, actual privacy/image integration, real cloud authorization, subscription delivery, cross-mini-program navigation, and configured business-domain web views remain separate acceptance boundaries.
