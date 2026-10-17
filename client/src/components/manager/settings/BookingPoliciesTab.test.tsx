import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KitchenWorkspaceControls, { type KitchenPoliciesHandle } from "./KitchenWorkspaceControls";
import { kitchenWorkspaceSettingsKey } from "@/lib/manager-kitchens-navigation";

vi.mock("react-i18next", async () => ({ useTranslation: (await import("@/test/booking-i18n")).useBookingTranslation }));
vi.mock("@/i18n/manager", async () => ({ mt: (await import("@/test/booking-i18n")).testI18n.getFixedT("en-CA", "manager") }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/hooks/use-presigned-document-url", () => ({ usePresignedDocumentUrl: () => ({ url: null, isLoading: false, error: null }) }));
vi.mock("@/lib/manager-bookings-query", () => ({ fetchManagerBookings: async () => [] }));
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiGet: api.get, apiPut: api.put, apiPutWithMessage: api.put, apiPost: api.post }));
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const location = { id: 33, name: "Harbour", kitchenTermsUrl: "https://cdn.example.com/harbour-terms.pdf" };
const effective = {
  cancellationPolicyHours: 24, minimumBookingWindowHours: 1, defaultDailyBookingLimit: 8,
  maxAdvanceBookingDays: 30, turnoverBufferEnabled: false, bookingBufferMinutes: 0,
  allowMultiDayBookings: true, maxBookingDays: 7, maxBookingDaysCap: 14,
  weeklyChefHoursLimit: null, maxAdvanceBookingDaysCap: 60,
};
const workspace = {
  kitchen: {
    name: "Prep Kitchen", cancellationPolicyHours: null, minimumBookingWindowHours: null, defaultDailyBookingLimit: null,
    maxAdvanceBookingDays: null, turnoverBufferEnabled: null, bookingBufferMinutes: null,
    allowMultiDayBookings: null, maxBookingDays: null, weeklyChefHoursLimit: null, minimumBookingHours: 0,
  },
  effective, defaults: effective,
};
const policy = { policy: { id: 1, version: 3, noticeHours: 24, lateChargePercent: 100, adminOverrideReason: null }, settings: { noticeOptions: [24, 48, 72], chargeOptions: [50, 100] } };
const extension = { kitchenId: 40, kitchenName: "Prep Kitchen", enabled: true, autoApprove: false, override: null, overrideReason: null, effectiveAutoApprove: false };

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (path: string) => path.endsWith("cancellation-policy") ? policy : path.endsWith("session-extension-settings") ? extension : workspace);
  api.put.mockImplementation(async () => workspace);
});
afterEach(cleanup);

function mount(data: unknown = workspace) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(kitchenWorkspaceSettingsKey(40), data);
  client.setQueryData(["managerBookings"], []);
  const ref = createRef<KitchenPoliciesHandle>();
  const onRequestSave = vi.fn();
  render(<QueryClientProvider client={client}><KitchenWorkspaceControls kitchenId={40} location={location} mode="policies"
    showTerms saveRef={ref} onRequestSave={onRequestSave} /></QueryClientProvider>);
  return { client, ref, onRequestSave };
}
const rulesSection = () => screen.getByTestId("booking-rules-section");
const saveRules = () => within(rulesSection()).getByRole("button", { name: "Save booking rules" });

describe("Booking Policies tab", () => {
  it("shows kitchen-scoped heading, location-default labels, read-only terms, and five sections", async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText("Free cancellation until")).toBeEnabled());
    expect(screen.getByRole("heading", { name: /Rules for Prep Kitchen/i })).toBeInTheDocument();
    expect(screen.getAllByText("Location default").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Change for this kitchen").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(
      ["Booking rules", "Cancellation policy", "Extra time", "Damage and cleaning", "Terms and conditions"]);
    expect(screen.queryByText("Copy these rules to your other kitchens")).not.toBeInTheDocument();
    expect(saveRules()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save cancellation policy" })).toBeDisabled();
    await waitFor(() => expect(within(screen.getByTestId("session-extension-settings")).getByRole("button", { name: "Save changes" })).toBeDisabled());
    expect(screen.queryByTestId("setting-change-preview")).not.toBeInTheDocument();
    expect(screen.getByText("Chefs can book up to 30 days ahead.")).toBeInTheDocument();
    expect(screen.getByText("Chefs can book back to back.")).toBeInTheDocument();
    expect(screen.getByText("Longest booking: 8 hours per day")).toBeInTheDocument();
    expect(screen.getByText(/One hourly booking can last up to 8 hours/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /More about Longest booking/i }));
    expect(await screen.findByText(/Applies to hourly bookings/)).toBeInTheDocument();
    expect(screen.getByText(/Full days are booked at your daily rate/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /More about Limit hours per chef each week/i }));
    expect(await screen.findByText(/Monday–Sunday/)).toBeInTheDocument();
    expect(screen.getAllByText(/at this kitchen/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Report damage or extra cleaning within 72 hours/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "How claims work" }));
    expect(screen.getByText(/Report damage or extra cleaning within 72 hours/)).toBeInTheDocument();
    expect(screen.getByText("harbour-terms.pdf")).toBeInTheDocument();
    expect(screen.getByText(/Set for Harbour/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
  });

  it("caps the booking window at the Local Cooks limit and previews it before the save", async () => {
    const { ref, onRequestSave } = mount();
    expect(screen.getByText("Up to 60 days")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "How far ahead chefs can book" });
    fireEvent.change(input, { target: { value: "90" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("60");
    const preview = within(rulesSection()).getByTestId("setting-change-preview");
    expect(preview).toHaveTextContent("Chefs can book up to 60 days ahead.");
    expect(preview).toHaveTextContent("Bookings already made stay as they are.");
    expect(preview).toHaveTextContent("No upcoming bookings are affected.");
    fireEvent.click(saveRules());
    expect(onRequestSave).toHaveBeenCalledOnce();
    expect(await ref.current!.saveAllChanges("kitchen")).toBe(true);
    expect(api.put).toHaveBeenCalledWith("/manager/kitchens/40/workspace-settings", { maxAdvanceBookingDays: 60 });
  });

  it("never lets the window go below one day", () => {
    mount();
    const input = screen.getByRole("textbox", { name: "How far ahead chefs can book" });
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("1");
  });

  it("previews the buffer between bookings and can apply it to every kitchen", async () => {
    const { ref } = mount();
    api.put.mockResolvedValue({ updatedKitchens: 2 });
    const trigger = screen.getByRole("combobox", { name: "Time free between bookings" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "1 hour" }));
    expect(within(rulesSection()).getByTestId("setting-change-preview")).toHaveTextContent("can’t start or end within an hour of another booking");
    expect(saveRules()).toBeEnabled();
    expect(await ref.current!.saveAllChanges("location")).toBe(true);
    expect(api.put).toHaveBeenCalledWith("/manager/locations/33/kitchen-booking-policies", { bookingBufferMinutes: 60 });
  });

  it("discards edits back to the saved values", async () => {
    mount();
    fireEvent.click(screen.getByRole("combobox", { name: "Time free between bookings" }));
    fireEvent.click(await screen.findByRole("option", { name: "1 hour" }));
    fireEvent.click(within(rulesSection()).getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("combobox", { name: "Time free between bookings" })).toHaveTextContent("Off");
    expect(saveRules()).toBeDisabled();
  });

  it("marks a kitchen-only booking window and resets it to the location rule", async () => {
    mount({ ...workspace, kitchen: { ...workspace.kitchen, maxAdvanceBookingDays: 45 }, effective: { ...effective, maxAdvanceBookingDays: 45 } });
    expect(screen.getAllByText("Set for this kitchen").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Use the location’s rule" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/manager/kitchens/40/workspace-settings", { maxAdvanceBookingDays: null }));
  });

  it("offers copy-to-other-kitchens when the location has multiple kitchens", async () => {
    api.get.mockImplementation(async (path: string) => {
      if (path.endsWith("cancellation-policy")) return policy;
      if (path.endsWith("session-extension-settings")) return extension;
      if (path.includes("copy-booking-policies")) {
        return { sourceKitchenId: 40, sourceKitchenName: "Prep Kitchen", kitchens: [
          { kitchenId: 41, kitchenName: "Bake", changes: [{ field: "minimumBookingWindowHours", from: 1, to: 4, action: "set" }] },
        ] };
      }
      return workspace;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(kitchenWorkspaceSettingsKey(40), workspace);
    client.setQueryData(["managerBookings"], []);
    render(<QueryClientProvider client={client}><KitchenWorkspaceControls kitchenId={40} location={location} mode="policies"
      showTerms kitchenCount={2} onRequestSave={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Copy these rules to your other kitchens" }));
    expect(await screen.findByText("Bake")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy rules" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/manager/kitchens/40/copy-booking-policies", {}));
    expect(api.get).toHaveBeenCalledWith("/manager/kitchens/40/copy-booking-policies");
  });

  it("works with an older server that has no window or buffer settings", async () => {
    const { ref } = mount({ ...workspace, effective: { cancellationPolicyHours: 24, minimumBookingWindowHours: 1, defaultDailyBookingLimit: 8 } });
    expect(screen.queryByText("How far ahead chefs can book")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Time free between bookings" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Advance notice" }), { target: { value: "4" } });
    expect(within(rulesSection()).getByTestId("setting-change-preview")).toHaveTextContent("Chefs must book at least 4 hours before the start.");
    expect(await ref.current!.saveAllChanges("kitchen")).toBe(true);
    expect(api.put).toHaveBeenCalledWith("/manager/kitchens/40/workspace-settings", { minimumBookingWindowHours: 4 });
  });
});
