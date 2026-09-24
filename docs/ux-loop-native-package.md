# Native package integrity review

Date: 2026-09-23

## Finding

The R10 native package review found a blocking detail-page load failure that the browser prototype could not expose. `miniprogram/services/entrance.ts` imports `../runtime-config`. The previous build plugin preserved that source-relative string when the helper was bundled into `dist/miniprogram/pages/detail/index.js`. The resulting CommonJS import resolved to the nonexistent `dist/miniprogram/pages/runtime-config`, rather than the package-root configuration file.

The failure was reproduced against the existing generated package on `test-env`, in `/tmp/wankapai-ux-loop-20260922`, before changing the build:

```text
node scripts/check-native-package.mjs
Error: Unresolved native dependency: pages/detail/index.js -> ../runtime-config
Exit status: 1
```

## Implementation

`scripts/build.mjs` now builds each native entry with its own output path. The resolver identifies shared modules by their resolved absolute source paths and computes external CommonJS paths relative to the final output file. This also covers transitive imports, sibling imports, and explicit file extensions without depending on the spelling of the source import.

Runtime configuration remains a separately copied, editable package file. The API and privacy services remain shared entries. Build metadata assertions reject any bundle that inlines runtime configuration, duplicates the API or privacy service in another entry, or includes the demo runtime outside the shared API entry.

The build invokes `scripts/check-native-package.mjs` after producing the native package. The standalone checker also accepts an optional package directory:

```text
node scripts/check-native-package.mjs [package-directory]
```

The checker verifies declared page artifacts and local component references, resolves generated literal CommonJS dependencies entirely within the package, loads every JavaScript entry independently, and then loads all entries together. It asserts exactly one corresponding `App`, `Page`, or `Component` registration per native entry. The module loader cannot fall back to source files, host modules, or `node_modules`. Lifecycle callbacks are not invoked, and access to WeChat APIs or timers fails the check.

## Remote verification

All execution below ran through `ssh test-env`. No local build, test, validation suite, or runtime probe was performed.

```text
cd /tmp/wankapai-ux-loop-20260922
npm run build
npm run typecheck
node scripts/check-native-package.mjs
npx tsx --test tests/entrance-behavior.test.ts tests/client-demo.test.ts
```

Results:

- Complete native and cloud-function build: passed.
- Complete TypeScript check: passed.
- Native package integrity: passed for 16 pages, 3 components, 2 services, 1 app, and 1 runtime configuration file; 23 JavaScript modules and 23 literal external dependencies.
- Entrance behavior and client demo business regressions: 6 passed, 0 failed.
- Independent static review confirmed the per-entry output mapping and resolver recursion guard approach.

## Acceptance boundary

This is Node CommonJS package-integrity and registration verification. It does not render WXML, invoke page or component lifecycles, exercise WeChat APIs, validate a physical device, or verify a deployed cloud environment. The browser prototype and package-integrity checks do not establish native visual acceptance. No deployment, real notification, experience-version upload, or publishing was performed.
