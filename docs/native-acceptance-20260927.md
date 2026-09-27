# WeChat DevTools native acceptance: 2026-09-27

## Outcome and scope

The 19 native pages and 35 acceptance checks have complete evidence across a full simulator run and a focused follow-up on identical application source and native build files. This is actual WeChat DevTools rendering and `miniprogram-automator` execution, not the browser prototype. No computer-use automation was used.

The full corrected run retained **32 passed and 3 failed** results. Its three outstanding application flows passed the subsequent focused run, which completed **9 functional cases and 1 candidate-identity check**. System-dialog callbacks were simulated in that follow-up because the simulator's `Tool.native.cancelModal` and `confirmModal` calls returned without resolving their visible dialogs. This result does **not** certify those system-dialog button gestures. The original failed results remain available and were not rewritten.

| Check | Result | Evidence |
| --- | --- | --- |
| Complete native run | 32/35 passed; all 19 routes reached a stable rendered state; 0 runtime exceptions; 61 screenshots | [Full HTML report](../.qa-native/ui-acceptance/2026-09-27T09-49-19-760Z/index.html), [raw JSON](../.qa-native/ui-acceptance/2026-09-27T09-49-19-760Z/report.json) |
| Focused native follow-up | 10/10 passed; 0 runtime exceptions; 14 screenshots | [Follow-up HTML report](../.qa-native/ui-acceptance/2026-09-27T10-01-23-876Z/index.html), [raw JSON](../.qa-native/ui-acceptance/2026-09-27T10-01-23-876Z/report.json) |
| Combined evidence | 35 checks resolved with the dialog-simulation boundary retained; 75 SDK screenshots | [Combined report](../.qa-native/ui-acceptance/2026-09-27-final/index.html), [combined JSON](../.qa-native/ui-acceptance/2026-09-27-final/report.json) |
| Complete business/controller tests | 895 passed, 0 failed, 0 skipped on `ssh test-env` after the source corrections | [Test log](../.qa-native/ui-acceptance/2026-09-27T09-49-19-760Z/business-tests.log) |
| Type check, source build and prototype generation | Passed on `ssh test-env`; the native simulator package was also built locally under the task-specific authorization | `scripts/build.mjs`, `scripts/prototype-build.mjs` |
| Native package integrity | 19 pages, 3 components, 2 shared services, 1 app and 1 runtime configuration | Source build output and native build manifest |
| Cleanup | Demo/draft storage restored and each isolated project closed in both final runs | `storageRestored: true` and `automation.status: closed` in both raw reports |

## Environment and authorization

The designated remote environment was Linux without WeChat DevTools. The user explicitly authorized local simulator acceptance for this task. The runner used official WeChat DevTools CLI commands and `miniprogram-automator@0.12.1`, with an already configured test AppID in the ignored private project configuration.

- WeChat DevTools: `2.02.2608070`.
- Mini Program base library: `3.17.3`.
- Simulator: iPhone 12/13 (Pro), initial rendered viewport 390 x 671 CSS pixels. Hiding the native tab bar changes the available rendered height; sheet checks measure the current viewport.
- Local SDK process: Node.js `26.1.0`; business/build verification: Node.js `20.19.2` on `test-env`.
- Runtime: explicit demo mode, empty cloud environment, fictional bank and benefit data.

The runs retained one DevTools warning about three global custom components and lazy injection. It is not a JavaScript runtime exception or evidence of a measured performance failure. Protocol diagnostics also retain expected `no such element` responses used to check that optional controls and closed sheets are absent.

## Source corrections and acceptance-tool corrections

Native visual review found two small interface-copy defects. Progress recovery repeated its registered status, and a one-time reward source repeated the word for activity. The actual progress controller now deduplicates equal stage/registration labels, and the rewards template adds the activity suffix only when needed. These changes are in native source and the regenerated prototype.

The benefit-use and lounge-editor sheets gained stable IDs so the official SDK can address their custom component roots. Their business logic and styles did not change.

The acceptance tools were brought up to date with the delivered interface: stage-specific Detail actions, More menus, expandable History help, the receipt-specific recovery confirmation, 48px sheet controls, all four newer routes, fixed preference saving, and supported-bank lookup. The web-entry fixture now uses a valid public bank overview URL; reserved example domains are intentionally rejected by the existing validator. Web-view is disabled in the demo, so that test does not request the website.

An exploratory complete run recorded 19 passes and 16 failures before these corrections. Nine failures were SDK response timeouts, and the remaining failures involved an obsolete dialog assertion, a previous test's retained draft, a rejected reserved-domain fixture, custom-component lookup, and dependent cases. Its [raw report](../.qa-native/ui-acceptance/2026-09-27T09-30-39-799Z/index.html) remains available. The initial cold-launch logging failure is separately retained in the earlier connection diagnostic; neither result is represented as a passing run.

The runner now awaits native startup, bounds protocol calls, records safe method-level diagnostics, and retries only the read-only screenshot operation up to three total attempts. The two final runs required zero screenshot retries. Taps, inputs and business submissions are never automatically replayed.

## Focused follow-up and guarantees

The follow-up deliberately recreated the previous submission-draft prerequisite before checking the private lead/moderation flow. Its recovery callback can cancel only the identified empty test draft, with an exact owner, revision, route, title, body and button match. Unexpected dialogs fail without returning a decision. The SDK method and temporary observer are restored in cleanup.

Benefit reversal, archive and restore similarly match the exact requested modal parameters before returning their explicit confirmation through the SDK. Normal usage submission and excess-quantity validation have no simulated dialog. The underlying native inputs, buttons, sheets, data service, ownership/version checks and persisted records remain real. The cases verify the original record IDs, quota changes, retained reversed history, and unchanged records during airport lookup.

Supported-bank acceptance saves a mixed-separator list through the native editor, verifies its deduplicated four-bank result, and queries it by airport code and city. The result displays the four-hour booking requirement and local-bank-customer restriction. Lookup exposes no usage, editing or personal-balance mutation control.

The focused run skips already completed unrelated cases explicitly through `WECHAT_UI_CASES`; its result is not described as a second 35-case run. The combined report maps the two renamed confirmation cases to their earlier counterparts and retains each raw outcome.

## Candidate identity

| Artifact | SHA-256 |
| --- | --- |
| Native client source fingerprint, both final runs | `4d302fc8fe77647b51686643c815d844d5120608c3586d91abeda5b1aa1fc2b7` |
| Native client package fingerprint, both final runs | `10de8712257f1fd3f56ae2e7c887ad0092f69072a2ea80cd289cb6c78c268bd5` |
| Regenerated browser prototype | `e7de27c4126ca3c992042b2090278eb0f4a52667915ba5aa8aa35a08a8e175c2` |

The first two fingerprints hash the ordered per-file manifest of `miniprogram/` source and the isolated generated native client respectively. The compiled package includes the bundled shared/domain code. Both runs assert that source and package fingerprints remain unchanged at completion. The QA harness changed between those runs; these fingerprints are not claims that all QA files are identical.

All 75 SDK screenshots were independently inspected: full-run images 01-18 cover primary tabs, bank selection and stage actions; [images 19-45](../.qa-native/ui-acceptance/2026-09-27T09-49-19-760Z/native-visual-review-19-45.md) confirm the copy fixes and core recovery flows; [images 46-61 plus all 14 follow-up images](../.qa-native/ui-acceptance/2026-09-27T09-49-19-760Z/native-visual-benefits-review.md) cover settings, benefits, reversal/restoration and saved bank access rules. No further clipping, overlap or obscured-operation issue was identified. Occasional DevTools measurement labels are distinguished from application content.

Physical devices, alternate native simulator sizes, operating-system pickers and confirmation gestures, live cloud/account integration, actual bank admission and real notification delivery remain outside this result. No upload, deployment, experience release or publication occurred.
