# Verification

Initial verification on 2026-09-20 ran on the designated remote environment, `ssh test-env`, with Node 20.19.2 and npm 9.2.0. The original downloadable delivery includes a `dist/` directory built remotely and copied back as files. Git intentionally excludes generated build output; repository checkouts must build it from source. Later in the same task, the user explicitly authorized local Windows installation, builds, tests, and simulator checks.

## Results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed with no errors |
| `npm test` | 62 passed, 0 failed, 0 skipped |
| `npm run build` | Native client and both cloud functions built successfully |
| Built-package structure | 15 pages, 3 custom components, 101 files |
| Built JavaScript | 22 files parsed; all static client dependencies resolved inside the package |
| Built client size | 422,329 source bytes, before platform packaging |
| Supplementary WXML/WXSS compilation | 18 templates and 19 stylesheets compiled with no stderr |

Tests cover period rollover and backfill, direct completion and receipt, actual receipt-month attribution, currency separation, correction and revocation, ownership and moderation, idempotency and conflicts, shared bills, bounded transactions, image authorization, and finite reminder authorization. UI contract tests cover routes, page and component files, event handlers, component registration, and WXML expressions. Demo integration tests exercise initial data, held-card filtering, persistent receipt records, and the moderator flow using mocked native storage APIs.

## Compiler boundary

The supplementary Linux syntax check uses the official `miniprogram-compiler@0.2.3` wrapper. Its bundled binaries identify themselves as:

- WCC: `v0.5vv_20200413_syb_scopedata`
- WCSC: `v0.4me_20190328_db`

These old binaries provide additional syntax evidence only. They do not establish rendering or interaction behavior in current WeChat DevTools or on phones. The check was run against the final built templates, including the injected demo notice and privacy gate.

The public `miniprogram-ci@2.1.31` project constructor requires a private key. No key was fabricated, and no credentialed CI preview or upload was attempted.

## Local simulator check

WeChat DevTools Stable 2.02.2608070 was installed on Windows and the project was imported with the user's test-account AppID in ignored `project.private.config.json`. The local runtime remains `mode: 'demo'`, with no cloud environment or live message delivery.

The demo loaded in the iPhone 12/13 (Pro) simulator with base library 3.17.3. Checks covered the five primary tabs, three seeded cards and their bills, empty-submission validation, the demo role selector, selecting a bank from the full-bank picker, and opening the monthly activity detail with its seeded 2/3 progress. Real rendering exposed the native v2 button width and margin defaults overriding project styles; the source styles now reset those defaults while preserving explicit per-page button sizes and multi-line button layouts. The privacy component's unsupported tag selector was also replaced with a class selector. The bank sheet did not appear with `inset:0`; replacing that shorthand with explicit top/right/bottom/left positions restored the mask and sheet. Both overlay components now use explicit edges.

An initial base-library route error did not recur after a full recompile. Subsequent navigation showed no runtime errors; DevTools still reported framework performance, preload, and hot-reload warnings. Local type checking, all 62 tests, and the source build passed after the final style changes.

## Scripted UI acceptance

The same user-authorized local task subsequently ran `npm run test:ui` through the official CLI and `miniprogram-automator@0.12.1`, without computer-use automation. The user enabled the CLI/HTTP service port once. All 11 UI scenarios passed with zero captured runtime exceptions. The run used the iPhone 12/13 (Pro) simulator, base library 3.17.3, and a 390px-wide viewport (671px high on the initial tab).

Fourteen SDK screenshots and measured element bounds provide evidence for the five tabs, task and activity geometry, bank-sheet search and selection, progress editing, completion and an 18.75 CNY receipt in the ledger, submission validation, and demo review access. The role-picker check explicitly triggers its change event; native picker gestures are not covered. Screenshot review confirmed that a navigation-title mismatch in an earlier capture was a transition-timing artifact, not a page configuration defect.

Acceptance found a real 32px-wide task "More" touch target; it now measures 48 by 48px and is covered by a minimum-touch-area assertion. A stable ID was added to the bank-sheet host so that the SDK can locate the custom component reliably. The final run restored and verified its demo storage snapshot before closing its isolated project. All 62 business/contract tests, type checking, and the source build also passed. See [Scripted UI acceptance](ui-acceptance.md) for the reusable command, artifact locations, and limits.

## UI/UX remediation acceptance

On 2026-09-21, the review findings were addressed and the explicitly authorized local checks were rerun. Type checking, all 109 automated tests, and the source build passed. The expanded SDK suite passed all 22 scenarios with zero captured runtime exceptions and produced 29 screenshots. It verified real same-name-card creation, skip/restore behavior, global history, currency counts, actual versus estimated amounts, demo reminder boundaries, and four local-draft recovery flows. Test data and draft keys were restored and verified. See [UI/UX remediation](ui-ux-remediation.md) for the complete finding-to-change mapping and acceptance limits.

## Product UX refinement delivery

The next refinement separates cashback receipts from instant discounts, groups unfinished tasks by urgency with one primary action, adds lightweight private activity leads, and replaces everyday card hashes with readable names. Lead-to-full-form navigation preserves input while prioritizing existing drafts. All 148 automated tests, TypeScript checking, and the source build passed.

The expanded 24-scenario SDK acceptance remains incomplete. An initial run recorded 16 passes and eight automation/navigation timeouts. After adding route and renderer stability diagnostics, the final run passed eight scenarios before the DevTools connection closed; three later cases failed on that closed connection and the suite stopped. Its isolated demo-storage restoration also could not run, so the ignored local backup was retained. The user then requested delivery to main and closure. These results do not supersede the earlier successful 22-scenario run or establish full acceptance of the latest changes. See [Product UX refinement](product-ux-refinement.md).

## Not yet verified

No production AppID or CloudBase environment was provided. Real iOS/Android devices, deployed CloudBase services and storage rules, platform privacy authorization, cross-mini-program navigation, and real subscription delivery have not been verified. Simulator smoke checks are not comprehensive device acceptance: keyboard behavior, all screen sizes, accessibility settings, and device-specific event propagation remain outside this check. Mocked SDK tests are not a substitute for deployed cloud integration.

No deployment, preview upload, publication, or live message sending was performed. The committed configuration retains demo mode, `touristappid`, and no credentials; the local test AppID is stored only in the ignored private configuration.

## Reproduction

Run on the designated verification environment after copying the source project:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The supplementary package and template checks are retained in the task's verification workspace, together with raw logs. They are intentionally separate from runtime dependencies.
