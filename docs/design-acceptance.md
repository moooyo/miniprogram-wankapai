# Native design acceptance

The design acceptance runner uses the official WeChat developer tools CLI and `miniprogram-automator`. It exercises a source-built, isolated copy of the mini program in the local developer tools simulator. It does not use computer-use automation.

## Run

The user must explicitly authorize local verification. Build the current source before running acceptance:

```powershell
npm run build
node scripts/design-acceptance.mjs
```

`npm run test:ui` and `npm run test:design` build from source and run this current design suite. `test:ui:legacy` retains the previous design's historical scenarios and is not the acceptance entry point for this rewrite.

The test AppID is read from the uncommitted `project.private.config.json` or `WECHAT_TEST_APPID`. `WECHAT_DEVTOOLS_CLI` can select another official CLI installation or the project's diagnostic wrapper. The runner refuses production mode or a configured cloud environment. It does not deploy functions, send WeChat subscription messages, upload versions, or publish production activities. Publication scenarios exercise the isolated demo domain only.

On this Windows installation, the official CLI's fixed callback port 3799 is unavailable. The local acceptance uses `scripts/wechat-cli.ps1`, which runs the installed official CLI with an available callback port chosen for that process. It changes the single callback declaration in memory and does not modify the installed application or operating-system settings. Set `$env:WECHAT_DEVTOOLS_CLI = (Resolve-Path 'scripts/wechat-cli.ps1').Path` before running acceptance. A nondefault installation can be selected with `WECHAT_DEVTOOLS_INSTALL_DIR`. The adapter fails closed if the official declaration changes.

The runner leaves its isolated developer tools project open for review by default. Set `$env:WECHAT_DESIGN_KEEP_OPEN = '0'` to close it after the report is saved. The automation connection is always disconnected. The report records the actual simulator viewport rather than assuming the reference canvas.

## Evidence

Each run produces `.qa-native/design-acceptance/<timestamp>/index.html`, `report.json`, native screenshots, route stability diagnostics, protocol errors, and source/build SHA-256 manifests. The source manifest includes `miniprogram`, `domain`, and `shared`. `acceptance-harness-manifest.json` records the exact runner, scenarios, route helpers, and two CLI adapter files. `.qa-native/design-acceptance/latest.json` points to the latest report. The application source, domain source, shared contracts, copied build, and acceptance harness must remain unchanged for the duration of acceptance.

The report covers all 19 configured native routes and the four tabs: progress, activities, cards and benefits, and account. Activity scenarios exercise bank filtering, the dynamic match count, 60 by 80 thumbnails, the custom viewer and pagination, prejoin eligibility/card selection, four cycle types, withdrawal, preserved progress, pending-task exclusion, history, and rejoin. Actual consumption commands append two ledger rows, reach the target, revoke both rows, preserve their history, and restore the original participation. Six benefit categories use owned holdings, distinguish information benefits from visit quotas, and display registered points. An isolated bill amount is corrected, reloaded, and restored without changing its identity, period, due date, or repayment state. Form scenarios exercise explicit demo OCR, manual-field preservation, OCR regions and undo, reward filtering, date constraints, custom cycles, and pending moderation. The review list exercises inline reward/cycle editing, its source gate and review-specific viewer, then transfers the actual inline draft to the full editor. Existing progress/receipt/card forms, holdings, lounge lookup, review permissions, source checks, settings, history, and the unconfigured web-entry fallback are also visited.

The installer `getApp().installDesignDemoFixtures()` is guarded by demo configuration. It augments the ordinary demo store only in the isolated acceptance project, using idempotent fixture IDs. Demo and form-draft storage are backed up and restored after every run, including failed runs.

## Interpretation

The handoff reference is `D:/Code/design_handoff_activity_features`, with a 402 by 874 logical-pixel canvas. Recorded measurements compare rendered native dimensions and computed styles with the handoff's card, thumbnail, cycle-chip, and screenshot-viewer metrics. The report distinguishes the actual viewport from that reference. A different viewport is not equivalent to an exact-canvas pixel comparison.

Screenshots are captured by `miniprogram-automator` after native rendering stabilizes. Rendering, application data, domain responses, and layout are never mocked. OCR starts from an owned pending lead created through the real demo domain service, referencing a bundled fixture image. Its demo recognition response and native form handlers are real. The operating-system image picker and upload are not exercised. Native picker change events exercise the picker component and application handler, while the operating-system date-wheel gesture remains outside that evidence. One operation-scoped platform recovery-dialog callback confirms the exact inline review draft, owner, submission, base version, reward/cycle values and dialog text; loading and transferring that application draft remain real. The callback is restored immediately afterward. These limits are recorded in the report.

Simulator evidence does not validate physical devices, real OCR providers, account authorization, deployed cloud services, notification delivery, photo-album permission, or publishing. Pixel fidelity still requires reviewing the native screenshots against the exact design reference; numerical geometry checks alone do not establish complete visual equivalence.
