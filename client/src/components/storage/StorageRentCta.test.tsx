import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"

const state = vi.hoisted(() => ({ signedIn: true }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}) }))
vi.mock("@/lib/session-extensions", () => ({ completeCardAction: vi.fn(), newRequestKey: () => "key-12345678" }))
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()], Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock("@/components/booking/CancellationPolicySummary", () => ({ PublishedCancellationPolicySummary: () => <p>Cancellation policy line</p> }))

import { StorageRentCta } from "./StorageRentCta"

const rows = [
  { listingId: 4, name: "Walk-in shelf", storageType: "cold", dailyPriceCents: 700, maxTermDays: 30, availability: { state: "now" }, unitCount: 2,
    sizeLabel: null, accessType: "anytime", temperatureRange: "2–4 °C", notes: null, photos: ["https://img.example/shelf.jpg"] },
  { listingId: 5, name: "Freezer bin", storageType: "freezer", dailyPriceCents: 900, maxTermDays: 7, availability: { state: "full" } },
]
beforeAll(async () => {
  if (!i18n.isInitialized) await new Promise<void>(resolve => i18n.on("initialized", () => resolve()))
  await i18n.changeLanguage("en-CA")
})
beforeEach(() => { state.signedIn = true; vi.stubGlobal("fetch", vi.fn(async () => state.signedIn ? { ok: true, json: async () => rows } : { ok: false, json: async () => ({ error: "Sign in" }) })) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const show = (canBook: boolean, onApply = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient()}><I18nextProvider i18n={i18n}><StorageRentCta kitchenId={1} canBook={canBook} onApply={onApply} /></I18nextProvider></QueryClientProvider>)
  return onApply
}

describe("kitchen page storage section", () => {
  it("approved chefs rent per listing; a full listing has no button", async () => {
    show(true)
    expect(await screen.findByText("Cooler · 2–4 °C")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Rent storage: Walk-in shelf" })).toHaveAttribute("href", "/storage/new?kitchenId=1&listingId=4")
    expect(screen.getByText("$9.00/day · Full right now")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Rent storage: Freezer bin" })).toBeNull()
  })

  it("chefs not yet approved see shelves, prices, rules and apply first", async () => {
    const onApply = show(false)
    expect(await screen.findByText("Walk-in shelf")).toBeInTheDocument()
    expect(screen.getByText("$7.00/day · Available now")).toBeInTheDocument()
    expect(screen.getByText("Cancellation policy line")).toBeInTheDocument()
    expect(screen.getAllByText(/No automatic charges/)[0]).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Rent storage/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Apply to this kitchen first" }))
    expect(onApply).toHaveBeenCalled()
  })

  it("a visitor who can't read availability still gets the apply path", async () => {
    state.signedIn = false
    show(false)
    expect(await screen.findByRole("button", { name: "Apply to this kitchen first" })).toBeInTheDocument()
  })
})

it("shows three compact listings, expands the rest and uses public rows without a second fetch", async () => {
  const list = Array.from({ length: 5 }, (_, i) => ({ ...rows[0], listingId: i + 1, name: `Shelf ${i + 1}`, photos: [] })) as any;
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  render(<QueryClientProvider client={new QueryClient()}><StorageRentCta kitchenId={1} canBook onApply={vi.fn()} listings={list} /></QueryClientProvider>);
  expect(screen.getAllByRole("link", { name: /Rent storage/ })).toHaveLength(3);
  expect(screen.queryByText("Shelf 4")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all storage (5)" }));
  expect(screen.getAllByRole("link", { name: /Rent storage/ })).toHaveLength(5);
  // The tile is decorative now; each row still names its kind in text.
  expect(screen.getAllByText(/Cooler/)).toHaveLength(5);
  expect(fetchMock).not.toHaveBeenCalled();
});
