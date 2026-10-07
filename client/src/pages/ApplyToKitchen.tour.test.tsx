import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ next: undefined as any, error: false, loading: false, form: vi.fn(), application: null as any }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'fixture-chef', emailVerified: true }, loading: false }) }));
vi.mock('@/hooks/use-chef-kitchen-applications', () => ({
  useGlobalMyApplications: () => ({ applications: [] }),
  useChefKitchenApplicationForLocation: () => ({ application: state.application, hasApplication: !!state.application, isLoading: false, refetch: vi.fn() }),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: any) => queryKey.includes('application-next-step')
  ? { data: state.next, isError: state.error, isLoading: state.loading, refetch: vi.fn() }
  : queryKey.includes('/api/public/kitchens') ? { data: [], isLoading: false }
  : { data: { id: 4, name: 'Fixture location' }, isLoading: false } }));
vi.mock('@/components/kitchen-application/KitchenApplicationForm', () => ({ default: (props: any) => { state.form(props); return <div>Editable application form</div>; } }));
vi.mock('@/components/auth/KitchenJourneyAuth', () => ({ default: () => <div>Authentication</div>, useKitchenJourneyEmailVerified: () => true }));
vi.mock('@/layouts/chef-shell-context', () => ({ useChefShellChrome: () => true }));
vi.mock('@/layouts/ChefDashboardLayout', () => ({ default: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/components/kitchen-application/KitchenJourneyLayout', () => ({ default: ({ children }: any) => <main>{children}</main>, KitchenJourneySteps: () => null }));
vi.mock('@/components/kitchen-application/KitchenBookingPreferencesPanel', () => ({ KitchenBookingPreferencesPanel: () => null }));
vi.mock('@/lib/auth-intent', () => ({ saveAuthIntent: vi.fn() }));
vi.mock('@/i18n/kitchen-ns', () => ({ kt: (key: string) => key }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));
vi.mock('wouter', () => ({ useLocation: () => ['/apply-kitchen/4', vi.fn()], useParams: () => ({ locationId: '4' }) }));
vi.mock('framer-motion', () => ({ motion: { div: ({ children }: any) => <div>{children}</div> } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => typeof options === 'string' ? options : options?.defaultValue || key }) }));
import ApplyToKitchen from './ApplyToKitchen';
const prefill = { intendedUse: 'Meals for catering', estimatedWeeklyHours: '5-10', hasLicense: false, targetStartDate: 'not_decided',
  chefNotes: 'Bring equipment questions', sharedManagerNotes: 'Use the shared freezer', additionalInfo: '' };
beforeEach(() => {
  state.error = false; state.loading = false; state.application = null; state.form.mockClear();
  state.next = { action: 'apply', href: '/apply-kitchen/4?tourId=83', locationId: 4, kitchenId: null, sourceTourId: 83, applicationId: null, prefill };
  window.history.replaceState({}, '', '/apply-kitchen/4?tourId=83');
  window.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });
describe('completion link resolves current authorized application state', () => {
  it('passes intended use to editable defaults and labels all other answers as reference', () => {
    render(<ApplyToKitchen />);
    expect(screen.getByText('Editable application form')).toBeInTheDocument();
    expect(state.form.mock.calls.at(-1)?.[0]).toMatchObject({ sourceTourId: 83, tourReference: prefill });
    expect(screen.getByText('5-10 hours per week')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument(); expect(screen.getByText('Not decided yet')).toBeInTheDocument();
    expect(screen.getByText('Shared visit notes')).toBeInTheDocument();
  });
  it.each(['view', 'continue'])('routes an existing application to %s without attaching new source credit', action => {
    state.next = { ...state.next, action, applicationId: 12 };
    state.application = { id: 12, status: 'approved', current_tier: action === 'view' ? 3 : 1, tier1_completed_at: '2026-10-06' };
    render(<ApplyToKitchen />);
    if (action === 'view') expect(screen.getByRole('button', { name: 'View my applications' })).toBeInTheDocument();
    else expect(state.form.mock.calls.at(-1)?.[0].sourceTourId).toBeUndefined();
  });
  it.each(['unavailable', 'wrong_location', 'invalid_tour', 'resolver_failure'])('blocks the form for %s rather than allowing an unguarded new application', issue => {
    if (issue === 'unavailable') state.next.action = 'unavailable';
    if (issue === 'wrong_location') state.next.locationId = 5;
    if (issue === 'invalid_tour') window.history.replaceState({}, '', '/apply-kitchen/4?tourId=bad');
    if (issue === 'resolver_failure') { state.error = true; state.next = undefined; }
    render(<ApplyToKitchen />);
    expect(screen.queryByText('Editable application form')).not.toBeInTheDocument();
    expect(screen.getByText('This tour’s application next step is unavailable')).toBeInTheDocument();
  });
  it('waits for the current-state check before showing application controls', () => {
    state.loading = true; state.next = undefined; render(<ApplyToKitchen />);
    expect(screen.queryByText('Editable application form')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Checking your kitchen application' })).toBeInTheDocument();
  });
  it('reuses the latest completed tour reference from a generic apply button too', () => {
    window.history.replaceState({}, '', '/apply-kitchen/4');
    render(<ApplyToKitchen />);
    expect(state.form.mock.calls.at(-1)?.[0]).toMatchObject({ sourceTourId: 83, tourReference: prefill });
  });
  it('allows the ordinary application workflow when no completed tour exists', () => {
    window.history.replaceState({}, '', '/apply-kitchen/4'); state.next = null;
    render(<ApplyToKitchen />);
    expect(screen.getByText('Editable application form')).toBeInTheDocument();
    expect(state.form.mock.calls.at(-1)?.[0].sourceTourId).toBeUndefined();
  });
});
