# Chef and manager notification sound

Research and implementation decision, 8 October 2026.

## Product contract

The user selected sound for new notifications in both foreground and background tabs, explicit opt-in in the notification dropdown, browser-local preferences remembered per user, and desktop/open-platform scope. Admin sound and closed-platform push are outside this change.

Enable sound plays a short preview and activates audio from that click. Mute and Test sound remain next to the control in the dropdown and full notification page. Sound status distinguishes off, ready, audio activation needed, and browser capability/storage failure. The copy is localized in English, French and Ukrainian. Controls wrap at narrow widths. The enable/mute action is a native button with an associated status description, rather than a toggle with a changing label; this follows the [W3C button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/).

Opt-in survives reload and sign-out. Activation does not: a new tab may need a user interaction. Once opted in, an ordinary trusted click or keypress can activate this tab without another preference decision. Muting affects every open tab of the same portal, user and browser profile. Chef and manager portals run on distinct origins; origin-scoped storage and locks do not synchronize preferences between those portals or between devices.

## Browser research and consequences

- Chrome applies autoplay restrictions to Web Audio. Create/resume AudioContext during a user gesture and inspect its state. The UI must not equate a saved preference with a running audio context. [Chrome autoplay policy](https://developer.chrome.com/blog/autoplay), [MDN Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).
- Safari also lets users block autoplay. Catch failures rather than assuming playback worked. [WebKit autoplay policy](https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/).
- Audio can become interrupted by device sleep, audio hardware ownership or leaving a page on iOS. A running context is an application readiness signal, not proof that speakers are audible. OS volume, browser/site mute and output-device settings remain outside the application's control. Test sound lets the user confirm audibility. [Audio context states](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/state).
- Background timers are throttled. Frozen pages suspend JavaScript tasks, and discarded pages must reload. In-page sound cannot promise timely alerts while sleeping, frozen, discarded or closed. Do not use silent audio loops to keep the browser awake. [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API), [Chrome lifecycle documentation](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), [Chrome timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/).
- TanStack Query needs explicit background polling. Its polling interval is independent of freshness; it is still subject to browser scheduling. Keep the existing authenticated request/retry model and enable background polling for these two portals. [TanStack polling documentation](https://tanstack.com/query/latest/docs/framework/react/guides/polling).
- Storage events synchronize other same-origin tabs but do not fire in the writing window. A local custom event handles multiple centers in the same document. Web Locks serialize the read/claim/write operation across tabs; localStorage alone is not atomic coordination. Both are scoped to an origin. [Storage event](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event), [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
- Keep alerts short and user-controlled. The chime is approximately 380 ms, well below the WCAG audio-control criterion's three-second threshold, and has an explicit mute control. Audio supplements the existing visible notification list and unread badge. [W3C audio-control guidance](https://www.w3.org/WAI/WCAG21/Understanding/audio-control).
- Notifications delivered while the app is closed require a separate push/service-worker design and permission flow. That is a different delivery channel from custom in-page audio. [Service worker notification API](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification).

These are platform constraints and documented API behaviors. The following timing and grouping choices are this implementation's product/engineering policy.

## Event detection and delivery

The existing unread-count endpoints now return the count, a database sample timestamp and at most 20 identities from the last two minutes. The query includes recent read/archived identities as well as unread ones; restoring them therefore does not become a new creation event. It retains authenticated owner checks, expiration filters, manager location scope and global-location alerts. The bounded recent lookup uses the owner/creation-time indexes in migration 0051. No new schema or third-party service is required.

The client detects previously unseen eligible identities. It does not compare unread counts: simultaneous reads can hide a real new item, and optimistic rollbacks can increase a count without creating anything. Server sample timestamps reject repeated or out-of-order snapshots, including cache rollbacks. Each mounted center observes the shared query result, so a notification page cannot inadvertently take over the bell's request and silence an activated bell.

The first sample is silent, including existing unread notifications. Switching manager location establishes a silent baseline. A gap exceeding two minutes establishes another silent baseline; old offline/sleep backlog must not become a burst of sounds. Short interruptions can produce one chime for fresh notifications still in the two-minute window. Muted or audio-blocked events are consumed locally and are not replayed on enable/reactivation.

Polling is every 15 seconds with the dropdown closed and 10 seconds while open, including background tabs. Under normal scheduling, arrival is detected on the next successful poll; this is not an immediate-delivery SLA. At 15 seconds, each mounted polling observer can make four requests per minute, subject to query deduplication and browser throttling. There is no second audio-specific poll. Fresh eligible events also refresh an open notification list.

One Web Lock protects a per-user/per-role playback ledger. The first ready tab claims the batch; other tabs suppress it. Different events within a five-second cooldown are consumed without queued playback. The ledger holds only bounded IDs and the last sound time, never titles, messages or credentials. The device clock affects only cooldown; server time decides freshness. Clock rollback does not indefinitely silence sound.

If Web Audio, secure-context Web Locks or usable local storage is absent, sound is unavailable and the bell continues to operate. Coordination/storage failures suppress audio; mute remains usable. Unmount/account changes close audio, stop scheduled notes, remove listeners and cancel pending playback. Sign-out retains only validated on/off preference entries; it clears delivery history with the rest of session storage.

## Why this transport

The inspected notification system writes to PostgreSQL and has authenticated polling readers. It has no notification event stream. This change repairs background polling and creation detection at the existing boundary, rather than introducing a second notification-delivery system just for audio.

A later sub-second delivery requirement would justify a durable event stream, reconnect cursor and fanout architecture. Current Vercel documentation does support WebSocket connections; implementation would need to fit the app's deployment/runtime and cross-instance delivery requirements. WebSockets still cannot execute JavaScript in a frozen or closed page. [Vercel WebSocket guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections). Closed-platform delivery would additionally require the separately selected push-notification scope.

## Validation

Automated checks cover opt-in preview, silent bootstrap, new IDs with unchanged counts, non-monotonic ID arrival, read/archive restoration, stale/out-of-order snapshots, manager location changes, reconnect baselines, multi-tab deduplication, burst cooldown, mute propagation, interrupted contexts, remembered account/role preferences, sign-out retention, unavailable storage/coordination, clock rollback, unmount cancellation, both dropdowns, simultaneous page/bell query observers and admin exclusion. SQL checks cover ownership, scope/global alerts, expiry and bounded snapshots.

Chrome checks on the running local manager and chef portals verify the controls, activation status and layout. A second manager tab verifies remembered opt-in and mute synchronization. A dedicated manager tab at 375 px verifies the enabled controls fit, with the viewport then restored. Automated browser audio scheduling checks use mocked AudioContext; real Chrome verification checks activation state. Actual speaker loudness and cross-browser/device behavior require listening and device testing.

Before release, listen to the chime in desktop Chrome/Edge, Firefox and Safari; check background arrival with a real new notification; verify browser/site mute, two activated tabs, a locked/sleeping device and reconnect. Those device checks are distinct from the automated policy checks and are not claimed as completed here.
