# Verification

Verified on 2026-09-20. All executable checks ran on the designated remote environment, `ssh test-env`, with Node 20.19.2 and npm 9.2.0. The original downloadable delivery includes a `dist/` directory built remotely and copied back as files. Git intentionally excludes generated build output; repository checkouts must build it from source. No local Windows tests, builds, or runtime probes were run.

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

## Not yet verified

No real AppID or CloudBase environment was provided. Current WeChat DevTools, real iOS/Android devices, deployed CloudBase services and storage rules, platform privacy authorization, cross-mini-program navigation, and real subscription delivery have not been verified. Native scrolling, keyboard behavior, safe areas, and event propagation still need DevTools and device acceptance. Mocked SDK tests are not a substitute for deployed cloud integration.

No deployment, preview upload, publication, or live message sending was performed. The default runtime remains demo mode with `touristappid` and no credentials.

## Reproduction

Run on the designated verification environment after copying the source project:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The supplementary package and template checks are retained in the task's verification workspace, together with raw logs. They are intentionally separate from runtime dependencies.
