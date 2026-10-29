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

  it.each([
    ['arrival', { bookingDate: '2099-01-15' }, 'Arrive'],
    ['check-in', {}, 'Check in'],
    ['cooking', { checkinStatus: 'checked_in', chefId: 3, visitCloseout: { phase: 'in_booked_time', scheduledStartAt: new Date(Date.now() - 3_600_000).toISOString(), scheduledEndAt: new Date(Date.now() + 3_600_000).toISOString() } }, 'Cook'],
    ['checkout', { checkinStatus: 'checkout_requested' }, 'Check out'],
    // A closed visit has every step done, so no step is current.
    ['complete', { checkinStatus: 'checked_out' }, null],
  ])('marks only the current progress step during %s', async (_state, overrides, step) => {
    status = visit(overrides as Record<string, unknown>);
    setup();
    const progress = await screen.findByRole('list', { name: 'Visit progress' });
    const current = progress.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(step ? 1 : 0);
    if (step) expect(current[0]).toHaveTextContent(step as string);
    expect(within(progress).getAllByRole('listitem')).toHaveLength(4);
  });

  it('shows only the allowed help actions before the window, while open, and after completion', async () => {
    status = visit({ bookingDate: '2099-01-15' });
    setup();
    let help = await screen.findByRole('region', { name: 'Visit help' });
    await screen.findByText(/^Check-in opens /);
    expect(within(help).getByRole('button', { name: 'Message kitchen' })).toBeVisible();
    expect(within(help).queryByRole('button', { name: 'Running late?' })).not.toBeInTheDocument();
    expect(within(help).queryByRole('button', { name: 'Report a problem' })).not.toBeInTheDocument();
    cleanup(); client.clear();
    status = visit(); setup();
    await screen.findByRole('button', { name: 'Check in' });
    help = screen.getByRole('region', { name: 'Visit help' });
    expect(within(help).getByRole('button', { name: 'Message kitchen' })).toBeVisible();
    expect(within(help).getByRole('button', { name: 'Report a problem' })).toBeVisible();
    cleanup(); client.clear();
    status = visit({ checkinStatus: 'checked_out' }); setup();
    await screen.findByRole('heading', { name: 'Visit complete' });
    help = screen.getByRole('region', { name: 'Visit help' });
    expect(within(help).queryAllByRole('button')).toHaveLength(0);
  });

  it('uses the existing location address for directions and the existing kitchen photo', async () => {
    mocks.apiGet.mockResolvedValue({ kitchen: { name: 'Test kitchen', photos: ['/kitchen.jpg'] }, location: { address: '10 Water St, St. John’s' }, bookingDate: status.bookingDate, startTime: status.startTime, endTime: status.endTime });
    setup(true);
    expect(await screen.findByRole('link', { name: 'Directions' })).toHaveAttribute('href', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('10 Water St, St. John’s')}`);
    expect(document.querySelector('header img')).toHaveAttribute('src', '/kitchen.jpg');
  });

  it('opens a dated day-2 URL and copies matching tasks only, still requiring new photos and confirmation', async () => {
    const date = new Date().toISOString().slice(0, 10);
    const previous = new Date(); previous.setUTCDate(previous.getUTCDate() - 3);
    const pastDate = previous.toISOString().slice(0, 10);
    status = visit({ scheduleRevision: 1, bookingDate: pastDate,
      currentVisitDuties: { version: 2, arrival: { ...section,
        items: [{ id: 'clean', label: 'Check counter', required: true }, { id: 'new', label: 'New task', required: true }],
        photos: [{ id: 'today', label: 'Today photo', required: true }] }, departure: section },
      visits: [{ id: 11, blockIndex: 4, visitDate: pastDate, startTime: '00:00', endTime: '23:59', checkinStatus: 'no_show',
        checkinChecklistItems: [{ id: 'clean', label: 'Old counter label', checked: true }, { id: 'removed', label: 'Removed', checked: true }] },
      { id: 12, blockIndex: 7, visitDate: date, startTime: '00:00', endTime: '23:59', checkinStatus: 'not_checked_in' }] });
    const { navigation } = setup(true, '/booking/901/visit?visitId=12');
    const confirm = await screen.findByRole('button', { name: 'Check in' });
    fireEvent.click(screen.getByRole('button', { name: 'Same as previous visit' }));
    expect(screen.getByRole('checkbox', { name: /Check counter/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /New task/ })).not.toBeChecked();
    expect(screen.queryByText('Removed')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /New task/ }));
    expect(confirm).toBeDisabled(); expect(posts()).toHaveLength(0);
    expect(screen.getByText('Today photo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Day 2 of 2/ })).toHaveAttribute('aria-pressed', 'true');
    // Each day is labelled with its own date (live bug Oct 18: every day showed the selected day's date).
    const md = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));
    expect(screen.getByRole('button', { name: /Day 1 of 2/ })).toHaveTextContent(md(pastDate));
    expect(screen.getByRole('button', { name: /Day 1 of 2/ })).not.toHaveTextContent(/\d{4}-\d{2}-\d{2}/);
    fireEvent.click(screen.getByRole('button', { name: /Day 1 of 2/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Day 1 of 2/ })).toHaveAttribute('aria-pressed', 'true'));
    expect(navigation.history.at(-1)).toBe('/booking/901/visit?visitId=11');
  });

  it('keeps a removed dated visit URL from falling through to a different mutable day', async () => {
    status = visit({ scheduleRevision: 2, visits: [{ id: 12, blockIndex: 7, visitDate: status.bookingDate,
      startTime: '00:00', endTime: '23:59', checkinStatus: 'not_checked_in' }] });
    setup(true, '/booking/901/visit?visitId=11');
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer in the current schedule');
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('keeps required arrival photos before Confirm and instructions expanded before the form', async () => {
    status.currentVisitDuties = { ...status.currentVisitDuties, arrival: { ...section,
      photos: [{ id: 'floor', label: 'Floor photo', required: true }] } } as any;
    setup();
    const confirm = await screen.findByRole('button', { name: 'Check in' });
    const photo = screen.getByText('Floor photo');
    const instructions = screen.getByRole('region', { name: 'Arrival instructions' });
    expect(photo).toBeVisible();
    expect(photo.closest('details')).toBe(instructions);
    expect(photo.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(instructions.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(instructions).toHaveAttribute('open');
  });

  it("keeps optional arrival photos and notes collapsed after Confirm", async () => {
    setup();
    const confirm = await screen.findByRole('button', { name: 'Check in' });
    const toggle = screen.getByText('Add photos or a note (optional)');
    const details = toggle.closest('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(confirm.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.querySelector('textarea')).toBeInTheDocument();
  });

  it("opens the checkout form on Check out early, with the no-refund note by the final button", async () => {
    const end = new Date(Date.now() + 2 * 3_600_000);
    const start = new Date(Date.now() - 3_600_000);
    status = visit({ chefId: 3, checkinStatus: 'checked_in', checkedInAt: start.toISOString(),
      visitCloseout: { id: 901, blockIndex: 0, phase: 'in_progress', scheduledStartAt: start.toISOString(), scheduledEndAt: end.toISOString() } });
    setup();
    const early = await screen.findByRole('button', { name: 'Check out early' });
    expect(screen.queryByRole('button', { name: 'Check out' })).not.toBeInTheDocument();
    fireEvent.click(early);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Check out' })).toBeInTheDocument();
    expect(screen.getByText('Leaving early does not refund unused booked time.')).toBeInTheDocument();
  });

  it("hides preparation on a completed direct visit route while keeping its recorded outcome", async () => {
    status = visit({ status: "completed", checkinStatus: "checked_out", checkedInAt: "2026-10-12T14:05:00Z", checkoutRequestedAt: "2026-10-12T17:10:00Z",
      checkoutApprovedAt: "2026-10-12T17:40:00Z", checkinChecklistItems: [{ id: "floor", label: "Check the floor", checked: true }] });
    setup(true);
    await screen.findByRole("region", { name: "Visit status" });
    expect(screen.getByRole("heading", { level: 1, name: "Visit complete" })).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryData(["kitchen-checkin-status", 901])).toBeDefined());
    const summary = screen.getByRole("region", { name: "Visit status" });
    expect(screen.getByText("Checked out")).toBeInTheDocument();
    expect(within(summary).getByText(/^See your booking/)).toBeInTheDocument();
    expect(within(summary).queryByText(/manager.*review.*finished/i)).not.toBeInTheDocument();
    for (const label of ["Check-in time", "Checkout time", "Kitchen closed the visit"]) {
      // The header carries the visit date; times never repeat the year.
      expect(within(summary).getByText(label).parentElement).toHaveTextContent(/\d:\d\d/);
      expect(within(summary).getByText(label).parentElement).not.toHaveTextContent(/2026/);
    }
    expect(screen.getByText("Your Check-In Checklist")).toBeInTheDocument();
    expect(screen.getByText("Check the floor")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Visit instructions" })).not.toBeInTheDocument();
    // Collapsed by default; the text is kept for the record.
    expect(within(screen.getByText('Instructions you were given').closest('details')!).getByText('Use the side entrance.')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check out" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Back to booking" })).toHaveLength(2);
  });

  it("shows a neutral visit title after cancellation even when arrival was recorded", async () => {
    status = visit({ status: "cancelled", checkinStatus: "checked_in", checkedInAt: "2026-10-12T16:00:00Z" });
    setup(true);
    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen visit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check out" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Visit instructions" })).not.toBeInTheDocument();
  });

  it("presents full-page context and separates instructions from optional actions", async () => {
    setup(true);
    expect(await screen.findByRole("heading", { level: 1, name: "Check in at Test kitchen" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    screen.getAllByRole("link", { name: "Back to booking" }).forEach(link => expect(link).toHaveAttribute("href", "/booking/901"));
    expect(screen.getByRole("heading", { name: "Check in at Test kitchen" })).toBeInTheDocument();
    expect(screen.getAllByText(/GMT/).length).toBeGreaterThan(0);
    const instructions = screen.getByRole("region", { name: "Arrival instructions" });
    expect(instructions).toHaveAttribute("open");
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
    const button = await screen.findByRole("button", { name: phase === "arrival" ? "Check in" : "Check out" });
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
    expect(screen.queryByText('Instructions you were given')).not.toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Check out' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Check the new exit/ }));
    expect(submit).toBeEnabled();
  });

  it('allows arrival despite obsolete disabled flags and does not render a removed snapshot task', async () => {
    status.checkinEnabled = false; status.checkoutEnabled = false;
    status.visitDuties.arrival = { ...section, enabled: false, items: [{ id: 'old', label: 'Removed task', required: true }] } as any;
    setup();
    expect(await screen.findByRole('button', { name: 'Check in' })).toBeEnabled();
    expect(screen.queryByRole('checkbox', { name: /Removed task/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/doesn.t ask you to check in/)).not.toBeInTheDocument();
  });

  it('keeps matching current requirements free of an update note', async () => {
    setup();
    await screen.findByRole('button', { name: 'Check in' });
    expect(screen.queryByText('Updated by the kitchen since you booked')).not.toBeInTheDocument();
  });

  it('shows authoritative item and photo field errors and preserves the draft when tasks change at submit', async () => {
    setup();
    const submit = await screen.findByRole('button', { name: 'Check in' });
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
    const submit = await screen.findByRole("button", { name: "Check in" });
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
    const submit = await screen.findByRole("button", { name: phase === "arrival" ? "Check in" : "Check out" });
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
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
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
    await screen.findByRole("button", { name: "Check out" });
    client.setQueryData(["/api/chef/bookings"], []);
    client.setQueryData(["/api/chef/bookings/901/attendance"], {});
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
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
    await screen.findByRole("button", { name: "Check in" });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    const sentence = await screen.findByTestId("visit-next-step");
    expect(sentence).toHaveTextContent(/^You checked in at \d{1,2}:\d{2}\s[ap]\.m\./);
    // The time is stated once: no second "Arrival confirmed" line and no "Check-in time" row.
    expect(screen.queryByText(/Arrival confirmed at/)).not.toBeInTheDocument();
    expect(screen.queryByText("Check-in time")).not.toBeInTheDocument();
    expect(navigation.history).toEqual(["/booking/901/visit"]);
    expect(screen.queryByRole("heading", { name: "Returned to booking" })).not.toBeInTheDocument();
  });

  it("waits for active booking details to refresh before navigating", async () => {
    status = visit({ checkinStatus: "checked_in", checkedInAt: new Date().toISOString() });
    const { navigation } = setup(true);
    await screen.findByRole("button", { name: "Check out" });
    let finishRefresh!: (value: any) => void;
    mocks.apiGet.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(2));
    expect(navigation.history).toEqual(["/booking/901/visit"]);
    await act(async () => finishRefresh({ kitchen: { name: "Test kitchen" }, bookingDate: status.bookingDate, startTime: status.startTime, endTime: status.endTime }));
    await waitFor(() => expect(navigation.history).toEqual(["/booking/901"]));
  });

  it("keeps the form mounted when booking context revalidation fails", async () => {
    setup(true);
    await screen.findByRole("button", { name: "Check in" });
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
    expect(screen.queryByRole("button", { name: "Check in" })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    mocks.apiGet.mockResolvedValue({ checkinItems: [], checkoutItems: [], checkinPhotoRequirements: [], checkoutPhotoRequirements: [] });
    fireEvent.click(screen.getByRole("button", { name: "Retry requirements" }));
    expect(await screen.findByRole("button", { name: "Check in" })).toBeEnabled();
  });

  it("shows an overnight visit on the correct kitchen-local calendar dates", async () => {
    status = visit({ bookingDate: "2026-10-12", startTime: "22:00", endTime: "02:00", operatingWindowStartTime: "22:00", timezone: "America/Toronto", checkinStatus: "checked_out" });
    setup();
    await screen.findByRole("region", { name: "Visit status" });
    expect(screen.getByRole("heading", { level: 1, name: "Visit complete" })).toBeInTheDocument();
    expect(screen.getByText(/Mon, Oct 12 · 10:00\s*p\.m\.\s*[–-]\s*Tue, Oct 13 · 2:00\s*a\.m\./)).toBeInTheDocument();
    expect(screen.getByText(/Oct 13 · 2:00\s*a\.m\. · Eastern Time$/)).toBeInTheDocument();
    expect(screen.queryByText(/Times are shown in the kitchen/)).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body).visitId).toBe(911);
  });

  it("shows status, kitchen-local time and next step without opening any disclosure", async () => {
    const { container } = setup();
    const summary = await screen.findByRole("region", { name: "Visit status" });
    expect(screen.getByTestId("visit-next-step").closest("details")).toBeNull();
    // One status line: the next-step sentence, not a "Not checked in" chip repeating it.
    expect(within(summary).queryByText("Not checked in")).not.toBeInTheDocument();
    expect(within(summary).getByText(/Check-in is open/)).toBeInTheDocument();
    expect(screen.queryByText("Arrival not recorded")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Message kitchen" })).toBeInTheDocument();
    expect(screen.getByText(/^\w{3}, \w{3} \d{1,2} · 12:00\s*a\.m\.\s*[–-]\s*11:59\s*p\.m\. · GMT$/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Check in" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Check in" })).toBeVisible();
  });

  it("shows when check-in opens before the window without inventing absence", async () => {
    status = visit({ bookingDate: "2099-01-15", startTime: "09:00", endTime: "12:00", timezone: "America/St_Johns", checkinWindowMinutesBefore: 15 });
    setup();
    const summary = await screen.findByRole("region", { name: "Visit status" });
    expect(within(summary).getByText(/^Check-in opens .*Jan 15.*8:45/)).toBeInTheDocument();
    // No code on this visit, so no locked code card ahead of time.
    expect(screen.queryByLabelText("Check-in code")).not.toBeInTheDocument();
    expect(screen.queryByText("Check-in opens")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check in" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Arrival instructions" })).toHaveAttribute("open");
    expect(screen.queryByText(/no-show/i)).not.toBeInTheDocument();
  });

  it("in session offers Message kitchen once and does not repeat the arrival instructions as a saved record", async () => {
    const now = Date.now();
    status = visit({ checkinStatus: "checked_in", checkedInAt: new Date(now - 600_000).toISOString(), chefId: 3,
      visitCloseout: { key: "b", phase: "in_booked_time", arrivalRecorded: true, scheduledStartAt: new Date(now - 3_600_000).toISOString(),
        scheduledEndAt: new Date(now + 3_600_000).toISOString(), inspection: { outcome: "not_due", deadline: new Date(now + 86_400_000).toISOString(), canRespond: false } } });
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "You’re checked in" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Message kitchen" })).toHaveLength(1);
    expect(screen.queryByText("Instructions you were given")).not.toBeInTheDocument();
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
      expect(message).toHaveTextContent(/^Your booking ended at \d{1,2}:\d{2}\s[ap]\.m\. \S+\. Please check out now. Test kitchen may charge for the extra time\.$/);
      expect(screen.queryByText("Visit finished")).not.toBeInTheDocument();
      expect(screen.getByText(/min past your booking/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Check out now" }));
      fireEvent.click(await screen.findByRole("button", { name: "Check out" }));
      await waitFor(() => expect(posts().some(([url]) => String(url).endsWith("/checkout"))).toBe(true));
    });
    it("a chef still checked in sees the ended state once: no 'In session', no kitchen deadline, one Check out now", async () => {
      status = ended({ status: "completed", checkinStatus: "checked_in" });
      setup();
      await screen.findByTestId("visit-next-step");
      expect(screen.getAllByText("Your booked time ended")).toHaveLength(1);
      expect(screen.queryByText(/In session/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Inspection due/i)).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Check out now" })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Leave early / check out now" })).not.toBeInTheDocument();
    });
    it("a finished visit shows a completion title and status", async () => {
      status = ended({ status: "completed", checkinStatus: "checked_out", checkoutRequestedAt: new Date(Date.now() - 3_000_000).toISOString() }, "manager_cleared");
      setup();
      expect(await screen.findByRole("heading", { name: "Visit complete" })).toBeInTheDocument();
      expect(screen.getByText("Checked out")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Check out now|Check out/ })).not.toBeInTheDocument();
    });
    it("once the inspection window has closed there is no checkout, and it says what to do", async () => {
      status = ended({ status: "completed", checkinStatus: "checked_in" }, "auto_closed_uninspected");
      setup();
      expect(await screen.findByTestId("visit-next-step")).toHaveTextContent("Your booked time has ended and your checkout wasn’t recorded. Message Test kitchen if your departure needs to be added.");
      expect(screen.getAllByText("Visit finished")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: /Check out now|Check out/ })).not.toBeInTheDocument();
    });
  });

  it("states the check-in time once when checked in", async () => {
    status = visit({ checkinStatus: "checked_in", checkedInAt: "2026-10-12T09:28:00Z" });
    setup();
    expect(await screen.findByTestId("visit-next-step")).toHaveTextContent("You checked in at 9:28 a.m. Choose Check out when you’re finished.");
    expect((document.body.textContent || "").match(/9:28\s*a\.m\./g)).toHaveLength(1);
  });

  it("after checkout is submitted it says when, and never mentions the kitchen's review deadline", async () => {
    status = visit({ checkinStatus: "checkout_requested", checkedInAt: "2026-10-12T09:28:00Z", checkoutRequestedAt: "2026-10-12T10:31:00Z", checkoutReviewDeadline: "2026-10-13T10:31:00Z" });
    setup();
    expect(await screen.findByTestId("visit-next-step")).toHaveTextContent("You checked out at 10:31 a.m.");
    expect(screen.queryByText("Review due by")).not.toBeInTheDocument();
    expect(screen.queryByText(/Inspection due/i)).not.toBeInTheDocument();
    expect((document.body.textContent || "").match(/10:31\s*a\.m\./g)).toHaveLength(1);
  });

  it("shows a submitted checkout and its review deadline without implying payment completion", async () => {
    status = visit({ checkinStatus: "checkout_requested", checkedInAt: "2026-10-12T14:05:00Z", checkoutRequestedAt: "2026-10-12T17:10:00Z", checkoutReviewDeadline: "2026-10-12T18:10:00Z" });
    setup();
    const summary = await screen.findByRole("region", { name: "Visit status" });
    expect(screen.getByRole("heading", { level: 1, name: "Checking out" })).toBeInTheDocument();
    expect(screen.getByText("Checked out")).toBeInTheDocument();
    expect(within(summary).getByText(/^You checked out at \d{1,2}:\d{2}\s[ap]\.m\.$/)).toBeInTheDocument();
    // The review deadline is the kitchen's business, not the chef's.
    expect(summary).not.toHaveTextContent(/Review due by|inspection|paid|payout|refund|complete/i);
    expect(screen.queryByRole("button", { name: /Check in|Check out/ })).not.toBeInTheDocument();
  });

  it.each([
    ["cancelled", "Cancelled", /booking was cancelled/],
    ["completed", "Not checked in", /ended without a check-in/],
  ])("shows a %s booking with no live instructions or actions", async (bookingStatus, chipLabel, message) => {
    status = visit({ status: bookingStatus });
    setup();
    const summary = await screen.findByRole("region", { name: "Visit status" });
    expect(screen.getByText(chipLabel)).toBeInTheDocument();
    expect(within(summary).getByText(message)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Kitchen visit" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Visit instructions" })).not.toBeInTheDocument();
    expect(screen.queryByText("Use the side entrance.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check in|Check out/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/no-show/i)).not.toBeInTheDocument();
  });

  it("opens the visit chosen on the booking and updates status when another visit is selected", async () => {
    status.visits = [
      { id: 910, blockIndex: 0, startTime: "00:00", endTime: "12:00", checkinStatus: "checked_out", checkedInAt: "2026-10-12T01:00:00Z", checkoutApprovedAt: "2026-10-12T12:30:00Z" },
      { id: 911, blockIndex: 1, startTime: "12:00", endTime: "23:59", checkinStatus: "checked_in", checkedInAt: new Date().toISOString() },
    ];
    setup(true, "/booking/901/visit?visitId=910");
    const summary = await screen.findByRole("region", { name: "Visit status" });
    expect(await within(summary).findByText("Kitchen closed the visit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Visit 1:/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Check out" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Choose a visit" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Visit 2:/ }));
    expect(await within(screen.getByRole("region", { name: "Visit status" })).findByText(/^You checked in at /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body).visitId).toBe(911);
  });

  it("says the booking still ends on time when the start has passed, and again after a late check-in", async () => {
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") { status = { ...status, checkinStatus: "checked_in", checkedInAt: new Date().toISOString() }; return new Response(JSON.stringify({ success: true })); }
      return new Response(JSON.stringify(status));
    });
    setup(true);
    expect(await screen.findByTestId("visit-next-step")).toHaveTextContent(/^Check-in is open\. .* Your booking still ends at 11:59 p\.m\. GMT\.$/);
    fireEvent.click(await screen.findByRole("button", { name: "Check in" }));
    await waitFor(() => expect(screen.getByTestId("visit-next-step")).toHaveTextContent(/^You checked in at .* Your booking still ends at 11:59 p\.m\. GMT\.$/));
  });

  it("on the day, before the window, says only the time and offers Arrived early", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-20T11:00:00Z")); // 8:30 a.m. Newfoundland
    try {
      status = visit({ bookingDate: "2026-10-20", startTime: "10:00", endTime: "14:00", timezone: "America/St_Johns", checkinWindowMinutesBefore: 15 });
      setup(true);
      expect(await screen.findByText(/^Check-in opens 9:45\s*a\.m\., so come back/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Arrived early? Message the kitchen" })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it("on a later day, names the day check-in opens and doesn't offer Arrived early, and no late line", async () => {
    const tomorrow = new Date(Date.now() + 36 * 3600_000).toISOString().split("T")[0];
    status = visit({ bookingDate: tomorrow, startTime: "10:00", endTime: "14:00" });
    setup(true);
    expect(await screen.findByText(/^Check-in opens \w{3}, /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arrived early? Message the kitchen" })).not.toBeInTheDocument();
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
