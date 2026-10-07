import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TourFunnel } from './TourFunnel';
import { buildTourFunnel, tourFunnelRange } from '@shared/tour-funnel';
import locale from '../../../../shared/i18n/locales/en-CA/common.json';
const mocks = vi.hoisted(() => ({ person: { uid: 'manager-one', getIdToken: vi.fn(async () => 'fixture-token') } }));
vi.mock('@/lib/firebase', () => ({ auth: { get currentUser() { return mocks.person; } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => (locale as Record<string, string>)[key] || key }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); mocks.person.uid = 'manager-one'; });
const empty = () => buildTourFunnel({ tours: [], events: [], applications: [], bookings: [], range: tourFunnelRange() });
function mount(locationId = 20) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = <QueryClientProvider client={client}><TourFunnel role="manager" locationId={locationId} /></QueryClientProvider>;
  return { client, ...render(element) };
}
describe('scoped tour funnel', () => {
  it('requests the selected location cohort and shows fact-based counts and empty denominators', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => empty() }));
    vi.stubGlobal('fetch', fetcher); const { client } = mount();
    await screen.findAllByText('No eligible journeys');
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, any];
    expect(url).toContain('/api/viewings/funnel?from='); expect(url).toContain('locationId=20');
    expect(options).toMatchObject({ credentials: 'include', headers: { Authorization: 'Bearer fixture-token' } });
    expect(screen.getByText('Applications predating first request')).toBeInTheDocument();
    expect(screen.getByText('Recorded results / elapsed confirmed kitchen tours')).toBeInTheDocument();
    expect(client.getQueryCache().getAll()[0].queryKey).toContain('manager-one');
    client.clear();
  });
  it('updates inclusive cohort dates only after the user submits', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => empty() }));
    vi.stubGlobal('fetch', fetcher); const { client } = mount();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('First request from'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-09-10' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls[1][0]).toContain('from=2026-09-01&to=2026-09-10'); client.clear();
  });
  it('retains the current report for an invalid range without requesting it', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => empty() }));
    vi.stubGlobal('fetch', fetcher); const { client } = mount();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('First request from'), { target: { value: '2020-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose up to 366'); expect(fetcher).toHaveBeenCalledTimes(1); client.clear();
  });
  it('offers a retry without displaying stale fabricated metrics after an error', async () => {
    const fetcher = vi.fn(async () => ({ ok: false })); vi.stubGlobal('fetch', fetcher); const { client } = mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load tour conversion');
    expect(screen.queryByText('Applied after tour')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); client.clear();
  });
});
