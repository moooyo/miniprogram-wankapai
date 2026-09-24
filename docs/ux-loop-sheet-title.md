# Round 14: long sheet-title reachability

The confirmed browser-projection case used a valid 60-character activity title, published through the demo domain service and opened from Todo's More action. At 320 px and 375 px, the unbreakable title expanded the header and pushed the 48 px close button outside the visible device. Programmatic locator scrolling could reach it, but an ordinary visible pointer could not.

The shared sheet header reserves space between its title and close button. Its title text can shrink within the flex row and wrap long tokens without truncation. The existing close-button dimensions and non-shrinking behavior remain unchanged. Round 16 below replaces the initial native tag selector with a class shared by the native title and browser projection; receipt, navigation, and domain behavior are unchanged.

The existing sheet controller already measures the rendered header height. The independent regression checks that a taller wrapped header reduces the scroll body's viewport while preserving the safe-area deduction and a scrollable region for long content. A template/style contract also preserves the full visible and accessible title and the 48 px close target.

Verification is restricted to `ssh test-env`. Browser geometry remains projection evidence and does not establish physical WeChat behavior; the final task owns the rebuilt whole-product projection and device-acceptance distinction.

Remote targeted verification passed: `node --import tsx --test tests/sheet-ux.test.ts tests/sheet-title-ux.test.ts` completed 7 tests with 0 failures in `/tmp/wankapai-ux-loop-20260922`. These cover source contracts and the measured-height/lifecycle controllers; the final visible-point browser check remains part of the main task's rebuilt prototype acceptance.

## Round 16 native selector compatibility

The round 14 rule targeted the native `text` tag, which conflicts with the documented restrictions for custom-component style selectors. The available official WCSC compiler produced an unsupported-selector diagnostic for that rule. Its class-only comparison did not. This establishes a compiler-compatibility issue; it does not establish current physical-device geometry.

The native title now explicitly binds `class="sheet-title"`, and the unchanged layout declarations use `.sheet-title`. The title still shrinks and wraps completely; the 48 px close target remains non-shrinking. The independent test follows the actual class binding, rejects component tag selectors, and retains the full-title, wrapping, minimum-width, target-size, and measured-body assertions. The prototype workstream owns the matching rendered-span class.

Targeted tests and the repeat of the same official compiler diagnostic check ran only on `ssh test-env`. The precise compiler result and version boundary are recorded by the native-package workstream; neither compiler success nor browser projection substitutes for native-device geometry acceptance.

Remote verification after the class binding change passed `npm run typecheck` and all 7 tests in `tests/sheet-ux.test.ts` plus `tests/sheet-title-ux.test.ts`.

The native-package workstream reran the same WCSC `v0.4me_20190328_db` binary with all three original flag combinations. The frozen baseline outputs remained byte-identical and retained the diagnostic at line 5:15; the actual class-only source emitted no corresponding unsupported-selector diagnostic in any of the three outputs. Its exact-diff check also confirmed that the wrapping declarations, minimum width, flex behavior, 48 px close target, component controller, and JSON configuration remained unchanged. Evidence is saved at `.qa-native/prototype/r16-after/wcsc/README.md` and `compiler-after-report.json`. This establishes removal of the observed diagnostic in that 2019 compiler only; current native-device geometry and full round 16 acceptance remain separate.
