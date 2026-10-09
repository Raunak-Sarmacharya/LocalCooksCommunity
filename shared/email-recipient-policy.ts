export const SUPPORT_EMAIL = 'support@localcooks.ca';

/** The support contact inbox only receives mail composed by users themselves. */
export function isSupportContactMailbox(address: string): boolean {
  const mailbox = address.trim().toLowerCase().replace(/^"([^"]+)"@/, '$1@');
  // Keep legacy queued support copies blocked after changing the public address.
  return mailbox === SUPPORT_EMAIL || mailbox === 'support@localcook.shop';
}
