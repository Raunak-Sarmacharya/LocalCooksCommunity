import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocumentRenewalReview } from './DocumentRenewalReview';

afterEach(cleanup);
const renewal = { id: 3, key: 'foodSafetyLicense' as const, url: '/renewed.pdf', expiry: '2099-06-01', status: 'pending', submittedAt: '2026-10-27T15:00:00Z' };
const mount = (onReview = vi.fn(async () => {}), onView = vi.fn()) => {
  render(<DocumentRenewalReview renewal={renewal} document="Food Safety Certificate" busy={false} onView={onView} onReview={onReview} />);
  return { onReview, onView };
};

describe('manager renewal review', () => {
  it('explains that the current document stays valid and lets the manager open the renewal', () => {
    const { onView } = mount();
    expect(screen.getByText('Renewed Food Safety Certificate submitted')).toBeVisible();
    expect(screen.getByText(/New expiry date: Jun 1, 2099\. The current document stays valid until it expires/)).toBeVisible();
    expect(screen.getByText(/^Sent Oct 27, 2026 · New expiry date/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View renewal' }));
    expect(onView).toHaveBeenCalled();
  });

  it('verifies in one step', () => {
    const { onReview } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Verify new copy' }));
    expect(onReview).toHaveBeenCalledWith('approved');
  });

  it('requires a note before asking for a new copy and sends it trimmed', async () => {
    const { onReview } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for a new copy' }));
    const send = screen.getByRole('button', { name: 'Send request' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What should they fix? (required)'), { target: { value: '   ' } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What should they fix? (required)'), { target: { value: '  The expiry date is cut off.  ' } });
    fireEvent.click(send);
    await waitFor(() => expect(onReview).toHaveBeenCalledWith('rejected', 'The expiry date is cut off.'));
  });
});
