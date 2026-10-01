# Activity-feature design implementation

The source is reimplemented from `D:/Code/design_handoff_activity_features`, including its complete interactive prototype. The design reference uses a 402 by 874 logical-pixel canvas. Layout dimensions use CSS pixels with adaptive content widths, retaining the specified 16-pixel gutters rather than applying an inaccurate fixed two-rpx conversion to that canvas.

## Interface

The four native tabs are progress, activities, cards and benefits, and account. Income is a secondary route. All 19 pages use the handoff's colors, typography, card radii, controls, and custom navigation. The five components include custom navigation and the full-screen screenshot viewer alongside adaptive sheets, the explicit demo notice, and privacy authorization. Native tab artwork follows the handoff line shapes. DM Mono is bundled under its OFL license and loaded for numbers and dates.

Activities expose bank and owned-card filtering, accurate total counts, 60 by 80 screenshot thumbnails, participation status, and prejoin details. Detail displays eligibility, saved progress, the stage sequence, screenshots, shared cycle timelines, rules and entry instructions, withdrawal consequences, and rejoin. Screenshot browsing retains the 3:4 image area, pagination, uploader labels, recognition regions, and context-specific actions.

The card wallet uses 220-pixel bank-color cards with a 158-pixel overlap and a full-screen secondary detail view. Its six primary benefit categories are airport lounges, delay insurance, airport transfer, health checks, car washes, and points; other benefits remain supported. Counted benefits retain usage and reversal history. Insurance descriptions and point balances have separate information semantics and cannot consume artificial usage counts. Point totals retain exact integral values and unknown balances remain unknown.

Card details show their actual linked holdings and participating records. Optional bill amounts retain integer minor units and explicit currency; unregistered amounts remain blank. Airport lookup adds account-isolated recent queries and summaries of explicitly registered lounge programs while retaining supported-bank, region, customer, booking, and source conditions. Existing safeguards are retained behind the new presentation.

Activity detail records actual dated consumption entries with an amount, merchant, and progress increment. Append, reversal, and automatic completion are transactional and retain the original participation snapshot. A stable request must be saved locally before dispatch; failed persistence does not send a command. Recovery retains its exact payload and request identity. Historical first entries use their original participation and version, while uncertain later-period requests are resolved without being recreated. Reversal retains the consumption history and cannot silently change an already received reward.

## Recognition and publication

Leads accept up to six screenshots and optional reward, cycle, date, condition, and entry information. Recognition fills empty fields or fields still managed by recognition. Manual values remain protected. Start and end dates retain separate provenance across multiple images. Incremental entry recognition updates both its visible field and submitted rules. Undo restores the first pre-recognition form snapshot while retaining the current screenshot selection, as required by the handoff.

The moderator queue supports inline reward and cycle editing, screenshots, source verification, publication, and return. Missing mandatory rules lead to the complete editor with retained draft and version context. Publication still requires authorized review and source verification. The five reward kinds are cash back, instant discount, voucher, points, and gift. Point receipts use integral point counts and remain excluded from monetary totals.

Demo recognition is explicitly identified as fictional. Production recognition requires `OCR_ENDPOINT` and optional `OCR_TOKEN` environment configuration. The HTTPS endpoint receives `{ assets: [{ id, url, mime }], locale: 'zh-CN' }` and returns `{ items: AssetRecognition[] }`. Asset ownership, result fields, and normalized region bounds are verified. External recognition runs outside retried store transactions. An unavailable production provider yields a clear error.

## Retained guarantees

New cycles use the shared calendar implementation. A reset creates a new participation with an immutable rule snapshot and leaves previous progress and pending rewards intact. Withdrawal disables automatic tracking and reminders, hides followed work from active and pending views, and retains all history. Rejoin restores the existing record and earlier pending rewards without generating participation for periods spent withdrawn.

Ownership, transaction, receipt-date, period-target, version, and request-idempotency checks remain enforced. Receipt drafts record their reward kind and currency; changed units require explicit confirmation. No cloud function deployment, real notification, version upload, or publication is part of this rewrite.

## Verification evidence

Local verification is explicitly authorized for this task. The complete business and controller suite passes 1,063 tests. Full TypeScript checking, the source build, native package registration for 19 pages and five components, and the installed WeChat WXML and WXSS compiler passes succeed. The full test log is saved in `.qa-native/final-business-tests.log`.

Native acceptance uses the official CLI and `miniprogram-automator` against an isolated source-built project. Initial failures are retained, including native syntax incompatibilities and button specificity defects found in actual screenshots. Design reference captures, comparison notes, native geometry, source/build fingerprints, and screenshots are saved under `.qa-native/design-reference/` and `.qa-native/design-acceptance/`. The latest acceptance report is located through `.qa-native/design-acceptance/latest.json`.

The final native run is `.qa-native/design-acceptance/2026-10-01T21-33-10-353Z/`: all 24 scenarios pass, all 19 routes reach stable rendered states, and zero runtime exceptions are captured. It contains 65 native screenshots and 26 matching rendered design measurements. The source, native build, and five acceptance/CLI harness files remain unchanged throughout that run. Test storage is restored. The simulator uses iPhone 12/13 (Pro), SDK 3.17.3, a 390 by 844 screen, and a 390 by 762 initial tab viewport; page and overlay viewport heights vary by native chrome context.

After that full run, manual review found stale tab image resources and compiler warnings. Rebuilding from source, clearing only the compiler cache, and reopening the official simulator restored all eight normal and selected tab icons. Follow-up source changes scope component registration to the pages that use each component, remove unsupported component selectors and legacy system-info fallbacks, and provide string fallbacks for hidden titles. The complete business suite still passes all 1,063 tests; TypeScript checking, the source build, and native WXML/WXSS compilation pass. Direct CLI and SDK checks of all four tabs record zero warnings, zero runtime exceptions, and eight decoded 48 by 48 icons in `.qa-native/manual-launch-check.json`. The latest business log is `.qa-native/warnings-business-tests.log`. The earlier 24-scenario report remains evidence for its recorded source version, while these follow-up checks cover the final warning fixes.

The simulator viewport is measured rather than assumed to equal the design canvas. Screenshot review and dimension checks are distinct from a same-data, same-viewport pixel-difference score. Device chrome, fictional seed content, and dates are not copied into production behavior. Physical devices, deployed OCR and cloud services, photo-album permissions, real message delivery, and publishing require separate integration acceptance.
