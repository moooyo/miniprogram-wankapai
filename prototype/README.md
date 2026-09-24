# Source-linked interactive prototype

Build with `node scripts/prototype-build.mjs`. The result is `dist/prototype/index.html`, a portable, single-file browser prototype with embedded styles, page templates, JavaScript, and image assets. `dist/prototype/coverage.json` lists every source WXML event binding from pages and shared components. Regenerate after native source changes; never edit generated output.

## Architecture

- All sixteen routes come from `miniprogram/app.json`.
- Layout, text, conditional states, iteration, and bindings are read from the native WXML and WXSS sources.
- Native tag selectors are translated only inside CSS rule selectors. Responsive `rpx`, `vw`, and `vh` units track the preview dimensions. Width and height media conditions are evaluated against the preview rather than the surrounding workbench. WXML member access expressions are compiled with null-safe access to reproduce empty native values without suppressing an entire conditional label.
- Original page controllers are bundled together with the existing API, demo service, domain validation, ownership checks, period snapshots, and idempotency logic.
- Runtime configuration is forced to demo mode at build time. No production endpoint, WeChat deployment, notification, or publishing service is contacted.
- Route options retain one decoded query layer for stable URL serialization. The source Web Entry controller explicitly decodes its `url` argument, so only its `onLoad` argument copy receives that value encoded once. This source-specific adapter boundary preserves escaped path/query bytes without changing other route parameters or asserting a general WeChat query-decoding contract.
- The browser adapter provides native-style navigation, input fields, selectors, date/month controls, checkboxes, switches, progress bars, sheets, confirmation dialogs, image upload/preview, local storage, and draft leave warnings.
- Browser composition keeps the active input or textarea connected while source handlers receive the browser's real input values. Page rendering resumes after composition ends or focus leaves the field; no synthetic commit input is dispatched. Page transitions discard the old rendering session, and platform dialogs retain focus ownership.
- Prototype data has a separate browser storage namespace. Reset restores the original demo fixtures and clears prototype-only form drafts.

## Review workbench

The page atlas opens all sixteen routes, supplying demo record identifiers for record-specific screens. A connected overview shows the activity, card, submission, and settings flows. The scenario panel opens progress, receipt, discount, card editing, submission, moderation, history, and permission-denied flows. Moderation scenarios create pending demo submissions through the same domain commands used by the app; review decisions update the shared demo state.

The current-page action list is generated from WXML bindings and indicates whether a handler is currently rendered or has been exercised. It provides control location, containing sheets, and source state conditions, including shared component actions. It is an inspection aid, not a claim that every binding or conditional branch has been tested. Slow-loading and one-shot query/command failures exercise the page controller's actual error handling. The width control supports 320, 390, and 430 pixel previews.

Commands marked `replayOnly: true` only look up an earlier result. The browser adapter applies read-failure and read-delay effects to these lookups while preserving any pending save-failure effect for an actual write.

Toolbar reload, slow-load, and load-failure controls share the page's unsaved-change confirmation. Cancelling preserves the current page and inputs without arming a later read effect. A save, upload, removal, conflict reload, or other source operation must finish before a toolbar refresh can begin; this condition is checked again after confirmation. Accepted effects apply to the pending refresh and are discarded if that refresh performs no read. Internal scenario reconciliation retains its original page instance and never refreshes a different page opened while the scenario was running.

Atlas, flow, scenario, and reset actions also retain the initiating page as their owner. They wait for source operations, editor loading or draft recovery, and existing dialogs to finish. Read-only route preparation and the final pre-navigation check cannot bypass that owner. Role changes and scenario records begin only after the user accepts navigation. Source-controlled successful-save navigation and the native-style Back control retain their normal lifecycle.

Review-scenario preparation also retains its explicit role revision and scenario claim. A later role selection retires pending preparation even when the same Review page instance remains visible. Retired preparation performs no further writes or refreshes and does not replace the newer scenario's feedback or show a late error.

The pagination scenario adds thirty-two published demo activities, receipt records, and pending leads through domain commands, making all paginated lists reachable without repetitive manual input. It stops after an already-started command settles if the user leaves its page, preserving committed records without updating the new page. Progress and completion feedback also recheck that page after asynchronous work, so a late response does not replace a newer scenario's message. Its temporary demo role is restored only while that role assignment is still current; a newer explicit role choice, including the same role chosen again, takes precedence. The concurrent-edit control updates the currently open progress or receipt record through the same service while preserving the form's previous version; submitting then exercises the real conflict/reload/reapply flow. Its completion feedback also requires the original form to remain active and ready after the command returns. Both scenarios are browser-only fixtures and can be cleared with Reset.

## Platform boundaries

The prototype is a source-linked approximation of WeChat rendering, not the native client. Native date pickers and permission UI use browser controls. WeChat subscription messages remain explicitly disabled by demo mode. Cross-mini-program navigation, privacy policy presentation, and blocked web entry are simulated. Browser image data stays in browser storage, and clipboard access depends on browser permission. The native sheet component is represented by an accessible browser sheet with focus management; this does not validate its WeChat runtime measurements.

Browser review therefore supplements native source/build/business verification. It cannot establish real-device rendering, keyboard behavior, screen-reader integration, actual cloud authorization, upload security, reminder delivery, or production readiness.

Composition regression checks use real Chromium CDP composition and text-insertion commands, calibrated against plain browser inputs and textareas. They verify browser commit, cancellation, continued typing, and draft navigation; they do not certify an operating-system IME or WeChat keyboard behavior.

## Acceptance integration

The `window.Prototype` object exposes `ready`, `current.route`, `current.data`, `shadow`, `navigate(url)`, `openPage(nameOrRoute)`, `reset()`, `refresh()`, `scenarios`, and the demo `api`. Native controls live inside the open shadow root on `#native-page`; the navigation bar, tab bar, and platform dialogs live in the document. Tests should perform interactions through rendered controls and use these read-only state hooks for assertions and fixture navigation.

The public navigation and reset hooks use the same workbench guards as the visible controls. `resetFixture()` is reserved for explicit test setup between cases; it directly resets demo state without a user confirmation and must not be used to simulate a user resetting the prototype.

All verification must follow repository environment policy. In this task, run builds and acceptance scripts only on `ssh test-env`; local Windows execution has not been authorized.
