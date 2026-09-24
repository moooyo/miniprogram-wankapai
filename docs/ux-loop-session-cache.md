# Session cache ownership across asynchronous reads

Date: 2026-09-23

## Confirmed finding

The R20 before reproduction changed the role through the real Mine picker, opened Review, and delayed an already computed moderator `session.get` response. After leaving Review, the user selected the ordinary role and completed a newer session read. Releasing the older moderator response then replaced the shared session cache. Returning to Mine within the cache TTL incorrectly displayed the moderator role and review entry, even though the underlying actor remained an ordinary user and the real moderation query returned `FORBIDDEN`.

This is a demo identity-display consistency issue, not an authorization bypass. The before flow made no business mutations and did not inject an actor or cache value. Evidence is `.qa-native/prototype/r20-before/r20-session-role-cache-report.json` and four screenshots, against the frozen R19 prototype SHA-256 `e19900395fad83fd538145333bcfa6ec0ef00d0f1e366b6885e8230a7b2b38a4`.

## Implementation

Each actual `ensureSession` read captures the current cache generation and a monotonically increasing read sequence. It may publish its result into the shared cache only while it still owns both. Older or invalidated reads continue returning their own original result to their caller, but cannot replace shared cache state.

Every permitted `setDemoRole` call clears the cache and advances its generation, including assignment to the same role. The production-mode `FORBIDDEN` check remains before any actor or cache mutation. A cache hit does not claim a new read sequence, so an in-progress forced read retains its ownership.

The normal 30-second TTL and forced-read behavior are unchanged. A failed latest read leaves any previously valid cache and its original timestamp intact. It also prevents an older pending read from publishing a replacement. Failure therefore neither extends the existing TTL nor revives cache data invalidated by a role change.

Only `miniprogram/services/api.ts` session-cache bookkeeping changed. Command idempotency, read-only result lookup, domain authorization, production role restrictions, and Mine/Review controllers are unchanged.

## Remote verification

The new `tests/client-session-cache.test.ts` contains eight isolated API tests. Each VM evaluates the real API client and demo service source; the demo service delegates to the real domain service and transactional memory store. A transparent wrapper computes each real session response before holding its delivery. Role changes use the actual `setDemoRole` implementation, and the controlled cache clock does not modify the host's global clock.

Before syncing the API change, the new test file ran against the previous remote API: six cases failed and two existing-behavior controls passed. After syncing the fix, all eight passed. The combined run with the existing demo, command-replay, and command-retry regressions passed 54 tests, with no failures. The complete TypeScript check passed.

Coverage includes a late moderator response after switching to ordinary user, role invalidation before another read starts, repeated assignment to the same role, forced reads completing in reverse order, latest-read failure with a fresh or empty cache, unchanged production-mode rejection, the exact 30-second TTL boundary, and cache hits during a pending forced read. The ordinary user's actual moderation query remains forbidden.

```text
npx tsx --test --test-reporter=spec tests/client-session-cache.test.ts tests/client-demo.test.ts tests/client-command-replay.test.ts tests/client-retry-intent.test.ts
npm run typecheck
```

An independent static review found no additional correctness issue in the implementation.

## Verification boundary

The root task authorized scoped remote verification in `/tmp/wankapai-ux-loop-20260922` after sealing the R19 acceptance run. All execution used `ssh test-env`; no local tests or runtime probes were used. The API-level tests and mocked transport results do not establish native WeChat rendering or real account authorization; the root task performs the full suite, source build, and real prototype-control acceptance for the frozen R20 candidate.
