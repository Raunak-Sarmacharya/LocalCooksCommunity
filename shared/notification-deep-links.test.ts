import assert from "node:assert/strict";
import {
  chefDashboardView,
  chefIssuesHref,
  chefMessagesHref,
  managerDashboardView,
  managerMessagesHref,
  normalizeNotificationActionUrl,
  resolveNotificationHref,
} from "./notification-deep-links";

assert.equal(chefDashboardView("bookings"), "/dashboard?view=bookings");
assert.equal(
  chefMessagesHref("abc"),
  "/dashboard?view=messages&conversation=abc"
);
assert.equal(chefIssuesHref("damage-claims"), "/dashboard?view=issues-refunds&tab=damage-claims");
assert.equal(managerDashboardView("overstays"), "/manager/dashboard?view=overstays");
assert.equal(
  managerMessagesHref("xyz"),
  "/manager/dashboard?view=messages&conversation=xyz"
);

assert.equal(
  normalizeNotificationActionUrl("/dashboard?view=discover"),
  "/dashboard?view=discover-kitchens"
);
assert.equal(
  normalizeNotificationActionUrl("/dashboard?view=payments"),
  "/dashboard?view=issues-refunds"
);
assert.equal(
  normalizeNotificationActionUrl("/dashboard?view=storage"),
  "/dashboard?view=bookings"
);
assert.equal(
  normalizeNotificationActionUrl("/dashboard?view=claims"),
  "/dashboard?view=issues-refunds"
);
assert.equal(
  normalizeNotificationActionUrl("/manager/booking-dashboard?view=storage"),
  "/manager/dashboard?view=storage-checkouts"
);
assert.equal(
  normalizeNotificationActionUrl("/manager/booking-dashboard?view=damage-claims"),
  "/manager/dashboard?view=damage-claims"
);
assert.equal(
  normalizeNotificationActionUrl("/manager/booking/:id"),
  "/manager/dashboard?view=messages"
);
assert.equal(
  normalizeNotificationActionUrl("/booking/42"),
  "/booking/42"
);
assert.equal(normalizeNotificationActionUrl(null), null);

assert.equal(
  resolveNotificationHref({
    role: "chef",
    type: "message_received",
    actionUrl: null,
    metadata: { conversationId: "c1" },
  }),
  "/dashboard?view=messages&conversation=c1"
);
assert.equal(
  resolveNotificationHref({
    role: "chef",
    type: "damage_claim_filed",
    actionUrl: null,
    metadata: { claimId: 9 },
  }),
  "/dashboard?view=issues-refunds&tab=damage-claims"
);
assert.equal(
  resolveNotificationHref({
    role: "chef",
    type: "overstay_detected",
    actionUrl: "/dashboard?view=storage",
  }),
  "/dashboard?view=bookings"
);
assert.equal(
  resolveNotificationHref({
    role: "manager",
    type: "booking_new",
    actionUrl: null,
    metadata: { bookingId: 7 },
  }),
  "/manager/booking/7"
);
assert.equal(
  resolveNotificationHref({
    role: "manager",
    type: "message_received",
    actionUrl: "/manager/applications?chat=1",
    metadata: { conversationId: "c2" },
  }),
  "/manager/dashboard?view=messages"
);

console.log("notification-deep-links.test.ts: ok");
