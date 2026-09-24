# Creation result lookup and receipt intent integration

Date: 2026-09-23

## Client contract

The client supports a read-only result lookup through:

```typescript
api.command(originalAction, originalPayload, {
  intentKey: originalIntentKey,
  replayOnly: true,
});
```

This sends a separate `request.replay` query containing the original command's action, payload, and derived request ID. It does not send the original mutation with a new flag. The separate action fails closed when a server does not support the query; an older server cannot silently ignore an option and execute the original creation.

The original key, action, and canonical payload remain the only inputs to the derived request ID. `replayOnly` is not included. The query uses its own in-flight map, does not run wallet preflight reads, and cannot complete, invalidate, detach, or replace a normal mutation intent. It requires a persisted intent key and never falls back to a write. A successful response must contain a valid mutation result ID; malformed positive responses become `INVALID_RESPONSE`.

The domain query matches the authenticated owner's request ledger and exact original fingerprint. `REQUEST_UNRESOLVED` means that no committed result was observed by this lookup. It does not establish that an earlier in-flight request was cancelled or can never commit. Callers must keep the original pending context and may query again; lookup errors, including unsupported-server `INVALID_INPUT` and `INVALID_ACTION`, must not be treated as definitive creation failures.

## First receipt identity

Persistent intent namespaces now also support a first `reward.confirm` when `expectNew` is exactly true and both `participationId` and `expectedVersion` are absent. Existing-record corrections remain on their normal versioned mutation path.

The new creation payload includes its domain-provided `expectedPeriodKey`. Recovery preserves the original payload and request ID. A committed original request remains replayable after rollover. An uncommitted original request cannot be moved into the next period by retrying that payload: the domain period guard rejects it before creating participation or reward records.

The API does not invent an intent for a legacy draft that never persisted one, infer an original request ID from amount/date fields, add period fields to a historical pending payload, or interpret an old result as the current state of a subsequently edited record. Those recovery decisions remain explicit in the form layer.

## Remote verification

`tests/client-command-replay.test.ts` adds twelve cases covering exact legacy card-result recovery across months without new bill materialization, missing-result lookups, both query/write concurrency orders, late mutation commit after an unresolved lookup, lookup deduplication, isolation of pending normal retries, unsupported-server and network errors, malformed positive responses, and missing intent metadata.

`tests/client-receipt-intent.test.ts` adds six cases covering a committed first receipt across rollover, an uncommitted first receipt rejected in a later period, same-intent concurrent submission, request reconstruction after in-memory cleanup, a genuinely distinct creation intent reaching the creation guard, and rejection of namespaces on existing-record corrections.

```text
cd /tmp/wankapai-ux-loop-20260922
npx tsx --test --test-reporter=spec tests/client-command-replay.test.ts tests/client-receipt-intent.test.ts tests/client-retry-intent.test.ts tests/reminder-consent-intent.test.ts
npm run typecheck
npm run build
```

Results: 58 passed, zero failed. The complete TypeScript check and native/cloud-function build passed, including all 23 native JavaScript modules in the package-integrity check. The test chains use the real API client, domain service, and transactional memory store with mocked cloud transport. Unsupported-server responses are simulated explicitly. An independent static review found no additional correctness issue in the API change.

All execution ran through `ssh test-env`; no local tests or runtime probes were used. These checks verify the API/domain integration snapshot, not final form UI behavior, native WXML rendering, physical devices, or deployed cloud services. No real notification, deployment, experience-version upload, or publishing was performed.
