import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/i18n/manager', () => ({ mt: (key: string) => key }));
vi.mock('@/components/common/TruncatedText', () => ({ TruncatedText: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/booking/CancellationRefundReview', () => ({
  CancellationRefundReview: ({ open, scope }: { open: boolean; scope?: { kind: string; id: number } }) =>
    open ? <p>Quoted {scope?.kind} #{scope?.id}</p> : null,
}));
import { BookingManagementDialog } from './BookingManagementDialog';
describe('manager storage cancellation entry', () => {
  it('opens the exact-item quote from relational status even when the snapshot flag is false', () => {
    const submit = vi.fn();
    render(<BookingManagementDialog open onOpenChange={() => {}} onSubmit={submit} booking={{
      id: 10, bookingDate: '2026-11-10', startTime: '09:00', endTime: '11:00', status: 'confirmed', paymentStatus: 'paid',
      storageItems: [{ id: 77, storageBookingId: 77, name: 'Cold storage', storageType: 'cold', totalPrice: 2000,
        status: 'cancellation_requested', cancellationRequested: false }],
    }} />);
    expect(screen.getByText('Chef requested cancellation')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'accept' }));
    expect(screen.getByText('Quoted storage #77')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
});
