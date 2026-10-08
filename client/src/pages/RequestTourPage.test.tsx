import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RequestTourPage from './RequestTourPage';
const state = vi.hoisted(() => ({ navigate: vi.fn(), hasApplication: false }));
vi.mock('wouter', () => ({ useParams: () => ({ locationId: '2' }), useLocation: () => ['/', state.navigate] }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'chef-1' }, loading: false }) }));
vi.mock('@/hooks/use-chef-kitchen-applications', () => ({ useChefKitchenApplicationForLocation: () => ({ hasApplication: state.hasApplication, isLoading: false }) }));
vi.mock('@/layouts/chef-shell-context', () => ({ useChefShellChrome: () => {} }));
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer fixture' }) }));
vi.mock('@/components/chef/ScheduleViewingWidget', () => ({ default: () => <p>Choose a new tour</p> }));
vi.mock('@/components/kitchen-application/KitchenJourneyLayout', () => ({ default: ({ title, children }: any) => <div><h1>{title}</h1>{children}</div> }));
let client: QueryClient;
beforeEach(() => {
  state.navigate.mockClear(); state.hasApplication = false;
  window.history.replaceState({}, '', '/request-tour/2?kitchenId=4');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
function mount(access: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: path.includes('request-access') ? ok : true,
    json: async () => path === '/api/public/kitchens' ? [{ id: 4, locationId: 2, name: 'Fixture kitchen' }] : access })));
  render(<QueryClientProvider client={client}><RequestTourPage /></QueryClientProvider>);
}
it.each(['pending', 'confirmed', 'ended', 'completed', 'unverified'])('opens the existing %s tour and never shows a new request form', async kind => {
  mount({ canRequest: false, reason: kind, authorization: null, tour: { id: 77, kind, scheduledAt: '2020-01-01', durationMinutes: 30 } });
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/dashboard?view=viewings&viewing=77', { replace: true }));
  expect(screen.queryByText('Choose a new tour')).not.toBeInTheDocument();
});
it('allows recovery or an admin-authorized repeat through the usual request form', async () => {
  mount({ canRequest: true, reason: null, tour: { id: 77, kind: 'completed', scheduledAt: '2020-01-01', durationMinutes: 30 },
    authorization: { id: 5, expiresAt: '2099-01-01', recovery: false } });
  expect(await screen.findByText('Choose a new tour')).toBeInTheDocument(); expect(state.navigate).not.toHaveBeenCalled();
});
it('application access still prevents the form even when an old permission is cached', async () => {
  state.hasApplication = true;
  mount({ canRequest: true, reason: null, tour: null, authorization: { id: 5, expiresAt: '2099-01-01', recovery: false } });
  expect(await screen.findByText('Your access request is underway')).toBeInTheDocument();
  expect(screen.queryByText('Choose a new tour')).not.toBeInTheDocument();
});
it('keeps the form closed when history cannot be checked', async () => {
  mount({}, false);
  expect(await screen.findByRole('button', { name: 'Check again' })).toBeInTheDocument();
  expect(screen.queryByText('Choose a new tour')).not.toBeInTheDocument();
});
