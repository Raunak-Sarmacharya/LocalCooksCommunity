import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailLogSection } from './EmailLogSection';
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const row = { id: 8, recipientEmail: 'chef@example.test', recipientRole: 'chef', subject: 'Kitchen preparation',
  category: 'advance_reminder', status: 'failed', createdAt: '2026-10-04T08:00:00Z', canRetry: true,
  delivery: { source: 'booking', sourceId: 10, resource: 'kitchen-4-visit-0', channel: 'email', originalLogId: 8,
    dueAt: '2026-10-04T08:00:00Z', nextAttemptAt: '2026-10-04T08:01:00Z', attempts: 1,
    state: 'Not accepted; recovery required', destination: '/admin?section=transactions&bookingId=10',
    recovery: 'Local Cooks: verify current contact and missed response opportunity.' } };
function mount(future = false) {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/retry')
    ? { success: true, message: 'Obsolete action suppressed; no email sent.' }
    : url.includes('pending-events') ? { events: [{ source: 'booking', id: 9, reservationId: 10, dueAt: row.createdAt,
      nextAttemptAt: row.createdAt, acknowledgmentCount: 0, recoveryOwnerIds: [1], recipients: [{ recipient: row.recipientEmail, channel: 'email', acknowledged: false }], destination: row.delivery.destination }] }
    : url.includes('/stats') ? { total: 1, sent: 0, failed: 1 }
    : { logs: [{ ...row, ...(future ? { status: 'scheduled', canRetry: false, delivery: { ...row.delivery, state: 'Scheduled' } } : {}) }], total: 1 } }));
  vi.stubGlobal('fetch', fetcher);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <EmailLogSection getFirebaseToken={async () => 'test-token'} /></QueryClientProvider>);
  return fetcher;
}
it('connects failed scheduled action details to owned current source and authenticated safe recovery', async () => {
  const fetcher = mount(); await screen.findByText('Kitchen preparation');
  expect(screen.getByText(/event #9/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open current source' })).toHaveAttribute('href', row.delivery.destination);
  fireEvent.click(screen.getByRole('button', { name: 'View details' }));
  expect(await screen.findByText(/Source: booking #10/)).toBeVisible();
  expect(screen.getByText(row.delivery.recovery)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Check current action / retry original' }));
  await waitFor(() => expect(fetcher.mock.calls.some(call => call[0] === '/api/admin/email-logs/8/retry')).toBe(true));
  const recoveryCall = (fetcher.mock.calls as any[]).find(call => call[0] === '/api/admin/email-logs/8/retry');
  expect(recoveryCall[1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer test-token' } });
});
it('shows future timing and disables direct retry before due time', async () => {
  mount(true); await screen.findByText('Kitchen preparation');
  expect(screen.getByRole('button', { name: 'Retry email' })).toBeDisabled();
  expect(screen.getByText(/email · Scheduled/)).toBeVisible();
});
