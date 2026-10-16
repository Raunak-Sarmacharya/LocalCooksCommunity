import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ fetch: vi.fn(), cardAction: vi.fn() }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ "Content-Type": "application/json" }) }))
vi.mock("@/lib/session-extensions", () => ({ completeCardAction: state.cardAction, newRequestKey: () => "key-12345678" }))

import { payExtension, requestRental } from "./storage-rentals"

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
