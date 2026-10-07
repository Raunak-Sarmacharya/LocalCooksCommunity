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

The gallery contains 89 Chef, Manager, and Local Cooks emails for requests, confirmation, time changes, cancellations, results, private feedback, corrections, reminders, conversation messages, and delayed delivery. It includes missing-contact, overnight, and daylight-saving fixtures. Arrival/departure recording has been retired; feedback emails replace it.

Use the recipient and scenario filters or search the subject/body. Switch between email, plain text, HTML source, and links; use Mobile to inspect a narrow email and Dark preview to check the alternate email theme independently of the app. The local gallery embeds the current logo so it works before the new asset is pushed. Download HTML/text or any attached calendar file.

Samples come from `tourEventMessages`, `currentReminders`, `renderTourReminder`, `renderHistoricalTourEmail`, and `generateChatDigestEmail`. Reminder queries use an in-memory fixture reader. The harness does not load `.env`, connect to the application database, call delivery, or send emails. The preview iframe blocks link navigation; the Links view displays the actual destinations and prefilled mailto values.

These previews show the current working tree, including uncommitted template edits. They are browser previews, not a Gmail rendering test or a prediction of a Google summary. All names, email addresses, and reservation details are fictional.

Regression check:

```powershell
node node_modules/vitest/vitest.mjs run -c vitest.config.server.ts server/services/tour-email-harness.test.ts
```
# Message alerts

The Conversation group includes the prompt starting-message email and attachment variant in both directions, plus the one-hour unread reminder. These use the actual message-email renderers with fictional names and recipients. See [message notification behavior and activation](chat-message-emails.md).

## Tour actions and layout

The supplied Airbnb screenshots show restrained branding, a prominent headline, useful appointment/property details, a clear main action, and secondary text links. The grey reservation cards above the messages are Gmail summaries, rather than email-template content. The screenshots also show Gmail dark mode; they do not establish the email's original background colour.

Tour and conversation templates now use a plain white surface, the original full Local Cooks logo and brand name, a purpose-led headline scaled to the supplied Airbnb examples (26px desktop/24px mobile, section headings 20px/18px, and 16px body copy), one full-width primary button, and secondary text links. The header uses a transparent red version of the original horizontal symbol and “Local cooks” wordmark, exported at 2146 × 733 pixels and displayed at 200px wide. Both the mark and name use brand red; the accessible image alternative is Local Cooks. The original white asset is preserved. Confirmations and reminders group details under Your appointment, Getting there, and optional Meeting notes. Calendar and directions links sit beside the relevant details. Customer confirmations omit the internal confirmation-record timestamp; the scheduled date/time and timezone remain. Calendar files remain attached to confirmations and confirmed cancellations. The admin email-design preview and promo defaults use the same horizontal red logo. All email renderers and the delivery boundary apply the shared light/dark theme, neutral header/footer and horizontal brand-red logo. Legacy booking/account emails retain their message content and actions.

Feedback asks whether the tour happened and invites comments and suggestions. Privacy and application guidance follow as short supporting notes. Only admins close the tour; allowing a chef to request to apply while review is pending is unchanged. The revised feedback and result copy is available in English, French, and Ukrainian; the existing shell/fact labels remain English. No new response deadlines, reply-to-email support, or approval promises were added.

Message actions link to the specific tour with `action=message`. The authenticated tour page resolves the authorized shared conversation and opens the same focused chat view in a modal; it does not choose a person from an email-provided name or ID. Review, feedback, change, and cancellation links open the authenticated tour details for the applicable action; clicking an email does not mutate a tour.

Chef and manager cancellation wording is generic. Automatic legacy reasons such as “Cancelled by chef” and recorded actor labels are hidden from their emails and public tour views; genuine shared reasons remain visible. Admin emails retain actor and audit details.

## Email design verification (8 October 2026)

The 89 tour fixtures and 56 account/booking fixtures passed browser checks at 375px in light and dark mode without horizontal overflow. Confirmation, feedback and welcome screenshots were also inspected at mobile and desktop widths. The gallery theme toggle was verified. The focused email suite passed 284 tests across nine files. Browser checks do not replace real Gmail/Outlook mailbox checks. No email was sent by the preview or tests.

Run `node node_modules/tsx/dist/cli.mjs scripts/preview-emails.ts` for the account/booking gallery on port 3847. Both galleries use fictional data and embed the local logo in previews; generated email source retains the production asset URL. Push `attached_assets/emailHeader-brand-red.png` with the template changes before deployed emails use that URL.
