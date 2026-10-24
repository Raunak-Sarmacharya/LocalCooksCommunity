import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ refetch: vi.fn(), token: vi.fn(async () => 'test-token'), fetch: vi.fn(), data: {
  serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, historicalVisitReviewAfterHours: 48, preparationReminderHours: 24,
  arrivalReminderHours: 2, departureReminderMinutes: 30, managerNoCheckinMinutes: 15, inspectionWarningPercent: 50,
  managerResponseBufferHours: 1, managerDecisionFirstReminderHours: 12, managerDecisionFinalReminderHours: 2,
  responseWarningHours: 6, cancellationWarningHours: 6, tourArrivalReminderMinutes: 120, tourArrivalEnabled: 1,
} }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mocks.data, refetch: mocks.refetch }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: mocks.token } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The popover calendar's month navigation would tie these assertions to the day the suite runs.
vi.mock('@/components/ui/date-field', () => ({ DateField: ({ id, value, onChange, disabled }: any) => <input id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /> }));
import { LifecycleSettings } from './LifecycleSettings';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('saves edited notification leads alongside outcome settings through the existing admin endpoint', async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', mocks.fetch);
  render(<LifecycleSettings />);
  expect(screen.getByText(/Kitchens get.*15 minutes after the booked start/)).toBeInTheDocument();
  expect(screen.getByText('Alerts already scheduled keep their time.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Arrival reminder before start'), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText('Manager inspection reminder through review window'), { target: { value: '25' } });
  fireEvent.change(screen.getByLabelText('Requests expire this long before the start'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save lifecycle timing' }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  const [url, request] = mocks.fetch.mock.calls[0];
  expect(url).toBe('/api/admin/lifecycle-settings');
  expect(request.method).toBe('PUT');
  expect(JSON.parse(request.body)).toMatchObject({ arrivalReminderHours: 4, preparationReminderHours: 24,
    inspectionWarningPercent: 25, managerResponseBufferHours: 2, managerDecisionFirstReminderHours: 12, managerDecisionFinalReminderHours: 2 });
});

it('saves the tour reminder lead and its on/off control', async () => {
  mocks.fetch.mockClear(); mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({}) }); vi.stubGlobal('fetch', mocks.fetch);
  render(<LifecycleSettings />);
  fireEvent.change(screen.getByLabelText('Tour reminder before start'), { target: { value: '90' } });
  fireEvent.click(screen.getByLabelText('Tour reminders enabled'));
  fireEvent.click(screen.getByRole('button', { name: 'Save lifecycle timing' }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ tourArrivalReminderMinutes: 90, tourArrivalEnabled: 0, arrivalReminderHours: 2 });
});

it('saves the closeout notification start as an exact instant through its own endpoint', async () => {
  mocks.fetch.mockClear(); mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({}) }); vi.stubGlobal('fetch', mocks.fetch);
  render(<LifecycleSettings />);
  expect(screen.getByRole('button', { name: 'Save notification start' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByRole('textbox', { name: 'Visit finished and inspection closed notices start' }), { target: { value: '2026-10-14' } });
  fireEvent.click(screen.getByRole('combobox', { name: 'Visit finished and inspection closed notices start' }));
  fireEvent.click(screen.getByRole('option', { name: '9:30 a.m.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save notification start' }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  const [url, request] = mocks.fetch.mock.calls[0];
  expect(url).toBe('/api/admin/closeout-notifications-from');
  expect(request.method).toBe('PUT');
  expect(JSON.parse(request.body)).toEqual({ closeoutNotificationsFrom: new Date('2026-10-14T09:30').toISOString() });
});
