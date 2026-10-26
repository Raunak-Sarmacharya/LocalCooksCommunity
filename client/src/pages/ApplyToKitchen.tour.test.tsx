import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ next: undefined as any, error: false, loading: false, form: vi.fn(), application: null as any, navigate: vi.fn() }));
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
vi.mock('@/components/kitchen-application/RequestToCookPage', () => ({ RequestToCookPage: (props: any) => { state.form(props); return <div>Editable application form</div>; } }));
vi.mock('@/components/auth/KitchenJourneyAuth', () => ({ default: () => <div>Authentication</div>, useKitchenJourneyEmailVerified: () => true }));
vi.mock('@/layouts/chef-shell-context', () => ({ useChefShellChrome: () => true }));
vi.mock('@/layouts/ChefDashboardLayout', () => ({ default: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/components/kitchen-application/KitchenJourneyLayout', () => ({ default: ({ children }: any) => <main>{children}</main>, KitchenJourneySteps: () => null }));
vi.mock('@/components/kitchen-application/PreferredDaysPicker', () => ({ PreferredDaysPicker: () => null }));
vi.mock('@/lib/auth-intent', () => ({ saveAuthIntent: vi.fn() }));
vi.mock('@/i18n/kitchen-ns', () => ({ kt: (key: string) => key }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));
vi.mock('wouter', () => ({ useLocation: () => ['/apply-kitchen/4', state.navigate], useParams: () => ({ locationId: '4' }) }));
vi.mock('framer-motion', () => ({ motion: { div: ({ children }: any) => <div>{children}</div> } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => typeof options === 'string' ? options : options?.defaultValue || key }) }));
import ApplyToKitchen from './ApplyToKitchen';
const prefill = { intendedUse: 'Meals for catering', estimatedWeeklyHours: '5-10', hasLicense: false, targetStartDate: 'not_decided',
  chefNotes: 'Bring equipment questions', sharedManagerNotes: 'Use the shared freezer', additionalInfo: '' };
beforeEach(() => {
  state.error = false; state.loading = false; state.application = null; state.form.mockClear(); state.navigate.mockClear();
  state.next = { action: 'apply', href: '/apply-kitchen/4?tourId=83', locationId: 4, kitchenId: null, sourceTourId: 83, applicationId: null, prefill };
  window.history.replaceState({}, '', '/apply-kitchen/4?tourId=83');
  window.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });
describe('completion link resolves current authorized application state', () => {
  it('keeps tour defaults without repeating tour intake answers or notes on the request page', () => {
    render(<ApplyToKitchen />);
    expect(screen.getByText('Editable application form')).toBeInTheDocument();
    expect(state.form.mock.calls.at(-1)?.[0]).toMatchObject({ sourceTourId: 83, tourReference: prefill });
    expect(screen.queryByText('Your kitchen tour')).not.toBeInTheDocument();
    expect(screen.queryByText(prefill.chefNotes)).not.toBeInTheDocument();
    expect(screen.queryByText(prefill.sharedManagerNotes)).not.toBeInTheDocument();
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

describe('the kitchen page is the one place after Send (owner, Oct 26)', () => {
  beforeEach(() => { window.history.replaceState({}, '', '/apply-kitchen/4'); state.next = null; });
  it('sends a chef who already applied to the kitchen page with a notice, not a second form', () => {
    state.application = { id: 12, status: 'inReview', current_tier: 1 };
    render(<ApplyToKitchen />);
    expect(state.navigate).toHaveBeenCalledWith('/dashboard?view=kitchen-requests&location=4&notice=applied', { replace: true });
  });
  it('keeps the form for booking requirements still to send', () => {
    state.application = { id: 12, status: 'approved', current_tier: 1, tier1_completed_at: '2026-10-06' };
    render(<ApplyToKitchen />);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(screen.getByText('Editable application form')).toBeInTheDocument();
  });
  it('a declined request can be sent again', () => {
    state.application = { id: 12, status: 'rejected', current_tier: 1 };
    render(<ApplyToKitchen />);
    expect(state.navigate).not.toHaveBeenCalled();
  });
  it('after Send, lands on the kitchen page with the banner', () => {
    render(<ApplyToKitchen />);
    state.form.mock.calls.at(-1)?.[0].onSent();
    expect(state.navigate).toHaveBeenCalledWith('/dashboard?view=kitchen-requests&location=4&sent=1', { replace: true });
  });
});
