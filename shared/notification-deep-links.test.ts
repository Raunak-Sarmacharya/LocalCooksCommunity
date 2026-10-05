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

import { describe, it } from "vitest";

/*
 * A `node:assert` script, wrapped so vitest can REPORT it.
 *
 * It was named `*.test.ts`, which made vitest collect it — and a file with no `describe`/`it`
 * is reported as "No test suite found", i.e. a FAILED FILE. So a script whose every assertion
 * PASSED showed up as a failure, and a genuine regression showed up as exactly the same
 * failure. The signal was useless in both directions, and twenty of these had buried the two
 * real failures in this repo's baseline.
 */
describe("notification-deep-links", () => {
  it('preserves exact tour context for both roles and legacy notifications', () => {
    for (const role of ['chef', 'manager'] as const) {
      const path = `${role === 'manager' ? '/manager' : ''}/dashboard?view=viewings&viewing=42`;
      assert.equal(resolveNotificationHref({ role, type: 'booking_new', metadata: { viewingId: 42 } }), path);
      assert.equal(resolveNotificationHref({ role, actionUrl: `https://dev-${role}.localcooks.ca${path}` }), path);
    }
    assert.equal(resolveNotificationHref({ role: 'chef', metadata: { viewingId: 42, conversationId: 'shared' } }), chefMessagesHref('shared'));
  });
  it("holds", () => {

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

  });
});
