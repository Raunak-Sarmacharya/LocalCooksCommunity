import { eq, sql } from 'drizzle-orm';
import { users } from '@shared/schema';
import { db } from '../db';
import { sendEmail } from '../email';
import { logOutgoingEmail } from './email-log-service';

type Connection = Pick<typeof db, 'select'>;

/** Roles grant access; this preference controls operational email only. */
export function operationalEmailAllowed(person: { role: string | null; adminEmailNotifications: boolean }) {
  return person.role !== 'admin' || person.adminEmailNotifications;
}

/** Resolve again at delivery time, including already queued messages. */
export async function operationalEmailAllowedForUser(id: number, connection: Connection = db) {
  const [person] = await connection.select({ role: users.role, adminEmailNotifications: users.adminEmailNotifications })
    .from(users).where(eq(users.id, id)).limit(1);
  return !!person && operationalEmailAllowed(person);
}

export async function adminEmailAllowedForUser(id: number, connection: Connection = db) {
  const [person] = await connection.select({ role: users.role, adminEmailNotifications: users.adminEmailNotifications })
    .from(users).where(eq(users.id, id)).limit(1);
  return person?.role === 'admin' && person.adminEmailNotifications === true;
}

/** Only current, explicitly opted-in admins can receive administrative broadcasts. */
export async function adminEmailAllowedForAddress(email: string, connection: Connection = db) {
  const [person] = await connection.select({ role: users.role, adminEmailNotifications: users.adminEmailNotifications })
    .from(users).where(sql`lower(${users.username}) = ${email.trim().toLowerCase()}`).limit(1);
  return person?.role === 'admin' && person.adminEmailNotifications === true;
}

/** Account verification, password resets and sign-in mail continue using sendEmail. */
export async function sendAdminNotificationEmail(content: Parameters<typeof sendEmail>[0], options?: Parameters<typeof sendEmail>[1]) {
  const adminOptions = { ...options, emailType: 'admin_notification' };
  if (!await adminEmailAllowedForAddress(content.to)) {
    await recordAdminEmailSuppression(content, adminOptions);
    return false;
  }
  return sendEmail(content, adminOptions);
}

export async function recordAdminEmailSuppression(content: Parameters<typeof sendEmail>[0], options?: Parameters<typeof sendEmail>[1]) {
  await logOutgoingEmail({ ...content, ...options, status: 'skipped_preference',
    errorMessage: 'Admin operational email is disabled for this recipient.' });
}
