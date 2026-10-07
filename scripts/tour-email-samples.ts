import { PgDialect } from 'drizzle-orm/pg-core';
import { tourEventMessages, renderHistoricalTourEmail } from '../server/services/tour-delivery-service';
import { currentReminders, renderTourReminder, selectedReminderPolicy } from '../server/services/advance-reminders';
import { getSubdomainUrl, generateChatDigestEmail, generateChatMessageEmail } from '../server/email';
import { DEFAULT_TIMEZONE } from '../shared/timezone-utils';

type Payload = Parameters<typeof tourEventMessages>[0];
type Tour = Payload['after'];
export type TourEmailSample = {
  id: string; scenario: string; group: string; role: 'Chef' | 'Manager' | 'Local Cooks';
  to: string; subject: string; html: string; text: string;
  attachments: { filename: string; content: string }[];
};

const chef = { id: 101, name: 'Alex Chen', email: 'alex.chen@example.com' };
const manager = { id: 202, name: 'Morgan Lee', email: 'morgan+tour@example.com' };
const admin = { id: 303, name: 'Local Cooks', email: 'operations@example.com' };
const location = { id: 5, name: 'Harbour House', address: '123 Water Street, St. John’s, NL A1C 1A5, Canada', managerId: manager.id, timezone: DEFAULT_TIMEZONE };
const kitchen = { id: 7, name: 'Harbour House Commercial Kitchen' };
const tour = {
  id: 42, chefId: chef.id, managerId: manager.id, locationId: location.id, targetedKitchenId: kitchen.id,
  scheduledAt: new Date('2026-10-14T14:30:00Z'), durationMinutes: 30, status: 'confirmed',
  updatedAt: new Date('2026-10-06T12:00:00Z'), checkedInAt: null, checkedOutAt: null,
  attendanceHistory: [], outcomeHistory: [], disruptionReason: null, noShowReason: null,
  requestedRescheduleAt: null, cancellationReason: null, adminReviewReason: null,
  chefNotes: 'I would like to see the prep space and cold storage.',
  sharedManagerNotes: 'Use the side entrance on Water Street. Ring the bell and ask for Morgan.',
  managerNotes: 'PRIVATE HARNESS SENTINEL — never share with the visitor.',
} as Tour;

/** Real rendering functions with a closed, in-memory reader; no DB writes or outbound delivery. */
export async function buildTourEmailSamples() {
  const samples: TourEmailSample[] = [];
  const notificationOnly: { scenario: string; recipients: string[] }[] = [];
  const add = (scenario: string, group: string, role: TourEmailSample['role'], email: { to: string; subject: string; html?: string; text?: string; attachments?: any[] }) => {
    samples.push({ id: String(samples.length), scenario, group, role, to: email.to, subject: email.subject,
      html: email.html || '', text: email.text || '', attachments: (email.attachments || []).map(file => ({ filename: file.filename, content: String(file.content) })) });
  };
  const events: { scenario: string; group: string; kind: Payload['kind']; before?: Partial<Tour>; after?: Partial<Tour>; actorRole?: string }[] = [
    { scenario: 'Request received', group: 'Requests', kind: 'requested', before: { status: 'pending_local_cooks' }, after: { status: 'pending_local_cooks' } },
    { scenario: 'Request ready for manager', group: 'Requests', kind: 'review_approved', before: { status: 'pending_local_cooks' }, after: { status: 'pending' } },
    { scenario: 'Request declined by Local Cooks', group: 'Requests', kind: 'review_denied', before: { status: 'pending_local_cooks' }, after: { status: 'cancelled', adminReviewReason: 'The kitchen is unavailable at your requested time.' }, actorRole: 'admin' },
    { scenario: 'Request declined by manager', group: 'Requests', kind: 'status', before: { status: 'pending' }, after: { status: 'cancelled', cancellationReason: 'Please choose an afternoon time.' } },
    { scenario: 'Request withdrawn by chef', group: 'Requests', kind: 'status', before: { status: 'pending' }, after: { status: 'cancelled' }, actorRole: 'chef' },
    { scenario: 'Request expired before review', group: 'Requests', kind: 'expired', before: { status: 'pending_local_cooks' }, after: { status: 'pending_local_cooks' } },
    { scenario: 'Request expired before confirmation', group: 'Requests', kind: 'expired', before: { status: 'pending' }, after: { status: 'pending' } },
    { scenario: 'Tour confirmed', group: 'Confirmation', kind: 'status', before: { status: 'pending' } },
    { scenario: 'Time change requested', group: 'Time changes', kind: 'reschedule_requested', after: { requestedRescheduleAt: new Date('2026-10-15T16:30:00Z') } },
    { scenario: 'Time change accepted', group: 'Time changes', kind: 'reschedule_accepted', after: { scheduledAt: new Date('2026-10-15T16:30:00Z'), requestedRescheduleAt: new Date('2026-10-15T16:30:00Z') } },
    { scenario: 'Time change declined', group: 'Time changes', kind: 'reschedule_declined', after: { requestedRescheduleAt: new Date('2026-10-15T16:30:00Z') } },
    ...['chef', 'manager', 'admin'].map(actorRole => ({ scenario: `Confirmed tour cancelled by ${actorRole === 'admin' ? 'Local Cooks' : actorRole}`, group: 'Cancellations', kind: 'status' as const, after: { status: 'cancelled' as const, cancellationReason: 'The kitchen is closed for maintenance.' }, actorRole })),
    { scenario: 'Tour completed', group: 'Outcomes', kind: 'status', after: { status: 'completed' } },
    { scenario: 'Visitor marked as missed', group: 'Outcomes', kind: 'status', after: { status: 'no_show', noShowReason: 'visitor_absent' } },
    { scenario: 'Legacy outcome without a reason', group: 'Outcomes', kind: 'status', after: { status: 'no_show' } },
    ...['manager_absent', 'access_unavailable', 'weather', 'other'].map(disruptionReason => ({ scenario: `Tour disrupted: ${disruptionReason.replace(/_/g, ' ')}`, group: 'Outcomes', kind: 'status' as const, after: { status: 'cancelled' as const, disruptionReason, cancellationReason: 'Please contact us to arrange another visit.' } })),
    { scenario: 'Missed visit corrected to completed', group: 'Corrections', kind: 'status', before: { status: 'no_show', noShowReason: 'visitor_absent' }, after: { status: 'completed' } },
    { scenario: 'Completed visit corrected to cancelled', group: 'Corrections', kind: 'status', before: { status: 'completed' }, after: { status: 'cancelled', cancellationReason: 'The tour could not take place.' } },
    { scenario: 'Past outcome corrected to confirmed', group: 'Corrections', kind: 'status', before: { status: 'completed' } },
    { scenario: 'Disrupted tour corrected to completed', group: 'Corrections', kind: 'status', before: { status: 'cancelled', disruptionReason: 'weather' }, after: { status: 'completed' } },
    { scenario: 'Confirmed overnight tour', group: 'Edge cases', kind: 'status', before: { status: 'pending' }, after: { scheduledAt: new Date('2026-10-15T02:15:00Z') } },
    { scenario: 'Tour across daylight saving change', group: 'Edge cases', kind: 'status', before: { status: 'pending' }, after: { scheduledAt: new Date('2026-11-01T04:15:00Z') } },
    { scenario: 'Visitor checks in', group: 'Notifications only', kind: 'visitor_checkin' },
    { scenario: 'Visitor checks out', group: 'Notifications only', kind: 'visitor_checkout' },
    { scenario: 'Manager helps save a visit time', group: 'Notifications only', kind: 'attendance_assisted' },
    { scenario: 'Manager prompted for tour outcome', group: 'Notifications only', kind: 'reminder' },
  ];
  for (const event of events) {
    const payload: Payload = { kind: event.kind, before: { ...tour, ...event.before }, after: { ...tour, ...event.after },
      actorRole: event.actorRole || 'manager', chef, manager, admins: [admin], locationName: location.name, kitchenName: kitchen.name, address: location.address };
    const messages = tourEventMessages(payload, 1);
    for (const message of messages) if (message.email) add(event.scenario, event.group,
      message.key === 'chef-email' ? 'Chef' : message.key === 'manager-email' ? 'Manager' : 'Local Cooks', message.email);
    if (!messages.some(message => message.email)) notificationOnly.push({ scenario: event.scenario, recipients: messages.flatMap(message => message.notification ? [message.notification.target === 'chef' ? 'Chef' : message.notification.userId === manager.id ? 'Manager' : 'Local Cooks'] : []) });
    if (event.scenario === 'Tour confirmed' || event.scenario === 'Time change requested' || event.scenario === 'Tour completed') {
      for (const message of messages) if (message.email) add(`Delayed delivery: ${event.scenario.toLowerCase()}`, 'Delivery recovery',
        message.key === 'chef-email' ? 'Chef' : message.key === 'manager-email' ? 'Manager' : 'Local Cooks',
        renderHistoricalTourEmail({ email: message.email, key: message.key, payload, viewingId: tour.id,
          createdAt: tour.updatedAt, currentStatus: 'Cancelled' }));
    }
  }

  const dialect = new PgDialect();
  const reminderSamples = async (scenario: string, currentTour: Tour, now: Date, hostEmail = manager.email) => {
    const people = [chef, { ...manager, email: hostEmail }].map(person => ({ id: person.id, username: person.email,
      role: person.id === chef.id ? 'chef' : 'manager', managerProfileData: { displayName: person.name } }));
    const reader = { select: () => {
      let table = '', condition: any, max = Infinity;
      const rows = () => {
        if (table === 'users') { const ids = dialect.sqlToQuery(condition).params; return people.filter(person => ids.includes(person.id)).slice(0, max); }
        if (table === 'kitchen_viewings') return [{ tour: currentTour, location }];
        if (table === 'kitchens') return [kitchen];
        if (table === 'locations') return [location];
        if (table === 'kitchen_viewing_settings') return [{ arrivalNotes: 'Bring photo ID and wear closed-toe shoes.', departureNotes: 'Return your visitor badge to Morgan.' }];
        if (table === 'platform_settings') return [];
        throw new Error(`Unexpected preview read: ${table}`);
      };
      const chain: any = { from(value: any) { table = value[Symbol.for('drizzle:Name')]; return chain; },
        where(value: any) { condition = value; return chain; }, limit(value: number) { max = value; return chain; }, innerJoin() { return chain; },
        then(resolve: any, reject: any) { return Promise.resolve().then(rows).then(resolve, reject); } };
      return chain;
    } };
    const reminders = await currentReminders(reader as any, 'tour', tour.id, selectedReminderPolicy, now);
    for (const reminder of reminders) add(`${scenario} · ${reminder.kind}`, 'Reminders', reminder.role === 'chef' ? 'Chef' : 'Manager',
      renderTourReminder(reminder, `${getSubdomainUrl(reminder.role === 'chef' ? 'chef' : 'kitchen')}${reminder.path}`));
  };
  await reminderSamples('Before the tour', tour, new Date('2026-10-14T08:00:00Z'));
  await reminderSamples('Manager email unavailable', tour, new Date('2026-10-14T08:00:00Z'), '');
  const actualAt = new Date('2026-10-14T14:30:00Z');
  await reminderSamples('Before you leave', { ...tour, checkedInAt: actualAt, attendanceHistory: [{ action: 'check_in', actorId: chef.id,
    source: 'visitor', actualAt: actualAt.toISOString(), recordedAt: actualAt.toISOString(), scheduledAt: tour.scheduledAt.toISOString() }] }, new Date('2026-10-14T14:45:00Z'));
  for (const person of [chef, manager]) for (const count of [1, 3]) {
    const isChef = person.id === chef.id;
    add(`Tour conversation · ${count} unread ${count === 1 ? 'message' : 'messages'}`, 'Conversation', isChef ? 'Chef' : 'Manager',
      generateChatDigestEmail(person.email, count, isChef ? manager.name : chef.name, location.name,
        `${getSubdomainUrl(isChef ? 'chef' : 'kitchen')}${isChef ? '/dashboard' : '/manager/dashboard'}?view=messages&conversation=tour-preview-42`, [], person.name));
  }
  for (const person of [chef, manager]) for (const attachment of [false, true]) {
    const isChef = person.id === chef.id;
    add(`Starting tour message${attachment ? ' · attachment' : ''}`, 'Conversation', isChef ? 'Chef' : 'Manager',
      generateChatMessageEmail(person.email, person.name, isChef ? manager.name : chef.name, location.name,
        `${getSubdomainUrl(isChef ? 'chef' : 'kitchen')}${isChef ? '/dashboard' : '/manager/dashboard'}?view=messages&conversation=tour-preview-42`,
        attachment ? 'Sent an attachment: kitchen-tour-notes.pdf' : isChef
          ? 'Hi Alex, I’ll meet you at the front entrance for your tour. Please message me here when you arrive.'
          : 'Hi Morgan, I’m on my way for the kitchen tour. Is the front entrance the best place to meet?'));
  }
  return { samples: samples.filter(sample => sample.to).map((sample, index) => ({ ...sample, id: String(index) })), notificationOnly };
}
