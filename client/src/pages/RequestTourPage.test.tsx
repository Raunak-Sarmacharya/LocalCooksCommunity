import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RequestTourPage from './RequestTourPage';
const state = vi.hoisted(() => ({ navigate: vi.fn(), hasApplication: false, verified: true }));
vi.mock('wouter', () => ({ useParams: () => ({ locationId: '2' }), useLocation: () => ['/', state.navigate] }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'chef-1', isVerified: state.verified }, loading: false }) }));
vi.mock('@/hooks/use-chef-kitchen-applications', () => ({ useChefKitchenApplicationForLocation: () => ({ hasApplication: state.hasApplication, application: state.hasApplication ? { id: 12 } : null, isLoading: false }) }));
vi.mock('@/layouts/chef-shell-context', () => ({ useChefShellChrome: () => {} }));
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer fixture' }) }));
vi.mock('@/components/chef/ScheduleViewingWidget', () => ({ default: () => <p>Choose a new tour</p> }));
vi.mock('@/components/kitchen-application/KitchenJourneyLayout', () => ({ default: ({ title, children }: any) => <div><h1>{title}</h1>{children}</div> }));
let client: QueryClient;
beforeEach(() => {
  state.navigate.mockClear(); state.hasApplication = false; state.verified = true; localStorage.clear();
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
  localStorage.setItem('viewing_booking_4', JSON.stringify({ step: 'details' }));
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/dashboard?view=viewings&viewing=77&notice=already', { replace: true }));
  expect(screen.queryByText('Choose a new tour')).not.toBeInTheDocument();
  // The half-filled request is dropped, here and on the server.
  expect(localStorage.getItem('viewing_booking_4')).toBeNull();
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/viewings/tour-draft/4', expect.objectContaining({ method: 'DELETE' })));
});
it('shows the request screen to an account created on it, before its email is verified, without checking access', async () => {
  state.verified = false;
  mount({ canRequest: false, reason: 'pending', authorization: null, tour: { id: 77, kind: 'pending', scheduledAt: '2020-01-01', durationMinutes: 30 } });
  expect(await screen.findByText('Choose a new tour')).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).includes('request-access'))).toBe(false);
});
it('allows recovery or an admin-authorized repeat through the usual request form', async () => {
  mount({ canRequest: true, reason: null, tour: { id: 77, kind: 'completed', scheduledAt: '2020-01-01', durationMinutes: 30 },
    authorization: { id: 5, expiresAt: '2099-01-01', recovery: false } });
  expect(await screen.findByText('Choose a new tour')).toBeInTheDocument(); expect(state.navigate).not.toHaveBeenCalled();
});
it('an application here opens it with a notice, even when an old permission is cached, and drops the half-filled request', async () => {
  state.hasApplication = true;
  localStorage.setItem('viewing_booking_4', JSON.stringify({ step: 'details' }));
  mount({ canRequest: true, reason: null, tour: null, authorization: { id: 5, expiresAt: '2099-01-01', recovery: false } });
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/dashboard?view=kitchen-requests&application=12&notice=tour', { replace: true }));
  expect(screen.queryByText('Choose a new tour')).not.toBeInTheDocument();
  expect(localStorage.getItem('viewing_booking_4')).toBeNull();
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/viewings/tour-draft/4', expect.objectContaining({ method: 'DELETE' })));
});
it('an application wins over an older tour at the same kitchen', async () => {
  state.hasApplication = true;
  mount({ canRequest: false, reason: 'application', authorization: null, tour: { id: 77, kind: 'completed', scheduledAt: '2020-01-01', durationMinutes: 30 } });
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/dashboard?view=kitchen-requests&application=12&notice=tour', { replace: true }));
  expect(state.navigate).not.toHaveBeenCalledWith(expect.stringContaining('viewing=77'), expect.anything());
});
it('kitchen access without an application goes to the kitchen page to book', async () => {
  mount({ canRequest: false, reason: 'application', authorization: null, tour: null });
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/kitchen-preview/2', { replace: true }));
  expect(screen.queryByText('Choose a new tour')).not.toBeInTheDocument();
});
it('keeps the form closed when history cannot be checked', async () => {
  mount({}, false);
  expect(await screen.findByRole('button', { name: 'Check again' })).toBeInTheDocument();
  expect(screen.queryByText('Choose a new tour')).not.toBeInTheDocument();
});
