import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ViewingSettingsPanel } from "./ViewingSettingsPanel";
import { createRef } from "react";
import type { ViewingSettingsPanelHandle, ViewingSettingsResponse } from "./ViewingSettingsPanel";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
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

function mount(initial: ViewingSettingsResponse = data) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(key, initial);
  render(<QueryClientProvider client={client}><ViewingSettingsPanel kitchenId={40} hideSaveActions /></QueryClientProvider>);
  return client;
}
function openInstructions() {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'tourInstructionsTab' }), { button: 0, ctrlKey: false });
}
function openSchedule() {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'tourScheduleTab' }), { button: 0, ctrlKey: false });
}

describe("tour settings refetches", () => {
  it('opens instructions directly from a tour even while setup is incomplete', async () => {
    window.history.replaceState({}, '', '/?focus=tour-notes&returnTour=10');
    const client = mount({ ...data, availability: [] });
    expect(screen.getByRole('tab', { name: 'tourInstructionsTab' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tourActivateAction' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tourSetScheduleAction' })).toBeInTheDocument();
    client.clear();
  });
  it('moves to instructions after a starting schedule is prepared while preserving an instruction draft', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(key, { ...data, availability: [] });
    const view = render(<QueryClientProvider client={client}><ViewingSettingsPanel kitchenId={40} hideSaveActions /></QueryClientProvider>);
    openInstructions();
    fireEvent.change(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' }), { target: { value: 'Meet Sam' } });
    openSchedule();
    act(() => client.setQueryData(key, data));
    view.rerender(<QueryClientProvider client={client}><ViewingSettingsPanel kitchenId={40} initialSection="instructions" hideSaveActions /></QueryClientProvider>);
    expect(screen.getByRole('tab', { name: 'tourInstructionsTab' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' })).toHaveValue('Meet Sam');
    openSchedule();
    expect(screen.getByRole('switch', { name: 'Monday' })).toBeChecked();
    client.clear();
  });
  it('guides setup without exposing activation until the schedule and both instructions are complete', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const client = mount({ ...data, availability: [] });
    expect(screen.queryByRole('button', { name: 'tourActivateAction' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tourContinueInstructions' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    openSchedule();
    fireEvent.click(screen.getByRole('switch', { name: 'Monday' }));
    expect(screen.getByRole('button', { name: 'tourContinueInstructions' })).toBeEnabled();
    openInstructions();
    openInstructions();
    fireEvent.change(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' }), { target: { value: 'Meet Sam' } });
    expect(screen.queryByRole('button', { name: 'tourActivateAction' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'departureInstructionsTitle' }), { target: { value: 'Return badge' } });
    expect(screen.getByRole('button', { name: 'tourActivateAction' })).toBeEnabled();
    expect(fetcher).not.toHaveBeenCalled();
    client.clear();
  });
  it('saves complete setup as a draft, then activates only on the explicit action', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async (): Promise<ViewingSettingsResponse> => client.getQueryData<ViewingSettingsResponse>(key)! } } });
    client.setQueryData(key, data);
    const ref = createRef<ViewingSettingsPanelHandle>();
    const fetcher = vi.fn(async (_path: string, options: RequestInit) => ({ ok: true,
      json: async () => ({ ...data.settings, ...JSON.parse(options.body as string) }) }));
    vi.stubGlobal('fetch', fetcher);
    render(<QueryClientProvider client={client}><ViewingSettingsPanel kitchenId={40} ref={ref} hideSaveActions /></QueryClientProvider>);
    openInstructions();
    fireEvent.change(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' }), { target: { value: 'Meet Sam' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'departureInstructionsTitle' }), { target: { value: 'Return badge' } });
    await act(async () => { expect(await ref.current!.saveChanges()).toBe(true); });
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).isActive).not.toBe(true);
    expect(screen.getByText('tourStateReady')).toBeInTheDocument();
    expect(screen.queryByText('tourStateLive')).not.toBeInTheDocument();
    await act(async () => { expect(await ref.current!.activateTours()).toBe(true); });
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toMatchObject({ isActive: true, arrivalNotes: 'Meet Sam', departureNotes: 'Return badge' });
    expect(screen.getByText('tourStateLive')).toBeInTheDocument();
    client.clear();
  });
  it('saves new hours and activation together and retains edits when activation fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async (): Promise<ViewingSettingsResponse> => client.getQueryData<ViewingSettingsResponse>(key)! } } });
    client.setQueryData(key, { ...data, availability: [] });
    const ref = createRef<ViewingSettingsPanelHandle>();
    const fetcher = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Please retry' }) }));
    vi.stubGlobal('fetch', fetcher);
    render(<QueryClientProvider client={client}><ViewingSettingsPanel kitchenId={40} ref={ref} hideSaveActions /></QueryClientProvider>);
    openInstructions();
    fireEvent.change(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' }), { target: { value: 'Meet Sam' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'departureInstructionsTitle' }), { target: { value: 'Return badge' } });
    openSchedule();
    fireEvent.click(screen.getByRole('switch', { name: 'Monday' }));
    await act(async () => { expect(await ref.current!.activateTours()).toBe(false); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/viewings/settings/40', expect.objectContaining({ body: expect.stringContaining('"slots"') }));
    openInstructions();
    expect(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' })).toHaveValue('Meet Sam');
    openSchedule();
    expect(screen.getByRole('switch', { name: 'Monday' })).toBeChecked();
    expect(screen.queryByText('tourStateLive')).not.toBeInTheDocument();
    client.clear();
  });
  it('shows that activated tours cannot receive requests from an unlisted kitchen', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(key, { ...data, settings: { ...data.settings, isActive: true, arrivalNotes: 'Meet Sam', departureNotes: 'Return badge' } });
    render(<QueryClientProvider client={client}><ViewingSettingsPanel kitchenId={40} kitchenIsListed={false} hideSaveActions /></QueryClientProvider>);
    expect(screen.getByText('tourStateUnlisted')).toBeInTheDocument();
    expect(screen.queryByText('tourStateLive')).not.toBeInTheDocument();
    client.clear();
  });
  it('requires pausing before saved live instructions or the last usable day can be removed', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(key, { ...data, settings: { ...data.settings, isActive: true, arrivalNotes: 'Meet Sam', departureNotes: 'Return badge' } });
    const ref = createRef<ViewingSettingsPanelHandle>();
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    render(<QueryClientProvider client={client}><ViewingSettingsPanel kitchenId={40} ref={ref} hideSaveActions /></QueryClientProvider>);
    openInstructions();
    fireEvent.change(screen.getByRole('textbox', { name: 'departureInstructionsTitle' }), { target: { value: '  ' } });
    await act(async () => { expect(await ref.current!.saveChanges()).toBe(false); });
    expect(screen.getByText('tourDepartureRequired')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'departureInstructionsTitle' }), { target: { value: 'Return badge' } });
    openSchedule();
    fireEvent.click(screen.getByRole('switch', { name: 'Monday' }));
    await act(async () => { expect(await ref.current!.saveChanges()).toBe(false); });
    expect(screen.getByText('tourScheduleRequired')).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
    client.clear();
  });
  it("edits tour notes directly, preserves drafts on refresh, saves with the parent action and reloads them", async () => {
    const saved = { ...data, settings: { ...data.settings, arrivalNotes: 'Meet at reception', departureNotes: 'Return your badge' } };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(key, saved);
    const ref = createRef<ViewingSettingsPanelHandle>();
    const dirty = vi.fn();
    const fetcher = vi.fn(async (_path: string, _options?: RequestInit) => ({ ok: true, json: async () => ({ ...saved.settings, arrivalNotes: 'Use the side entrance\nAsk for Sam' }) }));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<QueryClientProvider client={client}><ViewingSettingsPanel kitchenId={40} ref={ref} onDirtyChange={dirty} hideSaveActions /></QueryClientProvider>);
    openInstructions();
    expect(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' })).toHaveValue('Meet at reception');
    expect(screen.getByRole('textbox', { name: 'departureInstructionsTitle' })).toHaveValue('Return your badge');
    openInstructions();
    fireEvent.change(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' }), { target: { value: 'Use the side entrance\nAsk for Sam' } });
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
    act(() => client.setQueryData(key, { ...saved, availability: [] }));
    expect(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' })).toHaveValue('Use the side entrance\nAsk for Sam');
    let result = false;
    await act(async () => { result = await ref.current!.saveChanges(); });
    expect(result).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [path, options] = fetcher.mock.calls[0];
    expect(path).toBe('/api/viewings/settings/40');
    expect(JSON.parse(options!.body as string)).toMatchObject({ arrivalNotes: 'Use the side entrance\nAsk for Sam', departureNotes: 'Return your badge' });
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
    view.unmount();
    client.setQueryData(key, { ...saved, settings: { ...saved.settings, arrivalNotes: 'Use the side entrance\nAsk for Sam' } });
    render(<QueryClientProvider client={client}><ViewingSettingsPanel kitchenId={40} hideSaveActions /></QueryClientProvider>);
    openInstructions();
    expect(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' })).toHaveValue('Use the side entrance\nAsk for Sam');
    client.clear();
  });
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
    openSchedule();
    fireEvent.click(screen.getByText("tourTimingRules"));
    fireEvent.change(screen.getByRole("textbox", { name: "viewingDuration" }), { target: { value: "45" } });
    openInstructions();
    act(() => client.setQueryData(key, { ...data, availability: [] }));
    openSchedule();
    fireEvent.click(screen.getByText("tourTimingRules"));
    expect(screen.getByRole("textbox", { name: "viewingDuration" })).toHaveValue("45");
    await waitFor(() => expect(screen.getByRole("switch", { name: "Monday" })).not.toBeChecked());
    client.clear();
  });
  it('keeps timing rules with the schedule and instructions in their own section', () => {
    const client = mount();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'tourScheduleTab' })).toHaveAttribute('data-state', 'active');
    expect(screen.queryByRole('textbox', { name: 'arrivalInstructionsTitle' })).not.toBeInTheDocument();
    expect(screen.getByText('tourTimingRules').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('tourTimingRules'));
    expect(screen.getByRole('textbox', { name: 'viewingDuration' })).toBeInTheDocument();
    openInstructions();
    expect(screen.getByRole('textbox', { name: 'arrivalInstructionsTitle' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Monday' })).not.toBeInTheDocument();
    client.clear();
  });
});
