import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const smtp = vi.hoisted(() => ({ send: vi.fn(), log: vi.fn(), close: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp.send, close: smtp.close }) } }));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./services/email-log-service', async original => ({ ...await original<typeof import('./services/email-log-service')>(), logOutgoingEmail: smtp.log }));
vi.mock('./db', () => ({ db: {} }));
import { sendEmail } from './email';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '0');
  vi.stubEnv('EMAIL_USER', 'fixture@example.test'); vi.stubEnv('EMAIL_PASS', 'isolated-test-value');
});
afterEach(() => vi.unstubAllEnvs());
describe('ordinary SMTP acknowledgment', () => {
  it('keeps an ordinary failed tracking key retryable and deduplicates only accepted sends per recipient', async () => {
    smtp.send.mockRejectedValueOnce(Error('temporary SMTP failure')).mockRejectedValueOnce(Error('temporary SMTP failure')).mockResolvedValue({ accepted: ['chef@example.test'], rejected: [], messageId: 'fixture' });
    const content = { to: 'chef@example.test', subject: 'Fixture', text: 'Fixture' }, options = { trackingId: 'ordinary-fixture' };
    expect(await sendEmail(content, options)).toBe(false);
    expect(await sendEmail(content, options)).toBe(true);
    expect(await sendEmail(content, options)).toBe(true);
    expect(smtp.send).toHaveBeenCalledTimes(3);
    expect(smtp.log.mock.calls.map(call => call[0].status)).toEqual(['failed', 'sent', 'skipped_duplicate']);
    smtp.send.mockResolvedValueOnce({ accepted: ['other@example.test'], rejected: [] });
    expect(await sendEmail({ ...content, to: 'other@example.test' }, options)).toBe(true);
    expect(smtp.send).toHaveBeenCalledTimes(4);
  });
  it('records partial acceptance for the actual recipients and leaves rejected recipients retryable', async () => {
    smtp.send.mockResolvedValue({ accepted: ['chef@example.test'], rejected: ['bad@example.test'] });
    expect(await sendEmail({ to: 'chef@example.test,bad@example.test', subject: 'Fixture', text: 'Fixture' }, { trackingId: 'partial-fixture' })).toBe(false);
    expect(smtp.log).toHaveBeenCalledWith(expect.objectContaining({ to: 'chef@example.test', status: 'sent' }));
    expect(smtp.log).toHaveBeenCalledWith(expect.objectContaining({ to: 'bad@example.test', status: 'failed' }));
    smtp.send.mockResolvedValueOnce({ accepted: ['bad@example.test'], rejected: [] });
    expect(await sendEmail({ to: 'bad@example.test', subject: 'Fixture', text: 'Fixture' }, { trackingId: 'partial-fixture' })).toBe(true);
  });
  it('does not infer acceptance from a resolved SMTP promise without accepted recipients', async () => {
    smtp.send.mockResolvedValue({ accepted: [], rejected: [], messageId: 'ambiguous' });
    expect(await sendEmail({ to: 'chef@example.test', subject: 'Fixture' }, { durableDelivery: true })).toBe(false);
    expect(smtp.log).toHaveBeenCalledWith(expect.objectContaining({ to: 'chef@example.test', status: 'failed' }));
  });
  it('does not acknowledge a suppressed harness send', async () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '1');
    expect(await sendEmail({ to: 'chef@example.test', subject: 'Fixture' })).toBe(false);
    expect(smtp.send).not.toHaveBeenCalled();
  });
});
