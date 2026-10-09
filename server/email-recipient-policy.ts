import addressparser from 'nodemailer/lib/addressparser/index.js';
import { isSupportContactMailbox } from '@shared/email-recipient-policy';

/** This inbox is for mail composed by real users, never platform-generated mail. */
export function isPlatformEmailRecipientBlocked(to: string) {
  return addressparser(to, { flatten: true }).some(({ address }) =>
    isSupportContactMailbox(address));
}
