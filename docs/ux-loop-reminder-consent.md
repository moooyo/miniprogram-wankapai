# Reminder consent event retry review

Date: 2026-09-23

## Finding

Each `requestReminder` invocation obtains a new platform consent result. Previously, its `reminder.authorize` command used the generic payload-based retry cache. If an accepted authorization committed but its response was lost, the cache retained the original request ID. After a reminder worker consumed that grant, another accepted platform event with identical payload replayed the earlier request instead of adding a grant. The client reported success while the remaining authorization count stayed at zero.

The new regression file, `tests/reminder-consent-intent.test.ts`, reproduced this against the old client on `test-env`: four of the initial five cases failed. The end-to-end mocked case observed `remaining = 0` after the second platform acceptance, and the independent concurrent-event case dispatched one command instead of two.

## Implementation

`requestReminder` now creates a fresh intent namespace for every completed platform consent event. A module-level sequence distinguishes events even if the clock and random source produce the same values. The key is generated only after the platform promise resolves; platform failures, demo mode, and missing template configuration do not send an authorization command.

`CommandOptions.intentKey` now supports `reminder.authorize` in addition to the three existing record-creation commands. Existing card and submission edits remain prohibited from using a persistent creation namespace. The existing canonical request-ID calculation keeps retries with the same key, action, and payload idempotent, including after the in-memory retry entry is removed. No reminder resource supersession rule was added: two separate consent events must not invalidate or collapse each other.

The helper does not persist consent events or provide automatic recovery across a process restart. Same-event replay is supported when the caller retains the same intent key and payload. A new call to `requestReminder` performs a new platform consent operation and receives a new event key.

## Remote verification

The focused test file uses the real API client, domain service, in-memory transactional store, and reminder worker. Native consent callbacks and the worker sender are mocks; no real account or notification is used.

Verified cases:

- An accepted authorization commits, loses its response, and is consumed by the worker; a new accepted event adds a new grant and enables a second newly published activity reminder.
- Retrying one event before and after worker consumption preserves its request ID and does not duplicate or restore its grant.
- Independent concurrent platform events have separate requests even with a fixed clock and random value.
- Concurrent retries with the same event key share one in-flight dispatch; replay after completion stays idempotent.
- A rejection between two acceptances cannot cause the later acceptance to replay the first event.
- Platform failure, demo mode, and missing template configuration send no authorization command.
- Rejected, banned, filtered, and missing platform statuses neither add nor clear an existing grant.

Remote command:

```text
cd /tmp/wankapai-ux-loop-20260922
npx tsx --test tests/billing-target-intent.test.ts tests/reminder-consent-intent.test.ts tests/client-retry-intent.test.ts tests/card-creation-intent.test.ts
npm run typecheck
npm run build
```

Result: 71 passed, 0 failed, including all 7 new consent-event cases, 4 explicit billing-target retry cases, and the existing creation-recovery and known-resource retry regressions. The complete TypeScript check and native/cloud-function build also passed. The build's native package check loaded all 23 JavaScript modules. All verification ran through `ssh test-env`; no local test or runtime verification was performed.

## Acceptance boundary

This verifies mocked platform consent and mocked message delivery through the actual business implementation. It does not validate real WeChat subscription behavior, real account configuration, physical devices, or deployed cloud functions. No real notification, deployment, experience-version upload, or publishing was performed.
