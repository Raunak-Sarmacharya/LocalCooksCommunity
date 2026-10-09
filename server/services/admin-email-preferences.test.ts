import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ person: undefined as undefined | { role: string; adminEmailNotifications: boolean },
  send: vi.fn(), log: vi.fn() }));
vi.mock('../db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => state.person ? [state.person] : [] }) }) }) } }));
vi.mock('../email', () => ({ sendEmail: state.send }));
vi.mock('./email-log-service', () => ({ logOutgoingEmail: state.log }));

import { operationalEmailAllowed, operationalEmailAllowedForUser, sendAdminNotificationEmail } from './admin-email-preferences';

describe('Admin operational email eligibility', () => {
  beforeEach(() => { vi.clearAllMocks(); state.person = { role: 'admin', adminEmailNotifications: true }; state.send.mockResolvedValue(true); });
  it('checks the current preference on every send, including after opting out', async () => {
    const content = { to: 'test_admin@localcooks.ca', subject: 'Application awaiting review', text: 'Review application' };
    expect(await sendAdminNotificationEmail(content, { trackingId: 'application-1' })).toBe(true);
    expect(state.send).toHaveBeenCalledWith(content, { trackingId: 'application-1', emailType: 'admin_notification' });
    state.person!.adminEmailNotifications = false;
    expect(await sendAdminNotificationEmail(content)).toBe(false);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped_preference' }));
    expect(await operationalEmailAllowedForUser(1)).toBe(false);
  });
  it('does not send an admin broadcast to a missing or former admin', async () => {
    state.person = undefined;
    expect(await sendAdminNotificationEmail({ to: 'missing@example.com', subject: 'Alert' })).toBe(false);
    state.person = { role: 'chef', adminEmailNotifications: true };
    expect(await sendAdminNotificationEmail({ to: 'chef@example.com', subject: 'Alert' })).toBe(false);
    expect(state.send).not.toHaveBeenCalled();
  });
  it('leaves chef and manager operational emails eligible irrespective of the admin preference', async () => {
    for (const role of ['chef', 'manager']) {
      state.person = { role, adminEmailNotifications: false };
      expect(operationalEmailAllowed(state.person)).toBe(true);
      expect(await operationalEmailAllowedForUser(2)).toBe(true);
    }
  });
});
