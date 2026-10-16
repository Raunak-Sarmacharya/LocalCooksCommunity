import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"

const state = vi.hoisted(() => ({ maxDays: 30, limitReason: "max_term", card: { brand: "visa", last4: "4242" } as { brand: string; last4: string } | null,
  pay: vi.fn(), sync: vi.fn(), cardAction: vi.fn(), payBodies: [] as Array<Record<string, unknown>> }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ "Content-Type": "application/json" }) }))
vi.mock("@/lib/session-extensions", () => ({ completeCardAction: state.cardAction, newRequestKey: () => `key-${Math.random().toString(36).slice(2, 12)}` }))

import { StorageExtendSheet } from "./StorageExtendSheet"
import type { StorageRental } from "@/lib/storage-rentals"

const rental: StorageRental = { id: 3, ref: "ST-3", kitchen: { id: 1, name: "Harbour Kitchen" }, listing: { id: 4, name: "Dry shelf" }, unitLabel: "2",
  state: "active", phase: "ending_soon", startOn: "2026-10-01", paidThrough: "2026-10-20", graceEndsOn: "2026-10-25", holdoverDays: 0, accruedCents: 0,
  responseDeadline: null, declineReason: null, actions: ["extend"], terms: [], rentalTerms: { dailyPriceCents: 500, maxTermDays: 30, graceDays: 5 } }
const json = (body: unknown, ok = true) => ({ ok, json: async () => body })
const quoteFor = (days: number) => ({ days, dailyPriceCents: 500, subtotalCents: days * 500, taxCents: 0, serviceFeeCents: 0, totalCents: days * 500,
  maxDays: state.maxDays, limitReason: state.limitReason, newPaidThrough: new Date(Date.parse("2026-10-20T00:00:00Z") + days * 86400000).toISOString().slice(0, 10), card: state.card })

beforeAll(async () => {
  if (!i18n.isInitialized) await new Promise<void>(resolve => i18n.on("initialized", () => resolve()))
  await i18n.changeLanguage("en-CA")
})
beforeEach(() => {
  Object.assign(state, { maxDays: 30, limitReason: "max_term", card: { brand: "visa", last4: "4242" }, payBodies: [] })
  state.pay.mockReset(); state.sync.mockReset(); state.cardAction.mockReset()
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (url.endsWith("/extend/quote")) return json(quoteFor(body.days))
    if (url.endsWith("/extend")) { state.payBodies.push(body); return json(await state.pay(body)) }
    if (url.includes("/sync")) return json(await state.sync())
    throw new Error(`unexpected ${url}`)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function open(onExtended = vi.fn()) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <I18nextProvider i18n={i18n}><StorageExtendSheet rental={rental} open onOpenChange={vi.fn()} onExtended={onExtended} /></I18nextProvider>
  </QueryClientProvider>)
  return onExtended
}
const summary = () => screen.findByText(/New end date .* · Total/)

describe("Extend sheet", () => {
  it("offers 7/14/30 with the new end date and total, and a stepper", async () => {
    open()
    expect(await summary()).toHaveTextContent(/^New end date Tue, Oct\.? 27, 2026 · Total \$35\.00$/)
    for (const label of ["7 days", "14 days", "30 days"]) expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "14 days" }))
    await waitFor(() => expect(screen.getByTestId("extend-summary")).toHaveTextContent("Total $70.00"))
    fireEvent.click(screen.getByRole("button", { name: "More days" }))
    await waitFor(() => expect(screen.getByTestId("extend-summary")).toHaveTextContent("Total $75.00"))
    expect(screen.getByTestId("extend-days")).toHaveTextContent("15 days")
  })

  it("clips the chips and the stepper to what the server allows, and says why", async () => {
    Object.assign(state, { maxDays: 10, limitReason: "reservation" })
    open()
    await summary()
    expect(screen.getByRole("button", { name: "7 days" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "14 days" })).toBeNull()
    expect(screen.queryByRole("button", { name: "30 days" })).toBeNull()
    expect(screen.getByText("Up to 10 days can be added now.")).toBeInTheDocument()
    for (let n = 0; n < 5; n++) fireEvent.click(screen.getByRole("button", { name: "More days" }))
    await waitFor(() => expect(screen.getByTestId("extend-days")).toHaveTextContent("10 days"))
    expect(screen.getByRole("button", { name: "More days" })).toBeDisabled()
  })

  it("shows the reason and no pay button when nothing can be added", async () => {
    Object.assign(state, { maxDays: 0, limitReason: "window" })
    open()
    expect(await screen.findByTestId("extend-limit")).toHaveTextContent("You can extend once 14 days or fewer of paid time remain.")
    expect(screen.queryByRole("button", { name: /Pay/ })).toBeNull()
  })

  it("pays with the saved card and reports the extension", async () => {
    state.pay.mockResolvedValue({ paid: true, rental: { ...rental, paidThrough: "2026-10-27" } })
    const onExtended = open()
    await summary()
    fireEvent.click(screen.getByRole("button", { name: "Pay $35.00 with Visa •••• 4242" }))
    await waitFor(() => expect(onExtended).toHaveBeenCalledWith(expect.objectContaining({ paidThrough: "2026-10-27" })))
    expect(state.payBodies[0]).toMatchObject({ days: 7, expectedTotalCents: 3500, useSavedCard: true })
  })

  it("falls back to another card through Checkout", async () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    state.pay.mockResolvedValue({ checkoutUrl: "https://checkout.stripe.com/c/1" })
    open()
    await summary()
    fireEvent.click(screen.getByRole("button", { name: "Pay with another card" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/1"))
    expect(state.payBodies[0]).toMatchObject({ useSavedCard: false })
  })

  it("without a saved card offers a single pay button", async () => {
    state.card = null
    open()
    await summary()
    expect(screen.getByRole("button", { name: "Pay $35.00" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Visa/ })).toBeNull()
  })

  it("finishes 3D Secure with Stripe.js, then syncs", async () => {
    state.pay.mockResolvedValue({ requiresAction: true, clientSecret: "pi_secret_x", termId: 12 })
    state.sync.mockResolvedValue({ paid: true, rental })
    state.cardAction.mockResolvedValue(undefined)
    const onExtended = open()
    await summary()
    fireEvent.click(screen.getByRole("button", { name: /with Visa/ }))
    await waitFor(() => expect(onExtended).toHaveBeenCalled())
    expect(state.cardAction).toHaveBeenCalledWith("pi_secret_x")
  })

  it("says plainly when the card fails and lets the chef try another card", async () => {
    state.pay.mockResolvedValue({ cardFailed: true })
    const onExtended = open()
    await summary()
    fireEvent.click(screen.getByRole("button", { name: /with Visa/ }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Your card was declined. Nothing was charged. Try another card.")
    expect(onExtended).not.toHaveBeenCalled()
    expect(within(document.body).getByRole("button", { name: "Pay with another card" })).toBeEnabled()
  })
})
