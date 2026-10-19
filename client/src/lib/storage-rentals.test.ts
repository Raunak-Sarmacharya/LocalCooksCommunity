import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ fetch: vi.fn(), cardAction: vi.fn() }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ "Content-Type": "application/json" }) }))
vi.mock("@/lib/session-extensions", () => ({ completeCardAction: state.cardAction, newRequestKey: () => "key-12345678" }))

import { payExtension, requestRental, rentalStatus, can, type StorageRental } from "./storage-rentals"

const ok = (body: unknown) => ({ ok: true, json: async () => body })
const quote = (overrides: Record<string, unknown> = {}) => ({ listingId: 4, startOn: "2026-10-20", days: 7, endOn: "2026-10-26", dailyPriceCents: 500,
  subtotalCents: 3500, taxCents: 525, serviceFeeCents: 105, totalCents: 4130, maxTermDays: 30, taxRatePercent: 15, quotedAt: "2026-10-16T12:00:59.000Z",
  acceptedTermsVersion: "storage-v1", disclosureVersion: "d1", cancellationPolicy: { version: 3, noticeHours: 48, lateChargePercent: 50 }, ...overrides })
const calls = () => state.fetch.mock.calls.map(([url, init]) => [url, init?.method, init?.body ? JSON.parse(init.body) : undefined])

beforeEach(() => { state.fetch.mockReset(); state.cardAction.mockReset(); vi.stubGlobal("fetch", state.fetch) })
afterEach(() => vi.unstubAllGlobals())

describe("storage request", () => {
  it("re-quotes right before posting and sends the fresh quote's time and versions", async () => {
    state.fetch.mockResolvedValueOnce(ok(quote())).mockResolvedValueOnce(ok({ checkoutUrl: "https://checkout.stripe.com/x" }))
    const result = await requestRental({ listingId: 4, startOn: "2026-10-20", days: 7, requestKey: "key-12345678", acceptedTotalCents: 4130 })
    expect(result).toEqual({ checkoutUrl: "https://checkout.stripe.com/x" })
    const [[quoteUrl, , quoteBody], [postUrl, method, body]] = calls()
    expect(quoteUrl).toBe("/api/chef/storage-rentals/quote")
    expect(quoteBody).toEqual({ listingId: 4, startOn: "2026-10-20", days: 7 })
    expect([postUrl, method]).toEqual(["/api/chef/storage-rentals", "POST"])
    expect(body).toEqual({ listingId: 4, startOn: "2026-10-20", days: 7, requestKey: "key-12345678", expectedTotalCents: 4130,
      acceptedTermsVersion: "storage-v1", cancellationPolicyVersion: 3, disclosureVersion: "d1", quotedAt: "2026-10-16T12:00:59.000Z" })
  })

  it("stops without posting when the fresh total differs from what the chef accepted", async () => {
    state.fetch.mockResolvedValueOnce(ok(quote({ totalCents: 4200 })))
    const result = await requestRental({ listingId: 4, startOn: "2026-10-20", days: 7, requestKey: "key-12345678", acceptedTotalCents: 4130 })
    expect(result).toMatchObject({ priceChanged: { totalCents: 4200 } })
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })

  it("shows the server's translated error and code", async () => {
    state.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ code: "approval_required", error: "Apply first" }) })
    await expect(requestRental({ listingId: 4, startOn: "2026-10-20", days: 7, requestKey: "key-12345678", acceptedTotalCents: 4130 }))
      .rejects.toMatchObject({ message: "Apply first", code: "approval_required" })
  })
})

describe("extension payment", () => {
  const body = { days: 7, expectedTotalCents: 4130, requestKey: "key-12345678", useSavedCard: true }
  it("finishes 3DS with Stripe, then returns the synced server result", async () => {
    state.fetch.mockResolvedValueOnce(ok({ requiresAction: true, clientSecret: "pi_secret", termId: 9 })).mockResolvedValueOnce(ok({ paid: true }))
    state.cardAction.mockResolvedValue(undefined)
    expect(await payExtension(3, body)).toEqual({ paid: true })
    expect(state.cardAction).toHaveBeenCalledWith("pi_secret")
    expect(calls().map(([url]) => url)).toEqual(["/api/chef/storage-rentals/3/extend", "/api/chef/storage-rentals/3/extend/9/sync"])
  })
  it("reports a failed card after the bank refuses authentication", async () => {
    state.fetch.mockResolvedValueOnce(ok({ requiresAction: true, clientSecret: "pi_secret", termId: 9 })).mockResolvedValueOnce(ok({ cardFailed: true }))
    state.cardAction.mockRejectedValue(new Error("Bank said no"))
    expect(await payExtension(3, body)).toEqual({ cardFailed: true })
  })
  it("surfaces the bank's message when the term is still undecided", async () => {
    state.fetch.mockResolvedValueOnce(ok({ requiresAction: true, clientSecret: "pi_secret", termId: 9 })).mockResolvedValueOnce(ok({ requiresAction: true, clientSecret: "pi_secret", termId: 9 }))
    state.cardAction.mockRejectedValue(new Error("Bank said no"))
    await expect(payExtension(3, body)).rejects.toThrow("Bank said no")
  })
  it("returns a paid result without Stripe.js", async () => {
    state.fetch.mockResolvedValueOnce(ok({ paid: true }))
    expect(await payExtension(3, body)).toEqual({ paid: true })
    expect(state.cardAction).not.toHaveBeenCalled()
  })
})

describe("chef status sentences", () => {
  const base = { id: 1, kitchen: { name: "Harbour" }, unitLabel: "2", startOn: "2026-10-17", paidThrough: "2026-10-25", terms: [], state: "reserved", timezone: "America/St_Johns" } as unknown as StorageRental;
  const t = (key: string, values?: Record<string, unknown>) => `${key}:${JSON.stringify(values)}`;
  const now = new Date("2026-10-19T12:00:00Z");
  it.each(["2026-10-17", "2026-10-19"])("says a reserved unit is ready when its start is %s", startOn => {
    const status = rentalStatus({ ...base, startOn }, t, "en-CA", now);
    expect(status.sentence).toContain("stcStatusReservedReady");
    expect(status.sentence).toContain('"unit":"2"');
    expect(status.sentence).toContain('"end":"Sun, Oct 25"');
    expect(status.sentence).not.toContain('"start"');
  });
  it("uses future start dates only for future reservations and avoids a past move-in deadline", () => {
    expect(rentalStatus({ ...base, startOn: "2026-10-20" }, t, "en-CA", now).sentence).toContain("stcStatusReserved:");
    expect(rentalStatus({ ...base, paidThrough: "2026-10-18" }, t, "en-CA", now).sentence).toContain("stcStatusReservedPast:");
  });
  it("uses the actual release date for ended rentals and refuses a stale removal-review extension", () => {
    expect(rentalStatus({ ...base, state: "ended", releasedOn: "2026-10-18" }, t, "en-CA", now).sentence).toContain("Sun, Oct 18");
    expect(can({ state: "removal_review", actions: ["extend"] }, "extend")).toBe(false);
  });
});

it("does not promise an answer or extension by a past deadline", () => {
  const base = { kitchen: { name: "Harbour" }, state: "requested", responseDeadline: "2026-10-17T12:00:00Z", startOn: "2026-10-01", paidThrough: "2026-10-10", graceEndsOn: "2026-10-15", terms: [] } as unknown as StorageRental;
  const t = (key: string) => key;
  const now = new Date("2026-10-19T12:00:00Z");
  expect(rentalStatus(base, t, "en-CA", now).sentence).toBe("stcStatusRequestedElapsed");
  expect(rentalStatus({ ...base, state: "active", phase: "grace" }, t, "en-CA", now).sentence).toBe("stcStatusGraceEnded");
});
