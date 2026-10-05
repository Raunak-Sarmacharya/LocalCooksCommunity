import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminTourRequestsSection } from './admin/sections/AdminTourRequestsSection';
import { ViewingsDashboard } from './manager/ViewingsDashboard';
import ChefViewingsList from './chef/ChefViewingsList';
import { tourNextAction } from '@/lib/manager-overview-lifecycle';
import { authReturn, managerAuthReturn } from '@/lib/auth-return';
import { postTermsRedirect } from '@/lib/post-terms-redirect';
import { resolveNotificationHref } from '@shared/notification-deep-links';

vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'fixture-chef' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/i18n/manager', () => ({ mt: (key: string) => key }));
vi.mock('react-i18next', async original => ({ ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, fallback?: any) => typeof fallback === 'string' ? fallback : key }) }));
vi.mock('./admin/HistoricalVisitReviews', () => ({ HistoricalVisitReviews: () => null }));
const chat = vi.hoisted(() => ({ resolve: vi.fn(async () => ({ path: '/dashboard?view=messages&conversation=shared-tour-thread' })) }));
vi.mock('@/services/chat-service', () => ({ resolveTourConversation: chat.resolve }));
vi.mock('@/components/ui/data-table', () => ({ DataTable: () => <p>Tour list</p> }));

const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0;
  vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
const tour = { id: 42, chefId: 8, locationId: 33, status: 'pending', scheduledAt: '2099-10-07T11:30:00Z', durationMinutes: 30,
  updatedAt: '2026-10-05T11:00:00Z', createdAt: '2026-10-05T10:00:00Z', intakeData: {}, requestedRescheduleAt: null,
  adminReviewDecision: 'approved' };
const row = { viewing: tour, locationName: 'Harbour kitchen', chefName: 'Ada Chef' };
function mount(component: JSX.Element, queryKey: string[], rows: any[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity,
    queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json() } } }); clients.push(client);
  client.setQueryData(queryKey, rows);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('delivery-status') ? []
    : url.includes('commitment-problems') ? { problems: [], reportingAvailable: false } : rows })));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
  render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
  return client;
}

describe('Tour A exact task consumers', () => {
  it('opens admin history from an old review link and retains exact return through login/terms', async () => {
    const path = '/admin?section=tour-requests&viewing=42'; window.history.replaceState({}, '', path);
    mount(<AdminTourRequestsSection />, ['/api/viewings/admin'], [row]);
    expect(await screen.findByText('TOUR-42')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History (1)' })).toHaveAttribute('data-state', 'active');
    expect(screen.queryByRole('button', { name: 'Approve for manager' })).not.toBeInTheDocument();
    expect(authReturn(path)).toBe(path); expect(postTermsRedirect({ hostname: 'admin.localhost', redirectParam: path, role: 'admin' })).toBe(path);
  });
  it('opens the exact pending manager decision, exposes shared chat, then removes attention after confirmation', async () => {
    const path = resolveNotificationHref({ role: 'manager', metadata: { viewingId: 42 } })!;
    window.history.replaceState({}, '', path);
    const client = mount(<ViewingsDashboard />, ['/api/viewings/manager'], [{ ...row, viewing: { ...tour, id: 7 } }, row]);
    expect(await screen.findByRole('region', { name: 'sheetViewingDetails' })).toHaveTextContent('TOUR-42');
    expect(screen.getByRole('button', { name: 'acceptViewing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Message chef' })).toBeInTheDocument();
    expect(tourNextAction(tour)).toBe('overviewPendingTours');
    client.setQueryData(['/api/viewings/manager'], [{ ...row, viewing: { ...tour, status: 'confirmed' } }]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'acceptViewing' })).not.toBeInTheDocument());
    expect(tourNextAction({ ...tour, status: 'confirmed' })).toBeNull();
    expect(managerAuthReturn(path)).toBe(path);
    expect(postTermsRedirect({ hostname: 'kitchen.localhost', redirectParam: path, role: 'manager' })).toBe(path);
  });
  it('opens visitor forwarding as a waiting state with chat, then the current terminal state from the same link', async () => {
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=42');
    const client = mount(<ChefViewingsList />, ['/api/viewings', 'chef', 'fixture-chef'], [row]);
    expect(await screen.findByText('Waiting for the kitchen manager to confirm your tour.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message manager' }));
    await waitFor(() => expect(chat.resolve).toHaveBeenCalledWith(42));
    await waitFor(() => expect(window.location.search).toContain('conversation=shared-tour-thread'));
    expect(tourNextAction({ ...tour, status: 'pending_local_cooks' })).toBeNull();
    client.setQueryData(['/api/viewings', 'chef', 'fixture-chef'], [{ ...row, viewing: { ...tour, status: 'cancelled', cancellationReason: 'Kitchen closed' } }]);
    expect(await screen.findByText('Kitchen closed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download confirmation' })).not.toBeInTheDocument();
  });
  it.each(['chef', 'manager', 'admin'])('reports an inaccessible %s link and provides retry without choosing another record', async role => {
    window.history.replaceState({}, '', role === 'admin' ? '/admin?section=tour-requests&viewing=99'
      : `${role === 'manager' ? '/manager' : ''}/dashboard?view=viewings&viewing=99`);
    mount(role === 'admin' ? <AdminTourRequestsSection /> : role === 'manager' ? <ViewingsDashboard /> : <ChefViewingsList />,
      role === 'admin' ? ['/api/viewings/admin'] : role === 'manager' ? ['/api/viewings/manager'] : ['/api/viewings', 'chef', 'fixture-chef'], [row]);
    expect(await screen.findByRole('alert')).toHaveTextContent('This tour is unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
