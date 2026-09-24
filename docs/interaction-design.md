# Interaction prototype and design baseline

## Product and visual direction

Benefits Checklist is a personal bank-benefit organizer for Chinese-speaking cardholders. Its primary job is to make the next action clear while preserving accurate participation, receipt, billing, and moderation records. Public submissions remain in scope and require operator review before publication.

The accepted blue-and-white direction is retained. The signature is a chronological task rail: deadlines and the next relevant action are visible together. Currency totals remain separate, and instant discounts use savings terminology instead of suggesting a future bank payment.

| Token | Value and purpose |
| --- | --- |
| Brand | `#1f61d8`, primary action and selection |
| Ink | `#172230`, primary content |
| Muted | `#626f82`, supporting content |
| Surface / page | `#ffffff` / `#f4f7fb` |
| Error / success | `#ac3737` / `#326548`, always paired with text |
| Type | Platform Chinese sans serif; 24–28 px headings, 16 px body, at least 14 px supporting content |
| Data | Tabular numerals for dates, progress and amounts |
| Geometry | 4/8 px rhythm; 12 px surface radius; 48 px action targets |
| Motion | No decorative motion; stable press feedback; native navigation |

The UI UX Pro Max design-system query initially returned a generic financial marketing layout with unrelated handwritten typography. It was rejected as a poor fit. The narrower `finance mobile utility` product query matched Banking/Traditional Finance and Personal Finance Tracker. The minimalist/accessibility direction and calm-blue palette fit the existing product. Native WeChat is not one of the skill's listed framework stacks, so stack-specific web advice is adapted only where the native platform supports it. The `error summary validation` and `back behavior navigation` queries informed the concrete interaction changes.

## Navigation and complete screen scope

The five native tabs are Todo, Activities, Rewards, Wallet and Mine. Secondary routes preserve normal back navigation and provide safe destinations when opened without a navigation stack.

| Screen | Entry and principal interactions | Required alternate states |
| --- | --- | --- |
| Todo | Filter unfinished/completed/all; deadline filter; next action; more actions; rewards, bills, history and discovery links | Loading, failure, empty, overdue, soon, skipped, completed, received |
| Activities | Bank rail; searchable bank sheet; held-card filter; subscription; share lead; detail; pagination | Loading, first-load failure, no matches, local pagination failure |
| Detail | Stage-specific primary action and More; entrance, rules, direct completion/receipt, progress, card selection, expected date, history and reminders | Unjoined, active, skipped, completed, received, previous period, unmatched card, unavailable record |
| Progress | Progress count, registration, save, leave, draft restore and conflict recovery | Invalid input, saving, failure, read-only, latest-version conflict |
| Receipt | Actual amount and date, income-month explanation, save/correct, leave, draft and conflict recovery | Cashback/discount, new/correction, invalid date/amount, saving, conflict |
| Rewards | Recorded/pending tabs, month/currency filters, correction, confirmation and pagination | Empty month, pending across periods, independent currency counts, loading/failure |
| Wallet | Add/edit/name card, expand account, mark/undo payment, actual due date, reminders and matching activities | No cards, independent/shared accounts, archived unpaid/settled history |
| Card edit | Bank, issuer, card type/network, nickname, repayment plan, independent/shared billing, save and remove | Create/edit, locked identity, conditional fields, validation summary, draft, removal confirmation |
| History | All/unfinished/pending filters, detail and audit sheet, pagination | Global/activity scope, empty, loading, page failure, audit failure, overlapping requests |
| Mine | History, submissions, sharing, preferences, privacy explanation, review and demo role | User/operator, explicit demo, loading/error, role change |
| Preferences | Four switches, fixed Save dock, expandable notification help and leave | Loading, unavailable preferences, dirty, saving, saved, failure |
| Submissions | Share, edit lead/full submission and pagination | Pending, returned with reason, published, empty, loading, local failure |
| Submission lead | Bank/title/source, up to six images, preview/remove/retry, draft, submit/update, convert, latest version | New/pending/returned/published, access denied, upload, validation, version conflict |
| Submission edit | Four form groups, card conditions, period/reward, entrance modes, images, source, draft and submit | New/edit/lead conversion, conditional required fields, multi-error summary, conflict, published read-only |
| Review | Status tabs, open submission, verify source, publish or return with reason | Forbidden, loading/error, pending/returned/published, stale version |
| Web entry | Approved HTTPS entrance; load, retry, copy and return | Restricted configuration, invalid address, loading, failed load, loaded |
| Held benefits | Compact remaining-use inventory, filters, use/history/reversal, expandable details and management, archive/restore | Empty, expired, future, exhausted, retained stale results, unknown write result, conflicting version |
| Benefit editor | Core details, fixed period, quotas, transfer state, per-lounge supported banks and rules, draft and save | Create/edit, linked archived card, nested validation, legacy draft recovery, unknown result, conflicting version |
| Airport lounges | Airport/code/city, terminal and zone filters, benefit scope, explicitly supported banks and admission information | No registered match, unregistered banks, unknown eligibility, archived source excluded, loading/failure/stale data |

Shared states include explicit demonstration disclosure, a privacy authorization dialog, and adaptive sheets. Editing sheets retain unsaved values until the user saves or confirms discarding. In-flight saves prevent further edits. Browser prototype platform dialogs are simulations, clearly identified as such.

## Prototype implementation contract

The prototype is generated from native WXML, WXSS and TypeScript and runs the existing demo domain service. It is a review projection of the application, with a complete route/action inventory, not a separately maintained business implementation. Source changes and prototype revisions stay synchronized through generation. Native-specific capabilities are simulated; the prototype cannot certify WeChat rendering or real account integrations.

Every bound native action must appear in the generated inventory. Representative end-to-end paths exercise discovery to participation to receipt, independent/shared cards to bills, and private lead to operator review. Unavailable platform operations must explain their simulated result instead of implying a live external action.

## Review loop contract

The original completed loop examined all 16 routes, three shared components, navigation, all event bindings, loading/empty/error/success states, form drafts, conflicting requests, accessibility, visual hierarchy and business-state consistency. The later held-benefit feature extends the inventory to 19 routes; its separate feature and integration reviews are recorded in [Held benefits](held-benefits.md). Findings need concrete evidence and a user-visible benefit; speculative redesign preferences do not count as defects.

After any new actionable finding, fix it and reset the clean-round counter. Exit only after two consecutive complete reviews of the same final revision find no new actionable recommendations. Browser evidence and source review are recorded separately from real-device/cloud acceptance. A missing environment is a disclosed verification limit, never a passed check.

## Acceptance boundaries

All executable verification runs through `ssh test-env`. Type checking, the complete business suite and the production source build are required. Browser projection checks cover layout and interaction in the prototype. WeChat DevTools, physical devices, privacy authorization, image picking, real cloud ownership rules, cross-Mini-Program navigation and actual subscription delivery remain native integration checks requiring the appropriate environment and account configuration.

No cloud functions, notifications, experience build or production release are deployed as part of this work.
