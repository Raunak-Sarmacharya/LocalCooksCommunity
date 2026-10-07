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
  useTranslation: () => ({ t: (key: string, fallback?: any) => typeof fallback === 'string' ? fallback : fallback?.defaultValue?.replace('{{hours}}', fallback.hours) || key }) }));
vi.mock('./admin/HistoricalVisitReviews', () => ({ HistoricalVisitReviews: () => null }));
const chat = vi.hoisted(() => ({ resolve: vi.fn(async () => ({ conversationId: 'shared-tour-thread', chefId: 8, managerId: 12, chefName: 'Ada Chef', managerName: 'Morgan Lee' })) }));
vi.mock('@/services/chat-service', () => ({ resolveTourConversation: chat.resolve }));
vi.mock('./chat/UnifiedChatView', () => ({ default: (props: any) => <div data-testid="specific-chat">{JSON.stringify(props)}</div> }));
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
  it('shows the current manager contact on an unreviewed admin request', async () => {
    mount(<AdminTourRequestsSection />, ['/api/viewings/admin'], [{ ...row,
      viewing: { ...tour, status: 'pending_local_cooks', adminReviewDecision: null },
      managerId: 19, managerName: 'Current Manager', managerEmail: 'current-manager@example.com', managerPhone: '+17095550123' }]);
    const contact = await screen.findByRole('region', { name: 'Kitchen manager' });
    expect(contact).toHaveTextContent('Current Manager');
    expect(screen.getByRole('link', { name: 'current-manager@example.com' })).toHaveAttribute('href', 'mailto:current-manager@example.com');
    expect(screen.getByRole('link', { name: '+17095550123' })).toHaveAttribute('href', 'tel:+17095550123');
    expect(screen.getByRole('button', { name: 'Approve for manager' })).toBeInTheDocument();
  });
  it.each([null, 19])('explains missing manager contact with assignment %s', async managerId => {
    window.history.replaceState({}, '', '/admin?section=tour-requests&viewing=42');
    mount(<AdminTourRequestsSection />, ['/api/viewings/admin'], [{ ...row,
      managerId, managerName: managerId ? 'Current Manager' : null, managerEmail: null, managerPhone: null }]);
    expect(await screen.findByRole('region', { name: 'Kitchen manager' })).toHaveTextContent(
      managerId ? 'Manager contact details are unavailable' : 'No manager assigned');
    expect(screen.queryByRole('link', { name: /manager@example/ })).not.toBeInTheDocument();
  });
  it.each(['chef', 'manager'])('opens the exact %s chat modal from an email and preserves the tour page through login', async role => {
    vi.clearAllMocks();
    const path = `${role === 'manager' ? '/manager' : ''}/dashboard?view=viewings&viewing=42&action=message`;
    window.history.replaceState({}, '', path);
    mount(role === 'manager' ? <ViewingsDashboard /> : <ChefViewingsList />,
      role === 'manager' ? ['/api/viewings/manager'] : ['/api/viewings', 'chef', 'fixture-chef'],
      [{ ...row, viewing: { ...tour, id: 7 } }, { ...row, viewing: { ...tour, status: 'confirmed' } }]);
    expect(await screen.findByRole('dialog')).toHaveAccessibleName(`Chat with ${role === 'manager' ? 'Ada Chef' : 'Morgan Lee'}`);
    expect(screen.getByTestId('specific-chat')).toHaveTextContent('shared-tour-thread');
    expect(chat.resolve.mock.calls).toEqual([[42]]);
    expect(window.location.pathname + window.location.search).toBe(path);
    expect(role === 'manager' ? managerAuthReturn(path) : authReturn(path)).toBe(path);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.pathname + window.location.search).toBe(path);
  });
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
    expect(await screen.findByText('Your tour request is pending. We’ll notify you when it’s confirmed or declined.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message manager' }));
    await waitFor(() => expect(chat.resolve).toHaveBeenCalledWith(42));
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Chat with Morgan Lee');
    expect(screen.getByTestId('specific-chat')).toHaveTextContent('shared-tour-thread');
    expect(window.location.search).toBe('?view=viewings&viewing=42');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
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


describe('saved tour intake in every role', () => {
  it.each(['admin', 'manager', 'chef'])('shows all four saved answers and an explicit No to %s', async role => {
    window.history.replaceState({}, '', role === 'admin' ? '/admin?section=tour-requests&viewing=42'
      : `${role === 'manager' ? '/manager' : ''}/dashboard?view=viewings&viewing=42`);
    mount(role === 'admin' ? <AdminTourRequestsSection /> : role === 'manager' ? <ViewingsDashboard /> : <ChefViewingsList />,
      role === 'admin' ? ['/api/viewings/admin'] : role === 'manager' ? ['/api/viewings/manager'] : ['/api/viewings', 'chef', 'fixture-chef'],
      [{ ...row, viewing: { ...tour, intakeData: { intendedUse: 'Weekly meal preparation', estimatedWeeklyHours: '12-16', hasLicense: false, targetStartDate: '2099-11-01' } } }]);
    expect(await screen.findByText('Weekly meal preparation')).toBeInTheDocument();
    if (role === 'chef') fireEvent.click(screen.getByText('Notes and updates'));
    expect(screen.getByText('Intended use')).toBeVisible();
    expect(screen.getByText('12-16 hours per week')).toBeVisible();
    expect(screen.getByText('Food handler licence')).toBeVisible();
    expect(screen.getByText('No', { exact: true })).toBeVisible();
    expect(screen.getByText('2099-11-01', { exact: true })).toBeVisible();
  });
  it.each(['admin', 'manager', 'chef'])('shows Not decided for %s without inventing missing legacy answers', async role => {
    window.history.replaceState({}, '', role === 'admin' ? '/admin?section=tour-requests&viewing=42'
      : `${role === 'manager' ? '/manager' : ''}/dashboard?view=viewings&viewing=42`);
    const client = mount(role === 'admin' ? <AdminTourRequestsSection /> : role === 'manager' ? <ViewingsDashboard /> : <ChefViewingsList />,
      role === 'admin' ? ['/api/viewings/admin'] : role === 'manager' ? ['/api/viewings/manager'] : ['/api/viewings', 'chef', 'fixture-chef'],
      [{ ...row, viewing: { ...tour, intakeData: { targetStartDate: 'not_decided' } } }]);
    expect(await screen.findByText('Not decided yet', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('No', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Food handler licence')).not.toBeInTheDocument();
    client.setQueryData(role === 'admin' ? ['/api/viewings/admin'] : role === 'manager' ? ['/api/viewings/manager'] : ['/api/viewings', 'chef', 'fixture-chef'], [row]);
    await waitFor(() => expect(screen.queryByText('Target start date')).not.toBeInTheDocument());
    expect(screen.queryByText('No', { exact: true })).not.toBeInTheDocument();
  });
});
