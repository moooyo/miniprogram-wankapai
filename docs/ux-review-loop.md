# Complete interaction prototype and review loop

Completed on 2026-09-23. Rounds 23 and 24 independently reviewed the same frozen final candidate and found no new actionable recommendation, satisfying the two-consecutive-clean-review exit condition. All confirmed findings through round 22 are implemented in the source and generated prototype.

## Deliverables

- A generated portable interactive prototype: `dist/prototype/index.html`.
- Source generation, browser adaptation and documentation in `scripts/prototype-build.mjs` and `prototype/`.
- Sixteen native pages, three shared components, and a generated inventory of every WXML binding and unique page/component handler identity.
- A route atlas, connected activity/card/submission/settings flows, conditional operation inventory, bank/card/date/rule/history sheets, and form/receipt/moderation scenarios.
- Explicit browser-only fixtures for latency, failed reads/writes, pagination, and actual version conflicts through the existing demo domain service.
- Native code fixes implementing the revised interaction design. The prototype consumes these same source files and business controllers.

## Review method and iteration ledger

UI UX Pro Max provided the primary review framework, supplemented by the frontend-design skill for the established blue-and-white visual hierarchy. Every complete round includes all sixteen registered routes, all three shared components, their bound operations and conditional states, navigation, forms, drafts, concurrency, recovery, accessibility and layout. Findings are concrete recommendations, not an instruction to create endless cosmetic churn.

| Round | Scope and outcome | Consecutive clean rounds |
| --- | --- | --- |
| 1 | Complete core and management inventories; fixed request races, local pagination failure, draft reload loss, date dismissal, deep-link return, form errors, privacy layout and readability | 0 |
| 2 | Complete review found nine further issues, including asynchronous sheet height, conditional validation targets, wallet refresh, attention hints, entrance wording and browser projection fidelity | 0 |
| 3 | Complete review found four further issues: retained refresh content, loaded pagination extent, browser navigation lifetime/position and switch naming | 0 |
| 4 | Complete review found three further issues: selected-month feedback, long-sheet scroll restoration, and unverified private-list visibility | 0 |
| 5 | Fixed image-picker cancellation, Detail refresh, registration conflict context, simultaneous first-receipt creation, and repeated sheet departure prompts | 0 |
| 6 | Fixed platform-dialog focus ownership and record parameters lost after browser Back | 0 |
| 7 | Fixed stale image-gallery requests, keyboard sheet navigation, and registration audit descriptions | 0 |
| 8 | Fixed browser storage fallback consistency, the lead-to-full completion destination, card eligibility choices, and image URL identity | 0 |
| 9 | Fixed preview requests after explicit context dismissal, stale retry intentions after inverse operations, and creation identity across restored drafts | 0 |
| 10 | Fixed native bundle dependency resolution, date-bound recovery, billing-period targeting, separate consent events, and delayed sheet ownership | 0 |
| 11 | Fixed workbench refresh consent, stopped-account reminder availability, month-start demo initialization, Preferences callback ownership, and participation-only notification links | 0 |
| 12 | Fixed receipt draft period/record targeting and legacy card replay safety | 0 |
| 13 | Fixed workbench operation ownership, same-period receipt recovery after participation creation, and undispatched cross-period receipt recovery | 0 |
| 14 | Fixed stale review scenario effects, foreground receipt date bounds, long sheet titles, and read-only recovery of a saved card whose pending marker could not be stored | 0 |
| 15 | Fixed receipt initialization across midnight, explicit HTTPS default-port consistency, privacy-decline guidance, and switch-label projection | 0 |
| 16 | Fixed late Detail refresh clearing another page's leave warning, unsupported native sheet-title selector, and interrupted browser IME composition | 0 |
| 17 | Fixed the hidden target-refresh action when a same-period card draft refers to a replaced billing account | 0 |
| 18 | Fixed the existing Receipt save boundary during authoritative date preflight while retaining editable ordinary date refreshes | 0 |
| 19 | Fixed prototype Web Entry URL decoding without changing canonical route parameters or native URL policy | 0 |
| 20 | Fixed obsolete session reads overwriting the shared cache after a demo-role change or a newer read | 0 |
| 21 | Fixed Mine identity/count coupling, disclosed reminder preference prerequisites with direct-tap authorization, and retired delayed pagination feedback | 0 |
| 22 | Fixed delayed concurrent-edit simulation feedback overwriting a newer prototype scenario | 0 |
| 23 | Complete independent source, operation, state, script and visual review of the unchanged final candidate; no new actionable recommendation | 1 |
| 24 | A second complete fresh review of the same source and artifact, including an independent lead and root markup/visual pass; no new actionable recommendation | 2 |

The loop is closed. Rounds 23 and 24 were complete new reviews of the unchanged source fingerprint and prototype identified below; neither found a new actionable recommendation. Earlier finding rounds were not retrospectively counted as clean after their corrections. Historical findings and acceptance limits remain documented.

Detailed review records: [core implementation](ux-loop-core.md), [management implementation](ux-loop-management.md), [round 2](ux-loop-round2.md), [round 3](ux-loop-round3.md), [round 4](ux-loop-round4.md), [round 5](ux-loop-round5.md), [round 6](ux-loop-round6.md), [round 7](ux-loop-round7.md), [round 8](ux-loop-round8.md), [round 9](ux-loop-round9.md), [round 10](ux-loop-round10.md), [round 11](ux-loop-round11.md), [round 12](ux-loop-round12.md), [round 13](ux-loop-round13.md), [round 14](ux-loop-round14.md), [round 15](ux-loop-round15.md), [round 16](ux-loop-round16.md), [round 17](ux-loop-round17.md), [round 18](ux-loop-round18.md), [round 19](ux-loop-round19.md), [round 20](ux-loop-round20.md), [round 21](ux-loop-round21.md), [round 22](ux-loop-round22.md), [round 23](ux-loop-round23.md), and [round 24](ux-loop-round24.md). Each records complete scope, findings, incoming evidence, and acceptance boundaries. Separate records explain the [first-receipt guard](ux-loop-receipt-guard.md), [client retry intentions](ux-loop-client-retry-intent.md), and [native package integrity](ux-loop-native-package.md).

## Resulting behavior

Lists retain their loaded range when returning from a detail or editor. Refreshes preserve content until the entire same-filter window has been reconciled; failed refreshes identify the retained data and provide retry. Dependent task, bill and reward operations are locked while their data is stale. Filter changes cannot mix old rows or cursors into the new result, and moderation lists recheck the current session.

Failed pagination preserves the previous cursor and all read rows. Late audit requests cannot replace another record's history. Sheets remeasure asynchronous content, keep safe-area limits, and respect owner-controlled dismissal. Expected-date edits require explicit discard and cannot change during save.

Card and submission forms expose linked error summaries. Conditional errors disappear when their fields stop applying, and every remaining error has a visible destination. Conflict reloads retain the current input and recovery draft until an authorized fresh result arrives. Navigation has a safe direct-entry fallback. Web-entry labels match the dispatcher decision and failed embedded navigation has a copy/retry path. Month selectors show their selected scope during failure as well as success. Private submission content stays visually and semantically hidden until the current account has been verified; its layout space is retained. Browser sheets preserve their internal scroll and selection after state updates.

Supporting native copy is at least 14 px, primary form content remains 16 px, key actions have 48 px targets, and narrow layouts wrap. Cashback and instant-discount language remain distinct. Public submissions, authenticated moderation, ownership, transactions, actual receipt-date attribution, immutable period snapshots, optimistic versions and idempotency are retained.

Image galleries keep the selected asset identity when URLs are delayed, reordered, or missing. Dismissing a gallery context or choosing a newer image invalidates the old request. Image-picker cancellation preserves existing input and errors. New form instances carry separate creation identities, while an explicitly restored uncertain creation can recover its original result. Successful inverse mutations retire old retry intentions without removing immediate lost-response safety.

Card metadata changes omit untouched billing settings. Changes to recurring rules preserve existing bill snapshots; an actual date correction identifies the displayed bill and period. A stale new-account date requires an explicit period update with retained input. Exact unresolved creations can recover across midnight, while an uncommitted expired submission is still rejected. Each new native subscription consent has its own identity. Detail sheets are mutually exclusive, and switching to a guide cancels an obsolete card-selection read.

The prototype retains native page instances, route parameters, focus, and scroll. Platform dialogs and sheets own keyboard focus; background controls are inert. Its storage fallback consistently reads the newest same-session value and explains when persistence is unavailable. These browser adaptations are separate from native platform acceptance.

Receipt recovery checks the original activity, card scope, period, participation, request payload and creation identity. An exact same-period draft remains recoverable after a participation acquires an ID. Uncertain cross-period requests use a read-only original-result lookup; an ordinary draft whose command was never dispatched remains editable. A retained card draft can explicitly check its identifiable original result without bypassing nickname validation or creating a missing request.

Workbench navigation respects pending source operations and initial draft recovery. Scenario effects, temporary roles and delayed feedback belong to the initiating page and role generation. A newer scenario invalidates earlier continuations. Receipt foreground date refreshes retain the original record, snapshot and user input. Shared sheet titles wrap while reserving the close control.

Date freshness also covers initial Receipt reads that cross midnight. Web-entry labels and the destination share exact-host validation and normalize the default HTTPS port. Privacy refusal has distinct optional-retry guidance. Projected switch labels activate the real control. Detail's global leave warnings and feedback affect only its current foreground page. The native sheet title uses a supported class selector, and browser composition preserves the live input until the IME session finishes. An obsolete Card billing target exposes an explicit reread action, retains entered values, and requires the actual date to be reviewed before applying it to the current bill.

An existing Receipt save remains busy throughout its authoritative date check, validation and command, preventing edits from silently changing an already initiated submission. A failed check unlocks the retained draft, while ordinary foreground date refreshes remain editable and never submit. A page departure cancels an undispatched preparation. The prototype separately adapts Web Entry's load parameter to its source decoder while preserving canonical route options, so encoded URL content survives copying, reload and Back navigation.

Shared session caching accepts only the latest read in the current identity generation. A demo-role change invalidates older pending cache writes without altering each caller's result, cache lifetime, force refreshes, or server authorization. The demo selector remains unavailable in production mode.

Mine applies a verified identity independently of secondary submission counts. Count failures use a separate retry state and generic menu wording; identity failures hide unverified role controls. Detail checks the relevant reminder preference before preparing authorization, offers Settings when disabled, and reports read failures without consuming a grant. A distinct authorization tap invokes the native API synchronously, and prepared consent is invalidated on departure or record refresh. The worker still respects the global preference. Pagination and concurrent-edit simulation feedback remain tied to the original ready page after their asynchronous operations.

## Final remote verification

Verification ran only on `ssh test-env`, with Node 20.19.2. No local Windows executable verification was authorized or performed.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 720 passed, 0 failed, 0 skipped |
| `npm run build` | Passed; native client and both cloud functions built by `scripts/build.mjs` |
| Native package integrity | Passed for 16 pages, 3 components, 2 services, 1 app and 1 configuration file; 23 JavaScript modules |
| `npm run prototype` | Passed; generated directly from current native sources |
| Browser acceptance | 175 passed, 0 failed, 0 runtime exceptions |
| Browser evidence | 288 screenshots, three contact sheets, a desktop workbench overview, 115 source handlers exercised through rendered UI |
| Reminder integration simulation | 14 passed through actual controllers, API, domain and worker with mocked native/cloud transport and a dummy sender |
| Layout coverage | All 16 routes at 320 x 720, 375 x 812, and 768 x 375; nested 320-width desktop preview also checked |

The frozen report is `.qa-native/prototype/candidate-r22/index.html`; its exact interactive snapshot is `interactive-prototype.html` in the same directory. It incorporates all source corrections through round 22 and completed at `2026-09-22T23:36:59.955Z`. Prototype SHA-256: `8b597449860dd4dd7ee2f0cda299382d5e79548b22d56bef196b49cac9169b35`. Source fingerprint: `1c09a1b4f16c6ec92af188195819fe06c75fe0e418f44f217e02871749090b21`, covering 147 files with unchanged identity throughout the run. Report SHA-256: `e81e2e00d2c1f75bae13f1be67bd6036b244ad9f0dc8c43b70d9804e952fecf7`. The artifact manifest has SHA-256 `1041949b673f6f590a7611ecb3b6cfc098c8d5c765f4cf54d3c0047b57e35ec5`. The only captured HTTP 404 is the browser's favicon request; no UI resource failed to load. Native/cloud build output and the generated prototype were copied back from the remote environment without local execution or hand editing.

The inventory covers 274 source bindings and 193 unique handlers; 115 unique handlers were exercised by browser scenarios. Those numbers are intentionally distinct. Passing representative end-to-end scenarios does not imply every possible data combination or platform operation was tested. The separate 14-path reminder report belongs to this same prototype and records unchanged hashes for nine relevant source files. It checks disabled-preference guidance, read failure/retry, a separate synchronous authorization tap, acceptance/refusal, and readiness invalidation on hide/reload. These checks are not included in the 175 browser checks and do not claim physical native authorization or actual message delivery.

The final run uses task-owned disk-backed browser temporary files and evidence under `/var/tmp`; `runtime-environment.json` records these paths and filesystem state. Earlier Chromium failures caused by the saturated shared `/tmp` remain in their original iteration evidence. The final 175 cases ran together successfully; passing cases from failed attempts were not assembled into this result. The historical WCSC diagnostic comparison is included only after all four component source hashes match the current manifest. It verifies removal of that diagnostic in the available 2019 compiler, not modern native rendering.

The delivered workspace source was archived without executing it locally and checked in a separate remote directory against the final source manifest. All 147 files matched. This copy check did not modify the frozen verification checkout; its output is `.qa-native/prototype/delivery-source-check.log`.

## Remaining native integration boundary

The designated remote environment is Linux and the acceptance above uses a source-linked Chromium projection. It does not establish current WeChat DevTools or physical-device rendering, native keyboard/screen-reader/large-text behavior, actual privacy/image authorization, real CloudBase rules, cross-Mini-Program navigation, approved web-view domains, or subscription delivery. The existing native SDK runner remains available for an appropriately authorized environment. These limitations are not labeled as passed.

No cloud function was deployed, real notification sent, experience version uploaded, or production release published. Production credentials, category approval and account authorization remain deployment prerequisites; moderated public submissions remain part of the product.
