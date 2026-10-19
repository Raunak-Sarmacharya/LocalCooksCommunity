vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import en from "@shared/i18n/locales/en-CA/chef.json";
import bookingEn from "@shared/i18n/locales/en-CA/booking.json";
import { KitchenCheckinTracker } from "@/components/booking/KitchenCheckinTracker";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "local-test-token" } } }));
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer fixture", "Content-Type": "application/json" }), apiGet: vi.fn() }));
vi.mock("@/i18n/booking-ns", () => ({ bt: (key: string) => key }));
vi.mock("@/components/ui/smart-image", () => ({ SmartImage: (props: any) => <img {...props} /> }));
vi.mock("@/components/chat/UnifiedChatView", () => ({ default: (props: any) => <div data-testid="chat">{props.initialDraft}</div> }));
vi.mock("@/hooks/useSessionFileUpload", () => ({ useSessionFileUpload: () => ({ uploadFile: vi.fn(), isUploading: false, uploadProgress: 0 }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: (namespace: string) => ({
  i18n: { language: "en-CA", resolvedLanguage: "en-CA" },
  t: (key: string, options?: any) => {
    let value = ((namespace === 'booking' ? bookingEn : en) as Record<string, string>)[key] || (typeof options === "string" ? options : options?.defaultValue) || key;
    if (key === "kciVcAttemptsLeft" || key === "kciCompleteRequiredTasks" || key === "kciAcReleaseAt") return new IntlMessageFormat(value, "en-CA").format(options);
    for (const [name, replacement] of Object.entries(options || {})) value = value.replaceAll(`{{${name}}}`, String(replacement)).replaceAll(`{${name}}`, String(replacement));
    return value;
  },
}) }));

const section = { enabled: true, instructions: "Use the side entrance.", items: [], photos: [] };
const staffed = { targetKey: "booking:901", visitId: null, mode: "staffed", codeRequired: true, locked: false, attemptsLeft: 5,
  consumed: false, consumedMethod: null, consumedAt: null, revoked: false };
function visit(overrides: Record<string, any> = {}) {
  return {
    id: 901, chefId: 7, kitchenId: 990, locationId: 990, status: "confirmed", checkinEnabled: true, checkoutEnabled: true,
    checkinStatus: "not_checked_in", checkedInAt: null,
    bookingDate: new Date().toISOString().split("T")[0], startTime: "00:00", endTime: "23:59", timezone: "UTC",
    currentVisitDuties: { version: 2, arrival: section, departure: section },
    visitDuties: { version: 1, arrival: section, departure: section },
    visitCode: staffed,
    ...overrides,
  };
}

let status: ReturnType<typeof visit>;
let failure: { status: number; body: Record<string, unknown> } | null;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

function setup(initialVisitId: number | null = null) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><KitchenCheckinTracker bookingId={901} kitchenName="Test kitchen" initialVisitId={initialVisitId} onSuccess={vi.fn()} /></QueryClientProvider>);
}
const checkinPosts = () => fetchMock.mock.calls.filter(([url, options]) => options?.method === "POST" && String(url).endsWith("/checkin"));
const bodyOf = (index: number) => JSON.parse(checkinPosts()[index][1].body as string);
const field = () => screen.getByLabelText("Check-in code") as HTMLInputElement;
const confirm = () => screen.getByRole("button", { name: /^(Check in|I’m at the kitchen. Check in)$/ }) as HTMLButtonElement;

describe("chef arrival check-in code", () => {
  it('shows a failed kitchen offer in session and still allows check-out', async () => {
    const now = Date.now(), endAt = new Date(now + 5 * 60_000).toISOString();
    status = visit({ checkinStatus: 'checked_in', checkedInAt: new Date(now - 60_000).toISOString(),
      visitCloseout: { phase: 'in_session', scheduledStartAt: new Date(now - 60_000).toISOString(), scheduledEndAt: endAt,
        inspection: { outcome: 'not_due' } } });
    const extension = { id: 55, kind: 'offer', status: 'offered', amountCents: 1501, minutes: 30, endAt, expiresAt: endAt,
      cardFailedAt: new Date(now).toISOString(), confirmed: false, paid: false, processing: false };
    const extensions = { options: [], history: [extension], enabled: true, hasSavedCard: true, inSession: true,
      timezone: 'UTC', kitchenName: 'Test kitchen', currency: 'CAD', serverNow: new Date(now).toISOString() };
    fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).endsWith('/extensions')) return new Response(JSON.stringify(extensions));
      if (String(url).endsWith('/checkout') && options?.method === 'POST') return new Response(JSON.stringify({ success: true }));
      return new Response(JSON.stringify(status));
    });
    vi.stubGlobal('fetch', fetchMock); setup();
    expect(await screen.findByTestId('extension-offer')).toHaveTextContent('Your saved card was declined. Nothing was charged.');
    expect(screen.getByRole('button', { name: 'Pay with another card · $15.01' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Need more time?' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Check out now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check out' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith('/checkout') && options?.method === 'POST')).toBe(true));
  });
  beforeEach(() => {
    status = visit(); failure = null;
    fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        if (failure) return new Response(JSON.stringify(failure.body), { status: failure.status });
        status = { ...status, checkinStatus: "checked_in" };
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response(JSON.stringify(status));
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); });

  it("offers an access report at check-in opening and sends it through the shared report form", async () => {
    status = visit({ startTime: '23:59', checkinWindowMinutesBefore: 1440 });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Report a problem' }));
    expect(screen.getByRole('radio', { name: 'Access (cannot get in or out)' })).toBeChecked();
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'The kitchen is locked and nobody is here.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) => String(url).includes('/commitment-problems/booking/901') && JSON.parse(String(options?.body)).category === 'access')).toBe(true));
  });
  it("does not offer problem reporting before check-in opens", async () => {
    status = visit({ bookingDate: '2099-10-04', startTime: '09:00', checkinWindowMinutesBefore: 15 });
    setup();
    await screen.findByTestId('visit-next-step');
    expect(screen.queryByRole('button', { name: 'Report a problem' })).not.toBeInTheDocument();
  });
  it("shows one numeric one-time-code field with the kitchen hint for a staffed visit", async () => {
    setup();
    const input = await screen.findByLabelText("Check-in code") as HTMLInputElement;
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("maxlength", "6");
    expect(screen.getByText("Ask kitchen staff for today’s code")).toBeInTheDocument();
    fireEvent.paste(input, { clipboardData: { getData: () => "12a34-5678" } });
    expect(input.value).toBe("123456");
    expect(screen.queryByText(/attempts? left/)).not.toBeInTheDocument();
  });

  it("requires six digits before arrival can be submitted", async () => {
    setup();
    await screen.findByLabelText("Check-in code");
    expect(confirm()).toBeDisabled();
    fireEvent.change(field(), { target: { value: "12345" } });
    expect(confirm()).toBeDisabled();
    fireEvent.change(field(), { target: { value: "123456" } });
    expect(confirm()).toBeEnabled();
  });

  it("hides the field in self mode and tells the chef the kitchen enabled self check-in", async () => {
    status = visit({ visitCode: { ...staffed, mode: "self", codeRequired: false } });
    setup();
    await screen.findByRole("button", { name: "I’m at the kitchen. Check in" });
    expect(screen.queryByLabelText("Check-in code")).not.toBeInTheDocument();
    expect(screen.getByTestId("visit-code-self")).toHaveTextContent(/kitchen turned on self check-in/);
    fireEvent.click(confirm());
    await waitFor(() => expect(checkinPosts()).toHaveLength(1));
    expect(bodyOf(0).visitCode).toBeUndefined();
  });

  it("keeps legacy bookings unchanged when there is no projection", async () => {
    status = visit({ visitCode: null });
    setup();
    await screen.findByRole("button", { name: "Check in" });
    expect(screen.queryByLabelText("Check-in code")).not.toBeInTheDocument();
    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());
    await waitFor(() => expect(checkinPosts()).toHaveLength(1));
    expect(bodyOf(0)).not.toHaveProperty("visitCode");
  });

  it("submits the code with the arrival evidence in one request and a requestKey", async () => {
    setup();
    await screen.findByLabelText("Check-in code");
    fireEvent.change(screen.getByLabelText(/Your message to the kitchen manager/), { target: { value: "Arrived at the side door" } });
    fireEvent.change(field(), { target: { value: "123456" } });
    fireEvent.click(confirm());
    await waitFor(() => expect(checkinPosts()).toHaveLength(1));
    const body = bodyOf(0);
    expect(body).toMatchObject({ visitCode: "123456", checkinNotes: "Arrived at the side door" });
    expect(typeof body.requestKey).toBe("string");
    expect(body.requestKey.length).toBeGreaterThan(8);
  });

  it("keeps the field and the evidence after a wrong code and shows the attempts left", async () => {
    failure = { status: 400, body: { error: "That check-in code is not correct. 3 attempts left.", code: "VISIT_CODE_WRONG", attemptsLeft: 3 } };
    setup();
    await screen.findByLabelText("Check-in code");
    fireEvent.change(screen.getByLabelText(/Your message to the kitchen manager/), { target: { value: "Side door notes" } });
    fireEvent.change(field(), { target: { value: "000000" } });
    fireEvent.click(confirm());
    expect(await screen.findByText("3 attempts left")).toBeInTheDocument();
    expect(screen.getByText(/That check-in code is not correct/)).toBeInTheDocument();
    expect(field().value).toBe("000000");
    expect((screen.getByLabelText(/Your message to the kitchen manager/) as HTMLTextAreaElement).value).toBe("Side door notes");
    // The code problem lives beside the field in a polite live region, not in the generic retry banner.
    expect(screen.getByText("3 attempts left").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText("Retry visit details")).not.toBeInTheDocument();
  });

  it("reuses one requestKey on retry of the same code and changes it when the code changes", async () => {
    failure = { status: 400, body: { error: "x", code: "VISIT_CODE_WRONG", attemptsLeft: 4 } };
    setup();
    await screen.findByLabelText("Check-in code");
    fireEvent.change(field(), { target: { value: "111111" } });
    fireEvent.click(confirm());
    await waitFor(() => expect(checkinPosts()).toHaveLength(1));
    await screen.findByText("4 attempts left");
    fireEvent.click(confirm());
    await waitFor(() => expect(checkinPosts()).toHaveLength(2));
    expect(bodyOf(1).requestKey).toBe(bodyOf(0).requestKey);
    fireEvent.change(field(), { target: { value: "222222" } });
    fireEvent.click(confirm());
    await waitFor(() => expect(checkinPosts()).toHaveLength(3));
    expect(bodyOf(2).requestKey).not.toBe(bodyOf(0).requestKey);
    expect(bodyOf(2).visitCode).toBe("222222");
  });

  it("shows the locked state with a message-kitchen action and no way to submit", async () => {
    status = visit({ visitCode: { ...staffed, locked: true, attemptsLeft: 0 } });
    setup();
    expect(await screen.findByText("Ask the kitchen for a new check-in code")).toBeInTheDocument();
    expect(screen.queryByLabelText("Check-in code")).not.toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => String(url).endsWith("/conversation")
      ? new Response(JSON.stringify({ conversationId: "conv-1" })) : new Response(JSON.stringify(status)));
    fireEvent.click(screen.getByRole("button", { name: "Message kitchen" }));
    expect(await screen.findByTestId("chat")).toHaveTextContent("I need a new check-in code");
  });

  it("locks the form when the last wrong attempt is used", async () => {
    failure = { status: 400, body: { error: "x", code: "VISIT_CODE_WRONG", attemptsLeft: 0 } };
    setup();
    await screen.findByLabelText("Check-in code");
    fireEvent.change(field(), { target: { value: "999999" } });
    fireEvent.click(confirm());
    expect(await screen.findByText("Ask the kitchen for a new check-in code")).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
  });
});

describe("arrival communication on the visit page", () => {
  const required = { id: "t1", label: "Wipe the benches", required: true }
  const photo = { id: "p1", label: "Photo of the sink", required: true }
  const gated = { arrival: { ...section, instructions: null, items: [required], photos: [photo] }, departure: { ...section, instructions: null } }
  const start = new Date(`${new Date().toISOString().split("T")[0]}T00:00:00Z`)
  const releaseAt = new Date(start.getTime() - 48 * 3_600_000).toISOString()
  beforeEach(() => {
    status = visit(); failure = null
    fetchMock = vi.fn(async () => new Response(JSON.stringify(status)))
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals() })

  it("shows the overview with required tasks and the release time, and no instruction headings, before release", async () => {
    status = visit({ instructionsReleased: false, instructionsReleaseAt: releaseAt, currentVisitDuties: { version: 2, ...gated } })
    setup()
    const overview = await screen.findByTestId("instructions-overview")
    expect(overview).toHaveTextContent(/for your 6-digit check-in code/)
    expect(overview).toHaveTextContent("Wipe the benches")
    expect(overview).toHaveTextContent("Photo of the sink")
    expect(overview).toHaveTextContent(/will appear here on .* \(48 hours before your visit\)\. We'll email them to you too\./)
    expect(screen.queryByText("Arrival instructions")).not.toBeInTheDocument()
    expect(screen.queryByText("Departure instructions")).not.toBeInTheDocument()
    expect(screen.queryByText(/No arrival instructions provided/)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\d{3} \d{3}/)
  })

  it("shows the instructions with the mode line above them after release, and treats a missing flag as released", async () => {
    status = visit({ instructionsReleased: true, instructionsReleaseAt: releaseAt })
    setup()
    expect(await screen.findAllByText("Use the side entrance.")).not.toHaveLength(0)
    expect(screen.queryByTestId("instructions-overview")).not.toBeInTheDocument()
    expect(screen.getByTestId("arrival-mode-line")).toHaveTextContent(/ask kitchen staff/)
    cleanup(); client.clear()
    status = visit({ visitCode: { ...staffed, mode: "self", codeRequired: false } })
    setup()
    await screen.findAllByText("Use the side entrance.")
    expect(screen.getByTestId("arrival-mode-line")).toHaveTextContent(/Self check-in is on/)
    cleanup(); client.clear()
    status = visit({ visitCode: null })
    setup()
    await screen.findAllByText("Use the side entrance.")
    expect(screen.getByTestId("arrival-mode-line")).toHaveTextContent(/Follow the arrival instructions and confirm arrival/)
  })

  it("gates each split visit on its own release", async () => {
    const row = (id: number, blockIndex: number, released: boolean) => ({
      id, blockIndex, startTime: "00:00", endTime: "23:59", checkinStatus: "not_checked_in", checkedInAt: null, checkoutRequestedAt: null,
      checkedOutAt: null, checkoutApprovedAt: null, noShowDetectedAt: null, checkinChecklistItems: null, checkoutChecklistItems: null,
      visitCode: { ...staffed, targetKey: `visit:${id}`, visitId: id }, instructionsReleased: released, instructionsReleaseAt: releaseAt,
      currentVisitDuties: { version: 2, ...(released ? { arrival: section, departure: section } : gated) },
    })
    status = visit({ visits: [row(1, 0, true), row(2, 1, false)], visitCode: undefined, currentVisitDuties: undefined })
    setup(2)
    expect(await screen.findByTestId("instructions-overview")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Visit 1/ }))
    expect((await screen.findAllByText("Use the side entrance.")).length).toBeGreaterThan(0)
    expect(screen.queryByTestId("instructions-overview")).not.toBeInTheDocument()
  })

  it("clears the stale locked state when the kitchen reissues the code, keeping tasks and notes", async () => {
    status = visit({ visitCode: { ...staffed, locked: true, attemptsLeft: 0 } })
    setup()
    await screen.findByText("Ask the kitchen for a new check-in code")
    fireEvent.change(screen.getByLabelText(/Your message to the kitchen manager/), { target: { value: "Waiting at the side door" } })
    status = visit({ visitCode: { ...staffed, locked: false, attemptsLeft: 5 } })
    document.dispatchEvent(new Event("visibilitychange"))
    const input = await screen.findByLabelText("Check-in code") as HTMLInputElement
    expect(input.value).toBe("")
    expect(screen.queryByText("Ask the kitchen for a new check-in code")).not.toBeInTheDocument()
    expect(screen.getByText("Arrival details changed. Review the current instructions.")).toBeInTheDocument()
    expect((screen.getByLabelText(/Your message to the kitchen manager/) as HTMLTextAreaElement).value).toBe("Waiting at the side door")
  })

  it("explains a network failure without losing the entered code", async () => {
    setup()
    await screen.findByLabelText("Check-in code")
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") throw new TypeError("Failed to fetch")
      return new Response(JSON.stringify(status))
    })
    fireEvent.change(field(), { target: { value: "123456" } })
    fireEvent.click(confirm())
    expect(await screen.findByText(/Arrival hasn't been confirmed yet/)).toBeInTheDocument()
    expect(field().value).toBe("123456")
  })
})
