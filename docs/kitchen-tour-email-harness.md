# Kitchen tour email harness

Run from the repository root:

```powershell
npm run preview:tour-emails
```

Open [the local gallery](http://127.0.0.1:3848). The command watches the imported source files; reload the gallery after a renderer changes.

If npm is unavailable, use the installed Node runtime directly:

```powershell
node node_modules/tsx/dist/cli.mjs watch scripts/preview-tour-emails.ts
```

To save a standalone HTML gallery and the JSON samples:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/preview-tour-emails.ts --output ./tmp/tour-email-preview --export-only
```

The gallery contains Chef, Manager, and Local Cooks variants of requests, confirmation, time changes, cancellations, outcomes, corrections, reminders, conversation digests, and delayed-delivery notices. It includes missing-contact, overnight, and daylight-saving fixtures. Four events that only produce in-app notifications are listed separately.

Use the recipient and scenario filters or search the subject/body. Switch between email, plain text, HTML source, and links; use Mobile to inspect a narrow email. Download HTML/text or any attached calendar file.

Samples come from `tourEventMessages`, `currentReminders`, `renderTourReminder`, `renderHistoricalTourEmail`, and `generateChatDigestEmail`. Reminder queries use an in-memory fixture reader. The harness does not load `.env`, connect to the application database, call delivery, or send emails. The preview iframe blocks link navigation; the Links view displays the actual destinations and prefilled mailto values.

These previews show the current working tree, including uncommitted template edits. They are browser previews, not a Gmail rendering test or a prediction of a Google summary. All names, email addresses, and reservation details are fictional.

Regression check:

```powershell
node node_modules/vitest/vitest.mjs run -c vitest.config.server.ts server/services/tour-email-harness.test.ts
```
# Message alerts

The Conversation group includes the prompt starting-message email and attachment variant in both directions, plus the one-hour unread reminder. These use the actual message-email renderers with fictional names and recipients. See [message notification behavior and activation](chat-message-emails.md).

## Tour actions and layout

The supplied Airbnb message uses a centered 640px white card, a small logo on a white header, a prominent status headline, labeled stay details, contextual directions links, and a large itinerary action. Those observations come from the supplied message, whose source ends partway through the itinerary; they are not a claim about every Airbnb email.

The tour templates use that hierarchy with Local Cooks branding: a centered logo on the red header, a primary tour action and message action near the status, then calendar, directions, tour changes/cancellation, and support where relevant. Desktop actions use two columns; mobile actions stack at full width. Calendar files remain attached to confirmations and confirmed cancellations.

Message actions link to the specific tour with `action=message`. The authenticated tour page resolves the authorized shared conversation and opens the same focused chat view in a modal; it does not choose a person from an email-provided name or ID. Review, check-in/out, change, and cancellation links open the authenticated tour details for the applicable action; clicking an email does not mutate a tour.

Chef and manager cancellation wording is generic. Automatic legacy reasons such as “Cancelled by chef” and recorded actor labels are hidden from their emails and public tour views; genuine shared reasons remain visible. Admin emails retain actor and audit details.
