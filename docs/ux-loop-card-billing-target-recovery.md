# Explicit recovery for a changed billing target

Date: 2026-09-23

## Confirmed finding

The R17 before reproduction used two real browser pages sharing one owner. Page A changed an existing independent account X bill's due date from September 26 to September 28 and left an ordinary local draft. Page B then used normal card commands to move that card to shared account Y and back to a new independent account Z. Page A reloaded and explicitly restored its actual draft.

The restored draft correctly retained target X and refused to save against the now-current account Z. However, its error instructed the user to update the billing target while no recovery button appeared: the month was still September, and the previous visibility calculation only considered period changes. Selecting a shared account and then independent billing was an available workaround. This was a missing recovery entry with misleading guidance, not permanent data loss or an irrecoverable form.

Evidence: `.qa-native/prototype/r17-before/r17-card-billing-target-report.json` and its three screenshots, captured from `incoming-r16/index.html` with SHA-256 `e797bdb5e72a785fa11dcbca5996cf7d29ecf48927904bb216eeaec22cf41653`.

## Implementation

The controller now uses the same precise account ID, bill ID, and period matching rule for target validation and recovery visibility. An unavailable target exposes the existing reread operation even when the period has not changed. The operation is labelled as rereading the bill, and the explanation identifies an account-link change rather than claiming that the month changed.

The action refreshes the trusted session and Wallet before selecting the currently associated bill. It retains nickname, dates, rules, and reminder settings, and marks the retained date as requiring explicit review. The resulting explanation identifies the current associated bill, its original registered due date, and the preserved draft date. Only a subsequent confirmation or date selection permits the date correction to be saved against the newly read target.

No target changes during error calculation or draft restoration. Failed reads preserve the prior target, values, and draft so that the same action can be retried. In-flight reads retain existing busy guards. Valid historical bill corrections, rule-only edits that do not submit a bill date, intentional account splitting, and creation result-replay protections retain their prior behavior. The domain and API protocols were not changed.

## Remote verification

Work began with static local reads and edits while the R16 160-check acceptance run was sealed. Only after the root task released that freeze were the owned source and test files synchronized to `/tmp/wankapai-ux-loop-20260922` on `test-env`.

The new `tests/card-billing-target-recovery.test.ts` has eight cases using the real page controller, API client, domain service, and transactional memory store with mocked native APIs and cloud transport. It covers:

- The exact X-to-shared-Y-to-independent-Z sequence, retained input and draft, a visible same-period recovery condition, explicit date confirmation, and a final write only to Z.
- Separate session-read and Wallet-read failures that retain all recovery context.
- Duplicate reads, saves, and input changes blocked while the read is pending.
- Valid historical bill corrections after a month change without unnecessary retargeting.
- Rule-only edits after both account and month changes, with no existing bill changed.
- Intentional shared-account splitting without a false missing-target error.
- A replaced bill ID when the account and period still match.

```text
npx tsx --test --test-reporter=spec tests/card-billing-target-recovery.test.ts tests/card-creation-intent.test.ts tests/card-draft-result-lookup.test.ts tests/billing-target-intent.test.ts tests/ui-contract.test.ts
npx tsx --test --test-reporter=spec tests/card-billing-target-recovery.test.ts
npm run typecheck
```

The initial combined run passed 77 tests. After adding the explicit rule-only boundary case, the final new suite passed all 8 cases, and the complete TypeScript check passed again. An independent static review found no additional correctness issue. The root task performs the final full suite, source build, and real prototype-control acceptance against its frozen R17 candidate.

All execution was remote. No local verification, real notification, deployment, experience-version upload, or publishing occurred. Controller/domain checks do not replace native WeChat rendering or physical-device acceptance.
