import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AccessRequestsList, type CustomerInvite } from './AccessRequestsList';
afterEach(cleanup);
const invite = (id: number, fullName: string, status: string): CustomerInvite => ({ id, locationId: 1, locationName: 'Harbour', email: `${id}@example.invalid`, fullName, status,
  sentAt: '2026-10-14T12:00:00Z', expiresAt: '2026-10-28T12:00:00Z' });

it('an expired customer link shows Resend but no Withdraw; an open one keeps both (owner Oct 28)', () => {
  render(<AccessRequestsList applications={[]} invites={[invite(1, 'Old Link', 'expired'), invite(2, 'Open Link', 'sent')]} unreadCounts={{}}
    onOpen={vi.fn()} onOpenRequirements={vi.fn()} onResend={vi.fn()} onWithdraw={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: /Waiting on customer/ }));
  const [expired, open] = within(screen.getByRole('list', { name: 'Invited' })).getAllByRole('listitem');
  expect(expired).toHaveTextContent('Invitation expired');
  expect(within(expired).queryByRole('button', { name: 'Withdraw' })).toBeNull();
  expect(within(expired).getByRole('button', { name: 'Resend' })).toBeInTheDocument();
  expect(within(open).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
});
