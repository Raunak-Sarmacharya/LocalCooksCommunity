import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"

const state = vi.hoisted(() => ({ approved: true, quoteTotal: 3500, calls: [] as Array<[string, Record<string, unknown> | undefined]>, navigate: vi.fn() }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}), apiGet: async () => null }))
vi.mock("@/lib/session-extensions", () => ({ newRequestKey: () => "key-12345678", completeCardAction: vi.fn() }))
vi.mock("wouter", () => ({ useLocation: () => ["/storage/new", state.navigate], useSearch: () => window.location.search.slice(1), Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock("@/components/storage/StoragePageShell", () => ({ StoragePageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock("@/components/booking/CancellationPolicySummary", () => ({ PublishedCancellationPolicySummary: () => <p>Cancellation policy line</p> }))
vi.mock("@/components/booking/CheckoutCancellationDisclosure", () => ({
  CheckoutCancellationDisclosure: () => <p>Free cancellation until 48 hours before</p>,
  CheckoutConsentNotice: ({ buttonLabel }: { buttonLabel: string }) => <p data-testid="consent">By tapping {buttonLabel}, you agree</p>,
}))

import ChefStorageRequestPage from "./ChefStorageRequestPage"

const listing = { listingId: 4, name: "Dry shelf", storageType: "dry", dailyPriceCents: 500, maxTermDays: 30, availability: { state: "now" },
  kitchenName: "Harbour Kitchen", locationId: 9, timezone: "America/St_Johns", unitCount: 3, sizeLabel: "One shelf, 36 in wide",
  accessType: "kitchen_hours", temperatureRange: null, notes: "Label every box.", photos: [] }
const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

beforeAll(async () => {
  if (!i18n.isInitialized) await new Promise<void>(resolve => i18n.on("initialized", () => resolve()))
  await i18n.changeLanguage("en-CA")
})
beforeEach(() => {
  Object.assign(state, { approved: true, quoteTotal: 3500, calls: [] })
  window.history.pushState({}, "", "/storage/new?kitchenId=1&listingId=4")
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    state.calls.push([url, body])
    if (url.endsWith("/storage-availability")) return { ok: true, json: async () => [listing] }
    if (url.endsWith("/quote")) {
      if (!state.approved) return { ok: false, json: async () => ({ code: "approval_required", error: "Apply to this kitchen first." }) }
      return { ok: true, json: async () => ({ ...body, endOn: addDay(body.startOn, body.days - 1), dailyPriceCents: 500, subtotalCents: body.days * 500, taxCents: 0,
        serviceFeeCents: 0, totalCents: state.quoteTotal * body.days / 7, maxTermDays: 30, taxRatePercent: 0, quotedAt: new Date().toISOString(),
        acceptedTermsVersion: "storage-v1", disclosureVersion: "d1", cancellationPolicy: { version: 2, noticeHours: 48, lateChargePercent: 50 } }) }
    }
    if (url === "/api/chef/storage-rentals") return { ok: true, json: async () => ({ checkoutUrl: "https://checkout.stripe.com/c/9" }) }
    throw new Error(`unexpected ${url}`)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <I18nextProvider i18n={i18n}><ChefStorageRequestPage /></I18nextProvider></QueryClientProvider>)

describe("rent storage stepper", () => {
  it("greys out start dates before the first free day and starts on it", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/St_Johns" }).format(new Date())
    listing.availability = { state: "from", from: addDay(today, 3) } as typeof listing.availability
    try {
      show()
      const group = (await screen.findAllByRole("group", { name: "Start date" })).at(-1)!
      await waitFor(() => expect(within(group).getAllByRole("button")[3]).toHaveAttribute("aria-pressed", "true"))
      const days = within(group).getAllByRole("button")
      expect(days.slice(0, 3).every(day => (day as HTMLButtonElement).disabled)).toBe(true)
      expect((days[3] as HTMLButtonElement).disabled).toBe(false)
    } finally { listing.availability = { state: "now" } }
  })
  it("shows the listing plainly, then the disclosure and consent before paying", async () => {
    show()
    expect(await screen.findByText("Dry storage · 3 units · One shelf, 36 in wide · Access during kitchen hours")).toBeInTheDocument()
    expect(screen.getByText("From the kitchen: Label every box.")).toBeInTheDocument()
    expect(await screen.findByText("$5.00 × 7 days")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    const disclosure = await screen.findByTestId("storage-disclosure")
    expect(disclosure).toHaveTextContent("No automatic charges.")
    expect(disclosure).toHaveTextContent("Your card is held until Harbour Kitchen answers (within 24 hours).")
    expect(disclosure).toHaveTextContent("You pay only for the days you choose.")
    expect(disclosure).toHaveTextContent(/extend before .*\. You have 5 extra days to extend at the same price\. After that, Harbour Kitchen may charge \$5\.00\/day\./)
    expect(disclosure).toHaveTextContent("Ending early isn’t refunded.")
    expect(screen.getByText("Free cancellation until 48 hours before")).toBeInTheDocument()
    expect(screen.getByTestId("consent")).toHaveTextContent("By tapping Request and hold $35.00, you agree")
  })

  it("re-quotes silently right before posting, then opens Checkout", async () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, search: "?kitchenId=1&listingId=4", assign })
    show()
    await screen.findByText("$5.00 × 7 days")
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    const quotesBefore = state.calls.filter(([url]) => url.endsWith("/quote")).length
    fireEvent.click(await screen.findByRole("button", { name: "Request and hold $35.00" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/9"))
    const urls = state.calls.map(([url]) => url)
    const post = urls.lastIndexOf("/api/chef/storage-rentals")
    expect(urls[post - 1]).toBe("/api/chef/storage-rentals/quote")
    expect(state.calls.filter(([url]) => url.endsWith("/quote")).length).toBe(quotesBefore + 1)
    expect(state.calls[post][1]).toMatchObject({ listingId: 4, days: 7, expectedTotalCents: 3500, cancellationPolicyVersion: 2, requestKey: "key-12345678" })
  })

  it("stops and shows a changed price instead of charging it", async () => {
    show()
    await screen.findByText("$5.00 × 7 days")
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    const button = await screen.findByRole("button", { name: "Request and hold $35.00" })
    state.quoteTotal = 4200
    fireEvent.click(button)
    expect(await screen.findByRole("alert")).toHaveTextContent("The price is now $42.00. Check it, then tap the button again.")
    expect(state.calls.some(([url]) => url === "/api/chef/storage-rentals")).toBe(false)
  })

  it("a chef who isn't approved sees the listing and rules, and applies first", async () => {
    state.approved = false
    show()
    const panel = await screen.findByTestId("storage-apply-first")
    expect(panel).toHaveTextContent("You can rent storage at Harbour Kitchen once your application is approved.")
    expect(panel).toHaveTextContent("No automatic charges.")
    expect(panel).toHaveTextContent("Cancellation policy line")
    expect(screen.getByText("Harbour Kitchen · $5.00/day")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Apply to this kitchen first" }))
    expect(state.navigate).toHaveBeenCalledWith("/apply-kitchen/9?kitchenId=1")
    expect(screen.queryByRole("button", { name: /Request and hold/ })).toBeNull()
  })

  it("fits a 390 px phone: full-width primary action, 44 px targets, no fixed widths wider than the screen", async () => {
    window.innerWidth = 390
    const { container } = show()
    await screen.findByText("$5.00 × 7 days")
    expect(screen.getByRole("button", { name: "Continue" }).className).toMatch(/\bw-full\b/)
    for (const button of container.querySelectorAll("button")) expect(button.className).toMatch(/\bmin-h-1[12]\b|\bh-11\b/)
    const wide = [...container.querySelectorAll<HTMLElement>("[class]")].flatMap(el => [...(el.getAttribute("class") ?? "").matchAll(/\b(?:min-)?w-\[(\d+)px\]/g)].map(m => Number(m[1])))
    expect(wide.filter(px => px > 390)).toEqual([])
  })

  it("with only a kitchen, lists its open storage to pick from instead of a dead end", async () => {
    window.history.pushState({}, "", "/storage/new?kitchenId=1")
    show()
    const pick = await screen.findByTestId("storage-pick")
    expect(within(pick).getByRole("heading", { name: "Rent storage" })).toBeInTheDocument()
    expect(within(pick).getByText("Choose the storage you want at Harbour Kitchen.")).toBeInTheDocument()
    expect(within(pick).getByText("Dry shelf")).toBeInTheDocument()
    expect(within(pick).getByRole("link")).toHaveAttribute("href", "/storage/new?kitchenId=1&listingId=4")
    expect(screen.queryByText("This storage isn’t available right now.")).not.toBeInTheDocument()
  })
})
