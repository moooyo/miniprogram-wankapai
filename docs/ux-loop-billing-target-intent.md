# Billing target retry integration

Date: 2026-09-23

## Finding

The explicit billing-target contract distinguishes an existing bill correction from a change to future billing rules. `billing.billId` and `billing.periodKey` identify the bill being corrected; omitting `billing.dueOn` leaves existing bill dates unchanged.

The API retry resource mapping previously associated every independent-card billing payload with the observed current-month bill. This was incorrect for historical bill corrections and rule-only edits. A successful correction to a September bill could discard an unrelated October bill retry while leaving the September retry bound to a stale committed request.

With the updated domain contract and the previous API mapping, all four new cases in `tests/billing-target-intent.test.ts` failed remotely:

| Scenario | Required retry behavior | Previous result |
| --- | --- | --- |
| Lost September `bill.update`, then an explicit September correction through `card.save` | The later September update gets a new request ID and changes the bill | The stale request ID was replayed |
| Lost October `bill.update`, then an explicit September correction | The October retry keeps its request ID | The October request ID was discarded |
| Lost October `bill.update`, then a billing rule change without `dueOn` | The October retry keeps its request ID | The October request ID was discarded |
| Lost explicit September `card.save` correction, then a direct September `bill.update` | Repeating the card correction gets a new request ID and changes September again | The stale card request ID was replayed |

## Implementation

The API now associates a card mutation with a bill only when `billing.dueOn` is present. An explicit `billing.billId` is the exact bill resource. Without a bill ID, current-month inference requires either the legacy payload without `periodKey` or a declared period matching the observed month. Existing shared-account and account-splitting safeguards remain in place.

Rule-only changes do not associate a bill resource. The relationship preflight for an existing card's date correction now also requires an actual `dueOn` field. Other wallet relationship refresh behavior, card resource identity, creation namespaces, and known-record supersession rules are preserved.

## Remote verification

The fixture fixes time at 2026-10-02 and uses one independent credit card, one billing account, and separate September and October bills. It invokes the real client and domain service through a mocked cloud transport. Assertions cover request IDs, the server request ledger, bill audit events, the untouched month's complete snapshot, and the actual updated account rules.

```text
cd /tmp/wankapai-ux-loop-20260922
npx tsx --test tests/billing-target-intent.test.ts tests/reminder-consent-intent.test.ts tests/client-retry-intent.test.ts tests/card-creation-intent.test.ts
npm run typecheck
npm run build
```

After the API change, all 4 new billing-target cases passed. The combined regression run passed 71 tests with no failures. The complete TypeScript check and build passed, including native package integrity for 16 pages, 3 components, 2 services, 1 app, and 1 runtime configuration file.

All execution ran through `ssh test-env`. These are mocked transport/business checks and package-integrity checks, not deployed cloud, physical-device, or native WXML rendering acceptance. No local tests, real notifications, deployment, or publishing were performed.
