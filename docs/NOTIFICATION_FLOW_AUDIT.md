# Chef journey notification audit

Source review: 2026-09-26. This describes **code paths**, not verified production delivery. A check mark means a handler attempts to create the notification or send the email after the state change. It does not prove SMTP delivery or deployment of the Firestore trigger.

## Confirmed product rules

- Chef ↔ manager chat: **in-app notification only** for each new human message; no message email.
- First access to chef ↔ manager chat: **notify the chef in-app**, even before a manager sends a message.
- Seller submission receipt, approval/rejection, and rejected document: **both in-app and email**.
- Local Cooks tour handoff to manager and post-tour kitchen access invitation to chef: **in-app only**.
- Chef tour cancellation or time-change request to manager: **both in-app and email**.
- Kitchen Step 1 and document submission receipts to chef: **both in-app and email**.
- Tour no-show to chef: **in-app only**.
- Local Cooks admins: **email and a visible in-app notification center** for new requests. Seller document uploads/replacements also send both.
- Seller cancellation receipt to chef: **both in-app and email**.
- Seller document approved: **both** to chef. Seller application moved to review: **in-app only** to chef.
- Kitchen documents submitted to Local Cooks admin queue: **both in-app and email**.
- Seller document upload/replacement receipt to chef: **in-app only**. Seller cancellation to admins: **both in-app and email**.
- Chef tour cancellation: **in-app confirmation** to chef. Manager tour confirmation and manager's own kitchen document approval: **no extra self-alert**.
- Other events: choose in-app and email channels **event by event** with the product owner.

## Seller application

| Event → recipient | In-app now | Email now | Current destination / next action | Gap or decision |
| --- | --- | --- | --- | --- |
| Submit → chef | Yes in current worktree | Yes, receipt varies by uploaded documents | In-app and email open My Applications or document upload | Confirmed channel policy. |
| Submit → Local Cooks admin | Yes in current worktree | Yes | Admin seller applications queue | Admin center now reads the existing notification table. |
| Document upload/resubmission → chef | Yes in current worktree | No | My Applications | Confirmed channel policy. |
| Document upload/resubmission → admin | Yes in current worktree | Yes in current worktree | Admin seller applications queue | Confirmed channel policy. |
| Admin approves/rejects → chef | Yes in current worktree | Yes | In-app and email open training on approval or My Applications on rejection | Confirmed channel policy. |
| Admin rejects individual document → chef | Yes in current worktree | Yes | In-app and email open document replacement | Confirmed channel policy. |
| Admin approves individual document → chef | Yes in current worktree | Yes | My Applications | Confirmed channel policy. |
| Moved to under review → chef | Yes in current worktree | No | My Applications | Confirmed channel policy. |
| Chef cancels → chef | Yes in current worktree | Yes | My Applications | Confirmed channel policy. |
| Chef cancels → admin | Yes in current worktree | Yes in current worktree | Admin seller applications queue | Confirmed channel policy. |

Evidence: `server/routes/firebase/applications.ts` submission, document, and cancellation handlers; `server/routes/applications.ts` status and document-review handlers; `server/email.ts` seller templates. Admin UI updates seller status through `/api/applications/:id/status`.

## Kitchen tour

| Event → recipient | In-app now | Email now | Current destination / next action | Gap or decision |
| --- | --- | --- | --- | --- |
| Request → chef | Yes | Yes | My Tours | Receipt uses `booking_confirmed` type even while awaiting review. |
| Request → Local Cooks admin | Yes, visible in current worktree | Yes | Admin tour queue | Admin center reads the existing notification table. |
| Local Cooks approves → chef | Yes | No | My Tours | Confirmed in-app only. |
| Local Cooks approves → manager | Yes | Yes | Manager tours, review request | Present. |
| Local Cooks declines → chef | Yes | Yes | My Tours | Present. |
| Manager confirms → chef | Yes | Yes, calendar invite | My Tours | Present. |
| Manager confirms → manager | No | Yes, calendar invite | Calendar / manager tours | Confirmed: no extra in-app self-alert. |
| Manager cancels → chef | Yes | Yes | My Tours, labelled Reschedule | Link opens tour list; there is no one-click reschedule from this alert. |
| Chef cancels → manager | Yes | Yes in current worktree | Manager tours | Confirmed channel policy. Chef also gets an in-app receipt. |
| Chef requests time change → manager | Yes | Yes in current worktree | Manager tours, review request | Confirmed channel policy. |
| Manager accepts/declines time change → chef | Yes | Yes | My Tours | Present. |
| Tour completed → chef | Yes | No | Direct kitchen application form | Confirmed in-app only; CTA starts the next step. |
| No-show → chef | Yes | No | My Tours | Confirmed in-app only. |

Evidence: `server/routes/viewings.ts` request, admin review, reschedule, and status handlers.

## Request to apply and kitchen documents

| Event → recipient | In-app now | Email now | Current destination / next action | Gap or decision |
| --- | --- | --- | --- | --- |
| Step 1 submitted → chef | Yes in current worktree | Yes | In-app and email open Kitchen Requests | Confirmed channel policy. |
| Step 1 submitted → Local Cooks admin | Yes, visible in current worktree | Yes | Admin kitchen request queue | Admin center reads the existing notification table. |
| Step 1 approved → chef | Yes | Yes | Chat when conversation exists; requirements otherwise | First chat access is notified even when the conversation is created later. |
| Step 1 approved → manager | Yes | Yes | Chat when conversation exists; applications otherwise | Action is appropriate when chat exists. |
| Step 1 rejected → chef | Yes | Yes | Kitchen Requests | Specific request selection can be improved. |
| Kitchen documents submitted → chef | Yes in current worktree | Yes | In-app and email open Kitchen Requests | Confirmed channel policy. |
| Kitchen documents submitted → manager | Yes | Yes | Manager applications | Present. |
| Kitchen documents submitted → admin | Yes, visible in current worktree | Yes in current worktree | Admin kitchen request queue | Confirmed channel policy. |
| Final approval → chef | Yes | Yes | Approved Kitchens | Confirmed destination. |
| Final approval → manager | No self-notification in current worktree | No | Manager applications | Confirmed: no extra alert for own action. |
| Final rejection → chef | Yes | Yes | Kitchen Requests | Specific request selection can be improved. |

Evidence: `server/routes/firebase/kitchen-applications.ts` submission, admin and manager review handlers; `server/services/notification.service.ts` chef approval/rejection links; `server/email.ts` kitchen templates.

## Chef ↔ manager messages

Chat system-message lifecycle: Step 1 approval opens chat and explains that kitchen documents come next; Step 2 submission writes “Kitchen documents submitted for review.”; final approval alone writes “You're approved to book this kitchen.” The final message requires an approved application, tier 3 or higher, and a recorded Step 2 submission. The chat display hides legacy approval-like copy until those conditions are reflected in the application data.

- The client writes human messages to Firestore. `functions/src/index.ts:onNewChatMessage` creates one Neon in-app notification for the other party, with a link to the conversation; system messages are skipped. It sends **no email**, matching the confirmed rule.
- Chef and manager notification centers poll for unread counts every 30 seconds when closed and 10 seconds when open. This is not a push notification.
- The Firestore trigger must be deployed and have working Neon access. The source audit alone cannot verify production delivery.
- `createInAppNotification` previously caught database errors and returned `null`, causing the trigger to log success. The current worktree rethrows insertion errors and enables function retry; deployment remains unverified.
- The trigger handles sender roles `chef` and `manager`; `admin` messages do not create the other party's alert through this path.
- The legacy `/message-received` HTTP endpoints accept recipient IDs from the request. No client call was found in the current chat service; they should not be used as a fallback without server-side authorization checks.

## Environment verification still needed

- Send one live event through each transition and confirm the recipient, delivery channel, content, and click destination. SMTP acceptance does not prove inbox delivery.
- Confirm the Firestore message trigger is deployed with Neon credentials and retry enabled. The source audit cannot prove deployment or production delivery.
- Confirm admin notification records created for tour and kitchen requests appear in the new admin bell after deployment.
- Legacy chat notification HTTP endpoints should be retired or given server-side conversation membership checks before relying on them; the current client chat flow uses the Firestore trigger.
