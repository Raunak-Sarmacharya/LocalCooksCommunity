vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
﻿import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
vi.mock('@/components/ui/date-field', () => ({ DateField: ({ id, value, onChange, disabled, 'aria-label': ariaLabel }: any) => <input id={id} aria-label={ariaLabel} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /> }));
import { formatTime } from '@/lib/formatters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { BookingAttendancePanel } from './BookingAttendancePanel';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const record = { bookingId: 10, status: 'confirmed', checkinStatus: 'not_checked_in', updatedAt: '2026-10-04T12:00:00Z',
  scheduledEnd: '2026-10-03T12:00:00Z', operationsComplete: true, assistanceHistory: [],
  visits: [{ id: 5, startTime: '09:00', endTime: '11:00', checkinStatus: 'not_checked_in', updatedAt: '2026-10-04T12:00:00Z', scheduledEnd: '2026-10-03T12:00:00Z', operationsComplete: true }], history: [] };
const clock = { timezone: 'America/St_Johns', visits: [{ visitId: 5, phase: 'in_booked_time', scheduledStartAt: '2026-10-03T11:30:00Z', arrivalRecorded: false, inspection: { outcome: 'not_due' } }] };
function mount(props: any = {}) {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-04T12:00:00Z'));
  const data = props.data || record;
  const fetcher = vi.fn(async (_url: string, _options: any) => ({ ok: true, json: async () => data })); vi.stubGlobal('fetch', fetcher);
  const onSaved = vi.fn(async () => {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><BookingAttendancePanel bookingId={10} manager chefName="Alex" timezone="America/St_Johns" closeout={clock as any} onSaved={onSaved} {...props} /></QueryClientProvider>);
  return { client, fetcher, onSaved };
}
const posts = (fetcher: any) => fetcher.mock.calls.filter(([, options]: any) => options?.method === 'POST');
async function open() { fireEvent.click(await screen.findByRole('button', { name: 'Fix the visit record' })); return screen.getByRole('dialog'); }

// Date + time pickers live in a group named after the field; the date half is a plain input here.
function setWhen(name: RegExp, value: string) {
  const [date, time] = value.split('T'), group = within(screen.getByRole('group', { name }));
  fireEvent.change(group.getByRole('textbox'), { target: { value: date } });
  fireEvent.click(group.getByRole('combobox'));
  fireEvent.click(screen.getByRole('option', { name: formatTime(time) }));
}

it('has one quiet entry and named choices with consequences, no duplicate inspection link', async () => {
  mount({ managerVisitHref: '/manager/booking/10/inspection' });
  const dialog = await open();
  expect(screen.queryByRole('link', { name: 'Manage visit' })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: /Alex arrived but didn’t check in/ })).toBeEnabled();
  expect(within(dialog).getByRole('button', { name: /Alex didn’t show up/ })).toBeEnabled();
  expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: /left without/ })).not.toBeInTheDocument();
});
it('requires contact and a factual 10–500 character note, then posts the chosen visit and versions', async () => {
  const { fetcher, onSaved } = mount(); await open();
  fireEvent.click(screen.getByRole('button', { name: /Alex didn’t show up/ }));
  const form = screen.getByRole('button', { name: 'Report no-show' }).closest('form')!;
  fireEvent.submit(form);
  expect(screen.getByRole('alert')).toHaveTextContent('10–500'); expect(posts(fetcher)).toHaveLength(0);
  fireEvent.click(screen.getByRole('checkbox', { name: 'I tried to reach Alex before reporting' }));
  fireEvent.change(screen.getByLabelText('Note to Alex'), { target: { value: 'We waited and called twice before reporting.' } });
  fireEvent.submit(form);
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(JSON.parse(posts(fetcher)[0][1].body)).toMatchObject({ action: 'report_no_show', visitId: 5, confirmsChefAbsent: true, expectedUpdatedAt: record.visits[0].updatedAt, expectedBookingUpdatedAt: record.updatedAt });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('makes a personal attended note optional and shows the factual default before saving', async () => {
  const { fetcher } = mount(); await open(); fireEvent.click(screen.getByRole('button', { name: /Alex did come/ }));
  expect(screen.getByLabelText('Note to Alex (optional)')).not.toBeRequired();
  expect(screen.getByText(/Without a note, we’ll share/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mark as attended' }));
  await waitFor(() => expect(posts(fetcher)).toHaveLength(1));
  expect(JSON.parse(posts(fetcher)[0][1].body).sharedMessage).toBe('The kitchen confirms that the chef attended this visit.');
});
it('opens the missed-arrival form with the scheduled start in the kitchen zone', async () => {
  const { fetcher, onSaved } = mount(); await open(); fireEvent.click(screen.getByRole('button', { name: /Alex arrived but/ }));
  const arrival = within(screen.getByRole('group', { name: /Arrival time \(Newfoundland Time\)/ }));
  expect(arrival.getByRole('textbox')).toHaveValue('2026-10-03');
  expect(arrival.getByRole('combobox')).toHaveTextContent(formatTime('09:00'));
  fireEvent.change(screen.getByLabelText('Note to Alex'), { target: { value: 'Alex arrived while their phone was offline.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save arrival time' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(posts(fetcher)[0][0]).toBe('/api/manager/bookings/10/assist-visit');
  expect(JSON.parse(posts(fetcher)[0][1].body)).toMatchObject({ action: 'arrival', visitId: 5, actualAt: '2026-10-03T09:00' });
});
it('offers departure only after recorded arrival and hides no-show for an arrived chef', async () => {
  const { fetcher } = mount({ data: { ...record, visits: [{ ...record.visits[0], checkinStatus: 'checked_in' }] } }); await open();
  expect(screen.queryByRole('button', { name: /Alex didn’t show up/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Alex left without/ }));
  setWhen(/Departure time/, '2026-10-03T11:00');
  fireEvent.change(screen.getByLabelText('Note to Alex'), { target: { value: 'Alex confirmed departure after an upload failed.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save departure time' }));
  await waitFor(() => expect(posts(fetcher)).toHaveLength(1));
  expect(JSON.parse(posts(fetcher)[0][1].body).action).toBe('departure');
});
it('hides reports before the end and assisted times after inspection closes', async () => {
  mount({ data: { ...record, scheduledEnd: '2027-10-03T12:00:00Z', visits: [] }, closeout: { ...clock, visits: [{ ...clock.visits[0], visitId: undefined, inspection: { outcome: 'manager_cleared' } }] } });
  const dialog = await open();
  expect(within(dialog).getAllByRole('button').filter(button => button.textContent?.includes('Alex'))).toHaveLength(0);
  expect(within(dialog).getByRole('button', { name: /Something else/ })).toBeEnabled();
});
it('offers undo only for a no-show and sends the optional-note default', async () => {
  const { fetcher } = mount({ data: { ...record, visits: [{ ...record.visits[0], checkinStatus: 'no_show' }] } }); await open();
  fireEvent.click(screen.getByRole('button', { name: /Undo my no-show report/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Undo no-show report' }));
  await waitFor(() => expect(posts(fetcher)).toHaveLength(1));
  expect(JSON.parse(posts(fetcher)[0][1].body)).toMatchObject({ action: 'withdraw_attendance', sharedMessage: 'The kitchen has withdrawn its no-show report.' });
});
it('keeps a no-show read-only for chefs and offers messaging and support', async () => {
  mount({ manager: false, data: { ...record, visits: [{ ...record.visits[0], checkinStatus: 'no_show' }], history: [{ id: 1, visitId: 5, action: 'report_no_show', actorRole: 'manager', sharedMessage: 'We waited and tried to call.', createdAt: '2026-10-04T12:00:00Z' }] } });
  expect(await screen.findByRole('button', { name: 'Message kitchen' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'This isn’t right: contact Local Cooks' }).getAttribute('href')).toMatch(/^mailto:support@localcooks\.ca\?subject=/);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByText('Show history')).toBeInTheDocument();
});
it('inside the booking page drops its own heading and trigger and opens from the page menu', async () => {
  const onFixOpenChange = vi.fn();
  const view = { props: { embedded: true, fixOpen: false, onFixOpenChange } };
  const { client } = mount(view.props);
  // The booking page's Now card and visit timeline carry the status; the embedded panel adds no status line.
  await waitFor(() => expect(client.getQueryState(['/api/manager/bookings/10/attendance'])?.status).toBe('success'));
  expect(screen.queryByTestId('visit-record-status')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Visit record' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Fix the visit record' })).not.toBeInTheDocument();
  expect(screen.queryByText('Newfoundland Time')).not.toBeInTheDocument();
  cleanup();
  mount({ embedded: true, fixOpen: true, onFixOpenChange });
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});
it('inside the booking page leaves Message kitchen to the page header for a disputed no-show', async () => {
  mount({ manager: false, embedded: true, data: { ...record, visits: [{ ...record.visits[0], checkinStatus: 'no_show' }], history: [{ id: 1, visitId: 5, action: 'report_no_show', actorRole: 'manager', sharedMessage: 'We waited.', createdAt: '2026-10-04T12:00:00Z' }] } });
  expect(await screen.findByRole('link', { name: 'This isn’t right: contact Local Cooks' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Message kitchen' })).not.toBeInTheDocument();
});
it('labels support actions and keeps internal notes on the admin endpoint', async () => {
  const { fetcher } = mount({ manager: false, localCooks: true });
  fireEvent.click(await screen.findByRole('button', { name: 'Fix visit record (support)' }));
  expect(screen.getByText('You’re updating this visit as Local Cooks support')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /arrived but/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Alex did come/ }));
  fireEvent.change(screen.getByLabelText('Internal note (only Local Cooks sees this)'), { target: { value: 'Confirmed with the kitchen.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mark as attended' }));
  await waitFor(() => expect(posts(fetcher)).toHaveLength(1));
  expect(posts(fetcher)[0][0]).toBe('/api/admin/bookings/10/attendance');
  expect(JSON.parse(posts(fetcher)[0][1].body).internalNotes).toBe('Confirmed with the kitchen.');
});
it.each(['pending', 'cancelled'])('hides an unused visit card for %s bookings', async status => {
  const { client } = mount({ data: { ...record, status } }); await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('heading', { name: 'Visit record' })).not.toBeInTheDocument();
});
const endedClock = { ...clock, visits: [{ ...clock.visits[0], phase: 'ended' }] };
it('says once, in plain words, that a finished visit has no check-in, and the link opens the fix dialog', async () => {
  mount({ closeout: endedClock });
  const line = await screen.findByTestId('visit-no-checkin');
  expect(line).toHaveTextContent('Alex didn’t check in. If they came, fix the visit record.');
  expect(screen.queryByText('No check-in recorded yet')).not.toBeInTheDocument();
  fireEvent.click(within(line).getByRole('button', { name: 'fix the visit record.' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});
it('leaves the chef line to the visit summary and does not show the manager line to a chef', async () => {
  mount({ closeout: endedClock, manager: false });
  await waitFor(() => expect(screen.queryByText('No check-in recorded yet')).not.toBeInTheDocument());
  expect(screen.queryByTestId('visit-no-checkin')).not.toBeInTheDocument();
  expect(screen.queryByTestId('visit-record-status')).not.toBeInTheDocument();
});
it('keeps "No check-in recorded yet" while the visit has not ended', async () => {
  mount();
  expect(await screen.findByText('No check-in recorded yet')).toBeInTheDocument();
});
it('after the booked end (booking already completed), "Record when they left" opens straight on the departure form', async () => {
  const late = { ...record, status: 'completed', visits: [{ ...record.visits[0], checkinStatus: 'checked_in' }] };
  const endedClock = { timezone: 'America/St_Johns', visits: [{ visitId: 5, phase: 'ended', scheduledStartAt: '2026-10-03T11:30:00Z', arrivalRecorded: true, inspection: { outcome: 'due' } }] };
  mount({ data: late, closeout: endedClock, fixOpen: true, onFixOpenChange: vi.fn(), fixAction: 'departure' });
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByRole('heading', { name: 'Alex left without checking out' })).toBeInTheDocument();
  // Back returns to every choice; the preset is not forced again.
  fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
  expect(within(dialog).getByRole('button', { name: /Alex left without checking out/ })).toBeInTheDocument();
});
it('does not offer a late departure once the inspection window has closed', async () => {
  const late = { ...record, status: 'completed', visits: [{ ...record.visits[0], checkinStatus: 'checked_in' }] };
  const closed = { timezone: 'America/St_Johns', visits: [{ visitId: 5, phase: 'ended', scheduledStartAt: '2026-10-03T11:30:00Z', arrivalRecorded: true, inspection: { outcome: 'auto_closed_uninspected' } }] };
  mount({ data: late, closeout: closed });
  const dialog = await open();
  expect(within(dialog).queryByRole('button', { name: /left without/ })).not.toBeInTheDocument();
});
