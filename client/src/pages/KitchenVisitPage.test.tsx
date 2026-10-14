import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@shared/i18n/locales/en-CA/chef.json";
import { IntlMessageFormat } from 'intl-messageformat';
import { KitchenCheckinTracker } from "@/components/booking/KitchenCheckinTracker";
import KitchenVisitPage from "./KitchenVisitPage";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), uploads: [] as any[] }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "local-test-token" } } }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ loading: false }) }));
vi.mock("@/lib/api", () => ({ apiGet: mocks.apiGet }));
vi.mock("@/i18n/booking-ns", () => ({ bt: (key: string) => key }));
vi.mock("@/layouts/ChefDashboardLayout", () => ({ default: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/layouts/chef-shell-context", () => ({ useChefShellChrome: () => false }));
vi.mock("@/components/ui/smart-image", () => ({ SmartImage: (props: any) => <img {...props} /> }));
vi.mock("@/hooks/useSessionFileUpload", () => ({ useSessionFileUpload: (options: any) => {
  mocks.uploads.push(options);
  return { uploadFile: vi.fn(), isUploading: false, uploadProgress: 0 };
} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  i18n: { language: "en-CA", resolvedLanguage: "en-CA" },
  t: (key: string, options?: any) => {
    const pluralKey = options?.count != null ? `${key}_${options.count === 1 ? 'one' : 'other'}` : key;
    let value = (en as Record<string, string>)[pluralKey] || (en as Record<string, string>)[key] || (typeof options === "string" ? options : options?.defaultValue) || key;
    if (key === 'kciCompleteRequiredTasks') return new IntlMessageFormat(value, 'en-CA').format(options);
    for (const [name, replacement] of Object.entries(options || {})) value = value.replaceAll(`{{${name}}}`, String(replacement)).replaceAll(`{${name}}`, String(replacement));
    return value;
  },
}) }));

const section = { enabled: true, instructions: "Use the side entrance.", items: [], photos: [] };
function visit(overrides: Record<string, any> = {}) {
  return {
    id: 901, kitchenId: 990, locationId: 990, status: "confirmed", checkinEnabled: true, checkoutEnabled: true,
    checkinStatus: "not_checked_in", checkedInAt: null,
    bookingDate: new Date().toISOString().split("T")[0], startTime: "00:00", endTime: "23:59", timezone: "UTC",
    currentVisitDuties: { version: 2, arrival: section, departure: { ...section, instructions: "Lock the side entrance." } },
    visitDuties: { version: 1, arrival: section, departure: { ...section, instructions: "Lock the side entrance." } },
    ...overrides,
  };
}
let status: ReturnType<typeof visit>;
let failure = "";
let failureFields: Record<string, string> = {};
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;
let clients: QueryClient[];

function setup(page = false, path = "/booking/901/visit") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  clients.push(client);
  const navigation = memoryLocation({ path, record: true });
  const onSuccess = vi.fn();
  const result = render(<QueryClientProvider client={client}><Router hook={navigation.hook}>
    {page ? <Switch><Route path="/booking/:id/visit" component={KitchenVisitPage} /><Route path="/booking/:id"><h1>Returned to booking</h1></Route></Switch> : <KitchenCheckinTracker bookingId={901} kitchenName="Test kitchen" onSuccess={onSuccess} />}
  </Router></QueryClientProvider>);
  return { ...result, onSuccess, navigation };
}
const posts = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");

describe("full-page kitchen visit", () => {
  beforeEach(() => {
    clients = []; status = visit(); failure = ""; failureFields = {}; mocks.uploads = [];
    mocks.apiGet.mockReset();
    mocks.apiGet.mockResolvedValue({ kitchen: { name: "Test kitchen" }, bookingDate: status.bookingDate, startTime: status.startTime, endTime: status.endTime });
    fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        if (failure) return new Response(JSON.stringify({ error: failure, fieldErrors: failureFields }), { status: 400 });
        status = { ...status, checkinStatus: _url.endsWith("/checkin") ? "checked_in" : "checkout_requested" };
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response(JSON.stringify(status));
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { cleanup(); clients.forEach(value => value.clear()); vi.unstubAllGlobals(); });

  it("hides preparation on a completed direct visit route while keeping its recorded outcome", async () => {
    status = visit({ status: "completed", checkinStatus: "checked_out", checkedInAt: "2026-10-12T14:05:00Z", checkoutRequestedAt: "2026-10-12T17:10:00Z",
      checkoutApprovedAt: "2026-10-12T17:40:00Z", checkinChecklistItems: [{ id: "floor", label: "Check the floor", checked: true }] });
    setup(true);
    await screen.findByRole("region", { name: "Visit status" });
    expect(screen.getByRole("heading", { level: 1, name: "Kitchen visit" })).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryData(["kitchen-checkin-status", 901])).toBeDefined());
    const summary = screen.getByRole("region", { name: "Visit status" });
    expect(within(summary).getByText("Checked out")).toBeInTheDocument();
    expect(within(summary).getByText(/Your visit is complete/)).toBeInTheDocument();
    expect(within(summary).queryByText(/manager.*review.*finished/i)).not.toBeInTheDocument();
    for (const label of ["Check-in time", "Checkout time", "Checkout closed"]) {
      expect(within(summary).getByText(label).parentElement).toHaveTextContent(/Oct 12, 2026/);
    }
    expect(screen.getByText("Your Check-In Checklist")).toBeInTheDocument();
    expect(screen.getByText("Check the floor")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Visit instructions" })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Instructions saved with your booking' })).getByText('Use the side entrance.')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit checkout" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to booking" })).toBeInTheDocument();
  });

  it("shows a neutral visit title after cancellation even when arrival was recorded", async () => {
    status = visit({ status: "cancelled", checkinStatus: "checked_in", checkedInAt: "2026-10-12T16:00:00Z" });
    setup(true);
    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen visit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit checkout" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Visit instructions" })).not.toBeInTheDocument();
  });

  it("presents full-page context and separates instructions from optional actions", async () => {
    setup(true);
    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen arrival" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to booking" })).toHaveAttribute("href", "/booking/901");
    expect(screen.getByText("Test kitchen")).toBeInTheDocument();
    expect(screen.getAllByText(/GMT/).length).toBeGreaterThan(0);
    const instructions = screen.getByRole("region", { name: "Visit instructions" });
    expect(within(instructions).getByText("Use the side entrance.")).toBeInTheDocument();
    // Departure details wait until the chef has checked in.
    expect(within(instructions).queryByText("Lock the side entrance.")).not.toBeInTheDocument();
    expect(within(instructions).getByTestId("departure-after-checkin")).toHaveTextContent("Departure instructions appear here after you check in.");
    expect(within(instructions).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Optional", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Condition photos")).not.toHaveTextContent("*");
  });

  it.each(["arrival", "departure"])("submits a zero-task %s without photos", async (phase) => {
    if (phase === "departure") status = visit({ checkinStatus: "checked_in", checkedInAt: new Date().toISOString() });
    const { onSuccess } = setup();
    const button = await screen.findByRole("button", { name: phase === "arrival" ? "Confirm check-in" : "Submit checkout" });
    expect(button).toBeEnabled(); fireEvent.click(button);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const payload = JSON.parse(posts()[0][1].body);
    expect(payload[phase === "arrival" ? "checkinPhotoUrls" : "checkoutPhotoUrls"]).toEqual([]);
    expect(payload[phase === "arrival" ? "checkinChecklistItems" : "checkoutChecklistItems"]).toBeUndefined();
  });

  it('shows current instructions and tasks, with an update note, while retaining original evidence', async () => {
    status = visit({ checkinStatus: 'checked_in', checkedInAt: new Date().toISOString(),
      checkinChecklistItems: [{ id: 'original', label: 'Original submitted task', checked: true }] });
    status.currentVisitDuties.departure = { ...section, instructions: 'Use the new exit.',
      items: [{ id: 'new', label: 'Check the new exit', required: true }], photos: [] } as any;
    setup();
    const instructions = await screen.findByRole('region', { name: 'Visit instructions' });
    expect(within(instructions).getByText('Use the new exit.')).toBeInTheDocument();
    expect(screen.getByText('Complete 1 required task to continue')).toBeVisible();
    expect(within(instructions).queryByText('Lock the side entrance.')).not.toBeInTheDocument();
    expect(screen.getByText('Updated by the kitchen since you booked')).toBeInTheDocument();
    expect(screen.getByText('Original submitted task')).toBeInTheDocument();
    // The recorded text equals the arrival instructions still shown above, so it is not repeated.
    expect(screen.queryByRole('region', { name: 'Instructions saved with your booking' })).not.toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Submit checkout' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Check the new exit/ }));
    expect(submit).toBeEnabled();
  });

  it('allows arrival despite obsolete disabled flags and does not render a removed snapshot task', async () => {
    status.checkinEnabled = false; status.checkoutEnabled = false;
    status.visitDuties.arrival = { ...section, enabled: false, items: [{ id: 'old', label: 'Removed task', required: true }] } as any;
    setup();
    expect(await screen.findByRole('button', { name: 'Confirm check-in' })).toBeEnabled();
    expect(screen.queryByRole('checkbox', { name: /Removed task/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/doesn.t ask you to check in/)).not.toBeInTheDocument();
  });

  it('keeps matching current requirements free of an update note', async () => {
    setup();
    await screen.findByRole('button', { name: 'Confirm check-in' });
    expect(screen.queryByText('Updated by the kitchen since you booked')).not.toBeInTheDocument();
  });

  it('shows authoritative item and photo field errors and preserves the draft when tasks change at submit', async () => {
    setup();
    const submit = await screen.findByRole('button', { name: 'Confirm check-in' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sam’s draft' } });
    failure = 'Current requirements changed';
    failureFields = { items: 'Complete required checklist items: New safety task', photos: 'Upload the required condition photo' };
    fireEvent.click(submit);
    expect(await screen.findByText(failureFields.items)).toBeInTheDocument();
    expect(screen.getByText(failureFields.photos)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Sam’s draft');
    expect(posts()).toHaveLength(1);
  });

  it("blocks only saved configured required tasks and evidence", async () => {
    const required = { id: "floor", label: "Check the floor", required: true, category: "safety" };
    const optional = { id: "note", label: "Check supplies", required: false, category: "general" };
    status.currentVisitDuties.arrival = { ...section, items: [required, optional], photos: [{ id: "floor", label: "Floor photo", required: true }] } as any;
    setup();
    const submit = await screen.findByRole("button", { name: "Confirm check-in" });
    expect(submit).toBeDisabled(); fireEvent.click(submit); expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox", { name: /Check the floor/ }));
    expect(submit).toBeDisabled();
    act(() => mocks.uploads.at(-1).onSuccess({ url: "https://test.invalid/floor.jpg" }));
    await waitFor(() => expect(submit).toBeEnabled()); fireEvent.click(submit);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toMatchObject({ checkinPhotoUrls: ["https://test.invalid/floor.jpg"], checkinChecklistItems: [
      { id: "floor", label: "Check the floor", checked: true }, { id: "note", label: "Check supplies", checked: false },
    ] });
    expect(mocks.apiGet).not.toHaveBeenCalled();
  });

  it.each(["arrival", "departure"])("shows API 400 and retains the %s draft through refresh and retry", async (phase) => {
    if (phase === "departure") status = visit({ checkinStatus: "checked_in", checkedInAt: new Date().toISOString() });
    const duty = phase === "arrival" ? "arrival" : "departure";
    status.currentVisitDuties[duty] = { ...section, items: [{ id: "reset", label: "Reset station", required: true, category: "general" }], photos: [] } as any;
    failure = "Please contact the kitchen manager before submitting";
    const { onSuccess } = setup();
    const submit = await screen.findByRole("button", { name: phase === "arrival" ? "Confirm check-in" : "Submit checkout" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Draft message" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Reset station/ }));
    act(() => mocks.uploads.at(-1).onSuccess({ url: "https://test.invalid/retained.jpg" }));
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent(failure);
    expect(onSuccess).not.toHaveBeenCalled();
    await act(async () => { await client.invalidateQueries({ queryKey: ["kitchen-checkin-status", 901] }); });
    expect(screen.getByRole("textbox")).toHaveValue("Draft message");
    expect(screen.getByRole("checkbox", { name: /Reset station/ })).toBeChecked();
    expect(screen.getByRole("img")).toBeInTheDocument();
    failure = ""; fireEvent.click(submit);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(JSON.parse(posts()[1][1].body)[phase === "arrival" ? "checkinPhotoUrls" : "checkoutPhotoUrls"]).toEqual(["https://test.invalid/retained.jpg"]);
  });

  it("keeps a stale-action error and refresh exit when revalidation makes the form unavailable", async () => {
    setup();
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Retained arrival note" } });
    failure = "Cannot check in — booking is pending";
    fireEvent.click(screen.getByRole("button", { name: "Confirm check-in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(failure);
    status = { ...status, status: "pending" };
    await act(async () => { await client.invalidateQueries({ queryKey: ["kitchen-checkin-status", 901] }); });
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(failure);
    status = { ...status, status: "confirmed" };
    fireEvent.click(screen.getByRole("button", { name: "Retry visit details" }));
    expect(await screen.findByRole("textbox")).toHaveValue("Retained arrival note");
  });

  it("refreshes status, details, list and attendance before returning to the booking", async () => {
    status = visit({ checkinStatus: "checked_in", checkedInAt: new Date().toISOString() });
    const { navigation } = setup(true);
    await screen.findByRole("button", { name: "Submit checkout" });
    client.setQueryData(["/api/chef/bookings"], []);
    client.setQueryData(["/api/chef/bookings/901/attendance"], {});
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "Submit checkout" }));
    await waitFor(() => expect(navigation.history).toEqual(["/booking/901"]));
    for (const key of [["kitchen-checkin-status", 901], ["/api/chef/bookings"], ["/api/chef/bookings/901/details"], ["/api/chef/bookings/901/attendance"]]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
    expect(client.getQueryData<any>(["kitchen-checkin-status", 901]).checkinStatus).toBe("checkout_requested");
    expect(client.getQueryState(["/api/chef/bookings"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["/api/chef/bookings/901/attendance"])?.isInvalidated).toBe(true);
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Returned to booking" })).toBeInTheDocument();
  });

  it("stays on the visit page after arrival and says when it was confirmed", async () => {
    const { navigation } = setup(true);
    await screen.findByRole("button", { name: "Confirm check-in" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm check-in" }));
    expect(await screen.findByText(/Arrival confirmed at/)).toBeInTheDocument();
    expect(navigation.history).toEqual(["/booking/901/visit"]);
    expect(screen.queryByRole("heading", { name: "Returned to booking" })).not.toBeInTheDocument();
  });

  it("waits for active booking details to refresh before navigating", async () => {
    status = visit({ checkinStatus: "checked_in", checkedInAt: new Date().toISOString() });
    const { navigation } = setup(true);
    await screen.findByRole("button", { name: "Submit checkout" });
    let finishRefresh!: (value: any) => void;
    mocks.apiGet.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Submit checkout" }));
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(2));
    expect(navigation.history).toEqual(["/booking/901/visit"]);
    await act(async () => finishRefresh({ kitchen: { name: "Test kitchen" }, bookingDate: status.bookingDate, startTime: status.startTime, endTime: status.endTime }));
    await waitFor(() => expect(navigation.history).toEqual(["/booking/901"]));
  });

  it("keeps the form mounted when booking context revalidation fails", async () => {
    setup(true);
    await screen.findByRole("button", { name: "Confirm check-in" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep this draft" } });
    mocks.apiGet.mockRejectedValueOnce(new Error("Booking context temporarily unavailable"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["/api/chef/bookings/901/details"] }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Booking context temporarily unavailable");
    expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
    fireEvent.click(screen.getByRole("button", { name: "Retry visit details" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
  });

  it("does not bypass requirements while legacy settings fail to load", async () => {
    delete status.visitDuties;
    delete status.currentVisitDuties;
    mocks.apiGet.mockRejectedValue(new Error("Settings unavailable"));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your visit requirements");
    expect(screen.queryByRole("button", { name: "Confirm check-in" })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    mocks.apiGet.mockResolvedValue({ checkinItems: [], checkoutItems: [], checkinPhotoRequirements: [], checkoutPhotoRequirements: [] });
    fireEvent.click(screen.getByRole("button", { name: "Retry requirements" }));
    expect(await screen.findByRole("button", { name: "Confirm check-in" })).toBeEnabled();
  });

  it("shows an overnight visit on the correct kitchen-local calendar dates", async () => {
    status = visit({ bookingDate: "2026-10-12", startTime: "22:00", endTime: "02:00", operatingWindowStartTime: "22:00", timezone: "America/Toronto", checkinStatus: "checked_out" });
    setup();
    await screen.findByRole("region", { name: "Visit status" });
    expect(screen.getByRole("heading", { level: 1, name: "Kitchen visit" })).toBeInTheDocument();
    expect(screen.getByText(/Mon, Oct 12 · 10:00\s*p\.m\.\s*[–-]\s*Tue, Oct 13 · 2:00\s*a\.m\./)).toBeInTheDocument();
    expect(screen.getByText(/kitchen’s local time \(Eastern Time\)/)).toBeInTheDocument();
  });

  it("targets the selected visit and displays its localized schedule", async () => {
    status.visits = [
      { id: 910, blockIndex: 0, startTime: "00:00", endTime: "12:00", checkinStatus: "checked_in" },
      { id: 911, blockIndex: 1, startTime: "12:00", endTime: "23:59", checkinStatus: "checked_in" },
    ];
    setup();
    const second = await screen.findByRole("button", { name: /Visit 2:/ });
    expect(second).toHaveTextContent(/Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep/);
    fireEvent.click(second);
    fireEvent.click(screen.getByRole("button", { name: "Submit checkout" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body).visitId).toBe(911);
  });

  it("shows status, kitchen-local time and next step without opening any disclosure", async () => {
    const { container } = setup();
    const summary = await screen.findByRole("region", { name: "Visit status" });
    expect(container.querySelector("details")).toBeNull();
    // One status line: the next-step sentence, not a "Not checked in" chip repeating it.
    expect(within(summary).queryByText("Not checked in")).not.toBeInTheDocument();
    expect(within(summary).getByText(/Check-in is open/)).toBeInTheDocument();
    expect(screen.queryByText("Arrival not recorded")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Message kitchen" })).toBeInTheDocument();
    expect(screen.getByText(/^\w{3}, \w{3} \d{1,2} · 12:00\s*a\.m\.\s*[–-]\s*11:59\s*p\.m\.$/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Check in" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm check-in" })).toBeVisible();
  });

  it("shows when check-in opens before the window without inventing absence", async () => {
    status = visit({ bookingDate: "2099-01-15", startTime: "09:00", endTime: "12:00", timezone: "America/St_Johns", checkinWindowMinutesBefore: 15 });
    setup();
    const summary = await screen.findByRole("region", { name: "Visit status" });
    expect(within(summary).getByText(/isn’t open yet/)).toBeInTheDocument();
    expect(within(summary).getByText("Check-in opens").parentElement).toHaveTextContent(/Jan 15, 2099.*8:45/);
    expect(screen.queryByRole("button", { name: "Confirm check-in" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Visit instructions" })).toBeInTheDocument();
    expect(screen.queryByText(/no-show/i)).not.toBeInTheDocument();
  });

  it("in session offers Message kitchen once and does not repeat the arrival instructions as a saved record", async () => {
    const now = Date.now();
    status = visit({ checkinStatus: "checked_in", checkedInAt: new Date(now - 600_000).toISOString(), chefId: 3,
      visitCloseout: { key: "b", phase: "in_booked_time", arrivalRecorded: true, scheduledStartAt: new Date(now - 3_600_000).toISOString(),
        scheduledEndAt: new Date(now + 3_600_000).toISOString(), inspection: { outcome: "not_due", deadline: new Date(now + 86_400_000).toISOString(), canRespond: false } } });
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Your visit" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Message kitchen" })).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Instructions saved with your booking" })).not.toBeInTheDocument();
    expect(screen.queryByText("Use the side entrance.")).not.toBeInTheDocument();
  });

  describe("after the booked end", () => {
    const ended = (overrides: Record<string, any>, outcome = "due") => {
      const now = Date.now();
      return visit({ chefId: 3, checkedInAt: new Date(now - 4 * 3_600_000).toISOString(), ...overrides,
        visitCloseout: { key: "b", phase: "ended", arrivalRecorded: true, scheduledStartAt: new Date(now - 4 * 3_600_000).toISOString(),
          scheduledEndAt: new Date(now - 3_600_000).toISOString(), inspection: { outcome, deadline: new Date(now + 20 * 3_600_000).toISOString(), canRespond: outcome === "due" } } });
    };
    it("a chef still checked in can always check out late (the booking already reads completed), with one clear message", async () => {
      status = ended({ status: "completed", checkinStatus: "checked_in" });
      setup();
      const message = await screen.findByTestId("visit-next-step");
      expect(message).toHaveTextContent(/^Your booking ended at \d{1,2}:\d{2}\s[ap]\.m\. \S+\. Please check out now — Test kitchen may charge for the extra time\.$/);
      expect(screen.queryByText("Visit finished")).not.toBeInTheDocument();
      expect(screen.getByText(/min past your booking/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Check out now" }));
      fireEvent.click(await screen.findByRole("button", { name: "Submit checkout" }));
      await waitFor(() => expect(posts().some(([url]) => String(url).endsWith("/checkout"))).toBe(true));
    });
    it("a finished visit says Visit finished once", async () => {
      status = ended({ status: "completed", checkinStatus: "checked_out", checkoutRequestedAt: new Date(Date.now() - 3_000_000).toISOString() }, "manager_cleared");
      setup();
      expect(await screen.findAllByText("Visit finished")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: /Check out now|Submit checkout/ })).not.toBeInTheDocument();
    });
    it("once the inspection window has closed there is no checkout, and it says what to do", async () => {
      status = ended({ status: "completed", checkinStatus: "checked_in" }, "auto_closed_uninspected");
      setup();
      expect(await screen.findByTestId("visit-next-step")).toHaveTextContent("Your booked time has ended and your checkout wasn’t recorded. Message Test kitchen if your departure needs to be added.");
      expect(screen.getAllByText("Visit finished")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: /Check out now|Submit checkout/ })).not.toBeInTheDocument();
    });
  });

  it("shows a submitted checkout and its review deadline without implying payment completion", async () => {
    status = visit({ checkinStatus: "checkout_requested", checkedInAt: "2026-10-12T14:05:00Z", checkoutRequestedAt: "2026-10-12T17:10:00Z", checkoutReviewDeadline: "2026-10-12T18:10:00Z" });
    setup();
    const summary = await screen.findByRole("region", { name: "Visit status" });
    expect(within(summary).getByText("Checkout requested")).toBeInTheDocument();
    expect(within(summary).getByText(/kitchen manager is reviewing/)).toBeInTheDocument();
    expect(within(summary).getByText("Review due by").parentElement).toHaveTextContent(/Oct 12, 2026/);
    expect(summary).not.toHaveTextContent(/paid|payout|refund|complete/i);
    expect(screen.queryByRole("button", { name: /Confirm check-in|Submit checkout/ })).not.toBeInTheDocument();
  });

  it.each([
    ["cancelled", "Cancelled", /booking was cancelled/],
    ["completed", "Not checked in", /ended without a check-in/],
  ])("shows a %s booking with no live instructions or actions", async (bookingStatus, chipLabel, message) => {
    status = visit({ status: bookingStatus });
    setup();
    const summary = await screen.findByRole("region", { name: "Visit status" });
    expect(within(summary).getByText(chipLabel)).toBeInTheDocument();
    expect(within(summary).getByText(message)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Kitchen visit" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Visit instructions" })).not.toBeInTheDocument();
    expect(screen.queryByText("Use the side entrance.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm check-in|Submit checkout/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/no-show/i)).not.toBeInTheDocument();
  });

  it("opens the visit chosen on the booking and updates status when another visit is selected", async () => {
    status.visits = [
      { id: 910, blockIndex: 0, startTime: "00:00", endTime: "12:00", checkinStatus: "checked_out", checkedInAt: "2026-10-12T01:00:00Z", checkoutApprovedAt: "2026-10-12T12:30:00Z" },
      { id: 911, blockIndex: 1, startTime: "12:00", endTime: "23:59", checkinStatus: "checked_in", checkedInAt: new Date().toISOString() },
    ];
    setup(true, "/booking/901/visit?visitId=910");
    const summary = await screen.findByRole("region", { name: "Visit status" });
    expect(await within(summary).findByText("Checkout closed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Visit 1:/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Submit checkout" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Choose a visit" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Visit 2:/ }));
    expect(await within(screen.getByRole("region", { name: "Visit status" })).findByText(/You’re checked in/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit checkout" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body).visitId).toBe(911);
  });

  it("says the booking still ends on time when the start has passed, and again after a late check-in", async () => {
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") { status = { ...status, checkinStatus: "checked_in", checkedInAt: new Date().toISOString() }; return new Response(JSON.stringify({ success: true })); }
      return new Response(JSON.stringify(status));
    });
    setup(true);
    expect(await screen.findByTestId("booking-still-ends")).toHaveTextContent("Your booking still ends at 11:59 p.m. GMT.");
    fireEvent.click(await screen.findByRole("button", { name: "Confirm check-in" }));
    expect(await screen.findByTestId("booking-still-ends-success")).toHaveTextContent("Your booking still ends at 11:59 p.m. GMT.");
    expect(screen.queryByTestId("booking-still-ends")).not.toBeInTheDocument();
  });

  it("offers Message the kitchen next to the check-in time when you arrive early, and no late line", async () => {
    const tomorrow = new Date(Date.now() + 36 * 3600_000).toISOString().split("T")[0];
    status = visit({ bookingDate: tomorrow, startTime: "10:00", endTime: "14:00" });
    setup(true);
    expect(await screen.findByText("Check-in opens")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arrived early? Message the kitchen" })).toBeInTheDocument();
    expect(screen.queryByTestId("booking-still-ends")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Running late?" })).not.toBeInTheDocument();
  });

  it("shows Running late? before check-in and keeps the confirmation after the chef told the kitchen", async () => {
    setup(true);
    expect(await screen.findByRole("button", { name: "Running late?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arrived early? Message the kitchen" })).not.toBeInTheDocument();
    cleanup();
    status = visit({ runningLate: { minutes: 15, reportedAt: new Date().toISOString(), expectedAt: new Date(Date.now() + 15 * 60_000).toISOString(), note: null, visitId: null, count: 1 } });
    setup(true);
    expect(await screen.findByText("You told the kitchen you’re running late")).toBeInTheDocument();
    expect(screen.getByText(/We told Test kitchen you’re running about 15 minutes late\. Your booking still ends at 11:59 p\.m\./)).toBeInTheDocument();
  });

  it("hides Running late? once checked in", async () => {
    status = visit({ checkinStatus: "checked_in", checkedInAt: new Date().toISOString() });
    setup(true);
    await screen.findByRole("region", { name: "Visit status" });
    expect(screen.queryByRole("button", { name: "Running late?" })).not.toBeInTheDocument();
  });
});
