# Management UI review: round 1

## Scope and method

The review covered Mine, Preferences, My Submissions, Activity Lead, Full Submission, Moderation, Web Entry, Privacy Gate, Demo Notice, and App Sheet. It used source inspection against the UI/UX Pro Max accessibility, interaction, forms, navigation, and mobile layout references. No local tests, runtime probes, builds, or verification suites were run. The main task owns remote verification through `ssh test-env` and later review rounds.

## Findings and changes

| Finding | Implementation |
| --- | --- |
| Failed initial list requests also displayed a successful empty state. | Submission and moderation lists now suppress their empty states on a read error. |
| Pagination failure sent users to the first page through the global retry action. | Both lists keep loaded rows and the current cursor, report a separate error at the end of the list, and retry that cursor. |
| My Submissions could append a late page to a replaced result set. | Request generation and cursor checks reject stale responses; page merges deduplicate submission IDs. |
| Reloading a conflicted full submission deleted the recovery draft before the network request succeeded. | A guarded reload retains the current form, version, and local draft during the request. Only an authorized successful response replaces the form and clears the matching draft revision. Failures preserve the editable state. |
| Multiple form errors were hidden across collapsed sections. | A linked error summary lists every invalid field. Selecting a message opens the corresponding section and scrolls to that field. Field edits remove their own summary entry while retaining other errors. Multiple-error submissions scroll to the summary. |
| Full submission requirements and copied source content were inconsistent with the lead form. | Required fields and optional card networks are labeled. The source section explains its either-or requirement. Copy Source retains both the URL and source note. |
| Web Entry provided no recovery after an embedded page failed. | Allowed pages report navigation loading and handle load/error events. Errors offer retry and address copying. Restricted entries retain a safe copyable address without bypassing host configuration. |
| Moderation and editor denial pages could not recover from a deep link without navigation history. | Return actions use the shared navigation fallback service. |
| Privacy content could exceed a short landscape viewport. | The privacy panel has bounded scrollable content, persistent actions, safe-area padding, and a short-viewport adjustment. |
| App Sheet restored native navigation as soon as a close request was emitted, even if the owning page rejected dismissal. | The component exposes `dismissible`, suppresses close requests while false, and waits for its actual `show` state to change before restoring navigation. |
| Supporting labels were smaller than the shared readability target. | Supporting management and lead form copy is at least 14 px. The sheet close target is 48 px. |

## Regression coverage

`tests/ux-loop-management.test.ts` covers pagination recovery and stale responses; draft retention during failed and pending reloads; error-summary navigation and independent error clearing; complete source copying; restricted and failed web-entry recovery; and native navigation ownership during sheet dismissal.

The existing submissions form test now asserts the linked-summary interaction before its original field-position and independent-error assertions. Its VM import allowlist includes the navigation helper. No domain assertions were removed or weakened.

## Preserved constraints

Moderated public submissions remain available. Production moderator access continues to come from the authenticated session. Demo roles do not grant production access. Existing source verification, ownership, optimistic version, local draft isolation, and published-content immutability boundaries remain in place. This pass does not deploy, publish, send notifications, or change domain behavior.

## Verification status

Remote type checking, business tests, build, prototype interaction review, and the next independent full review are pending with the main task. Native device behavior, cloud integration, large system text, and physical landscape layout require separate device acceptance and are not established by source inspection or mocked controller tests.

## Round 2 corrections

The independent second review found that asynchronous slot content could remain constrained to the height measured for an initial loading message. App Sheet now accepts a `contentState` array, watches it and its title after rendering, and measures the available scroll viewport again. All eight current sheet instances bind the state that affects their content height. The calculation keeps the explicit scroll-view height, safe-area deduction, native navigation ownership, and guards against obsolete measurement callbacks. A regression exercises loading text, a long asynchronous result, and a short empty result in the same visible sheet.

The review also found error-summary links to conditionally hidden fields. Full Submission now asks for a valid bank before requiring an issuer, removes inapplicable entrance errors when the entrance form changes, and resolves a stale field-navigation action to its visible bank or entrance selector. Regression coverage checks bank-to-issuer disclosure and the web-to-mini-program-to-guide transition while retaining all applicable validation rules.

## Round 3 corrections

My Submissions and Moderation now refresh the previously loaded result window when returning from a detail page. Existing rows remain mounted while the request runs. Refresh pages are aggregated and deduplicated before replacing the list, with a request-generation check after every awaited response. A failed refresh retains the previous rows and pagination cursor, labels them as the last loaded data, and offers retry in place. Changing the status filter or authenticated identity starts a new window.

Both pages force a fresh session check on return. Moderation rechecks the current moderator role, clears results if access has been revoked, and never opens cached rows while the session is unverified. The shared session helper accepts a backward-compatible optional force argument to bypass its short cache. Additional regressions cover returning from the second page, refresh failure and retry, identity changes, a filter change during a multi-page refresh, revoked moderation access, and failed session verification.

## Round 4 corrections

The full review found that disabled cached rows still exposed private submission text while the fresh identity or moderator check was pending or had failed. My Submissions and Moderation now apply `visibility: hidden` and `aria-hidden` to the retained list until `sessionVerified` is true. This preserves the loaded window and layout while withholding its text and accessibility content. Status messages explain verification, and failures provide an explicit verification retry. Confirmed revocation continues to clear moderation results.

Controller regressions exercise a pending session request, failed verification, blocked navigation, and successful confirmation of the same identity without losing the loaded window. Template contracts require both visual and accessibility masking with layout preservation. Browser acceptance must additionally check computed visibility, unchanged list height, hidden accessibility state, and restoration after verification.

## Round 5 corrections

Full Submission previously recognized cancellation only when the image picker rejected an Error instance. Native `chooseMedia` rejects a plain object containing `errMsg`, so canceling selection incorrectly added an image error. The image action now normalizes native `errMsg`, Error-like messages, and string rejections before classifying cancellation. Starting the picker no longer clears existing form feedback. Canceling returns to the exact prior image, draft, field-error, and summary state; genuine failures still produce the image error and its summary entry.

Regression coverage supplies actual plain-object, Error, string, localized, and mixed-message cancellation values. Separate native, Error, and unknown failure cases require visible feedback without losing existing images or modifying the saved draft. This finding makes round 5 a correction round, not a clean review round.

The same round also found that App Sheet emitted an owner close request after its page had already become hidden. A dirty owner could then open a second discard dialog after the page-level leave confirmation. Hiding a sheet page now only releases native tab-bar ownership; it preserves the owner's `show` state. Returning to the page restores ownership and measures the sheet again. Explicit navigation actions that close a sheet still do so through their existing handlers, and detach still removes resize subscriptions and releases ownership. Lifecycle regressions assert that hiding, returning, and detaching never request an owner discard while preserving the navigation and subscription-cleanup guarantees.

## Round 6 integration follow-up

Integration found that normalization exposed raw English native error strings for genuine image-selection or upload failures. Full Submission and Activity Lead now keep native cancellation detection separate from display feedback. Photo-access denial maps to a Chinese permission-recovery message, network errors explain retrying the connection, and unknown technical failures provide a Chinese permissions-and-network recovery path. Existing Chinese domain validation messages remain unchanged. Neither form clears prior image feedback merely by opening and canceling the picker.

Both forms have regressions for native permission denial, authorization denial, network failure, general Error failures, unknown error shapes, and preserved Chinese validation messages. Lead-form cancellation cases additionally verify exact image, error-state, and local-draft preservation for native objects, Error instances, strings, and mixed native/message payloads. This is an integration correction in a findings round, not a clean review.

## Round 7 image concurrency correction

Source review confirmed that removing an entrance image while its metadata request was pending did not invalidate that request. Its late response could restore the removed asset to the cache, and the preview previously used the entire cache as a gallery. Entrance-image removal, successful upload, and source-image reuse now invalidate older metadata requests and prune caches against the current union of entrance and original-source IDs. A pending refresh restarts for the current membership when needed. Responses are also filtered to both the requested and current ID sets.

Preview buttons explicitly identify their entrance or source gallery. The controller checks membership again after an awaited refresh and builds the gallery from that current ordered list. Removing a source image from the public entrance preserves its original source membership, metadata, and source preview. The existing six-image ceiling, read-only guards, and source-ownership boundaries are unchanged.

Regressions delay real controller metadata promises across removal, source reuse, and successful upload. They require late responses to be ignored, deleted or unrequested IDs to stay out of previews, and lawful original-source images to remain available in their own gallery. Round 7 contains this confirmed finding and is not a clean review round.

The final URL-resolution boundary is guarded as part of the same correction. `previewAssets` accepts an optional validity callback and checks it immediately before calling the native preview API after resolving URLs. Full Submission, Activity Lead, and Activity Detail provide predicates covering disposal, request generation, current page ownership, page-hide invalidation, and current ordered gallery membership. Navigating forward to a new page invalidates a pending preview even while the old page remains in the navigation stack. A lawful original-source preview remains valid when only its public-entrance membership changes. Callers that omit the callback retain the previous API behavior.

Additional regressions run the actual API preview helper with deferred final URL promises. They cover image removal, unloading, inactive stack ownership, hiding and returning, generation replacement, retained original-source previews, and backward-compatible callers. These tests require that stale work never reaches `wx.previewImage`; they do not lock editing actions or change asset authorization.

Every valid preview selection also advances the preview sequence, so a newer selection supersedes an older pending URL request even when native preview does not trigger page hiding. Invalid image IDs or indexes return before advancing that sequence. Three additional controller-plus-API regressions select A then B, resolve B before A, and require exactly one native gallery opening with B selected; an invalid intermediate request must not cancel B.

## Round 8 corrections

The preview helper previously filtered unavailable URLs and then used the original numeric index against the shorter response. It now resolves the selected original asset ID, builds the remaining gallery in requested asset-ID order, and opens that exact selected URL. If the selected asset has no authorized URL, it reports a Chinese retry message instead of opening a different image. Partial and reordered URL-response regressions exercise the actual helper and retain the final validity callback.

A newly imported lead could also return to its still-dirty source editor after a successful full submission. That success now closes the entire lead-to-full editor flow and lands on My Submissions: it returns to an existing submissions page in the stack, or opens the list from the Mine tab; a deep-link fallback relaunches the list if switching tabs fails. The original local lead draft and unpublished source images remain untouched for later explicit recovery. If navigation fails, the submitted full form is read-only and offers a list-navigation retry without issuing another submission command.

Controller regressions cover existing-list, Mine, and deep-link origins; fallback and failed-navigation recovery; unchanged source-draft contents; exclusion of unselected private source images from the published entrance payload; and unchanged single-page return behavior for ordinary full edits and moderation. Round 8 contains these findings and is not a clean review.

## Round 9 preview-context correction

Full Submission image previews now belong to the currently open Entrance or Source section. Switching sections, including an error-summary jump, advances the preview sequence; returning to the original section cannot revive its obsolete URL request. The final preview predicate also requires the original gallery's section to remain open. Entrance and Source remain separate contexts even when they share an asset ID. Activity Lead has no collapsible sections and requires no corresponding change.

Actual-helper regressions cover switching away, switching away and returning, error-summary navigation, preserving a valid same-section request, and switching the same image between entrance and source galleries. Existing image tests now explicitly open their valid source section; the Detail fixture opens its guide to match the separately corrected Detail context boundary. No API behavior is changed in this correction.

New lead and full-submission forms also now own an explicit creation intent. A fresh page instance creates a fresh key, stores it inside its local draft value, and passes it only to a new `submission.lead.save` or `submission.save` command. A confirmed draft recovery reuses its valid stored key; rejecting recovery or recovering a legacy draft without a key creates a new one. Importing lead content into a new full submission never copies the lead's creation intent. Retrying an uncertain network outcome keeps the same key. Existing submission edits and moderation retain their default resource-command semantics.

Controller regressions cover retry options, fresh identical forms, confirmed and rejected recovery, legacy drafts, independent lead-to-full intents, and unchanged edit/moderation command options. Successful commands keep revision-guarded cleanup of the submitted form draft and do not remove the original lead draft or unpublished source-image recovery material. The shared API command option and pure `createCommandIntent` helper are maintained by the coordinated idempotency workstream.

## Round 10 pending-creation recovery

Full Submission now persists the validated, normalized creation payload together with its intent before dispatch. Only an exact payload-and-intent match from that pending attempt may bypass the client's current-day expiry check to resolve an unknown result. An intent key by itself, a fresh form, or edited content does not qualify. Storage failure blocks dispatch instead of pretending the recovery record exists. Ambiguous transport outcomes retain the pending record; definitive rejection clears only the captured draft revision, preserving newer editor drafts and their fields.

The server's new-submission branch now also requires the activity end date to be on or after the current day. Existing idempotent request results are returned before that branch, so an already committed request can be replayed across midnight while an uncommitted expired request cannot create a new record. Existing edits and moderation keep their previous server semantics. No ownership, transaction, receipt-date, or period-snapshot constraint is changed.

Regressions connect the actual page controller, API command helper, and domain service across an unknown response and next-day recovery. Both committed and uncommitted paths are covered, together with changed payloads or intents, intent-only drafts, storage failure, late definitive failures with revision protection, and existing-edit compatibility. A visible pending-result notice explains why an unchanged retry differs from editing and resubmitting.

The independent source review identified authentication and local-configuration failures as pre-ledger outcomes: neither proves that an earlier creation did not commit. These failures therefore preserve pending proof. Additional real-service regressions cover a committed request, next-day temporary authentication/configuration failure, and successful replay with the same request ID after recovery.

Targeted verification ran only on `ssh test-env` in `/tmp/wankapai-ux-loop-20260922`: `npm run typecheck` passed, and `node --import tsx --test tests/ux-loop-management.test.ts tests/submissions-ux.test.ts tests/domain.test.ts` passed all 151 tests. The main task still owns the final full build, complete suite, and browser/device acceptance boundaries.

## Round 15 privacy-decline feedback

Native callback simulation reproduced an incorrect recovery message after the real Privacy Gate rejection and privacy resolver returned `disagree`. The documented native failure `chooseMedia:fail privacy permission is not authorized` previously matched the generic album-authorization branch and directed users to photo settings.

Both submission forms now classify that specific privacy failure first. Chinese feedback explains that no image was added because the privacy notice was not accepted, that editing can continue, and that a later image attempt offers another opportunity to read the notice and choose whether to consent. Actual album authorization failures still use their separate settings guidance. Picker cancellation, prior images and drafts, genuine upload failures, and Chinese domain validation messages retain their behavior.

Four new controller regressions cover both forms, preserved images and local drafts, accurate optional-consent language, and continued editing. Existing album-permission and cancellation regressions remain intact. This is documented native callback simulation, not physical-device evidence. No local verification was run.

After the prior acceptance snapshot was sealed, the two page controllers and regression tests were synchronized to `/tmp/wankapai-ux-loop-20260922`. Remote `node --import tsx --test tests/ux-loop-management.test.ts tests/submissions-ux.test.ts` passed all 133 tests with 0 failures. The log is `.qa-native/r15-management-tests.log` in that remote checkout. The acceptance workstream owns the separate actual-resolver native-callback after-evidence and the final full-product checks.
