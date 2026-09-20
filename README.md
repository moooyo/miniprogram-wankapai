# Bank Benefits Mini Program

A native WeChat Mini Program implementing the accepted blue-and-white design. It preserves the original workflow: user submission, operator review, public activity discovery, private participation tracking, a card wallet, recurring periods, reward receipts, and scoped reminders.

## Current delivery

- 16 native pages and 3 reusable components.
- Native WXML/WXSS/TypeScript source, shared business logic, and two CloudBase functions.
- A prebuilt `dist/` directory in the downloadable delivery archive, generated and verified on the designated remote environment. Git tracks source only; `dist/` is intentionally ignored.
- Explicit, persistent demonstration mode with fictional activities. It makes no cloud calls or message deliveries.
- Real cloud integration code, ownership checks, review authorization, immutable image storage, and a configurable reminder worker.

No production AppID, CloudBase environment, operator account, or subscription template has been configured. A local test-account demo has been opened in WeChat DevTools; its AppID is kept in the ignored private project configuration. No experience version has been uploaded, and no public release or real notification has been sent. Physical devices and real cloud integration still need acceptance testing.

## Open the demonstration

For a Git checkout, generate `dist/` with `npm ci` followed by `npm run build` in the designated development/verification environment before importing the project. The original delivery archive already includes these build files. The working configuration remains in demonstration mode until real account details are supplied.

1. Extract the delivery archive, or clone and build the repository, in a normal development folder.
2. Sign in to WeChat DevTools with WeChat and obtain your own Mini Program [test account](https://developers.weixin.qq.com/miniprogram/dev/devtools/sandbox.html). The committed `touristappid` is only a placeholder; guest mode is not the supported execution path.
3. Put the test AppID in the root `project.private.config.json` as `{ "appid": "YOUR_TEST_APPID" }`, then import the **project root containing `project.config.json`**. The private file is ignored by Git and overrides shared configuration. The project points to `dist/miniprogram/` and `dist/cloudfunctions/`. If DevTools rewrites shared configuration during import, keep the personal AppID in the private file.
4. Keep `miniprogram/runtime-config.js` in `mode: 'demo'`. The compiled copy in `dist/miniprogram/runtime-config.js` already matches it.
5. Use the five tabs. The user page exposes a clearly labeled demonstration role switch so the submission/review flow can be tried without giving a production user moderator privileges.

Demonstration records are saved in the developer tool/device's own storage. Uploaded demonstration images are saved to local Mini Program files. They are not uploaded to a real cloud environment. Clearing the demonstration cache removes local demonstration records. Official bank overview links in the sample data are not registration links for the fictional offers.

## Acceptance path

1. Check that the bank strip scrolls and the full-bank picker searches the catalogue. Compare all activities with card-matched activities.
2. Open the monthly task and change its progress. Mark an activity complete without registering first, then confirm or correct its actual receipt.
3. Confirm a previous-period pending reward and check that its income month follows the actual receipt date.
4. Add another card with an independent or explicitly shared billing account. Change the current bill's actual due date and mark or undo payment.
5. Share an activity lead with a bank, title, and source link, bank-app path, or screenshot. Switch to the demonstration moderator, complete the verified rules, and publish or return it. Unreviewed leads stay private.
6. Confirm that single-step activities do not show an empty progress meter. Rules, management, and participation history use separate sheets.
7. Reminder buttons in demonstration mode explain that no WeChat message is sent.

## Source layout

| Directory | Purpose |
| --- | --- |
| `miniprogram/pages/` | Native user and operator pages |
| `miniprogram/components/` | Adaptive sheets, demonstration banner, privacy authorization |
| `miniprogram/services/` | Typed API client, local demonstration, display formatting |
| `shared/` | API contracts and bank/issuer metadata |
| `domain/` | Calendar periods, identity-aware application service, validation, storage abstraction |
| `cloudfunctions/api/` | Authenticated CloudBase API |
| `cloudfunctions/reminders/` | Timer worker and template configuration |
| `cloudfunctions/shared/` | Cloud database and immutable asset adapters |
| `infra/` | Collection/index checklist, deny-by-default rules, environment examples |
| `tests/` | Business, authorization, adapter, reminder, native-contract, and demo-flow tests |
| `dist/` | Ready-to-import build output |

## Configure a real environment

Follow [Cloud setup](docs/cloud-setup.md). In particular:

- Replace the project AppID and configure the client cloud environment; switch `mode` to `cloud` only after the backend is deployed.
- Put moderator OpenIDs and subscription template mappings in **function environment variables**, never in the client bundle.
- Apply the database, storage, and function rules before using real data. Create the documented indexes.
- Real uploads are verified and copied to server-write-only sealed objects. Editing an original upload cannot alter an approved image.
- Keep actual reminders disabled until the selected templates, authorization, and delivery have been tested. New-activity reminders use card matching and finite `matches` subscription grants; they are not an unlimited broadcast channel.
- `webViewEnabled` defaults to `false`. A personal-subject app must use the supported copy-link, Mini Program navigation, or image/path alternatives. Enabling web-view later requires the corresponding platform capability and verified business domains, not merely a client flag.
- Configure the real privacy declaration and verify the native privacy authorization dialog before publishing.

Personal-subject category suitability for moderated public activity information is still a platform classification question. This project retains the requested workflow; it does not claim that a particular category has been approved or that operator moderation automatically grants category eligibility. Show the real workflow when confirming the category and submitting the app for review.

## Build and verification

Node.js 20 or later is used for development. Install dependencies with `npm ci` and build with `npm run build`. The build bundles shared code, preserves a single API/demo runtime across pages, copies native assets, and adds the demonstration/privacy components. Source cloud-function folders are not deployable as unbundled TypeScript.

For this workspace, execute verification only on `ssh test-env` unless the user explicitly authorizes local verification:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The delivered build passed TypeScript checking, 62 automated tests, dependency/route/resource checks, and an additional old official WXML/WXSS compiler pass. The latter is a syntax check, not a substitute for current developer tools or physical devices. See [Verification](docs/verification.md) for exact evidence and limits.

For repeatable simulator acceptance, use `npm run test:ui` after enabling the DevTools CLI/HTTP service port and configuring a local test AppID. This builds the source, opens an isolated demo project, runs scripted interactions and layout assertions, and saves screenshots plus an HTML report under `.qa-native/ui-acceptance/`. It does not use computer-use automation. See [Scripted UI acceptance](docs/ui-acceptance.md) for prerequisites, isolation, and coverage limits. The local-verification authorization rule still applies.

The subsequent [UI/UX remediation](docs/ui-ux-remediation.md) passed 109 automated tests and 22 SDK scenarios. It adds global history access, consistent card and reward identity, actionable bill reminders, guarded draft recovery, clearer validation, and improved visual hierarchy.

The latest [product UX refinement](docs/product-ux-refinement.md) adds benefit-specific recording, prioritized todo actions, lightweight activity leads, readable card names, and preserved form context. All 148 automated tests, type checking, and the source build passed. Its expanded SDK run was interrupted by a closed DevTools connection, so complete UI acceptance of this version remains outstanding.

## Business guarantees

- Each period gets a new participation record with a rule snapshot; rollover never clears old progress or pending rewards.
- Direct receipt recording can complete a task in the same transaction. Retries reuse an operation ID and do not duplicate income.
- CNY, HKD, and MOP use integer minor units and separate totals. Actual receipt dates determine the income month.
- User-scoped data and uploaded assets are authorized on the server. Changing a client role flag cannot create production review access.
- Submission versions prevent an old review form from overwriting a newer submission.
- Recurring catch-up is split into recoverable batches, respecting CloudBase's transaction operation limit.
- Unknown message-delivery results are retained as unknown and are not blindly retried.

The cloud database adapter uses optimistic planning and a global epoch for a low-concurrency first deployment. Its scaling boundaries and the prohibition on unguarded console writes to live data are documented in the cloud setup guide.

## Licenses

See [Third-party notices](THIRD_PARTY_NOTICES.md) for the bank-logo and Lucide icon licenses. Bank marks are used only to identify the corresponding banks; this project is not presented as an official bank application.
