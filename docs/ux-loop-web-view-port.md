# Consistent default HTTPS port handling

Date: 2026-09-23

## Confirmed finding

With web views enabled and `cc.cmbchina.com` allowlisted, the public URL validator accepted `https://cc.cmbchina.com:443/promotion/`. The entrance classifier and detail-page labels chose in-app opening and dispatched navigation, but the web-entry page's different hostname expression rejected the same URL. The identical URL without an explicit port worked.

The remote before-change evidence is `.qa-native/prototype/r15-before/r15-web-port-repro.json`, with the corresponding `.ts` harness. It records the source hashes, configuration, actual detail labels, navigation options, and web-entry controller state. The reproduction uses mocked native navigation and does not open an external website.

## Implementation

`resolveWebViewUrl` in the entrance service is now the shared in-app eligibility and normalization function. It reuses the existing public HTTPS validator, then requires an exact case-insensitive allowlisted hostname and either no port or numeric port 443. It normalizes the scheme and hostname and removes the default port while preserving path, query, and fragment bytes.

Both the entrance classifier and web-entry controller use this function. The detail labels therefore agree with the dispatcher and the page that receives navigation. Valid public HTTPS URLs using other ports retain the copy-link fallback and cannot load inside the web view. Invalid addresses remain rejected by the web-entry page without a copyable source URL.

The helper does not depend on a global `URL` implementation and does not decode URL suffixes. The existing validator continues to reject user information, malformed or encoded authorities, IP literals and local/reserved hostnames, non-HTTPS schemes, invalid port syntax, and backslashes. The configuration remains disabled by default; business-domain verification and platform capability requirements are unchanged.

## Remote verification

Implementation and test preparation used local static reads and edits only while the root task preserved the R14 remote acceptance fingerprint. After the root task explicitly released that freeze, the owned source and test files were synchronized to `test-env` and verified in `/tmp/wankapai-ux-loop-20260922`.

```text
npx tsx --test --test-reporter=spec tests/web-view-url.test.ts tests/entrance-behavior.test.ts tests/ux-loop-management.test.ts tests/primitives.test.ts
npm run typecheck
```

Results: 181 passed, zero failed; the complete TypeScript check passed. The new URL matrix contributes 53 cases. Its VM evaluates the real validator, entrance service, detail controller, API dispatcher, and web-entry controller with no global `URL` or `URLSearchParams`. It covers omitted and explicitly default ports, case normalization, intact encoded suffixes, exact allowlists, legal non-default-port fallback, user information, encoded authorities, local/reserved hosts, IP literals, invalid ports, and invalid route encoding. Retry and copy behavior are checked without opening external pages.

Independent static reviews found no additional security, consistency, or test-harness issue. The root task performs the final combined build and prototype acceptance after all R15 changes are integrated. These mocked controller checks do not establish real WeChat web-view capability, business-domain verification, native rendering, or physical-device acceptance. No local tests, runtime probes, real external navigation, deployment, or publishing were performed.
