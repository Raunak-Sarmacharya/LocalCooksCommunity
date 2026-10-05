import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: null as any }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: state.user, loading: false }) }));
vi.mock('@/components/auth/EmailVerificationGate', () => ({ default: () => null }));
vi.mock('@/components/auth/AuthLoadingScreen', () => ({ default: () => null }));
vi.mock('wouter', () => ({ Route: ({ children }: any) => children, Redirect: ({ to }: any) => <div data-testid="redirect">{to}</div> }));
import { ProtectedRoute } from './protected-route';
import { CURRENT_POLICY_VERSION } from '@/config/policy-version';
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); state.user = null; });
describe('real chef route login and terms handoff', () => {
  it('keeps the complete visit/review destination for a logged-out arrival', () => {
    window.history.replaceState({}, '', '/booking/10?visit=2#checkout');
    render(<ProtectedRoute path="/booking/:id" component={() => <div>Visit details</div>} />);
    expect(screen.getByTestId('redirect').textContent).toBe('/auth?redirect=%2Fbooking%2F10%3Fvisit%3D2%23checkout');
    expect(screen.queryByText('Visit details')).toBeNull();
  });
  it('preserves action context through terms, then renders the existing detail consumer', () => {
    window.history.replaceState({}, '', '/booking/10?visit=2#checkout');
    state.user = { role: 'chef', emailVerified: true, isVerified: true, termsAccepted: false };
    const { rerender } = render(<ProtectedRoute path="/booking/:id" component={() => <div>Visit details</div>} />);
    expect(screen.getByTestId('redirect').textContent).toBe('/accept-terms?redirect=%2Fbooking%2F10%3Fvisit%3D2%23checkout');
    state.user = { ...state.user, termsAccepted: true, termsVersion: CURRENT_POLICY_VERSION };
    rerender(<ProtectedRoute path="/booking/:id" component={() => <div>Visit details</div>} />);
    expect(screen.getByText('Visit details')).toBeVisible();
  });
});
