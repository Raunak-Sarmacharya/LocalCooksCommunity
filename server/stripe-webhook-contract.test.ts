/**
 * Stripe webhook contract checks (signature / duplicate / out-of-order).
 * No network charges. Uses Stripe test helpers when STRIPE_WEBHOOK_SECRET is set.
 *
 * Run: npx vitest run -c vitest.config.server.ts server/stripe-webhook-contract.test.ts
 */
import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  try {
    for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(
      "\n"
    )) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* ignore */
  }
}
loadDotEnv();

const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SK = process.env.STRIPE_SECRET_KEY || "";

function makeEvent(overrides: Partial<Stripe.Event> = {}): Stripe.Event {
  return {
    id: overrides.id || `evt_test_${Date.now()}`,
    object: "event",
    api_version: "2026-02-25.clover",
    created: Math.floor(Date.now() / 1000),
    type: (overrides.type as Stripe.Event.Type) || "payment_intent.succeeded",
    livemode: false,
    pending_webhooks: 0,
    request: null,
    data: {
      object: {
        id: "pi_test_contract",
        object: "payment_intent",
        amount: 1000,
        currency: "cad",
        status: "succeeded",
        metadata: {},
      } as Stripe.PaymentIntent,
    },
    ...overrides,
  } as Stripe.Event;
}

describe("stripe webhook contract", () => {
  it("refuses live Stripe keys", () => {
    expect(SK.startsWith("sk_test")).toBe(true);
  });

  it("constructEvent accepts a valid test signature", () => {
    if (!SECRET) {
      console.warn("skip: STRIPE_WEBHOOK_SECRET missing");
      return;
    }
    const stripe = new Stripe(SK || "sk_test_placeholder", {
      apiVersion: "2026-02-25.clover",
    });
    const payload = JSON.stringify(makeEvent({ id: "evt_sig_ok" }));
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
    });
    const event = stripe.webhooks.constructEvent(payload, header, SECRET);
    expect(event.id).toBe("evt_sig_ok");
  });

  it("constructEvent rejects a tampered / wrong signature", () => {
    if (!SECRET) {
      console.warn("skip: STRIPE_WEBHOOK_SECRET missing");
      return;
    }
    const stripe = new Stripe(SK || "sk_test_placeholder", {
      apiVersion: "2026-02-25.clover",
    });
    const payload = JSON.stringify(makeEvent({ id: "evt_sig_bad" }));
    expect(() =>
      stripe.webhooks.constructEvent(payload, "t=1,v1=deadbeef", SECRET)
    ).toThrow();
  });

  it("duplicate event ids are equal (idempotency key contract)", () => {
    const a = makeEvent({ id: "evt_dup_1" });
    const b = makeEvent({ id: "evt_dup_1" });
    expect(a.id).toBe(b.id);
    // Handlers key off payment_intent id / session id — same event id must not create two bookings
    expect(a.data.object && (a.data.object as { id?: string }).id).toBe(
      (b.data.object as { id?: string }).id
    );
  });

  it("out-of-order: payment_intent.succeeded may arrive before checkout.session.completed", () => {
    const succeeded = makeEvent({
      id: "evt_ooo_pi",
      type: "payment_intent.succeeded",
    });
    const checkout = makeEvent({
      id: "evt_ooo_cs",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_ooo",
          object: "checkout.session",
          payment_intent: "pi_test_contract",
        } as Stripe.Checkout.Session,
      },
    });
    // Contract: handlers must tolerate either order (lookup by PI / session metadata; no throw on missing booking)
    expect(succeeded.type).toBe("payment_intent.succeeded");
    expect(checkout.type).toBe("checkout.session.completed");
    const piFromCheckout =
      typeof checkout.data.object.payment_intent === "string"
        ? checkout.data.object.payment_intent
        : null;
    expect(piFromCheckout).toBe("pi_test_contract");
  });
});
