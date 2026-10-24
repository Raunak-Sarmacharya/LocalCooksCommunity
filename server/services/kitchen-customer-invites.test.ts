import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('../email', () => ({ renderTransactionalEmail: vi.fn(), sendEmail: vi.fn() }));
vi.mock('./notification.service', () => ({ notificationService: {} }));
vi.mock('./document-waivers', () => ({ notifyAdmins: vi.fn(), recordDocumentWaiver: vi.fn() }));
vi.mock('../domains/locations/location.service', () => ({ locationService: {} }));
vi.mock('../firebase-setup', () => ({ initializeFirebaseAdmin: vi.fn() }));

import { checkInviteDocuments, inviteIsOpen, normalizeEmail } from './kitchen-customer-invites';

describe('kitchen customer invites', () => {
  it('matches emails without case or spaces, and closes on expiry or withdrawal', () => {
    expect(normalizeEmail('  Sam@Example.COM ')).toBe('sam@example.com');
    const later = new Date(Date.now() + 60_000), earlier = new Date(Date.now() - 60_000);
    expect(inviteIsOpen({ status: 'sent', expiresAt: later })).toBe(true);
    expect(inviteIsOpen({ status: 'sent', expiresAt: earlier })).toBe(false);
    expect(inviteIsOpen({ status: 'withdrawn', expiresAt: later })).toBe(false);
  });
  it('takes only documents this location asks for, with a future date when they expire', () => {
    const requirements = { tier2_custom_fields: [{ id: 'rules', label: 'Signed house rules', document: true, expires: false }] };
    expect(() => checkInviteDocuments({ insurance: { url: '/i.pdf', expiry: '2099-01-01' }, 'custom:rules': { url: '/r.pdf', expiry: null } }, requirements)).not.toThrow();
    expect(() => checkInviteDocuments({ insurance: { url: '/i.pdf', expiry: null } }, requirements)).toThrow('expiry date');
    expect(() => checkInviteDocuments({ 'custom:gone': { url: '/g.pdf', expiry: null } }, requirements)).toThrow('no longer asks');
  });
});
