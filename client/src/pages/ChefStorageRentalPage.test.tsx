import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"

const state = vi.hoisted(() => ({ rental: null as Record<string, unknown> | null }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}) }))
vi.mock("wouter", () => ({ useRoute: () => [true, { id: "3" }], Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock("@/components/storage/StoragePageShell", () => ({ StoragePageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock("@/components/storage/StorageExtendSheet", () => ({ StorageExtendSheet: () => null }))
vi.mock("@/components/booking/StorageCheckinDialog", () => ({ StorageCheckinDialog: () => null }))
vi.mock("@/components/booking/StorageCheckoutDialog", () => ({ StorageCheckoutDialog: () => null }))
vi.mock("@/components/support/CommitmentProblems", () => ({ CommitmentProblems: ({ kind }: { kind: string }) => <div data-testid="problems">{kind}</div> }))
vi.mock("@/components/chef/PendingOverstayPenalties", () => ({ PendingOverstayPenalties: ({ title }: { title?: string }) => <div data-testid="holdover">{title}</div> }))
vi.mock("@/components/booking/DamageClaimCards", () => ({ StorageDamageClaims: ({ storageRentalId }: { storageRentalId: number }) => <div data-testid="storage-claims">{storageRentalId}</div> }))
vi.mock("@/pages/ChefStoragePage", () => ({ STORAGE_LIST_KEY: ["/api/chef/storage-rentals"] }))

import ChefStorageRentalPage from "./ChefStorageRentalPage"

const base = { id: 3, ref: "ST-3", kitchen: { id: 1, name: "Harbour Kitchen" }, listing: { id: 4, name: "Dry shelf" }, unitLabel: "2",
  state: "active", phase: "current", startOn: "2026-10-01", paidThrough: "2026-10-20", graceEndsOn: "2026-10-25", holdoverDays: 0, accruedCents: 0,
  responseDeadline: null, declineReason: null, actions: [] as string[], rentalTerms: { dailyPriceCents: 500, maxTermDays: 30, graceDays: 5 },
  terms: [{ id: 1, seq: 1, kind: "first", startsOn: "2026-10-01", endsOn: "2026-10-20", days: 20, dailyPriceCents: 500, subtotalCents: 10000, taxCents: 1500,
    serviceFeeCents: 300, totalCents: 11800, status: "paid", paidAt: "2026-10-01T12:00:00Z" }] }

beforeAll(async () => {
  if (!i18n.isInitialized) await new Promise<void>(resolve => i18n.on("initialized", () => resolve()))
  await i18n.changeLanguage("en-CA")
})
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => state.rental }))))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const show = (overrides: Record<string, unknown>) => {
  state.rental = { ...base, ...overrides }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <I18nextProvider i18n={i18n}><ChefStorageRentalPage /></I18nextProvider></QueryClientProvider>)
}
const actionButtons = () => screen.getByTestId("rental-actions").querySelectorAll("button")

describe("storage rental page", () => {
  it("offers messaging without adding any lifecycle action the server didn’t list", async () => {
    show({ actions: [] })
    expect(await screen.findByText("Paid through Tue, Oct 20.")).toBeInTheDocument()
    expect([...actionButtons()].map(button => button.textContent)).toEqual(['Message kitchen'])
    expect(screen.queryByTestId("problems")).toBeNull()
  })

  it("renders exactly the listed actions and ignores unknown ones", async () => {
    show({ actions: ["extend", "move_out", "report_problem", "kitchen_reclaim"] })
    await screen.findByText("Dry shelf", { selector: "h1" })
    expect([...actionButtons()].map(button => button.textContent)).toEqual(["Message kitchen", "Extend", "Move out"])
    expect(screen.getByTestId("problems")).toHaveTextContent("storage")
  })

  it("offers only withdraw on a request, and shows the amount and the payment", async () => {
    show({ state: "requested", phase: null, actions: ["withdraw"], responseDeadline: "2099-10-17T15:00:00Z", terms: [{ ...base.terms[0], status: "authorized" }] })
    expect(await screen.findByTestId("rental-status")).toHaveTextContent(/Harbour Kitchen answers by .*\. Your card is on hold for \$118\.00\./)
    expect([...actionButtons()].map(button => button.textContent)).toEqual(["Message kitchen", "Withdraw request"])
    expect(screen.getByText("Card on hold", { exact: false })).toBeInTheDocument()
    expect(screen.getByText("$118.00")).toBeInTheDocument()
  })

  it("labels holdover charges as Holdover", async () => {
    show({ phase: "holdover", holdoverDays: 3, accruedCents: 1500, actions: ["extend"] })
    expect(await screen.findByTestId("rental-status")).toHaveTextContent("3 days past your paid time. Harbour Kitchen may charge up to $15.00.")
    expect(screen.getByTestId("holdover")).toHaveTextContent("Holdover to pay")
  })

  it.each(["grace", "holdover"] as const)("hides the extend-before disclosure during %s", async phase => {
    show({ phase, holdoverDays: phase === "holdover" ? 3 : 0, accruedCents: phase === "holdover" ? 1500 : 0, actions: ["extend"], paidThrough: "2026-10-01" })
    await screen.findByTestId("rental-status")
    expect(screen.queryByText(/To keep your space longer, extend before/)).not.toBeInTheDocument()
  })
})
