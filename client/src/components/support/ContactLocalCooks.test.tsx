import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key === 'supportContact' ? 'Contact Local Cooks' : 'Local Cooks support' }) }));
import { ContactLocalCooks, localCooksSupportHref } from './ContactLocalCooks';
describe('contextual contact', () => {
  it('prefills the booking, role, situation and relevant operation references', () => {
    render(<ContactLocalCooks bookingId={42} bookingReference="KB-TEST" role="manager" situation="Payout awaiting setup" claimId={8} paymentReference="pi_test" />);
    const href = screen.getByRole('link', { name: 'Contact Local Cooks' }).getAttribute('href')!;
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('subject')).toContain('KB-TEST');
    expect(params.get('body')).toBe('Role: manager\nSituation: Payout awaiting setup\nBooking: KB-TEST\nClaim: 8\nPayment: pi_test\n\n');
  });
  it('supports checkout incidents without an invented booking, and encodes reserved characters', () => {
    const href = localCooksSupportHref({ role: 'chef', checkoutReference: 'cs_original', situation: 'Refund & booking? #check' });
    expect(new URLSearchParams(href.split('?')[1]).get('body')).toBe('Role: chef\nSituation: Refund & booking? #check\nCheckout: cs_original\n\n');
    expect(href).not.toContain('KB-');
  });
});
