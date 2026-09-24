# Archived repayment reminder eligibility

Date: 2026-09-23

## Product behavior and finding

Removing the final active credit card disables its billing account. Existing bills remain visible and editable. The reminder worker requires an enabled account both when generating repayment candidates and when claiming a delivery, so disabled accounts do not send repayment reminders.

The earlier remediation summary described a reminder action on each unpaid bill, but neither that summary nor the interaction inventory explicitly required delivery after account disablement. This change preserves the existing worker policy and corrects the interface and authorization boundary to match it. It does not extend the worker's sending scope.

Before the source was changed, an independent remote reproduction followed the real `card.save`, `card.remove`, Wallet controller, `requestReminder`, API client, domain service, and reminder worker. The last card removal set `account.enabled` to false while retaining an unpaid bill. The actual WXML condition still exposed the reminder action; one mocked platform acceptance created one grant and produced both success feedback and a page notice. The worker created zero jobs and sent zero messages. An exact state clone with only `account.enabled` changed to true created and delivered one job through the dummy sender.

Evidence is stored at `.qa-native/prototype/candidate-r9/r11-archived-reminder-repro.json`, with the harness at the corresponding `.ts` path. The JSON records the source hashes, fixed clock, configuration, requests, grants, worker results, and control case. Its UI evidence evaluates the actual WXML condition against the page state; it is not a rendered screenshot.

## Implementation

Wallet account groups expose reminder availability directly from `account.enabled`. Both primary and historical bill actions, including accepted notices, use that state. Disabled accounts display an explicit explanation that WeChat reminders are unavailable while payment marking and date corrections remain available. Expanded account details and the page explanation use the same policy.

The controller rejects attempts for disabled or missing accounts and paid or missing bills before calling platform consent. Refreshes remove obsolete accepted notices. A delayed result can create a notice only for the same unchanged page load, bill, and enabled account, with the bill still unpaid. A server eligibility rejection refreshes the wallet so that stale active-account data is replaced with the current explanation.

The `reminder.authorize` repayment branch now checks ownership of both the bill and its account inside the existing transaction, then requires an enabled account and an unpaid bill before writing a grant. A new ineligible request returns `REMINDER_UNAVAILABLE`; missing or foreign references retain `NOT_FOUND`. Existing committed request replay still returns the original result without adding a grant, even if the account was subsequently disabled or the bill was subsequently paid.

The worker, API consent-event identity, bill viewing, payment marking and reversal, bill-date correction, and record retention are unchanged.

## UI/UX review

The `ui-ux-pro-max` skill's static quick reference and native-app rules were applied to this bounded change: state clarity, clear nearby error explanations, truthful success feedback, explicit unavailable-action semantics, and preservation of useful historical operations. The fix uses the page's existing text styles and spacing rather than adding a new visual system. Native rendering and device accessibility checks remain separate from the controller and template checks below.

## Remote verification

The updated `tests/wallet-ux.test.ts` uses valid enabled-account fixtures for normal authorization. Its archived-account case now verifies that no authorization occurs while historical bills and their editing actions remain available. Additional cases cover stale notices, disabled or missing accounts, paid or removed bills, changed account references, delayed results, and server-driven eligibility refresh.

The new `tests/repayment-reminder-eligibility.test.ts` contains nine real-domain and mocked-worker cases covering normal delivery, last-card removal, paid bills, missing accounts, both ownership boundaries, committed-request replay, consumed grants, shared accounts, and explicit account reactivation.

```text
cd /tmp/wankapai-ux-loop-20260922
npx tsx --test --test-reporter=spec tests/wallet-ux.test.ts tests/repayment-reminder-eligibility.test.ts tests/reminder-consent-intent.test.ts tests/reminder-worker.test.ts tests/domain.test.ts tests/ui-contract.test.ts
npm run typecheck
npm run build
```

Results: 75 tests passed, zero failed; the complete TypeScript check and native/cloud-function build passed. Build-integrated package verification loaded all 23 native JavaScript modules. An independent static review found no additional correctness issue in this change.

The independent post-fix chain also passed and is recorded in `.qa-native/prototype/candidate-r9/r11-archived-reminder-after.json` with its corresponding `.ts` harness. The disabled-account page made zero platform-consent or authorization calls and retained no success notice. Directly bypassing the page reached the server guard, returned `REMINDER_UNAVAILABLE`, and created no grant or success toast. Payment marking, reversal, and the historical due-date correction still worked. A separate committed-request replay preserved its original result and grant count after removal, while a new request was rejected.

All execution occurred through `ssh test-env`. Consent callbacks, cloud transport, and notification delivery were mocked. No local validation, real notification, deployment, experience-version upload, or publishing was performed. These results do not establish physical-device, real WeChat consent, native WXML rendering, or deployed-cloud acceptance.
