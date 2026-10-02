import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ViewingSettingsPanel } from "./ViewingSettingsPanel";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
const key = ["/api/viewings/settings/40"];
const data = {
  settings: { id: 1, kitchenId: 40, isActive: false, defaultDurationMinutes: 30,
    bufferBeforeMinutes: 0, bufferAfterMinutes: 15, advanceNoticeHours: 24, maxAdvanceBookingDays: 30 },
  availability: [{ kitchenId: 40, dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isAvailable: true }],
  blackouts: [],
};

function mount(initial = data) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(key, initial);
  render(<QueryClientProvider client={client}><ViewingSettingsPanel kitchenId={40} hideSaveActions /></QueryClientProvider>);
  return client;
}

describe("tour settings refetches", () => {
  it("preserves unsaved weekly hours when the settings section refreshes", async () => {
    const client = mount();
    fireEvent.click(screen.getByRole("switch", { name: "Monday" }));
    act(() => client.setQueryData(key, { ...data, settings: { ...data.settings, isActive: true } }));
    await waitFor(() => expect(client.getQueryData<any>(key).settings.isActive).toBe(true));
    expect(screen.getByRole("switch", { name: "Monday" })).not.toBeChecked();
    client.clear();
  });

  it("preserves an unsaved tour duration when weekly hours refresh", async () => {
    const client = mount();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "viewingSettings" }), { button: 0, ctrlKey: false });
    fireEvent.change(screen.getByRole("textbox", { name: "viewingDuration" }), { target: { value: "45" } });
    act(() => client.setQueryData(key, { ...data, availability: [] }));
    expect(screen.getByRole("textbox", { name: "viewingDuration" })).toHaveValue("45");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "weeklySchedule" }), { button: 0, ctrlKey: false });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Monday" })).not.toBeChecked());
    fireEvent.mouseDown(screen.getByRole("tab", { name: "viewingSettings" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("textbox", { name: "viewingDuration" })).toHaveValue("45");
    client.clear();
  });
  it("keeps settings in the last tour subtab", () => {
    const client = mount();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "weeklySchedule", "exceptionsCalendar", "viewingSettings",
    ]);
    expect(screen.queryByRole("textbox", { name: "viewingDuration" })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "viewingSettings" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("textbox", { name: "viewingDuration" })).toBeInTheDocument();
    client.clear();
  });
});
