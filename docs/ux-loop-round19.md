# Complete UI/UX review: round 19

## Result and method

Round 19 confirmed one new actionable P2 finding in the browser prototype's Web Entry route decoding. The consecutive clean-review count remains **0**. The complete source/script review, final consolidated report/provenance, four global images and focused proof have been reviewed and this findings round is sealed. A later correction or passing regression cannot change that classification retroactively.

The team freshly read all 16 routes across their 64 TS/WXML/WXSS/JSON files, all three components across their 12 files, every binding and supported state, all nine client services, all eight domain files, shared contracts/catalog, global app/runtime/package/TypeScript configuration and styles, all five prototype files, and the native builder/package checker. The lead reviewer covered Detail, Receipt, services, configuration/build and the source/interaction boundary; independent reviewers covered seven primary routes, seven management routes and the components, domain/store guarantees and the complete prototype. Stable parts were read while the Receipt owner finished the preceding correction. Receipt's complete four-file pass occurred after its final freeze; no earlier Receipt version was substituted.

The final acceptance script was freshly read in continuous ranges 1–3000 and 3001 through EOF after its 165-case freeze. Its later browser-launch/report diagnostic change was separately reread: the declared browser arguments, launch call and reported values agree. The review covers fixtures, real-service assertions, platform and lifecycle simulations, cleanup, scenario invocation, errors, and source/artifact provenance. Script reading remains distinct from the successful runtime result recorded below.

UI/UX Pro Max's skill, all ten quick-reference categories and professional checklist, the interaction-design contract, and complete round 16–18 records guided the pass. Round 18's report was initially not present and was read in full after it was finalized. All findings require a supported visible consequence or an explicit primary platform constraint. No new feature, decorative preference, chart, dark theme, arbitrary external-storage injection or unmeasured operating-system behavior was used to keep the loop running.

This reviewer edits only this English report. No local executable test, build, validation suite, smoke test or runtime probe was run. Local operations were source/document reading and inspecting remote evidence. Executable verification belongs to `ssh test-env`; no real notification, cloud deployment, account authorization, experience upload or publication occurred.

## Frozen incoming candidate and evidence boundaries

The main task reported successful full remote type checking, **686/686 business/controller tests**, and the source build, including native integrity for all **23 modules**. The Receipt owner separately reported **99/99** relevant cases and type checking before integration. Those results belong to the frozen round 18 correction, not to the later URL adapter correction proposed below.

The focused proof uses `.qa-native/prototype/incoming-r18/index.html`, SHA-256 `77b752827bd58136d65ab8f865f2b9fac42de728cb409540413c64b57de03874`. The final `.qa-native/prototype/candidate-r18/report.json` identifies that same HTML and finished at `2026-09-22T22:47:37.649Z`:

| Evidence | Frozen value |
| --- | --- |
| Browser result | 165 passed, 0 failed, 0 captured runtime exceptions |
| Browser evidence | 253 screenshots; 108 source handlers exercised through UI |
| Generated inventory | 16 routes, 3 components, 272 bindings, 193 unique handlers |
| Source fingerprint | `a04fe5504709a5c74e299a225f391b478ade3ce9ecb5678e77e82b01bf6843c6` |
| Fingerprint scope | 147 files; unchanged during the run |
| Report SHA-256 | `d108f1e7b20ec66e91db29974a336eb1d4acd147264bb79ff1228a4b5265f389` |
| Browser environment | Chromium `153.0.8010.12`, Node `v20.19.2`, Linux |

The source manifest covers application, domain, shared, cloud-function, prototype and script directories plus package/TypeScript configuration. Dependencies, generated output, QA evidence, Git internals, documentation and tests are excluded. The lead read every scenario result, summary, diagnostics, environment, limits, provenance and relevant manifest entries. `interactive-prototype.html` matches the HTML hash; `index.html` is the human-readable report. Binding inventory and representative handler execution do not mean every conditional branch was executed. The sole recorded HTTP/console warning identifies the local server's missing `favicon.ico`, not a missing UI asset. The old 162-case candidate-r17 report is not current acceptance.

Two incomplete infrastructure attempts remain as `iteration-1-report.json` and `iteration-2-report.json`. `runtime-environment.json` records Chromium process failures while the `/tmp` tmpfs was nearly full, and preserves filesystem diagnostics and the earlier report locations. Before attempt 2, the runner added and recorded `--disable-gpu`; the successful third attempt used that same runner and `--no-sandbox`, with a task-owned disk-backed temporary directory and output location. It ran all 165 scenarios afresh and did not combine earlier case results. The product prototype was unchanged. The reviewers inspected that environment record and use only the third complete report as the browser baseline.

Both lead and prototype reviewers viewed the complete matching `contact-sheet-375.png`, `contact-sheet-320.png`, `contact-sheet-768-landscape.png` and `workbench-overview.png`, covering all 16 pages. The prototype reviewer also inspected all Receipt save-state screenshots `246` through `252`; the lead inspected the held-save, failed-date recovery and editable foreground-refresh views. The ordinary page hierarchy, narrow/landscape wrapping, fixed-action clearance, explicit demo disclosure and the connected workbench yielded no additional concrete layout recommendation. The passing ordinary URL state does not contradict the separately proven encoded-URL path.

The current `wcsc/frozen-source-match.json` matches all four App Sheet source hashes to this exact manifest and explicitly reuses the historical round 16 compiler diagnostics. It states that WCSC was not rerun for round 18. The historical official `miniprogram-compiler@0.2.3` binary identifies itself as `v0.4me_20190328_db`; the reused diagnostic evidence is not a modern compiler or device-rendering result.

## Confirmed finding

### R19-01 — P2: Preserve URL bytes across prototype routing and Web Entry loading

Source mechanism at discovery: `prototype/runtime.js` builds canonical page options using `Object.fromEntries(new URLSearchParams(query))`, which decodes the outer route parameter. Web Entry's source `onLoad()` then explicitly applies `decodeURIComponent(options.url)`. Supplying the already-decoded URL directly to that source controller decodes percent escapes belonging to the inner bank URL a second time. Ordinary URLs conceal the error.

The prototype supports cold hash routing. For a valid original address with path `promo%20offer`, its canonical page options still correctly contain `%20` after the route parser. The additional controller decode changes that inner escape to a literal space, which the URL validator rejects. The fallback page loses the source address and does not expose its copy action. With the valid query `?next=a%26b`, the second decode instead changes a value containing an ampersand into a new query delimiter. The fallback page displays and copies a different URL.

Independent remote proof: `.qa-native/prototype/r19-before/r19-url-encoding-report.json` uses the fixed incoming HTML above, real cold-hash entry and the rendered copy button. `wx.setClipboardData` is transparently traced while its original adapter writes to the isolated browser clipboard. It does not manually invoke a hidden page handler or issue a request to a bank site.

The percent-escaped-space case has correct canonical `page.options.url`, empty `sourceUrl`, an invalid-address message and zero copy controls. The percent-escaped-ampersand case begins with one query value `next = a&b`, but the actual copied URL parses as `next = a` plus a separate empty `b` parameter. The plain bank-URL cold-entry control and normal Detail direct-copy control both preserve their addresses. The proof records zero runtime exceptions and zero external requests. The lead reviewer read the complete JSON and inspected all four screenshots: `r19-url-encoding-encoded-path-space.png`, `r19-url-encoding-encoded-query-ampersand.png`, `r19-url-encoding-plain-bank-url.png` and `r19-url-encoding-normal-detail-control.png`.

User impact: A valid encoded address in a supported prototype deep link can lose its copy fallback or copy a semantically different destination. This is a browser projection boundary defect. The proof does not establish WeChat's native `onLoad` decoding contract and does not justify changing the native security/eligibility policy.

Recommendation: Adapt the Web Entry controller's load input at the browser boundary so its explicit decode receives the representation it expects, while retaining canonical options separately for route serialization. Pair loading and `pageUrl`/Back/reload behavior to avoid accumulating encoding. Do not alter unrelated route parameters or weaken URL validation, allowlists, default-port normalization, or disabled-web-view fallback.

Acceptance: Verify cold hash, public prototype navigation, Back and browser reload with encoded spaces, query delimiters, fragments and literal percent escapes. The displayed and actually copied address must preserve the original inner URL bytes and query meaning. Keep ordinary URLs, normal Detail clipboard actions, invalid-address handling and other record-route parameters unchanged. Browser-route evidence must remain distinct from untested native parameter semantics and real external navigation.

## Complete route checklist

Every row represents a fresh read of the complete controller, template, stylesheet, configuration and all bindings, with applicable initial/loading/refreshing/empty/error/success/busy/read-only/permission/draft/conflict/navigation states.

| Route | Full review scope | Round 19 result |
| --- | --- | --- |
| `pages/todo/index` | Filters/deadline groups, next action, detail/progress/completion/receipt, More, skip/resume/undo, history/bills/discovery, stale reads and busy locks | No independent finding |
| `pages/activities/index` | Bank rail/search/sheet, held-card switch and label, reset, subscriptions, sharing/detail, retained windows and page recovery | No independent finding |
| `pages/rewards/index` | Recorded/pending, month/currency scopes, independent counts/totals, actual-month attribution, confirm/correct/detail, refresh/pagination/empty/failure | No independent finding |
| `pages/wallet/index` | Cards/names/groups, independent/shared/archived accounts, expansion, payment/undo/dates, reminders/preferences, matched activities and late reads | No independent finding |
| `pages/mine/index` | Attention queries, menus, privacy, operator entry, explicit demo roles, loading/error and sequencing | No independent finding |
| `pages/detail/index` | Owned record/snapshot, notification entry, card eligibility/preparation/cancel, all sheets and dirty dates, progress/receipt/revoke/tracking, guides/gallery, reminder/history/entrance and foreground feedback | No independent finding |
| `pages/progress/index` | Progress/registration, validation/focus, draft/leave/recovery, version comparison/reapply, busy/read-only and return | No independent finding |
| `pages/receipt/index` | Actual amount/date/month, exact scope/period, creation checks, ordinary/pending/legacy recovery, pure replay, versions/conflicts, initial/resume/midnight freshness, Save operation ownership and return | No independent finding after complete final-freeze source read |
| `pages/history/index` | Global/activity scopes, filters/detail, retained pagination/retry, audit identity/loading/error/close and operation descriptions | No independent finding |
| `pages/card-edit/index` | Identity/nickname, repayment/shared choices, date versus rules, ordinary/pending/legacy/recovered intents, exact period/target, explicit rebase/review, errors/save/remove and late responses | No independent finding |
| `pages/submissions/index` | Lead/full creation, status/reason disclosure, account verification, hidden cached rows, paging/retry and obsolete reads | No independent finding |
| `pages/submission-lead/index` | Source alternatives, required input, images/consent/cancel/upload/preview/remove, creation identity/drafts/conflicts, full continuation, submit/update and ownership | No independent finding |
| `pages/submission-edit/index` | All sections and conditional fields, error links, gallery/source identity, date/period rules, pending creation/drafts, moderation and completion routing | No independent finding |
| `pages/review/index` | Permission/status states, private-row verification, loading/error/retry, paging, submission entry and role/account changes | No independent finding |
| `pages/preferences/index` | Four switches, readiness/loading/errors, dirty/saved feedback, leave warning ownership, disposal and return | No independent finding |
| `pages/web-entry/index` | Shared URL eligibility/normalization, missing/restricted/approved states, loading/error/retry, source/copy and cold-entry return | R19-01 in the browser routing adapter |

## Components, services, domain and build

All three components were read across their 12 files. App Sheet retains the supported title class, responsive header/content measurement, stale-measurement guards, scrolling/safe areas, busy dismissal and native-tab lifecycle. Privacy Gate retains observation, foreground ownership, policy, consent and refusal semantics. Demo Notice stays explicit. Component call sites were crosschecked; no independent new issue was found.

All nine services were freshly read in full: API, form drafts, navigation, demo, entrance, privacy, formatting, benefit wording and card labels. The review covered immutable payload capture, canonical creation/consent identity, separate result lookup, uncertain retry retirement, known wallet/month/resource relationships, owned draft revision cleanup, image identity/validity/lifetime, shared entrance decisions, safe returns and precise Chinese amount/date/period/status wording. The URL finding concerns how the browser presents options to the source controller, not a requested service/security relaxation.

All eight domain files and shared contracts/catalog were reread, with store and cloud-store boundaries independently checked. Ownership, user/card scope, immutable period snapshots, actual receipt dates and actual-month attribution, expected versions/periods, first-creation absence, exact bill identity, request fingerprints, transactional rollback and finite reminder grants remain intact. Read-only replay cannot first-execute an absent operation.

The prior Card target fix compares current account, bill and period identities for validation and recovery visibility. It keeps entered values and asks for explicit actual-date review before using a replacement target. The final Receipt correction acquires `busy` before an explicit existing-record save's authoritative date check, retains that ownership through validation and command, and releases it on failures. Hidden/unloaded preflight continuations are invalidated by visibility/save generations. Ordinary foreground date refresh remains nonwriting and amount-editable. The full source pass considered all other Receipt flows, not just this correction.

Application/global styles, runtime/package/TypeScript configuration, the complete native source builder and package checker were read. Shared API/privacy/configuration remain external singleton modules, demo state is bundled once, page components are injected from source, and route/component artifacts and relative dependencies are checked. Registration-only package integrity is not WeChat rendering or cloud integration acceptance.

## Prototype, formal script and ten-category review

All five prototype files were freshly read: build generation, runtime, HTML, workbench CSS and README. The pass covered expressions/conditions/loops/keys, every current native tag/control/event family, source bindings, CSS selectors/preview dimensions/assets, original controller/domain reuse, explicit demo mode, route lifetimes and parameters, input/scroll/focus preservation, sheet/platform-dialog ownership, browser composition, storage/reset, galleries, action inventory, role/scenario claims and write/read-only fault projections. R19-01 is the one independently confirmed new prototype issue.

The entire frozen 165-case formal script was read continuously. Its checks inspect real records, request ledgers, audits, drafts and mutation counts; response delays preserve real results and command arguments. The three new Receipt cases exercise a real Save click with input 18, pointer/keyboard attempts to change it while busy, date failure followed by a second explicit save at 23, and an ordinary foreground-refresh control with zero writes. Their scope is recorded accurately: the new browser fixtures use cashback, duplicate-submit/Return behavior is checked through disabled state rather than extra raw clicks, and foreground lifecycle callbacks are simulated. Broader controller tests, source checks and other existing cases are not relabeled as those three browser interactions.

The script also retains explicit boundaries for legacy-schema fixtures, direct read-only API classification controls, worker-shaped deep links, wx platform-event simulations, calibrated Chromium composition and real versus native controls. Full-case statistics are computed from results, not assumed from an expected count. Fatal/runtime errors fail the report, and source/HTML digests are compared at completion. Contact-sheet rendering uses an isolated page per size. Infrastructure changes and retries must be recorded separately from product assertions.

All ten UI/UX Pro Max categories were considered: accessibility, touch/interaction, performance, style consistency, responsive layout, typography/color, animation, forms/feedback, navigation and data presentation. The confirmed issue concerns route/clipboard correctness. The other categories remain scoped to this utility's labeled controls, textual state cues, touch/busy feedback, retained/paginated reads, blue/white hierarchy, wrapping/safe areas, readable type, stable/reduced motion, predictable returns and separate currencies. New chart/theme features and hypothetical native behavior are not treated as missing requirements. The fresh global-image pass produced no additional concrete recommendation.

## Closure gate

The complete source/script review, focused encoded-URL proof, current consolidated report/provenance and four global images are closed with one confirmed recommendation. The main task has accepted the finding and assigned a minimal browser adapter correction. Initial local corrected source has been inspected for canonical-options/load-input separation; that targeted look is not a new clean review or remote acceptance of the correction. The passing incoming report cannot certify those later changes.

After correcting the finding, reread changed source, run relevant remote regressions and full checks, and generate the new source-linked candidate. Start a subsequent complete review only on that stable candidate. The loop ends after two consecutive complete reviews of the same unchanged candidate have no new actionable recommendation. Round 19 remains at clean count **0**.

Moderated public submissions and all transaction, ownership, date, snapshot, version and idempotency guarantees remain in scope. Physical WeChat rendering, keyboard/screen-reader/system-text behavior, real photo/privacy authorization, external mini-program/web-view compatibility, cloud account configuration and notification delivery remain separate integration boundaries.
