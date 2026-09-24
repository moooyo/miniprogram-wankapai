# Explicit billing-period targets

The card form previously submitted its displayed actual due date on every save.
The service selected a bill using the save-time month. A September form saved in
October could therefore apply September's actual due date to October's bill.

`card.save.billing.dueOn` is now optional. Omitting it updates recurring settings
without changing any existing bill's actual date. Newly materialized periods use
the updated rules; existing statement dates, periods, paid states, and due dates
remain unchanged.

An explicit actual-date correction can include `billId` and `periodKey`. Both are
required when a bill ID is present. The service verifies ownership, account
membership, period, and independent-account reuse before changing that exact
bill. Historical corrections use the target bill's original statement date as
their lower bound and preserve all other bill fields.

Any date-bearing call with an explicit period but no bill ID must target the
current server month, including new, existing, and split accounts. A stale
period raises `VERSION_CONFLICT` and the
transaction leaves cards, accounts, bills, audits, and request records unchanged.
An old shared bill cannot be corrected through a split into a new account.

Legacy date-bearing calls without target fields keep their existing current-month
behavior. Updated forms bind explicit corrections and omit untouched dates.
Request replay still precedes validation, so a committed creation can be retried
with its original period after a month boundary without creating another card.

`tests/billing-period-target.test.ts` covers month rollover, future recurring
rules, paid historical targets, account and owner isolation, shared-account
conversion, invalid targets, rollback, request replay, and legacy compatibility.
Remote verification on `ssh test-env` passed all 41 cases from
`billing-period-target.test.ts`, `domain.test.ts`, and `primitives.test.ts`,
including all 9 new cases. The parent task runs the integrated build and type
check. No local verification was performed.
