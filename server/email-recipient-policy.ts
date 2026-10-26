import addressparser from 'nodemailer/lib/addressparser/index.js';
import { isSupportContactMailbox } from '@shared/email-recipient-policy';

/** This inbox is for mail composed by real users, never platform-generated mail. */
export function isPlatformEmailRecipientBlocked(to: string) {
  return addressparser(to, { flatten: true }).some(({ address }) =>
    isSupportContactMailbox(address));
}

/** RFC 2606 / 6761 reserved names (synthetic accounts such as @localcooks.test) can never be delivered. Handing them to
 * SMTP only piles up rejections: the dev sender was disabled by its provider after ~250 a day (Oct 26). */
export function isReservedTestRecipient(to: string) {
  const addresses = addressparser(to, { flatten: true });
  return addresses.length > 0 && addresses.every(({ address }) => /\.(test|example|invalid|localhost)$/i.test(address.split('@')[1] || ''));
}
