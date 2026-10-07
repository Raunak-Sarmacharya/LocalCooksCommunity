import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminProtectedRoute from './admin/AdminProtectedRoute';
import AdminLogin from '@/pages/AdminLogin';
import { ViewingsDashboard } from './manager/ViewingsDashboard';
import ManagerBookingDashboard from '@/pages/ManagerBookingDashboard';
import TermsAcceptanceScreen from '@/pages/TermsAcceptanceScreen';
import { CURRENT_POLICY_VERSION } from '@/config/policy-version';
import ManagerProtectedRoute from './manager/ManagerProtectedRoute';
import { managerAuthReturn } from '@/lib/auth-return';

const state = vi.hoisted(() => ({ user: null as any }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: state.user, loading: false, refreshUserData: async () => {}, logout: vi.fn() }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'controlled-token' } } }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { clear: vi.fn() } }));
vi.mock('@/components/auth/AuthTransition', () => ({ useAuthTransition: () => ({ begin: vi.fn() }) }));
vi.mock('@/components/auth/AuthLoadingScreen', () => ({ default: () => <p>Controlled loading</p> }));
vi.mock('@/i18n/manager', () => ({ mt: (key: string) => key }));
vi.mock('@/components/ui/data-table', () => ({ DataTable: () => <p>Controlled tour table</p> }));
vi.mock('@/services/chat-service', () => ({ resolveTourConversation: vi.fn() }));
vi.mock('@/hooks/use-manager-dashboard', () => ({ useManagerDashboard: () => ({ locations: [
  { id: 11, name: 'First', address: 'First address' }, { id: 22, name: 'Exact', address: 'Exact address' }],
  kitchens: [{ id: 1, locationId: 11 }], bookings: [], isLoadingLocations: false, isLoadingKitchens: false }) }));
vi.mock('@/hooks/use-onboarding-status', () => ({ useOnboardingStatus: () => ({ setupSteps: [], missingSteps: [], improvementSteps: [], hasKitchens: true }), SETUP_STEP_WIZARD_STEP: {}, invalidateOnboardingStatus: vi.fn() }));
vi.mock('@/hooks/use-manager-getting-started', () => ({ useManagerGettingStarted: () => ({ items: [] }), invalidateGettingStarted: vi.fn() }));
vi.mock('@/components/manager/onboarding/ManagerOnboardingContext', () => ({ useManagerOnboarding: () => ({ startNewLocation: vi.fn() }) }));
vi.mock('@/layouts/DashboardLayout', () => ({ default: ({ children, selectedLocation, onLocationChange, breadcrumbs }: any) => <>
  <nav aria-label="Breadcrumbs">{breadcrumbs?.map((crumb: any, index: number) => <button key={index} onClick={crumb.onClick}>{crumb.label}</button>)}</nav>
  <output data-testid="selected-location">{selectedLocation?.id}</output>
  <button onClick={() => onLocationChange({ id: 11, name: 'First' })}>Select first location</button>{children}</> }));
vi.mock('@/components/manager/OnboardingStatusBanner', () => ({ OnboardingStatusBanner: () => null }));
vi.mock('@/pages/KitchenAvailabilityManagement', () => ({ default: () => null }));
vi.mock('@/pages/ManagerBookingsPanel', () => ({ default: () => null }));
vi.mock('@/pages/ManagerStorageBookingsPage', () => ({ default: () => null }));
vi.mock('@/pages/ManagerKitchenApplications', () => ({ ManagerKitchenApplicationsContent: () => null }));
vi.mock('@/components/dashboard/KitchenDashboardOverview', () => ({ default: () => null }));
vi.mock('@/components/manager/settings', () => ({ KitchensManagement: ({ initialKitchenId }: any) => <output data-testid="notes-kitchen">{initialKitchenId}</output> }));
vi.mock('@/components/chat/UnifiedChatView', () => ({ default: () => null }));
vi.mock('@/components/manager/ManagerProfileSettings', () => ({ default: () => null }));
vi.mock('@/components/manager/NotificationCenter', () => ({ default: () => null }));
vi.mock('@/components/legal/TermsContent', () => ({ default: () => <p>Controlled terms</p> }));
vi.mock('@/components/legal/PrivacyContent', () => ({ default: () => <p>Controlled privacy</p> }));
vi.mock('./manager/ManagerOnboardingWizard', () => ({ default: ({ children }: any) => children }));
vi.mock('wouter', async original => ({ ...await original<typeof import('wouter')>(),
  Redirect: ({ to }: { to: string }) => <output data-testid="redirect">{to}</output> }));

const clients: QueryClient[] = [];
beforeEach(() => {
  state.user = null; window.history.replaceState({}, '', '/admin?section=tour-requests&viewing=42');
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); vi.useRealTimers(); });
function client() {
  const result = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity,
    queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json() } } });
  clients.push(result);
  return result;
}

describe('Tour A coordinator exact-task review reproductions', () => {
  it.each(['/manager/tours/42', '/manager/dashboard?view=viewings&viewing=42'])('returns from tour details to the list through breadcrumbs (%s)', async path => {
    window.history.replaceState({}, '', path);
    const row = { viewing: { id: 42, locationId: 22, targetedKitchenId: 40, chefId: 8, status: 'pending',
      scheduledAt: '2099-10-07T11:30:00Z', durationMinutes: 30, updatedAt: '2026-10-05T11:00:00Z', intakeData: {} },
      locationName: 'Exact kitchen', chefName: 'Chef Sam' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () =>
      url.endsWith('/history') ? { complete: true, events: [] } : url.includes('/viewings/manager') ? [row] : { problems: [], reportingAvailable: false } })));
    render(<QueryClientProvider client={client()}><ManagerBookingDashboard /></QueryClientProvider>);
    await screen.findByRole('heading', { name: 'TOUR-42 · Chef Sam' });
    fireEvent.click(screen.getByRole('button', { name: 'kitchenTours' }));
    await screen.findByText('Controlled tour table');
    expect(window.location.pathname + window.location.search).toBe('/manager/dashboard?view=viewings');
    expect(screen.queryByRole('region', { name: 'sheetViewingDetails' })).not.toBeInTheDocument();
  });
  it('loads the dedicated manager tour route with breadcrumbs and opens the exact kitchen notes', async () => {
    window.history.replaceState({}, '', '/manager/tours/42');
    const row = { viewing: { id: 42, locationId: 22, targetedKitchenId: 40, chefId: 8, status: 'pending',
      scheduledAt: '2099-10-07T11:30:00Z', durationMinutes: 30, updatedAt: '2026-10-05T11:00:00Z', intakeData: {} },
      locationName: 'Exact kitchen', chefName: 'Chef Sam' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () =>
      url.endsWith('/history') ? { complete: true, events: [] } : url.includes('/viewings/manager') ? [row] : url.includes('/api/manager/locations/22') ? { id: 22, name: 'Exact' }
        : { problems: [], reportingAvailable: false } })));
    render(<QueryClientProvider client={client()}><ManagerBookingDashboard /></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'TOUR-42 · Chef Sam' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumbs' })).toHaveTextContent('kitchenToursTOUR-42');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Controlled tour table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tourVisitNotesButton' }));
    await waitFor(() => expect(screen.getByTestId('notes-kitchen')).toHaveTextContent('40'));
    const destination = new URL(window.location.href);
    expect(destination.pathname).toBe('/manager/dashboard');
    expect(destination.searchParams.get('view')).toBe('kitchens');
    expect(destination.searchParams.get('section')).toBe('tours');
    expect(destination.searchParams.get('focus')).toBe('tour-notes');
    expect(destination.searchParams.get('kit')).toBe('40');
    expect(screen.getByTestId('selected-location')).toHaveTextContent('22');
  });
  it('retains a dedicated manager tour route through the login return helper', () => {
    window.history.replaceState({}, '', '/manager/tours/42');
    render(<QueryClientProvider client={client()}><ManagerProtectedRoute><p>Tour page</p></ManagerProtectedRoute></QueryClientProvider>);
    const login = new URL(screen.getByTestId('redirect').textContent!, 'https://kitchen.localhost');
    expect(managerAuthReturn(login.searchParams.get('redirect'))).toBe('/manager/tours/42');
  });
  it('preserves the exact admin tour destination when login is required', () => {
    render(<QueryClientProvider client={client()}><AdminProtectedRoute><p>Authorized tour</p></AdminProtectedRoute></QueryClientProvider>);
    const destination = new URL(screen.getByTestId('redirect').textContent!, 'https://admin.localhost');
    expect(destination.pathname).toBe('/admin/login');
    expect(destination.searchParams.get('redirect')).toBe('/admin?section=tour-requests&viewing=42');
  });

  it('returns a signed-in admin from login to the preserved tour', () => {
    const path = '/admin?section=tour-requests&viewing=42';
    window.history.replaceState({}, '', `/admin/login?redirect=${encodeURIComponent(path)}`);
    state.user = { uid: 'controlled-admin', role: 'admin' };
    render(<AdminLogin />);
    expect(screen.getByTestId('redirect')).toHaveTextContent(path);
  });

  it('preserves admin section and tour through the actual terms guard', () => {
    state.user = { uid: 'controlled-admin', role: 'admin' };
    const queries = client();
    queries.setQueryData(['/api/user/profile', state.user.uid], { role: 'admin', termsAccepted: false });
    render(<QueryClientProvider client={queries}><AdminProtectedRoute><p>Authorized tour</p></AdminProtectedRoute></QueryClientProvider>);
    const destination = new URL(screen.getByTestId('redirect').textContent!, 'https://admin.localhost');
    expect(destination.pathname).toBe('/accept-terms');
    expect(destination.searchParams.get('redirect')).toBe('/admin?section=tour-requests&viewing=42');
  });

  it.each(['fresh', 'already selected', 'signed-out return'])('opens an authorized manager tour through the actual shell on %s navigation', async navigation => {
    // The actual ManagerBookingDashboard selects locations[0] then supplies its id to this consumer.
    // Mount the actual shell and consumer; mock surrounding views, layout and controlled reads.
    window.history.replaceState({}, '', '/manager/dashboard?view=viewings' + (navigation !== 'already selected' ? '&viewing=42&locationId=11' : ''));
    if (navigation === 'signed-out return') {
      const guard = render(<QueryClientProvider client={client()}><ManagerProtectedRoute><p>Authorized shell</p></ManagerProtectedRoute></QueryClientProvider>);
      const login = new URL(screen.getByTestId('redirect').textContent!, 'https://kitchen.localhost');
      expect(login.pathname).toBe('/manager/login');
      const returnPath = managerAuthReturn(login.searchParams.get('redirect'));
      expect(returnPath).toBe('/manager/dashboard?view=viewings&viewing=42&locationId=11');
      guard.unmount(); window.history.replaceState({}, '', returnPath);
    }
    const row = (id: number, locationId: number) => ({ viewing: { id, locationId, chefId: 8, status: 'pending',
      scheduledAt: '2099-10-07T11:30:00Z', durationMinutes: 30, updatedAt: '2026-10-05T11:00:00Z',
      createdAt: '2026-10-05T10:00:00Z', intakeData: {}, adminReviewDecision: 'approved', requestedRescheduleAt: null },
      locationName: `Controlled location ${locationId}`, chefName: 'Controlled chef' });
    const first = row(7, 11), exact = row(42, 22);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () =>
      url.endsWith('/history') ? { complete: true, events: [] } : url.includes('/attendance') ? { viewingId: 42, checkedInAt: null, checkedOutAt: null, canAssistArrival: false, canAssistDeparture: false,
        checkInOpensAt: '2099-10-07T11:15:00Z', checkInClosesAt: '2099-10-07T12:00:00Z', attendanceHistory: [] }
        : url.includes('locationId=11') ? [first] : url.includes('locationId=22') ? [exact] : url.includes('/viewings/manager') ? [first, exact]
        : url.includes('/api/manager/locations') ? [{ id: 11, name: 'First' }, { id: 22, name: 'Exact' }]
        : { problems: [], reportingAvailable: false } })));
    const queries = client();
    render(<QueryClientProvider client={queries}><ManagerBookingDashboard /></QueryClientProvider>);
    if (navigation === 'already selected') {
      await waitFor(() => expect(screen.getByTestId('selected-location')).toHaveTextContent('11'));
      window.history.pushState({}, '', '/manager/dashboard?view=viewings&viewing=42');
      fireEvent(window, new PopStateEvent('popstate'));
    }
    expect(await screen.findByRole('region', { name: 'sheetViewingDetails' })).toHaveTextContent('TOUR-42');
    await waitFor(() => expect(screen.getByTestId('selected-location')).toHaveTextContent('22'));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/viewings/manager?locationId=22'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select first location', hidden: true }));
    await waitFor(() => expect(screen.getByTestId('selected-location')).toHaveTextContent('11'));
  });

  it.each(['unavailable', 'denied'])('retains shell scope and shows retry for an exact tour that is %s', problem => {
    window.history.replaceState({}, '', '/manager/dashboard?view=viewings&viewing=99&locationId=22');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: problem !== 'denied' || url !== '/api/viewings/manager', json: async () =>
      url.includes('/api/viewings/manager') ? [] : url.includes('/api/manager/locations') ? [{ id: 11 }, { id: 22 }]
        : { problems: [], reportingAvailable: false } })));
    render(<QueryClientProvider client={client()}><ManagerBookingDashboard /></QueryClientProvider>);
    return waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('This tour is unavailable.');
      expect(screen.getByTestId('selected-location')).toHaveTextContent('11');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
  });

  it.each(['https://evil.test/admin', '//evil.test/admin', '/manager/dashboard', '/admin/login', '/admin%5clogin'])('rejects unsafe or wrong-role admin return %s', path => {
    window.history.replaceState({}, '', `/admin/login?redirect=${encodeURIComponent(path)}`);
    state.user = { uid: 'controlled-admin', role: 'admin' }; render(<AdminLogin />);
    expect(screen.getByTestId('redirect')).toHaveTextContent('/admin');
    expect(screen.getByTestId('redirect').textContent).toBe('/admin');
  });

  it('completes actual terms acceptance and returns to the exact admin tour', async () => {
    const path = '/admin?section=tour-requests&viewing=42';
    window.history.replaceState({}, '', `/accept-terms?redirect=${encodeURIComponent(path)}`);
    state.user = { uid: 'controlled-admin', role: 'admin', termsAccepted: false };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    const queries = client(); queries.setQueryData(['/api/user/profile', state.user.uid], { role: 'admin', termsAccepted: false });
    render(<QueryClientProvider client={queries}><TermsAcceptanceScreen /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Skip to the end' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Agree & continue' }));
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe(path), { timeout: 2000 });
    expect(queries.getQueryData<any>(['/api/user/profile', state.user.uid])).toMatchObject({ termsAccepted: true, termsVersion: CURRENT_POLICY_VERSION });
    expect(fetch).toHaveBeenCalledWith('/api/user/accept-terms', expect.objectContaining({ method: 'POST' }));
  });
});
