import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: null as any }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: state.user, loading: false, authPhase: 'idle' }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === '/api/user/profile' ? state.user : [{ id: 1 }], isLoading: false }) }));
vi.mock('@/components/auth/EmailVerificationGate', () => ({ default: () => null }));
vi.mock('@/components/auth/AuthLoadingScreen', () => ({ default: () => null }));
vi.mock('./ManagerOnboardingWizard', () => ({ default: ({ children }: any) => children }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/i18n/manager', () => ({ mt: (key: string) => key }));
vi.mock('wouter', () => ({ useLocation: () => ['/manager/booking/10', vi.fn()], Redirect: ({ to }: any) => <div data-testid="redirect">{to}</div> }));
import ManagerProtectedRoute from './ManagerProtectedRoute';
import { CURRENT_POLICY_VERSION } from '@/config/policy-version';
afterEach(() => { cleanup(); state.user = null; window.history.replaceState({}, '', '/'); });
describe('real manager downstream action gate', () => {
  it('preserves the logged-out review destination through login', () => {
    window.history.replaceState({}, '', '/manager/booking/10?visit=2#review');
    render(<ManagerProtectedRoute><div>Review action</div></ManagerProtectedRoute>);
    expect(screen.getByTestId('redirect').textContent).toBe('/manager/login?redirect=%2Fmanager%2Fbooking%2F10%3Fvisit%3D2%23review');
  });
  it('keeps terms and role gates while preserving the review query', () => {
    window.history.replaceState({}, '', '/manager/booking/10?visit=2#review');
    state.user = { role: 'manager', emailVerified: true, isVerified: true, termsAccepted: false };
    const { rerender } = render(<ManagerProtectedRoute><div>Review action</div></ManagerProtectedRoute>);
    expect(screen.getByTestId('redirect').textContent).toBe('/accept-terms?redirect=%2Fmanager%2Fbooking%2F10%3Fvisit%3D2%23review');
    state.user = { ...state.user, termsAccepted: true, termsVersion: CURRENT_POLICY_VERSION };
    rerender(<ManagerProtectedRoute><div>Review action</div></ManagerProtectedRoute>);
    expect(screen.getByText('Review action')).toBeVisible();
    state.user = { ...state.user, role: 'chef' };
    rerender(<ManagerProtectedRoute><div>Review action</div></ManagerProtectedRoute>);
    expect(screen.getByTestId('redirect').textContent).toBe('/');
    expect(screen.queryByText('Review action')).toBeNull();
  });
});
