# Calendar-safe demo bill seeding

Fresh demo data previously used statement days 6, 7, and 8 with actual repayment
dates three, four, and five days after initialization. On the first two days of a
month, the same-month due days preceded those statement days. Strict domain
validation correctly rejected the seed and prevented the demo from opening.

Fresh seeds now cap each sample statement day at the initialization day. The bill
has already been issued, and its actual repayment remains exactly three, four,
or five days away. A repayment crossing a month or year boundary still uses the
next-month offset. Statement days remain at most 8, so the saved recurring rules
are valid in every later month, including February.

Only fresh seed planning changed. Domain assertions, stored seed loading,
in-memory caching, cache reset, persistence, and user edits retain their existing
behavior.

`tests/demo-seed-dates.test.ts` runs the real demo service through every day of
2026 and leap year 2028, totaling 731 initialization dates. It also covers native
API persistence, edited card and paid bill recovery, month/year rollover without
reseeding, and retry after a failed initial storage write. All execution and
verification take place on `ssh test-env`; no local verification is performed.

The original seed failed the new calendar test on January 1 with the expected
domain validation error. After the data fix, all 6 new tests passed, including
all 731 fresh initialization dates. The related demo, domain, and billing-period
suite passed 38/38 tests. Type checking and the complete source build, including
native package integrity, also passed remotely.
