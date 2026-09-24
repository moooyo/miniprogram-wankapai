# Client retry intent lifecycle

## Finding

The client retained a request ID indefinitely after `NETWORK_ERROR`, indexed
only by the action and payload. If a bill was marked paid on the server but the
response was lost, a later successful reversal did not retire that request ID.
Marking the bill paid again replayed the old result without changing the bill.

## Change

Each retry intent now holds its request ID, a monotonic client sequence, and
observed resource keys. Known bill, card, submission, and participation mutations
share keys only within their own record. Receipt and participation mutations use
the same participation key. Preferences use a separate singleton key.

A confirmed mutation retires older retry intents and older in-flight commands
for the same resource. A request's own in-flight entry remains until its promise
finishes. Promise-reference and token-reference checks prevent delayed success,
network failure, server failure, or cleanup from clearing a newer request with
the same payload. A failed newer mutation does not invalidate an earlier retry.

An immediate retry after a lost response still sends the original request ID.
Concurrent identical calls still share one promise. Commands that create records
without a known ID keep their retry identity across unrelated successes. The
server's request fingerprint, transaction, and replay protocol are unchanged.

## Observed relationships

Successful activity, catalog, dashboard, history, and reward queries record the
activity scope and participation-to-tracking relationship. Join and untrack can
then retire each other's older intents for the exact user or card scope. Learning
the relationship after a lost response also connects an already pending retry.
Independent cards remain independent for card-scoped activities.

A full wallet query and an observed server month connect an independent card's
billing settings to its actual current bill. Shared-account splits do not retire
retries for the former account's bill. Card changes invalidate wallet evidence
after either success or a network failure, since a failed response may hide a
committed association change. Before another card or bill mutation relies on
that evidence, the client reads the server session and wallet again. Independent
billing-setting corrections always refresh these relationships first. Delayed
older wallet and month results cannot replace newer observations. Unknown
relationships are not guessed.

## Persistent creation intent

New card, activity-lead, and full-submission forms use a generated
`createCommandIntent()` key stored inside their local draft. They pass it as the
optional third argument to `api.command`. Recovering that draft reuses the key;
a fresh form or a declined recovery generates a new key. Existing-record edits
continue using the two-argument API.

The key, action, and canonical payload produce a stable request ID without
depending on an in-memory retry entry. Object field ordering and undefined
properties follow the existing server fingerprint rules; array order remains
significant. Reopening the same draft remains idempotent, while an explicitly new
form can create another record with identical field values. The API rejects this
option for known-record edits or commands outside the supported creation family.

## Verification

`tests/client-retry-intent.test.ts` connects the real client command method to a
real `createService` through a controllable cloud transport. It simulates a
successful commit followed by response loss, reversal and reapplication,
versioned receipt and progress retries, unrelated entities, rejected later
edits, unknown-ID creation, identical concurrent calls, and delayed old responses
while a replacement request is still in flight. Additional cases cover both
tracking scopes, shared-account transitions, cross-entry bill corrections,
delayed month observations, and fresh versus recovered creation namespaces.

No local verification was run. The parent task performs the full remote test,
type-check, and source-build acceptance on `ssh test-env`.
