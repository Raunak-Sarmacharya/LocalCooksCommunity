import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ refetch: vi.fn(), token: vi.fn(async () => 'test-token'), fetch: vi.fn(), data: {
  tourOutcomeReminderMinutes: 0, historicalVisitReviewAfterHours: 48, preparationReminderHours: 24,
  arrivalReminderHours: 2, departureReminderMinutes: 30, inspectionWarningPercent: 50,
  responseWarningHours: 6, cancellationWarningHours: 6, tourPreparationMinuteOfDay: 420, tourArrivalReminderMinutes: 60, tourDepartureReminderMinutes: 10, tourPreparationEnabled: 1, tourArrivalEnabled: 1, tourDepartureEnabled: 1,
} }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mocks.data, refetch: mocks.refetch }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: mocks.token } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { LifecycleSettings } from './LifecycleSettings';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('saves edited notification leads alongside outcome settings through the existing admin endpoint', async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', mocks.fetch);
  render(<LifecycleSettings />);
  fireEvent.change(screen.getByLabelText('Arrival reminder before start'), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText('Manager inspection reminder through review window'), { target: { value: '25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save lifecycle timing' }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  const [url, request] = mocks.fetch.mock.calls[0];
  expect(url).toBe('/api/admin/lifecycle-settings');
  expect(request.method).toBe('PUT');
  expect(JSON.parse(request.body)).toMatchObject({ arrivalReminderHours: 4, preparationReminderHours: 24,
    inspectionWarningPercent: 25, tourOutcomeReminderMinutes: 0 });
});

it('saves the native Newfoundland clock, independent tour leads and disabled control', async () => {
  mocks.fetch.mockClear(); mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({}) }); vi.stubGlobal('fetch', mocks.fetch);
  render(<LifecycleSettings />);
  expect(screen.getByLabelText('Tour preparation clock in Newfoundland').getAttribute('type')).toBe('time');
  fireEvent.change(screen.getByLabelText('Tour preparation clock in Newfoundland'), { target: { value: '08:15' } });
  fireEvent.change(screen.getByLabelText('Manager tour arrival reminder before start'), { target: { value: '90' } });
  fireEvent.click(screen.getByLabelText('Tour departure reminders enabled'));
  fireEvent.click(screen.getByRole('button', { name: 'Save lifecycle timing' }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ tourPreparationMinuteOfDay: 495, tourArrivalReminderMinutes: 90, tourDepartureEnabled: 0, arrivalReminderHours: 2 });
});
