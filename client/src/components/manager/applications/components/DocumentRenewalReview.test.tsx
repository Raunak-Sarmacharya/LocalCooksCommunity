import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocumentRenewalReview } from './DocumentRenewalReview';

afterEach(cleanup);
const renewal = { id: 3, key: 'foodSafetyLicense' as const, url: '/renewed.pdf', expiry: '2099-06-01', status: 'pending' };
const mount = (onReview = vi.fn(async () => {}), onView = vi.fn()) => {
  render(<DocumentRenewalReview renewal={renewal} document="Food Safety Certificate" busy={false} onView={onView} onReview={onReview} />);
  return { onReview, onView };
};

describe('manager renewal review', () => {
  it('explains that the current document stays valid and lets the manager open the renewal', () => {
    const { onView } = mount();
    expect(screen.getByText('Renewed Food Safety Certificate submitted')).toBeVisible();
    expect(screen.getByText(/New expiry date: June 1, 2099\. The current document stays valid until it expires/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View renewal' }));
    expect(onView).toHaveBeenCalled();
  });

  it('approves in one step', () => {
    const { onReview } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Approve renewal' }));
    expect(onReview).toHaveBeenCalledWith('approved');
  });

  it('requires a reason before declining and sends it trimmed', async () => {
    const { onReview } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Decline renewal' }));
    const send = screen.getByRole('button', { name: 'Send reason and decline' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for the chef (required)'), { target: { value: '   ' } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for the chef (required)'), { target: { value: '  The expiry date is cut off.  ' } });
    fireEvent.click(send);
    await waitFor(() => expect(onReview).toHaveBeenCalledWith('rejected', 'The expiry date is cut off.'));
  });
});
