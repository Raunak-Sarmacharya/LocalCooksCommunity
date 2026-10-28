import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
vi.mock('./DamageClaimSheet', () => ({ DamageClaimSheet: ({ open, visitId }: { open?: boolean; visitId?: number }) => open ? <p>Claim form for visit {visitId}</p> : null }));
import { ManagerDamageClaimEntry } from './ManagerDamageClaimEntry';

it('names each day by its date and hours, not "Visit 2" (QA walk Oct 28)', () => {
  render(<ManagerDamageClaimEntry mode="secondary" open bookingId={1} chefName="Ada" visits={[
    { id: 7, visitDate: '2026-10-28', startTime: '12:30', endTime: '15:30' }, { id: 8, visitDate: '2026-10-30', startTime: '09:00', endTime: '11:00' }]} />);
  const choices = screen.getAllByRole('button').map(button => button.textContent);
  expect(choices).toHaveLength(2);
  expect(choices[0]).toMatch(/Oct 28, 2026 · 12:30\s?p\.?m\.? – 3:30\s?p\.?m\.?/i);
  expect(choices.join(' ')).not.toMatch(/Visit \d/);
});

it('goes straight to the form when only one day is left on the booking', () => {
  render(<ManagerDamageClaimEntry mode="secondary" open bookingId={1} chefName="Ada" visits={[{ id: 7, visitDate: '2026-10-28', startTime: '12:30', endTime: '15:30' }]} />);
  expect(screen.getByText('Claim form for visit 7')).toBeInTheDocument();
});
