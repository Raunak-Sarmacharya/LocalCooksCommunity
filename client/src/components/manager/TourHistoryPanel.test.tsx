import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { TourHistoryPanel } from './TourHistoryPanel';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('@/i18n/manager', async () => {
  const { default: locale } = await import('../../../../shared/i18n/locales/en-CA/manager.json');
  return { mt: (key: string) => (locale as Record<string, string>)[key] || key };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TourHistoryPanel id={10} version="first" /></QueryClientProvider>);
  return { client, view };
}
it('shows recorded event chronology in Newfoundland time and refreshes after a version change', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ complete: false, events: [
    { key: '1', kind: 'requested', actor: 'chef', recordedAt: '2026-10-07T12:00:00Z' },
    { key: '2', kind: 'reschedule_proposal_accepted', actor: 'chef', recordedAt: '2026-10-07T13:00:00Z', previousScheduledAt: '2026-10-08T12:00:00Z', scheduledAt: '2026-10-09T12:00:00Z' },
    { key: '3', kind: 'attendance_assisted', actor: 'manager', recordedAt: '2026-10-07T14:00:00Z', action: 'check_in' },
    { key: '4', kind: 'status', actor: 'manager', recordedAt: '2026-10-07T15:00:00Z', status: 'cancelled', outcome: 'disrupted' },
    { key: '5', kind: 'status', actor: 'manager', recordedAt: '2026-10-07T16:00:00Z', status: 'cancelled', outcome: 'declined' },
    { key: '6', kind: 'status', actor: 'system', recordedAt: '2026-10-07T17:00:00Z' },
  ] }) }));
  vi.stubGlobal('fetch', fetcher);
  const { client, view } = mount();
  expect(await screen.findByText('Invitation accepted')).toBeInTheDocument();
  expect(screen.getByText('Some earlier activity is unavailable. Only recorded events are shown.')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Tour requested');
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('9:30 AM');
  expect(screen.getByText('Newfoundland time')).toBeInTheDocument();
  expect(screen.getByText('Arrival recorded with manager assistance')).toBeInTheDocument();
  expect(screen.getByText('Tour disruption recorded')).toBeInTheDocument();
  expect(screen.getByText('Tour request declined')).toBeInTheDocument();
  expect(screen.getByText('Tour updated')).toBeInTheDocument();
  expect(screen.queryByText(/tourHistory_status_undefined/)).not.toBeInTheDocument();
  const scroll = screen.getByRole('region', { name: 'Recorded tour activity' });
  expect(scroll).toHaveAttribute('tabindex', '0');
  expect(scroll).toHaveClass('max-h-80', 'overflow-y-auto');
  expect(scroll.querySelectorAll('details')).toHaveLength(1);
  expect(scroll.querySelector('details')).not.toHaveAttribute('open');
  expect(screen.getAllByTestId('tour-history-dot')).toHaveLength(6);
  const timestamp = scroll.querySelector('time')!;
  expect(timestamp).toHaveClass('whitespace-nowrap', 'text-right');
  expect(timestamp.parentElement).toHaveClass('grid-cols-[minmax(0,1fr)_auto]');
  expect(timestamp).toHaveAttribute('title', 'Oct 7, 2026, 9:30 AM');
  expect(fetcher).toHaveBeenCalledWith('/api/viewings/manager/10/history', { headers: { Authorization: 'Bearer fixture-token' }, cache: 'no-store' });
  view.rerender(<QueryClientProvider client={client}><TourHistoryPanel id={10} version="second" /></QueryClientProvider>);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  client.clear();
});
it('shows loading and retry on failure without claiming an empty history', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ events: [], complete: false }) });
  vi.stubGlobal('fetch', fetcher);
  const { client } = mount();
  expect(screen.getByRole('status')).toHaveTextContent('Loading tour history');
  expect(await screen.findByRole('alert')).toHaveTextContent('Tour history could not be loaded');
  expect(screen.queryByText('No recorded activity is available for this tour.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No recorded activity is available for this tour.')).toBeInTheDocument();
  client.clear();
});
