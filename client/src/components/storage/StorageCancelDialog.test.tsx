import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"

const state = vi.hoisted(() => ({ preview: {} as Record<string, unknown>, cancel: vi.fn(), bodies: [] as Array<Record<string, unknown>> }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ "Content-Type": "application/json" }) }))
vi.mock("@/lib/session-extensions", () => ({ newRequestKey: () => "cancel-key-fixture" }))

import { StorageCancelDialog } from "./StorageCancelDialog"
import type { StorageRental } from "@/lib/storage-rentals"

const rental: StorageRental = { id: 47, ref: "SB-47", kitchen: { id: 1, name: "Harbour Kitchen" }, listing: { id: 4, name: "Dry shelf" }, unitLabel: "1",
  state: "reserved", phase: null, startOn: "2099-10-30", paidThrough: "2099-10-30", graceEndsOn: "2099-11-04", holdoverDays: 0, accruedCents: 0,
  responseDeadline: null, declineReason: null, actions: ["cancel"], timezone: "America/St_Johns",
  terms: [{ id: 1, seq: 1, kind: "first", startsOn: "2099-10-30", endsOn: "2099-10-30", days: 1, dailyPriceCents: 1100, subtotalCents: 1100, taxCents: 165,
    serviceFeeCents: 17, totalCents: 1282, status: "paid", paidAt: "2099-10-20T12:00:00Z" }], rentalTerms: { dailyPriceCents: 1100, maxTermDays: 30, graceDays: 5 } }
const onTime = { paidCents: 1282, alreadyRefundedCents: 0, refundCents: 1215, cardFeeCents: 67, lateChargeCents: 0, startsAt: "2099-10-30T02:30:00Z",
  freeUntil: "2099-10-29T02:30:00Z", lateChargePercent: 50, timezone: "America/St_Johns" }
const json = (body: unknown, ok = true) => ({ ok, json: async () => body })

beforeAll(async () => {
  if (!i18n.isInitialized) await new Promise<void>(resolve => i18n.on("initialized", () => resolve()))
  await i18n.changeLanguage("en-CA")
})
beforeEach(() => {
  state.preview = onTime; state.bodies = []; state.cancel.mockReset()
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/cancel/preview")) return json(state.preview)
    if (url.endsWith("/cancel")) { state.bodies.push(JSON.parse(String(init?.body))); return state.cancel() }
    throw new Error(`unexpected ${url}`)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function open() {
  const onCancelled = vi.fn(), onOpenChange = vi.fn()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <I18nextProvider i18n={i18n}><StorageCancelDialog rental={rental} open onOpenChange={onOpenChange} onCancelled={onCancelled} /></I18nextProvider>
  </QueryClientProvider>)
  return { onCancelled, onOpenChange }
}

describe("Storage cancel dialog", () => {
  it("leads with the server's refund, shows every deduction and the deadline, and sends the accepted amount with one key", async () => {
    const { onCancelled } = open()
    expect(await screen.findByTestId("storage-cancel-refund")).toHaveTextContent("You’ll get $12.15 back")
    expect(screen.getByTestId("storage-cancel-summary")).toHaveTextContent("Dry shelf")
    expect(screen.getByTestId("storage-cancel-summary")).toHaveTextContent("Rental payment$12.82")
    expect(screen.getByText(/This refund applies if you cancel by .* After that, 50% is kept under Harbour Kitchen’s policy\./)).toBeInTheDocument()
    const breakdown = within(screen.getByTestId("storage-cancel-breakdown"))
    expect(breakdown.getByText("You paid").nextSibling).toHaveTextContent("$12.82")
    expect(breakdown.getByText("Card processing fee (not refundable)").nextSibling).toHaveTextContent("−$0.67")
    expect(breakdown.getByText("Your refund").nextSibling).toHaveTextContent("$12.15")
    expect(breakdown.queryByText("Kept under the cancellation policy")).toBeNull()
    state.cancel.mockResolvedValue(json({ ...rental, state: "ended", actions: [], cancellation: { cancelledAt: "2099-10-22T12:00:00Z", refundCents: 1215, reason: "Moved" } }))
    fireEvent.change(screen.getByLabelText(/Why are you cancelling/), { target: { value: " Moved " } })
    fireEvent.click(screen.getByRole("button", { name: "Cancel rental" }))
    await waitFor(() => expect(screen.getByTestId("storage-cancel-outcome")).toHaveTextContent(
      "Your rental is cancelled. Your refund of $12.15 is on its way. Banks usually show it within 5–10 business days."))
    expect(state.bodies).toEqual([{ operationKey: "cancel-key-fixture", reason: "Moved", expectedRefundCents: 1215 }])
    expect(onCancelled).toHaveBeenCalledWith(expect.objectContaining({ state: "ended" }))
    expect(screen.queryByRole("button", { name: "Cancel rental" })).toBeNull()
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument()
  })

  it("names the late charge after the deadline and says plainly when nothing comes back", async () => {
    state.preview = { ...onTime, refundCents: 0, lateChargeCents: 1215, freeUntil: "2000-01-01T00:00:00Z", lateChargePercent: 100 }
    open()
    expect(await screen.findByText("Under Harbour Kitchen’s cancellation policy, this rental isn’t refunded now. Cancelling frees the unit for someone else.")).toBeInTheDocument()
    expect(screen.getByText(/The free cancellation deadline was .*, so 100% is kept/)).toBeInTheDocument()
    expect(within(screen.getByTestId("storage-cancel-breakdown")).getByText("Kept under the cancellation policy").nextSibling).toHaveTextContent("−$12.15")
  })

  it("shows the server's error, keeps the dialog open and keeps the same key for the retry", async () => {
    open()
    await screen.findByTestId("storage-cancel-refund")
    state.cancel.mockResolvedValueOnce(json({ code: "not_cancellable", error: "This rental can’t be cancelled now." }, false))
    fireEvent.click(screen.getByRole("button", { name: "Cancel rental" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("This rental can’t be cancelled now.")
    expect(screen.getByRole("button", { name: "Keep rental" })).toBeEnabled()
  })
})
