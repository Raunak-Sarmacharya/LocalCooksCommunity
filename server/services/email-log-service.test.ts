import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ lookup: vi.fn(), insert: vi.fn() }));
vi.mock('../db', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: state.lookup }) }) }),
  insert: () => ({ values: state.insert }),
} }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));
import { logOutgoingEmail, retryFailedEmail } from './email-log-service';
beforeEach(() => { vi.clearAllMocks(); });
it('preserves the actual attempt when recipient role enrichment fails', async () => {
  state.lookup.mockRejectedValue(Error('Worker checkpoint reached'));
  await logOutgoingEmail({ to: 'chef@example.test', subject: 'Tour feedback', status: 'failed',
    trackingId: 'tour-event:90:chef-email', smtpMessageId: 'fixture', errorMessage: 'SMTP acceptance is uncertain' });
  expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'chef@example.test', recipientRole: 'unknown',
    status: 'failed', trackingId: 'tour-event:90:chef-email', smtpMessageId: 'fixture', errorMessage: 'SMTP acceptance is uncertain' }));
});
it('preserves historical sent support mail when a retry is requested', async () => {
  state.lookup.mockResolvedValue([{ id: 1, recipientEmail: 'support@localcook.shop', category: 'general', status: 'sent' }]);
  await expect(retryFailedEmail(1)).resolves.toMatchObject({ success: true });
  expect(state.insert).not.toHaveBeenCalled();
});
