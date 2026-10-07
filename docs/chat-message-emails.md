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

## Preview

Run `npm run preview:tour-emails` and filter the harness to **Conversation**. Starting messages, attachments and unread reminders are shown for both chefs and managers using fictional recipients and the actual renderers.

## Airbnb reference

[Airbnb documents email notifications for host and guest messages](https://www.airbnb.com/help/article/2893). It does not document an exact first-message reset rule, cooldown or email batching algorithm. The episode and grace-period behavior here follows the recommended options accepted in this conversation.
