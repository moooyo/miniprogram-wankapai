# Scripted UI acceptance

The UI acceptance runner uses the official `miniprogram-automator` SDK and the WeChat DevTools CLI. It does not use desktop screenshots, coordinate clicking, or computer-use automation. Screenshots are captured by the SDK from the running Mini Program and can be reviewed separately.

## Prerequisites

- Install and sign in to WeChat DevTools.
- Enable the service port for CLI/HTTP calls in DevTools security settings. This is a one-time setup step; expired login sessions may still require user action.
- Store your own test AppID in the ignored root `project.private.config.json`.
- Keep `miniprogram/runtime-config.js` in demo mode with an empty cloud environment.
- Follow the repository's execution policy. Local verification requires explicit authorization for the current task; this setup is not blanket permission for future tasks.

Run from the repository root:

```powershell
npm run test:ui
```

The npm pre-script builds from source using `scripts/build.mjs`. The runner then copies those exact client artifacts into a unique ignored acceptance project, enables automation for that project, and connects through a local WebSocket. On Windows it launches the official CLI through PowerShell so that paths containing spaces work with modern Node versions.

To use a different installation path:

```powershell
$env:WECHAT_DEVTOOLS_CLI = 'D:\Tools\WeChatDevTools\cli.bat'
npm run test:ui
```

`WECHAT_TEST_APPID` can override the private AppID for a dedicated test account. The runner refuses cloud mode and refuses to run on physical devices. It does not deploy functions, upload preview packages, publish, or send subscription messages.

## Coverage

- Chinese content and loading/error states on all five primary tabs.
- Actual button sizes, full-width content, vertical task content, and non-overlapping task actions.
- Fixed bank-rail widths and non-overlapping activity headings.
- Bank-sheet geometry, viewport coverage, three-column layout, search, selection, and dismissal.
- Monthly progress editing, completion, receipt recording, and the rendered reward ledger.
- Empty-submission validation and visible inline feedback.
- Ordinary and moderator review access, exercised through the demo role picker's change event.
- Actual versus estimated reward amounts, explicit currency counts, and global history navigation.
- Bank-aware card creation, same-name card identification, skipped participation recovery, and bill settings.
- Demo repayment reminder explanations, with an assertion that no platform subscription request is made.
- Card, progress, receipt, and submission drafts restored through confirmation without silently committing changes.
- Todo urgency groups and one primary action per row, including progress-to-completion-to-receipt progression.
- Instant discounts recorded with savings terminology and separated from cashback subtotals.
- Lightweight lead submission, private catalog visibility, and rejection of incomplete moderator publication.

Assertions inspect actual rendered text and geometry as well as page data. They do not use `setData` to manufacture successful UI states. The role-picker case is explicitly an event-level check; it does not claim to test operating-system picker gestures.

Element offsets in this pinned SDK are relative to the rendered viewport. The runner measures the viewport through `selectViewport().boundingClientRect()` because DevTools can return an old height from logic-layer `getWindowInfo` after hiding the native tab bar. Geometry assertions still require controls and overlays to fit within the actual rendered area.

After navigation, the runner compares the raw automation route, the SDK's cached page route, and the app's logical route. It also waits for the target page content and geometry to remain stable for at least 800ms. A logical route change alone does not establish that the native transition has finished. The renderer viewport callback has a bounded wait and rejects measurements taken across route changes.

## Isolation and evidence

Each run creates `.qa-native/ui-acceptance/<timestamp>/` with:

- `index.html`: readable results and screenshot gallery.
- `report.json`: checks, layout measurements, environment, runtime diagnostics, and cleanup result.
- `screenshots/`: SDK screenshots, including failure evidence.
- `cli.log`: CLI startup diagnostics.
- `automation.json`: the isolated project's automation endpoint and lifecycle.
- `navigation.jsonl`: route agreement, page state, and stable rendered-content diagnostics.
- `cases.jsonl`: incremental case results and failure stacks, available while a run is active.
- `project/`: the isolated project copied from the source build.

`.qa-native/ui-acceptance/latest.json` points to the latest report. These artifacts and the test AppID are excluded from Git.

Before mutation, the suite requires the demo identity and the monthly fixture's initial progress. The runner backs up the demo data, form-draft keys, and page handoff filters, restores them after testing, verifies the restored values, and closes only its isolated project window. New test drafts are removed without touching unrelated storage. A temporary backup is retained if restoration fails; it is removed after successful restoration. An interrupted Node process may require manual recovery from that backup.

## Limits

The report records the actual simulator viewport. Passing one size is not a claim about all phones, landscape, large accessibility text, or physical-device behavior. Regression cases mock platform confirmation and leave dialogs; the page state, domain operations, rendered feedback, and draft storage remain real. Real account authorization, photo picking, cloud rules, cross-Mini-Program navigation, and message delivery remain separate integration checks. Controlled controller tests cover delayed responses and version conflicts separately from the SDK flows. The official SDK is a development-only dependency and is never included in the client or cloud-function bundles.

References: [official automation setup](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html), [element APIs](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/element.html).
