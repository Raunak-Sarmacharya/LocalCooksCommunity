# Chef and manager message emails

New messages in an authorized kitchen conversation now use one notification episode per recipient. The first message queues an initial email for 15 seconds after its creation and one unread reminder for one hour after creation. Subsequent messages keep the same episode and create only in-app notifications; their email intents are suppressed.

A full read clears the recipient's episode. A partial read does not. Replying also clears the sender's pending episode, so their next incoming message can start a new alert. Firestore transactions update the message, episode, unread count and archive state together. Concurrent sends share one starting message. A changed manager receives a fresh episode tied to their actual current account.

The initial email includes the actual sender and recipient names, kitchen, up to 500 characters of the message or attachment filename, optional booking reference and an authenticated conversation link. It does not attach private chat files. The reminder uses the current conversation's unread count, including subsequent messages. No further reminder is queued within the same episode. Read/reply state, canonical conversation selection, current participants and booking permissions are checked immediately before delivery.

## Delivery and configuration

The persisted-message Firebase trigger commits the SQL intents, then publishes `localcooks/chat.message.start` to Inngest with a stable event id. The registered `starting-chat-message-email` function durably waits 15 seconds and dispatches the original initial intent. This is a minimum grace period, not an exact inbox arrival promise.

The existing two-minute recurring worker delivers unread reminders and recovers pending/failed initial intents. Temporary failures retain their original delivery keys, and accepted emails are acknowledged before later retries. Publishing failure retries the Firebase trigger without recreating the SQL intents. No schema migration, Firestore index or new package is required.

Local development cannot receive the hosted Inngest callback. After a participant message is saved and its authorization transaction releases its locks, the local API queues the same canonical notification intents. A development-only runner checks that message's initial and reminder delivery IDs every five seconds. It preserves the 15-second grace period, read/reply suppression and delivery locks; it never scans unrelated email work. No additional local configuration is required beyond the existing database, Firestore and email credentials. This runner is disabled on Vercel, outside development and under outbound-test suppression. Keep the development server running while testing delivery. Restarting it drops its local watch list; the SQL intents remain available to the hosted recovery worker.

To test locally, leave the recipient's chat closed, send a new message, and allow roughly 15–20 seconds plus SMTP delivery time. Test both directions. If an earlier message is still unread, read it first to end that episode; consecutive unread messages intentionally do not each generate an initial email. Reading or replying within the grace period suppresses the alert.

For activation:

1. Deploy the portal with both registered functions at the existing signed `/api/inngest` endpoint and sync that endpoint in Inngest. Keep its existing `INNGEST_SIGNING_KEY`, SMTP and database configuration.
2. Provision the production Firebase trigger's `INNGEST_EVENT_KEY` secret, or the staging trigger's `STAGING_INNGEST_EVENT_KEY` secret. The event key must belong to the same Inngest environment as the portal endpoint. Staging and production keys must remain separate. The staging Firebase export remains the deployment entry point; this change does not switch the project to production.
3. Deploy the matching Firebase trigger together with the portal writer change. Existing `DATABASE_URL` or `STAGING_DATABASE_URL` bindings remain required. Keep the recurring worker enabled for reminders/recovery.
4. Verify with two test accounts: first unread message, five consecutive messages, read within 15 seconds, partial read, full read, reply and a one-hour unread reminder. Check the durable delivery logs and actual inboxes. No real email or live service was used by the local automated tests.

Older persisted messages without episode metadata retain their legacy one-hour digest/recovery path. No historical notification backfill is performed.

## Staging inspection — October 7, 2026

The browser inspection confirmed both `starting-chat-message-email` and the two-minute recurring worker are registered in the Staging Inngest app. Recent recurring runs completed. The sole starting-message run inspected received `data: {}` and failed with `Invalid starting chat message identity`; this does not demonstrate actual chat-event publication or email delivery.

Read-only Firebase inspection found `onNewStagingChatMessage` active on the named staging database, but still deployed from October 5 with only `STAGING_DATABASE_URL` bound. `STAGING_INNGEST_EVENT_KEY` did not exist in Secret Manager. The current source additionally requires that event secret and publishes after committing the durable intents. The deployed producer therefore has not received the new starting-email integration.

The latest inspected manager-to-chef test message was unread and had a valid starting episode and recipient. The SQL database configured by the deployed trigger matched the workspace configuration, contained its confirmed tour and both participants, and contained no chat-email intents. Read suppression does not explain that message's missing email. Activation of the current producer must be verified before concluding SMTP or inbox delivery works.

The local staging audit now requires exactly both staging secret bindings, checks access to each, and rejects access to production secrets. The deployment helper adds an explicit `event-secret` operation. Supply `STAGING_INNGEST_EVENT_KEY` from the **same Staging Inngest environment** as the portal; the helper never falls back to `INNGEST_EVENT_KEY`. A portal's `INNGEST_EVENT_KEY` variable may also hold that staging key, so the variable name alone does not identify a production key.

When authorized to activate staging, provision the explicit key with `node scripts/firebase-staging-deploy.mjs event-secret`, ensure the restricted staging service identity can access it, compile/deploy the updated staging function with the existing helper, and verify using the updated audit. Then test new unread messages in both directions, inspect their real event identities and delivery records, and verify actual inbox delivery. Previously persisted messages do not automatically emit another document-created event.

Verification of the source integration: 94 mocked server checks passed, including Inngest, Firebase publication, local delivery, and notice production. Two isolated staging-tooling checks, script syntax checks, Functions TypeScript checking, and whitespace checking passed. This inspection did not provision a secret, change IAM, deploy, replay events, create a message, or send an email.

### Authorized staging activation completed

Later on October 7, the user explicitly authorized provisioning the staging event key, granting the staging trigger access, and deploying only `onNewStagingChatMessage`. The staging secret was created and the updated function deployment succeeded. The post-deployment audit verified both staging secret bindings and access policies, the named staging database, private invocation by the restricted staging service account, and unchanged production function and default Firestore-rules fingerprints.

The existing unread test message passed a read-only current participant/tour eligibility check. No chat-email intent had appeared at the immediate post-deployment check. Inbox delivery therefore remains to be verified with a fresh starting message: fully read the earlier episode, close the recipient conversation, send a new message, and check the resulting Inngest event, durable intent, SMTP acceptance, and inbox. Repeat in the other direction. No historical message replay or synthetic test email was performed during activation.

### Fresh-message producer failure identified

After activation, the user's fresh first-unread message at 16:32 IST reached the new Firebase revision but produced no SQL email intent or Inngest event. The recipient had read the preceding episode, and read-only checks confirmed current participant and tour eligibility. A diagnostic-only staging deployment then identified the next fresh message's exact early exit: `authType: unknown`, `reason: untrusted-auth-type`. The trigger had required `service_account` before reaching its canonical authorization checks.

The staging source now also permits `unknown` only when the event's `authId` equals the pinned server service account's email or numeric IAM identity. That identity was checked against the existing server credential configuration and a read-only IAM lookup. Missing/foreign identities and other authentication types remain rejected; current SQL ownership, sender role/UID, canonical relationship, eligibility and read/reply checks still run. Production does not gain this fallback. Thirty trigger checks and Functions TypeScript checking passed. Actual event publication, SMTP acceptance and inbox delivery still require a fresh message after this fix is deployed.

Structured producer diagnostics record event/message identifiers, authentication type, whether a writer identity is present/trusted, named skip stages, SQL commit outcome and successful event publication. They exclude message content, recipient addresses, sender UIDs and secrets. Retry errors record only the failed stage and a safe error code.

## Preview

Run `npm run preview:tour-emails` and filter the harness to **Conversation**. Starting messages, attachments and unread reminders are shown for both chefs and managers using fictional recipients and the actual renderers.

## Airbnb reference

[Airbnb documents email notifications for host and guest messages](https://www.airbnb.com/help/article/2893). It does not document an exact first-message reset rule, cooldown or email batching algorithm. The episode and grace-period behavior here follows the recommended options accepted in this conversation.
