# Product UX review 1

## Result

This first review of the current whole-product UX refinement found **one actionable P2 issue**: the two compact tools on Mine inherit a horizontal button layout and squeeze their titles beside their descriptions. The integration owner had identified the same issue, and this independent review reproduced it visually. No additional concrete recommendation was identified.

This is a findings round, **not a clean review**. The clean-review count for this product refinement remains zero until the correction is integrated into a new frozen build. Earlier held-benefit reviews and the completed 24-round review of the original product are historical evidence; they do not count as clean rounds for this task.

## Scope and method

The review covered all 19 native pages, with particular attention to the ten changed surfaces and their data compatibility: activity detail, rewards, history, preferences, card editing, Mine, submission leads, held-benefit inventory, benefit/lounge editing, and airport lookup. It used the accepted design and the previously loaded UI/UX Pro Max guidance rather than proposing another navigation or styling system.

Source reading included the changed page markup, styles, state transitions and handlers, plus independent bounded reviews of the other nine pages and the supported-bank data path. Browser checks used the source-generated prototype and its real persisted demonstration service. Screenshots of all 19 route entry states and the focused interaction/layout paths were opened and inspected.

All executable checks ran through `ssh test-env`. The reviewer did not run local tests, builds, validation suites, or runtime probes. Local work was limited to source reading, this report, and copying/opening generated screenshots. No product source, production data, deployment, real notification, upload, or publishing action was changed by this reviewer.

## Reviewed build and evidence

| Property | Value |
| --- | --- |
| Frozen checkout | `/var/tmp/wankapai-entitlements-20260924` |
| Prototype SHA-256 | `43fe3109f7d140e8da4694c5aca27b01ea1248a69de47351d88dc08a3692b3db` |
| Generated HTML size | 1,153,416 bytes |
| Build timestamp | `2026-09-24 15:25:18 +0800` |
| Browser temporary directory | `/var/tmp/wankapai-entitlements-browser` |
| Independent evidence | `/var/tmp/wankapai-product-review-1/` |
| Focused fixture corrections | `/var/tmp/wankapai-product-review-1/recheck/` and `/var/tmp/wankapai-product-review-1/direct-recheck/` |
| Local evidence copy | `.qa-native/product-review-1-independent/` |
| Integration-owner evidence | `.qa-native/product-ux-20260924/visual-review/screenshots/005-mine-375.png` and `/var/tmp/wankapai-product-ux-evidence/regression/screenshots/` |

The independent browser helpers checked the expected HTML digest before starting and again after each completed run. It remained unchanged, and no browser page exception occurred. The full-source QA fingerprint can change when a test fixture changes; this report identifies the unchanged product HTML that was actually reviewed. The integration owner was free to rebuild after this reviewer finished its final runtime check.

## PUX1-01: Stack each Mine tool title above its description

**Priority: P2.**

Reproduction on the reviewed 375px build: open Mine and inspect the two tools below the primary management menu. Each `.tool-entry` is a button containing `.tool-title` and `.tool-description`. The global button rule supplies a flex row. Without an explicit column direction, the two text children sit beside each other, forcing both short tool titles into two lines and reducing scanability.

The concrete source location is `miniprogram/pages/mine/index.wxss:5`, with the two tool entries in `miniprogram/pages/mine/index.wxml:13`. The independent screenshot is `page-mine-375.png` in the review evidence directory. It shows the held-benefit and airport-lookup tool titles squeezed into narrow columns next to their supporting text.

The minimal correction is to set the tool button's own layout explicitly: `display: flex`, `flex-direction: column`, `align-items: flex-start`, and `justify-content: center`. Preserve the two-column tool group, labels, destinations, accessible names, and touch targets. The integration owner prepared this CSS correction while the old HTML remained frozen for review.

Acceptance on the next build: at 320px and 375px, each tool title is above its description, with enough width to avoid the unnecessary narrow title column. Both tools still navigate to their original destinations. This report does not certify the correction before the new HTML is reviewed.

## Complete coverage

| Pages | Reviewed states and actions | Conclusion |
| --- | --- | --- |
| Todo | Deadline sections, stage-specific next actions, completion filters, more actions, refresh failure and mutation guards. | No new actionable issue. |
| Activities | Bank rail and search, held-card filter, detail and lead entries, loading, empty state, pagination and retry. The bank rail intentionally scrolls and clips its offscreen items. | No new actionable issue. |
| Detail | Snapshot-based primary action, More, unjoined direct completion/receipt, card selection, expected date, participation before entrance, history, rules, reminder and management guards. | One primary action and preserved direct-record paths were verified. |
| Progress and receipt | Existing form fields, actual date and period meaning, drafts, pending results, conflicts, ownership and return behavior. | No new actionable issue. |
| Rewards | Month/currency selection, compact empty state, pending destination, populated accounting and correction paths, refresh/pagination states. | Empty scopes omit redundant breakdowns and retain a reachable next action. |
| Wallet | Card/bill identity, groups, payment marking, dates, reminder eligibility and the separate inventory/airport entries. | No new actionable issue. |
| Card editor | Single-issuer annotation, multi-issuer picker, error anchor disclosure, immutable identity, billing fields and existing draft/retry behavior. | Compact single-issuer UI was verified at 320px and 375px. |
| History | Scope, collapsed explanation, filters, period/amount meaning, compact footer and separate audit action. | Explanation and audit remain reachable; no new issue. |
| Mine | Primary menu, compact tools, submission attention, sharing/privacy, moderator gate and explicit demo role. | PUX1-01 is the only finding. |
| Preferences | Initial/error states, switches, dirty/saving/saved feedback, fixed save dock, expanded subscription explanation and leave warning. | At 320 x 720 and 768 x 375, the last explanatory text remains above the dock at the end of scrolling, and Save remains visible and operable. |
| Submission lead | Minimum contribution copy, all source inputs, images, draft/submission states and full-rules transition. | No source input or entered value is lost through a new selection step. |
| Full submission, submissions and review | Sections and validation, draft/version states, pending/returned/published records, source evidence, ownership and moderator verification. | No new actionable issue. The ordinary-user review gate was also opened in the browser. |
| Web entry | Unsupported/invalid address boundary, copy and return, loading/failure behavior. | No new actionable issue. |
| Held benefits | Identity and adjacent remaining uses, visible validity/transfer state, compact grey qualification, details/management disclosure, usage/history and archived restoration. | Disclosure exposes management without disturbing direct use/history actions. |
| Benefit and lounge editor | Explicit supported-bank input, separators/deduplication, preserved lounge rules, field feedback, quota/draft/save flows and compatibility. | Bank values persist independently of provider/card information. |
| Airport lookup | Airport/code/city, terminal/zone filters, scoped results, explicit supported banks, admission/practical rules, unknown and empty states. | Result cards contain no usage, edit, quota or personal-balance controls. |
| Shared components and projection | Sheets, safe areas, privacy, generalized demo copy, source route registration and shared business implementation. | No new cross-page regression identified. |

## Runtime observations

All 19 routes were opened in isolated 375 x 812 browser contexts. Seven additional focused flows covered information-only airport cards and inventory disclosure; explicit bank editing and deduplicated persistence; the settings dock at two sizes; detail primary/More actions; direct receipt entry from an unjoined activity; and the compact rewards/history/card paths.

These checks confirmed that an unjoined direct receipt action opens the receipt form without first writing an activity join. Completing the unfinished demonstration activity through More moves its primary action to receipt recording. The settings dock stays visible, retains at least a 48px save control, and does not obscure the final explanatory paragraph after scrolling. Airport result cards have no buttons, while their explicit bank names remain separate from customer restrictions. The inventory's collapsed management area expands to the existing editor and archive actions.

Initial helper assertions required correction in four paths: the geometry helper counted intentionally clipped bank-rail items, sheet locators assumed source component IDs rather than projected sheet controls, and a read-only activity query used the wrong parameter name. Screenshots and source established these as helper errors. Only those affected paths were rerun after correcting the helpers; all completed successfully against the same HTML. The original and corrected JSON evidence is retained. These helper errors are not additional product findings, and passing runtime assertions do not cancel the independently observed Mine layout defect.

## Supported-bank and compatibility review

The source audit confirmed that `LoungeAccess.supportedBanks` is optional and independently recorded for each lounge. Missing or explicitly empty values remain unknown; card affiliation, provider names and customer notes do not become bank-support claims. Valid saves trim and deduplicate bounded bank lists.

Old pending drafts retain their original payload and intent. Restoring them does not inject default arrays or change their request fingerprint. Service-side normalization happens after the original request fingerprint is established. Demo annotation requires the original seed request, matching ownership/provider/creation identity and all original lounge fields; an existing bank property, including an empty array, is preserved. Quotas, versions, usage history and old request fingerprints are not rewritten. API/domain, MemoryStore/CloudStore, private collections/indexes and the generated prototype continue to share the same data contract.

## Next review boundary

The integration owner separately coordinates the 787-test business result, full type/source build, 31-case feature acceptance and the complete product regression suite. This independent review does not replace those suites. Their QA fixture updates should be frozen and fingerprinted separately from the repaired product artifact.

After the Mine correction is rebuilt, start the two-clean-review sequence for this product refinement on that new frozen HTML. Browser evidence does not establish physical-device rendering, native screen-reader behavior, actual airport admission, deployed cloud configuration or real notification delivery.
