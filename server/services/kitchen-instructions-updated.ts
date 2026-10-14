import { getCheckinSettings } from './kitchen-checkout-service';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { bookingLifecycleEvents, kitchenBookings, kitchenBookingVisits, kitchens, locations, users,
  checkinCheckoutChecklists, kitchenCheckinCheckoutOverrides } from '@shared/schema';
import { kitchenChecklistSections, type KitchenChecklistSection, resolveKitchenChecklist } from '@shared/kitchen-checklist';
import { activeChecklist } from '@shared/active-checklist';
import { DEFAULT_TIMEZONE, formatInTimezone, friendlyTimezoneName } from '@shared/timezone-utils';
import { reminderVisitTimes } from './advance-reminders';
import { renderTransactionalEmail } from '../email';
import { getAppBaseUrl } from '../config';
import { bookingInstructionRelease } from './visit-duties';
import { getLifecycleSettings, lifecycleSettings } from './lifecycle-settings';
import { getUserDisplayName } from '../utils/user-display';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = Pick<typeof db, 'select'>;
type Checklist = Record<string, unknown> | null;
export type InstructionUpdateMetadata = { [key: string]: unknown; revision: number; sections: KitchenChecklistSection[]; before: Checklist; recipientPolicy: 'chef' };

const value = (row: Checklist, field: string) => row?.[field] ?? (field.endsWith('Instructions') ? '' : []);
function comparable(row: Checklist, field: string) {
  const current = value(row, field);
  if (field.endsWith('Instructions')) return String(current).trim();
  return Array.isArray(current) ? current.map(item => ({ id: item.id, label: item.label,
    description: item.description || '', required: item.required !== false,
    ...(field.endsWith('Items') ? { photoRequired: item.photoRequired === true } : {}) })) : [];
}
export function changedKitchenSections(before: Checklist, after: Checklist): KitchenChecklistSection[] {
  return (Object.keys(kitchenChecklistSections) as KitchenChecklistSection[]).filter(section =>
    kitchenChecklistSections[section].some(field => JSON.stringify(comparable(before, field)) !== JSON.stringify(comparable(after, field))));
}

/** Closed/pending checkout visits never receive these notices, including split visits. */
export function eligibleInstructionSections(booking: typeof kitchenBookings.$inferSelect, timezone: string,
  visits: Array<Pick<typeof kitchenBookingVisits.$inferSelect, 'checkinStatus' | 'startTime' | 'endTime'> & { blockIndex?: number }>,
  sections: KitchenChecklistSection[], now = new Date(), preparationHours = lifecycleSettings.preparationReminderHours.defaultValue, checkinWindowMinutesBefore = 15): KitchenChecklistSection[] {
  if (booking.status !== 'confirmed' || !booking.chefId) return [];
  if (!bookingInstructionRelease(booking, timezone, visits, preparationHours, checkinWindowMinutesBefore, now).instructionsReleased) return [];
  if (visits.length) {
    const blocks = reminderVisitTimes(booking, timezone);
    const upcoming = blocks[0]?.start > now && visits.every(visit => visit.checkinStatus === 'not_checked_in');
    if (upcoming) return sections;
    return visits.some(visit => visit.checkinStatus === 'checked_in') ? sections.filter(section => section.startsWith('departure')) : [];
  }
  if (booking.checkinStatus === 'checked_in') return sections.filter(section => section.startsWith('departure'));
  if (booking.checkinStatus && booking.checkinStatus !== 'not_checked_in') return [];
  return reminderVisitTimes(booking, timezone)[0]?.start > now ? sections : [];
}

export async function readKitchenInstructionContext(bookingId: number, tx: Database = db) {
  const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!booking?.chefId) return null;
  const [kitchen] = await tx.select().from(kitchens).where(eq(kitchens.id, booking.kitchenId)).limit(1);
  if (!kitchen) return null;
  const [[location], [chef], [checklist], [override], visits] = await Promise.all([
    tx.select().from(locations).where(eq(locations.id, kitchen.locationId)).limit(1),
    tx.select().from(users).where(eq(users.id, booking.chefId)).limit(1),
    tx.select().from(checkinCheckoutChecklists).where(eq(checkinCheckoutChecklists.locationId, kitchen.locationId)).limit(1),
    tx.select().from(kitchenCheckinCheckoutOverrides).where(eq(kitchenCheckinCheckoutOverrides.kitchenId, kitchen.id)).limit(1),
    tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId)),
  ]);
  if (!location || !chef) return null;
  const effective = resolveKitchenChecklist(override, checklist);
  return { booking, kitchen, location, chef, visits, effective: effective && activeChecklist(effective) };
}

/** The caller holds the location scope lock; booking locks serialize outbox coalescing. */
export async function queueKitchenInstructionUpdates(tx: Transaction, kitchenId: number, before: Checklist, after: Checklist, actorId: number) {
  const sections = changedKitchenSections(before && activeChecklist(before), after && activeChecklist(after));
  if (!sections.length) return;
  const bookings = await tx.select({ booking: kitchenBookings, timezone: locations.timezone, locationId: locations.id }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(and(eq(kitchenBookings.kitchenId, kitchenId), eq(kitchenBookings.status, 'confirmed'))).for('update', { of: kitchenBookings });
  for (const { booking, timezone, locationId } of bookings) {
    const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, booking.id));
    const timing = await getLifecycleSettings(tx);
    const settings = await getCheckinSettings(locationId, tx);
    const eligible = eligibleInstructionSections(booking, timezone || DEFAULT_TIMEZONE, visits, sections, new Date(), timing.preparationReminderHours, settings.checkinWindowMinutesBefore);
    if (!eligible.length) continue;
    const [pending] = await tx.select().from(bookingLifecycleEvents).where(and(eq(bookingLifecycleEvents.bookingId, booking.id),
      eq(bookingLifecycleEvents.kind, 'instructions_updated'), isNull(bookingLifecycleEvents.completedAt))).limit(1).for('update');
    const previous = pending?.metadata as InstructionUpdateMetadata | undefined;
    const metadata: InstructionUpdateMetadata = { recipientPolicy: 'chef', revision: (previous?.revision || 0) + 1,
      sections: Array.from(new Set([...(previous?.sections || []), ...eligible])), before: previous ? previous.before : before && activeChecklist(before) };
    const { queueBookingLifecycleEvent } = await import('./booking-lifecycle-delivery');
    await queueBookingLifecycleEvent(tx, booking.id, 'instructions_updated', 'Booking instructions updated',
      'Check the updated arrival and departure instructions and your visit checklist.', actorId, metadata);
  }
}

function taskFacts(before: unknown, after: unknown) {
  const old = Array.isArray(before) ? before : [], current = Array.isArray(after) ? after : [];
  const facts: { label: string; value: string }[] = [];
  for (const item of current) if (!old.some(previous => previous.id === item.id)) facts.push({ label: 'New task added', value: item.label });
  for (const item of old) if (!current.some(next => next.id === item.id)) facts.push({ label: 'Task removed', value: item.label });
  return facts;
}

/** Re-read eligibility and effective values at delivery; never render queued instruction text. */
export async function currentKitchenInstructionEmail(bookingId: number, metadata: InstructionUpdateMetadata,
  recipientId: number, to: string, tx: Database = db) {
  const row = await readKitchenInstructionContext(bookingId, tx);
  if (!row || row.booking.chefId !== recipientId || row.chef.username.toLowerCase() !== to.toLowerCase()) return null;
  const timezone = row.location.timezone || DEFAULT_TIMEZONE;
  const actualChanges = changedKitchenSections(metadata.before, row.effective).filter(section => metadata.sections.includes(section));
  const timing = await getLifecycleSettings(tx);
  const settings = await getCheckinSettings(row.location.id, tx);
  const sections = eligibleInstructionSections(row.booking, timezone, row.visits, actualChanges, new Date(), timing.preparationReminderHours, settings.checkinWindowMinutesBefore);
  if (!sections.length) return null;
  const titles: Record<KitchenChecklistSection, string> = { arrivalInstructions: 'Arrival instructions', departureInstructions: 'Departure instructions',
    arrivalTasks: 'Arrival tasks and photos', departureTasks: 'Departure tasks and photos' };
  const blocks = reminderVisitTimes(row.booking, timezone);
  const updates = sections.map(section => {
    const fields = kitchenChecklistSections[section];
    const facts = fields.flatMap(field => {
      const current = value(row.effective, field);
      if (field.endsWith('Instructions')) return [{ label: titles[section], value: String(current).trim() || 'Removed by the kitchen' }];
      const items = Array.isArray(current) ? current : [];
      return [...taskFacts(value(metadata.before, field), items), { label: field.endsWith('Items') ? 'Current tasks' : 'Current photos',
        value: items.length ? items.map(item => `${item.label}${item.required === false ? ' (optional)' : ' (required)'}`).join('\n')
          : (value(metadata.before, field) as unknown[]).length ? 'Removed by the kitchen' : 'None requested' }];
    });
    return { title: titles[section], facts };
  });
  return renderTransactionalEmail({ to, recipientName: (await getUserDisplayName(row.chef.id, 'chef', tx)).replace(/^A chef$/i, '').trim() || to.split('@')[0],
    subject: `Booking instructions updated at ${row.kitchen.name}`, heading: 'Your booking instructions have been updated',
    message: `The kitchen updated: ${sections.map(section => titles[section].toLowerCase()).join(', ')}. Review the current details below.`, facts: [],
    sections: [{ title: 'Your booking', facts: [{ label: 'Kitchen', value: row.kitchen.name }, { label: 'Location', value: row.location.name },
      { label: 'Visit', value: blocks.map(block => `${formatInTimezone(block.start, 'EEE, MMM d, yyyy h:mm a', timezone)} - ${formatInTimezone(block.end,
        formatInTimezone(block.start, 'yyyy-MM-dd', timezone) === formatInTimezone(block.end, 'yyyy-MM-dd', timezone) ? 'h:mm a' : 'EEE, MMM d, yyyy h:mm a', timezone)}`).join('; ') + ` (${friendlyTimezoneName(timezone)})` },
      { label: 'Reference', value: row.booking.referenceCode || `KB-${bookingId}` }] }, ...updates],
    actionLabel: 'Open your visit', actionUrl: `${getAppBaseUrl('chef')}/booking/${bookingId}/visit` });
}
