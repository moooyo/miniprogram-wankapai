# Cloud setup

This code has not been deployed. A real Mini Program AppID, CloudBase environment, approved service category, privacy declaration, and subscribed message templates are still required for production use. The local demonstration mode is independent from cloud data.

## Deployment order

1. Create a WeChat CloudBase environment bound to the Mini Program. Keep production and development environments separate.
2. Build the project using the root build command. Deploy the generated `api` and `reminders` function directories, including their generated `package.json` and `config.json`, with cloud installation of dependencies. The function entry is `index.main`; use a supported Node.js runtime compatible with the root build target. Source files under `cloudfunctions/` are bundled with shared domain modules and are not standalone deployable TypeScript folders.
3. Create every collection listed in `infra/collections.json`. Apply `infra/database.rules.json` to every collection. Client reads and writes are denied; all access goes through the authenticated API and domain ownership checks. The collections file is an operator checklist, not a vendor CLI import schema. Add the listed composite indexes in the console, plus the owner indexes. Follow the console's missing-index guidance if the platform requires a different equivalent ordering.
4. Apply `infra/storage.rules.json` and `infra/functions.rules.json` in the security rule editors. Keep these function names aligned with the deployed names and client configuration. The reminder function must have client invocation disabled.
5. Configure environment variables from `infra/environment.example.json`. Populate `MODERATOR_OPENIDS` only on the API function, using trusted operator OpenIDs. Never accept a role, actor, or OpenID from request data. Do not put secrets or an operator list into the Mini Program bundle.
6. Configure the client AppID, cloud environment ID, and cloud mode. Upload an experience version and verify with two real WeChat accounts, including an ordinary user and an explicitly configured moderator.
7. Configure subscription templates only after selecting real templates in the Mini Program console. Keep sending disabled until the complete authorization and delivery flow has been verified.

## API and transactions

`api` accepts `{ action, payload, requestId? }` and returns `{ ok, data }` or `{ ok: false, error: { code, message, field? } }`. Mutations require a unique request ID that must be reused for a retry of the same user operation. The server derives identity from `cloud.getWXContext().OPENID` and checks `SOURCE === 'wx_client'`. Payload role fields are ignored. No HTTP trigger is configured.

CloudBase documents a 100-operation, 30-second transaction limit and single-document operations only; `where` queries are not assumed to work inside an SDK transaction. The adapter first plans the domain operation outside the SDK transaction using ordinary paginated reads and an isolated write overlay. It reads a global epoch before planning. The short SDK transaction then checks that epoch, applies at most 98 staged document writes, and increments the epoch. A changed epoch causes planning to retry, at most five times. Read-only plans also compare the epoch after their final read. No collection query, file download, or file upload runs inside the SDK transaction callback. See the [official transaction limits](https://docs.cloudbase.net/database/transaction).

All application writes, including reminder jobs, must use this adapter. This is a low-concurrency MVP strategy: the single epoch serializes commits across users. Console edits, scripts that bypass the adapter, and unguarded cloud functions are outside its consistency guarantee and must not modify live application data. Do not edit or delete `requests/__cloud_store_epoch_v1`, even when cleaning old idempotency requests. Use a maintenance window for migrations. Oversized write plans fail explicitly before committing rather than partially applying. `throwOnNotFound: false` makes missing records return `null`. Database errors and stack traces are not exposed to users. Production logs contain only sanitized error codes.

The first version scans owner data for aggregate views and all eligible preferences for a timer run. It is intended for an initial small deployment. Before a large rollout, measure contention and collection size, then introduce owner-partitioned epochs with a coordinated public-catalog version, partitioned due indexes, bounded catch-up jobs, and incremental totals. Do not increase timeouts indefinitely or drop transaction guarantees as a scaling shortcut.

## Private uploads and immutable publication

The client uploads to `uploads/{OPENID}/{assetId}.{jpg|jpeg|png|webp}`, then calls `asset.register`. The server verifies the exact environment and owner path, obtains a signed URL from the trusted storage SDK, and downloads with a 5 MiB streaming cap, a content-length precheck, and a timeout. Redirects and compressed responses are rejected. It checks the actual size and byte signature, then uploads the **same verified buffer** to `sealed/{OPENID}/{assetId}/{sha256}.{extension}` and stores only that sealed FileID. Preparation happens before the SDK commit transaction, and its promise is cached for epoch replanning within one API invocation. Content-addressed paths keep retries safe and prevent a later upload from changing an already reviewed image.

The storage rule deliberately denies all client reads. It allows owner writes only in the staging `uploads/` prefix. CloudBase `write` includes upload, overwrite, and deletion, so it cannot be used as an immutable publication boundary. Clients cannot write to `sealed/`. The original staging object can be deleted by its owner after registration. An operator may clean up unreferenced staging and sealed objects after a retention interval; never delete an object solely by guessing its filename.

`assets.urls` first runs the domain `assets.get` authorization query. An owner or moderator can view their permitted private image; other users can view only approved assets referenced by a currently published activity. The API then requests short-lived signed URLs (300 seconds) for those authorized FileIDs. URLs are bearer links and may remain usable until expiration after a withdrawal. Do not publish them in logs or use their existence as authorization. MIME signatures are an upload integrity check, not content moderation; operators must review the sealed image before publication.

Official rule references:

- [CloudBase storage security rules](https://docs.cloudbase.net/storage/security-rules): `auth.openid` is the Mini Program identity; `auth.uid` is the Web identity; `resource.openid` is the file creator; regular-expression `test(resource.path)` is supported.
- [WeChat storage rules](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/guide/storage/security-rules.html): `write` covers upload, overwrite, and deletion.
- [Cloud function security rules](https://docs.cloudbase.net/cloud-function/security-rules): invocation rules affect client SDK calls, not timer triggers.

## Reminder configuration

The included timer expression runs daily at 09:00 in the platform's UTC+8 timezone. Timer delivery can be duplicated. The function additionally requires trusted `SOURCE === 'wx_trigger'`; a forged `event.Type` or trigger name cannot authorize it. It does not accept an external actor or an owner list.

Use the **same** `REMINDER_TEMPLATES_JSON` value for both functions, and the matching template IDs in the client configuration. The field IDs must exactly match your selected WeChat templates. This example is structural only; its template IDs are placeholders and must not be deployed as real values:

```json
{
  "new_activity": {
    "templateId": "REPLACE_WITH_APPROVED_TEMPLATE_ID",
    "fields": { "thing1": "title", "date2": "dueOn", "thing3": "kindLabel" }
  },
  "deadline": {
    "templateId": "REPLACE_WITH_APPROVED_TEMPLATE_ID",
    "fields": { "thing1": "title", "date2": "dueOn" }
  },
  "reward": {
    "templateId": "REPLACE_WITH_APPROVED_TEMPLATE_ID",
    "fields": { "thing1": "title", "date2": "dueOn" }
  },
  "repayment": {
    "templateId": "REPLACE_WITH_APPROVED_TEMPLATE_ID",
    "fields": { "thing1": "title", "date2": "dueOn" }
  }
}
```

Only `thingN`, `dateN`, and `timeN` fields are currently supported. Date and time fields must map to `dueOn`. This implementation sends a date-only value for `dueOn`; use templates whose selected date/time field permits a date value. Expand the formatter and tests if a template requires another value type. `thingN` values are truncated to 20 Unicode characters. `REMINDERS_ENABLED=true` enables actual sending; missing or malformed templates fail closed. The default environment keeps sending disabled.

The worker materializes current tracked periods and billing cycles for users with enabled preferences. A failed user catch-up increments `materializationFailed` without suppressing other already due jobs; operators must investigate a nonzero count. It creates one job per owner, kind, entity, and due date. Deadline jobs become eligible three days before the deadline, repayment jobs use the account's lead time, and expected-reward jobs remain eligible across months until completed with an actual receipt. A pending activity without an expected receipt date does not generate an arbitrary date reminder.

Each authorization is scoped to owner, reminder kind, entity, and template ID with a remaining count. Claiming a job, consuming a count, and acquiring a lease happen in one transaction. The WeChat platform remains the authority on whether a subscription exists; a client-side acceptance record alone cannot guarantee delivery. Turning on preferences does not create unlimited subscription permission.

`new_activity` is a separate opt-in preference and subscription kind. Its grant scope is the literal entity ID `matches`; it does not borrow deadline, reward, or repayment grants. The worker considers currently published, active activities published during the last seven calendar days in UTC+8 (today and the previous six days). It matches active owned cards by bank, issuer, card network, and credit/debit kind. Matching is a discovery hint, not proof of bank eligibility; invitation-only activities are explicitly labelled. Each owner/activity/revision has a distinct job and consumes one matching grant count. Its date field is the publication date and its page opens that activity. Withdrawal, expiry, card removal/mismatch, an obsolete revision, or age beyond the seven-day window cancels an unsent job. Missing templates or insufficient grants keep the job explicitly unsent; sent and unknown-delivery jobs are never automatically repeated. Preferences and template availability do not grant unlimited promotional push permission.

| Status | Meaning |
|---|---|
| `pending` | Due and awaiting a worker claim |
| `needs_authorization` | Sending disabled, template missing, no matching grant, or platform reports no subscription |
| `sending` | Grant consumed and an exclusive lease acquired |
| `sent` | WeChat API explicitly acknowledged success |
| `sent_unknown` | Timeout, opaque response, or abandoned sending lease; actual delivery is unknown |
| `failed` | WeChat explicitly rejected the message for another reason |
| `cancelled` | The entity is no longer due, was completed/paid, or reminders were disabled |

`sent_unknown` is never automatically retried, including after lease expiry. A late explicit response from the original sender can settle the same lease token without initiating another send. An ambiguous network timeout may already have delivered a financial reminder. Operators must investigate before creating a deliberate replacement. The worker never labels an unknown delivery as sent and does not refund the consumed local grant. A cancelled job can become pending again when the same entity is due and the user re-enables reminders; sent and unknown jobs cannot be rearmed that way. Explicit failures are retained for operator investigation; enabling templates does not resubmit previously failed jobs automatically.

Official references:

- [WeChat timer trigger](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/guide/functions/triggers.html)
- [getWXContext](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/reference-sdk-api/utils/Cloud.getWXContext.html)
- [Subscription message API](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-message-management/subscribe-message/sendMessage.html)

## Verification boundary

Adapter and worker unit tests use a transactional in-memory store and a mock SDK whose transaction surface exposes only `doc` operations. They cover epoch conflicts, staged read overlays, oversized write-plan rejection, identity spoofing, private-image URL authorization, immutable image sealing, duplicate timers, grant scoping, cross-month receipts, and unknown-delivery handling. They do not prove that a real cloud environment has the correct indexes, security rules, subscribed templates, or permissions. Before publication, verify those on a dedicated cloud environment and check that direct client database reads, sealed writes, and reminder function calls are denied.
