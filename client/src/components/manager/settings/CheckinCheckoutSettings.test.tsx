import { createRef, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CheckinCheckoutSettings, { type CheckinCheckoutHandle } from './CheckinCheckoutSettings';
import { resolveKitchenChecklist } from '@shared/kitchen-checklist';
import type { ChecklistItem, PhotoRequirement } from './shared/ChecklistEditor';

const state = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock('@/i18n/manager', () => ({ mt: (key: string, options?: { defaultValue?: string; location?: string }) =>
  (options?.defaultValue ?? key).replace('{location}', options?.location ?? '') }));
vi.mock('@/i18n/common-ns', () => ({ tt: (key: string) => key }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ apiGet: state.get, apiPut: state.put }));

const clients: QueryClient[] = [];
const defaults = {
  id: 1, locationId: 33, checkinEnabled: true, checkoutEnabled: true,
  checkinItems: [] as ChecklistItem[], checkoutItems: [] as ChecklistItem[],
  checkinPhotoRequirements: [] as PhotoRequirement[], checkoutPhotoRequirements: [] as PhotoRequirement[],
  checkinInstructions: 'Use the main door.', checkoutInstructions: 'Lock the main door.',
  timeWindowSettings: { checkinWindowMinutesBefore: null as number | null, noShowGraceMinutes: null as number | null },
};
const queryKey = ['checkin-checkout-settings', 33];
function setup(overrides: Partial<typeof defaults> & { defaults?: any; override?: any; overridingKitchens?: any[] } = {}, context: Partial<ComponentProps<typeof CheckinCheckoutSettings>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  clients.push(client);
  const key = context.kitchenContext ? ['kitchen-checkin-checkout-settings', context.kitchenContext.id] : queryKey;
  let server: any = { ...defaults, ...overrides };
  state.get.mockImplementation(async () => server);
  state.put.mockImplementation(async (_url, patch) => {
    if (_url.includes('/kitchens/')) {
      const override = { ...server.override, ...patch };
      server = { ...server, ...resolveKitchenChecklist(override, server.defaults || defaults), override };
      return server;
    }
    server = { ...server, ...patch, timeWindowSettings: { ...server.timeWindowSettings, ...patch.timeWindowSettings } };
    return server;
  });
  client.setQueryData(key, server);
  const saveRef = createRef<CheckinCheckoutHandle>();
  const dirty = vi.fn();
  render(<QueryClientProvider client={client}><CheckinCheckoutSettings location={{ id: 33, name: 'Sunlight' }} saveRef={saveRef} onDirtyChange={dirty} {...context} /></QueryClientProvider>);
  return { saveRef, dirty, client, refresh: async (patch: Partial<typeof defaults>) => {
    server = { ...server, ...patch };
    await act(async () => { client.setQueryData(key, server); });
  } };
}
const changeNote = (name: 'Arrival instructions' | 'Departure instructions', value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
const changeTask = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: 'item' }), { target: { value } });
const save = async (ref: React.RefObject<CheckinCheckoutHandle>) => {
  let result: boolean | undefined;
  await act(async () => { result = await ref.current?.save(); });
  return result;
};
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });
beforeEach(() => { vi.clearAllMocks(); });

it('keeps inherited instructions read-only, customizes locally with a dirty guard, and previews this kitchen', async () => {
  const { saveRef, dirty } = setup({ defaults, override: null }, { mode: 'instructions', kitchenContext: { id: 40, name: 'Ocean kitchen' } });
  const arrival = screen.getByRole('textbox', { name: 'Arrival instructions' });
  expect(arrival).toBeDisabled();
  expect(screen.getAllByText('kitchenScope.usingDefault')).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: 'kitchenScope.customize' })[0]);
  expect(arrival).not.toBeDisabled(); expect(dirty).toHaveBeenLastCalledWith(true);
  expect(state.put).not.toHaveBeenCalled();
  changeNote('Arrival instructions', 'Only Ocean kitchen uses this door');
  expect(within(screen.getByRole('region', { name: 'At check-in (arrival)' })).getByText('Only Ocean kitchen uses this door')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Departure instructions' })).toBeDisabled();
  expect(await save(saveRef)).toBe(true);
  expect(state.put).toHaveBeenCalledExactlyOnceWith('/manager/kitchens/40/checkin-checkout-settings', { checkinInstructions: 'Only Ocean kitchen uses this door' });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  fireEvent.click(screen.getByRole('button', { name: 'kitchenScope.useDefault' }));
  expect(arrival).toHaveValue(defaults.checkinInstructions);
  expect(dirty).toHaveBeenLastCalledWith(true);
  expect(await save(saveRef)).toBe(true);
  expect(state.put).toHaveBeenLastCalledWith('/manager/kitchens/40/checkin-checkout-settings', { checkinInstructions: null });
});

it('preserves a kitchen draft across a location-default refresh and a failed save', async () => {
  const { saveRef, refresh, dirty } = setup({ defaults, override: { checkinInstructions: 'Kitchen entry' }, checkinInstructions: 'Kitchen entry' },
    { mode: 'instructions', kitchenContext: { id: 40, name: 'Ocean kitchen' } });
  changeNote('Arrival instructions', 'Keep this kitchen draft');
  await refresh({ checkoutInstructions: 'Updated location departure' });
  expect(screen.getByRole('textbox', { name: 'Arrival instructions' })).toHaveValue('Keep this kitchen draft');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Departure instructions' })).toHaveValue('Updated location departure'));
  state.put.mockRejectedValueOnce(new Error('Mock write failure'));
  expect(await save(saveRef)).toBe(false);
  expect(dirty).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('textbox', { name: 'Arrival instructions' })).toHaveValue('Keep this kitchen draft');
});

it('saves only the customized task stage and resets both arrays with its location preview', async () => {
  const task = { id: 'a', label: 'Kitchen task', required: true, category: 'general' as const };
  const original = { ...defaults, checkinItems: [{ ...task, label: 'Location task' }] };
  const { saveRef } = setup({ defaults: original, override: { checkinItems: [task], checkinPhotoRequirements: [] }, checkinItems: [task] },
    { kitchenContext: { id: 40, name: 'Ocean kitchen' } });
  expect(screen.getByText('kitchenScope.customized')).toBeVisible();
  changeTask('Changed kitchen task');
  expect(await save(saveRef)).toBe(true);
  expect(Object.keys(state.put.mock.lastCall![1]).sort()).toEqual(['checkinItems']);
  fireEvent.click(screen.getByRole('button', { name: 'kitchenScope.useDefault' }));
  expect(within(screen.getByRole('region', { name: 'At check-in (arrival)' })).getByText('Location task')).toBeVisible();
  // The task button's feedback cooldown must not swallow a guard save.
  expect(await save(saveRef)).toBe(true);
  expect(state.put).toHaveBeenLastCalledWith('/manager/kitchens/40/checkin-checkout-settings', { checkinItems: null, checkinPhotoRequirements: null });
});

it('customizes an inherited task stage, retains new rows until typed, and saves the edited values', async () => {
  const { saveRef, dirty } = setup({ defaults, override: null }, { kitchenContext: { id: 40, name: 'Ocean kitchen' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'kitchenScope.customize' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
  expect(await save(saveRef)).toBe(false);
  expect(state.put).not.toHaveBeenCalled();
  changeTask('New kitchen-only duty');
  expect(await save(saveRef)).toBe(true);
  expect(state.put).toHaveBeenCalledExactlyOnceWith('/manager/kitchens/40/checkin-checkout-settings', {
    checkinItems: [expect.objectContaining({ label: 'New kitchen-only duty' })], checkinPhotoRequirements: [],
  });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});
it('cleans the acknowledged kitchen task draft when the server fills legacy defaults', async () => {
  const legacy = { id: 'legacy', label: 'Wash sink' };
  const original = { ...defaults, checkinItems: [legacy] };
  const { saveRef, dirty } = setup({ defaults: original, override: null, checkinItems: [legacy] as ChecklistItem[] },
    { kitchenContext: { id: 40, name: 'Ocean kitchen' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'kitchenScope.customize' })[0]);
  const acknowledged = { ...defaults, defaults: original,
    checkinItems: [{ ...legacy, required: true, category: 'general' }],
    override: { checkinItems: [{ ...legacy, required: true, category: 'general' }], checkinPhotoRequirements: [] } };
  state.put.mockImplementationOnce(async () => { state.get.mockResolvedValue(acknowledged); return acknowledged; });
  expect(await save(saveRef)).toBe(true);
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});

it('blocks scope switching while dirty and lists kitchens shielded from location edits', async () => {
  setup({ defaults, override: null, overridingKitchens: [{ kitchenId: 40, name: 'Ocean kitchen', override: { checkinInstructions: 'Kitchen entry' } }] },
    { mode: 'instructions', kitchenContext: { id: 40, name: 'Ocean kitchen' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'kitchenScope.customize' })[0]);
  expect(screen.getByRole('button', { name: 'kitchenScope.editLocation' })).toBeDisabled();
  expect(screen.getByText('kitchenScope.saveBeforeScopeChange')).toBeVisible();
  expect(state.put).not.toHaveBeenCalled();
});

it('previews the selected kitchen override while editing a location default', async () => {
  const override = { checkinInstructions: 'Kitchen entry' };
  setup({ defaults, override, checkinInstructions: 'Kitchen entry', overridingKitchens: [{ kitchenId: 40, name: 'Ocean kitchen', override }] },
    { mode: 'instructions', kitchenContext: { id: 40, name: 'Ocean kitchen' } });
  state.get.mockImplementation(async (url: string) => url.includes('/kitchens/')
    ? { ...defaults, defaults, override } : { ...defaults, overridingKitchens: [{ kitchenId: 40, name: 'Ocean kitchen', override }] });
  fireEvent.click(screen.getByRole('button', { name: 'kitchenScope.editLocation' }));
  const arrival = await screen.findByRole('textbox', { name: 'Arrival instructions' });
  fireEvent.change(arrival, { target: { value: 'New location door' } });
  expect(within(screen.getByRole('region', { name: 'At check-in (arrival)' })).getByText('Kitchen entry')).toBeVisible();
  expect(screen.getByText(/kitchenScope.overridingKitchens/)).toBeVisible();
  expect(state.put).not.toHaveBeenCalled();
});

it('embeds the two instructions, timing and saved task summary with the kitchen header as sole Save owner', async () => {
  const open = vi.fn();
  const { saveRef, dirty } = setup({ checkinItems: [{ id: 'a', label: 'Saved task', required: true, category: 'general' }] }, { mode: 'instructions', onOpenTasks: open });
  const arrival = screen.getByRole('textbox', { name: 'Arrival instructions' });
  expect(arrival).toBeRequired();
  expect(arrival).toHaveAccessibleDescription(/Where to enter, how to get in if nobody is there/);
  expect(arrival).toHaveAttribute('placeholder', expect.stringMatching(/^Example:/));
  expect(screen.getByRole('textbox', { name: 'Departure instructions' })).toBeRequired();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'item' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'saveChanges', hidden: true })).not.toBeInTheDocument();
  expect(screen.getByText('Write both instructions before publishing. You can save with no customer tasks.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit customer tasks' }));
  expect(open).toHaveBeenCalledOnce();
  changeNote('Arrival instructions', 'Use the side door.');
  expect(dirty).toHaveBeenLastCalledWith(true);
  expect(state.put).not.toHaveBeenCalled();
  expect(await save(saveRef)).toBe(true);
  expect(state.put).toHaveBeenCalledExactlyOnceWith('/manager/locations/33/checkin-checkout-settings', { checkinInstructions: 'Use the side door.' });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  // A second edit saves at once; the tab has no status button whose reset could swallow it.
  changeNote('Departure instructions', 'Lock both doors.');
  expect(await save(saveRef)).toBe(true);
  expect(state.put).toHaveBeenLastCalledWith('/manager/locations/33/checkin-checkout-settings', { checkoutInstructions: 'Lock both doors.' });
});

it('saves two required instructions with zero tasks without changing saved off flags or arrays', async () => {
  const { saveRef } = setup({ checkinEnabled: false, checkoutEnabled: false, checkinInstructions: '', checkoutInstructions: '' }, { mode: 'instructions', onOpenTasks: vi.fn() });
  expect(screen.getByText('No tasks added')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add customer tasks' })).toBeInTheDocument();
  expect(screen.getByText('Write both arrival and departure instructions before saving.')).toBeInTheDocument();
  changeNote('Arrival instructions', 'Use the main door.');
  changeNote('Departure instructions', 'Lock the main door.');
  expect(state.put).not.toHaveBeenCalled();
  expect(await save(saveRef)).toBe(true);
  expect(state.put.mock.lastCall?.[1]).toEqual({ checkinInstructions: 'Use the main door.', checkoutInstructions: 'Lock the main door.' });
});

it('blocks whitespace instructions through the shell handle and retains the invalid draft', async () => {
  const { saveRef, dirty } = setup({}, { mode: 'instructions' });
  changeNote('Arrival instructions', '   ');
  expect(await save(saveRef)).toBe(false);
  expect(state.put).not.toHaveBeenCalled();
  expect(dirty).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('textbox', { name: 'Arrival instructions' })).toHaveValue('   ');
});

it('keeps the draft after a failed instruction write and returns failure to the guard', async () => {
  const { saveRef, dirty } = setup({}, { mode: 'instructions' });
  changeNote('Arrival instructions', 'Keep this draft.');
  state.put.mockRejectedValueOnce(new Error('Mock write failed'));
  expect(await save(saveRef)).toBe(false);
  expect(screen.getByRole('textbox', { name: 'Arrival instructions' })).toHaveValue('Keep this draft.');
  expect(dirty).toHaveBeenLastCalledWith(true);
});

it('places timing before preview and sends only changed timing keys', async () => {
  const { saveRef } = setup({}, { mode: 'instructions' });
  const timing = screen.getByRole('heading', { name: 'arrivalTiming' });
  const preview = screen.getByRole('heading', { name: 'What customers will see' });
  expect(timing.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'checkinOpensLabel' }), { target: { value: '22' } });
  expect(await save(saveRef)).toBe(true);
  expect(state.put.mock.lastCall?.[1]).toEqual({ timeWindowSettings: { checkinWindowMinutesBefore: 22 } });
});

it('retains the existing timing lock when location check-in is off', () => {
  setup({ checkinEnabled: false, checkoutEnabled: false }, { mode: 'instructions' });
  expect(screen.getByRole('textbox', { name: 'checkinOpensLabel' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'noShowGraceLabel' })).toBeDisabled();
  expect(screen.getByText('arrivalTimingLockedDescription')).toBeInTheDocument();
});

it('preserves new tasks from another surface while instructions are dirty', async () => {
  const { saveRef, refresh } = setup({}, { mode: 'instructions' });
  changeNote('Arrival instructions', 'Local arrival draft.');
  const newItems = [{ id: 'new', label: 'New task elsewhere', required: false, category: 'safety' }];
  await refresh({ checkinItems: newItems });
  await waitFor(() => expect(screen.getByRole('region', { name: 'At check-in (arrival)' })).toHaveTextContent('New task elsewhere'));
  expect(screen.getByRole('textbox', { name: 'Arrival instructions' })).toHaveValue('Local arrival draft.');
  expect(await save(saveRef)).toBe(true);
  expect(state.put.mock.lastCall?.[1]).toEqual({ checkinInstructions: 'Local arrival draft.' });
});

it('adopts untouched notes and timing on refresh without writing stale values', async () => {
  const { saveRef, refresh } = setup({}, { mode: 'instructions' });
  changeNote('Arrival instructions', 'Local arrival draft.');
  await refresh({ checkoutInstructions: 'New departure elsewhere.', timeWindowSettings: { checkinWindowMinutesBefore: 45, noShowGraceMinutes: 12 } });
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Departure instructions' })).toHaveValue('New departure elsewhere.'));
  expect(screen.getByRole('textbox', { name: 'checkinOpensLabel' })).toHaveValue('45');
  expect(await save(saveRef)).toBe(true);
  expect(state.put.mock.lastCall?.[1]).toEqual({ checkinInstructions: 'Local arrival draft.' });
});

it('task page has context, saved instruction preview and one reachable pinned Save only when dirty', async () => {
  const back = vi.fn();
  const { dirty } = setup({}, { kitchenContext: { id: 2, name: 'Second kitchen' }, onReturnToKitchen: back });
  expect(screen.getByRole('heading', { name: 'Customer tasks', level: 2 })).toBeInTheDocument();
  expect(screen.getByText('Second kitchen \u00b7 Sunlight')).toBeInTheDocument();
  expect(screen.getAllByText('kitchenScope.pageHelp')).toHaveLength(1);
  expect(screen.queryByRole('textbox', { name: 'Arrival instructions' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'arrivalTiming' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'saveChanges' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'saveChanges', hidden: true }).closest('[inert]')).not.toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'kitchenScope.customize' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
  changeTask('Wipe counters');
  expect(screen.getAllByRole('button', { name: 'saveChanges' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'saveChanges' }).closest('[inert]')).toBeNull();
  expect(dirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'kitchenArrivalDepartureBack' }));
  expect(back).toHaveBeenCalledOnce();
  expect(state.put).not.toHaveBeenCalled();
});

it('task edits exclude all instructions, timing and activation flags, including after a concurrent refresh', async () => {
  const { saveRef, refresh, client } = setup({ checkinItems: [{ id: 'a', label: 'Original task', required: true, category: 'general' }] });
  changeTask('Changed task');
  await refresh({ checkinInstructions: 'New arrival elsewhere.', checkoutInstructions: 'New departure elsewhere.', timeWindowSettings: { checkinWindowMinutesBefore: 7, noShowGraceMinutes: 12 } });
  expect(screen.getByRole('textbox', { name: 'item' })).toHaveValue('Changed task');
  await waitFor(() => expect(screen.getByRole('region', { name: 'At check-in (arrival)' })).toHaveTextContent('New arrival elsewhere.'));
  expect(await save(saveRef)).toBe(true);
  expect(state.put.mock.lastCall?.[1]).toEqual({ checkinItems: [{ id: 'a', label: 'Changed task', required: true, category: 'general' }], checkoutItems: [], checkinPhotoRequirements: [], checkoutPhotoRequirements: [] });
  expect(client.getQueryData(queryKey)).toMatchObject({ checkinInstructions: 'New arrival elsewhere.', timeWindowSettings: { checkinWindowMinutesBefore: 7, noShowGraceMinutes: 12 } });
});

it('saves legacy stage optionality, categories, ordering and orphan photos while editing a task', async () => {
  const checkinItems: ChecklistItem[] = [{ id: 'same', label: 'Clean counters', required: false, category: 'safety', photoRequired: false }];
  const checkoutItems: ChecklistItem[] = [{ ...checkinItems[0], required: true, category: 'cleaning', photoRequired: true }];
  const checkinPhotoRequirements = [{ id: 'same', label: 'Counter photo', required: false }, { id: 'orphan', label: 'Door photo', required: false }];
  const checkoutPhotoRequirements = [{ id: 'orphan', label: 'Door photo', required: true }];
  const { saveRef } = setup({ checkinItems, checkoutItems, checkinPhotoRequirements, checkoutPhotoRequirements });
  expect(screen.getByText(/Tasks labelled Optional were saved that way earlier/)).toBeInTheDocument();
  fireEvent.change(screen.getAllByRole('textbox', { name: 'item' })[0], { target: { value: 'Updated counters' } });
  expect(await save(saveRef)).toBe(true);
  expect(state.put.mock.lastCall?.[1]).toEqual({ checkinItems: [{ ...checkinItems[0], label: 'Updated counters' }], checkoutItems: [{ ...checkoutItems[0], label: 'Updated counters' }], checkinPhotoRequirements: [{ ...checkinPhotoRequirements[0], label: 'Updated counters' }, checkinPhotoRequirements[1]], checkoutPhotoRequirements });
});

it('filtered edits preserve hidden-stage tasks and optional flags', async () => {
  const { saveRef } = setup({ checkinItems: [{ id: 'a', label: 'Arrival task', required: false, category: 'general' }], checkoutItems: [{ id: 'b', label: 'Departure task', required: true, category: 'general' }] });
  fireEvent.click(within(screen.getByRole('group', { name: 'filterTasks' })).getByRole('button', { name: /checkIn/ }));
  changeTask('Edited arrival task');
  expect(await save(saveRef)).toBe(true);
  expect(state.put.mock.lastCall?.[1]).toMatchObject({ checkinItems: [{ id: 'a', label: 'Edited arrival task', required: false }], checkoutItems: [{ id: 'b', label: 'Departure task', required: true }] });
});

it('new tasks and photos are required in both assigned stages', async () => {
  const { saveRef } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
  changeTask('Wipe counters');
  const row = screen.getByRole('textbox', { name: 'item' }).closest('[data-checklist-index]') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: 'checkOut' }));
  fireEvent.click(within(row).getByRole('button', { name: 'photo' }));
  expect(await save(saveRef)).toBe(true);
  expect(state.put.mock.lastCall?.[1]).toMatchObject({
    checkinItems: [expect.objectContaining({ label: 'Wipe counters', required: true, photoRequired: true })],
    checkoutItems: [expect.objectContaining({ label: 'Wipe counters', required: true, photoRequired: true })],
    checkinPhotoRequirements: [expect.objectContaining({ label: 'Wipe counters', required: true })],
    checkoutPhotoRequirements: [expect.objectContaining({ label: 'Wipe counters', required: true })],
  });
});

it('blocks blank and duplicate task rows without losing drafts', async () => {
  const { saveRef } = setup({ checkinItems: [{ id: 'same', label: 'First', required: false, category: 'general' }, { id: 'same', label: 'Second', required: true, category: 'general' }] });
  fireEvent.change(screen.getAllByRole('textbox', { name: 'item' })[0], { target: { value: ' ' } });
  expect(screen.getAllByText(/Saved duties contain duplicate IDs/)[0]).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'saveChanges' })).toBeDisabled();
  expect(await save(saveRef)).toBe(false);
  expect(state.put).not.toHaveBeenCalled();
  expect(screen.getAllByRole('textbox', { name: 'item' })[0]).toHaveValue(' ');
});

it('tasks read missing hidden notes for validation but cannot write them', async () => {
  const { saveRef } = setup({ checkinInstructions: '' });
  fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
  changeTask('Clean');
  expect(screen.getByRole('button', { name: 'saveChanges' })).toBeDisabled();
  expect(screen.getAllByText('Write the arrival and departure instructions under Arrival & departure first.')[0]).toBeInTheDocument();
  expect(await save(saveRef)).toBe(false);
  expect(state.put).not.toHaveBeenCalled();
});

it('does not silently normalize mismatched legacy stage flags', async () => {
  const { saveRef } = setup({ checkinEnabled: false }, { mode: 'instructions' });
  changeNote('Arrival instructions', 'New note.');
  expect(screen.getByText(/Check-in and check-out are set up differently/)).toBeInTheDocument();
  expect(await save(saveRef)).toBe(false);
  expect(state.put).not.toHaveBeenCalled();
});

it('keeps preview editing on its own surface and never autosaves', () => {
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  setup({ checkinItems: [{ id: 'a', label: 'Task', required: true, category: 'general' }] });
  const arrival = screen.getByRole('region', { name: 'At check-in (arrival)' });
  expect(within(arrival).queryByRole('button', { name: 'Edit instructions' })).not.toBeInTheDocument();
  fireEvent.click(within(arrival).getByRole('button', { name: 'Edit tasks' }));
  expect(screen.getByRole('textbox', { name: 'item' })).toHaveFocus();
  expect(state.put).not.toHaveBeenCalled();
  scroll.mockRestore();
});

it('task Save waits for persistence, retains newer edits during the request and does not leave the guard early', async () => {
  const { saveRef, dirty } = setup({ checkinItems: [{ id: 'a', label: 'Original', required: true, category: 'general' }] });
  changeTask('Submitted');
  let finish!: (value: object) => void;
  state.put.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<boolean>;
  let resolved = false;
  act(() => { pending = saveRef.current!.save().then(result => { resolved = true; return result; }); });
  expect(screen.getByRole('button', { name: 'savingShort' })).toBeDisabled();
  expect(resolved).toBe(false);
  changeTask('Newer unsaved draft');
  await act(async () => { finish({}); expect(await pending).toBe(false); });
  expect(screen.getByRole('textbox', { name: 'item' })).toHaveValue('Newer unsaved draft');
  expect(dirty).toHaveBeenLastCalledWith(true);
});

it('failed task save retains the draft and the shell receives false', async () => {
  const { saveRef, dirty } = setup({ checkinItems: [{ id: 'a', label: 'Original', required: true, category: 'general' }] });
  changeTask('Keep this task');
  state.put.mockRejectedValueOnce(new Error('Mock failure'));
  expect(await save(saveRef)).toBe(false);
  expect(screen.getByRole('textbox', { name: 'item' })).toHaveValue('Keep this task');
  expect(dirty).toHaveBeenLastCalledWith(true);
});

it('guards browser unload only while tasks are dirty', () => {
  setup();
  let event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Add a task' })); changeTask('Clean');
  event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'discardChanges' }));
  event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
});
