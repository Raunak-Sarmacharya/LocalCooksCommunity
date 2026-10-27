/**
 * What a chef–kitchen conversation is about (owner mock, Oct 27): the kitchen, what's coming up, what's past, and the
 * booking, tour and storage events the thread shows inline. Read-only and scoped to one chef at one location; callers
 * authorize the conversation first (withParticipantChat).
 */
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../db';
import { chefKitchenApplications, kitchenBookings, kitchens, kitchenViewings, locations, storageBookings, storageListings } from '@shared/schema';

export type ChatViewer = 'chef' | 'manager';
export type ChatContextItem = {
  kind: 'booking' | 'tour' | 'storage'; id: number; status: string;
  /** Booking: calendar date + local times. Tour: start instant. Storage: first and last paid day. */
  date?: string; startTime?: string; endTime?: string; at?: string; from?: string; to?: string; label?: string;
  href: string;
};
export type ChatContextEvent = { kind: ChatContextItem['kind']; id: number; action: 'requested' | 'confirmed' | 'cancelled'; at: string; item: ChatContextItem };
export type ChatContext = {
  kitchen: { name: string; address: string | null; imageUrl: string | null; timezone: string };
  access: 'approved' | 'inReview' | null;
  upcoming: ChatContextItem[];
  past: { count: number; latest: ChatContextItem[] };
  customer?: { since: string | null; completedBookings: number; noShows: number };
  events: ChatContextEvent[];
};

const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const LIVE_STORAGE = ['requested', 'reserved', 'active', 'move_out_requested', 'removal_review'];

export async function chatContext(chefId: number, locationId: number, viewer: ChatViewer, now = new Date()): Promise<ChatContext> {
  return buildChatContext((await loadRows([{ chefId, locationId }])).get(`${chefId}:${locationId}`)!, viewer, now);
}

/** Inbox rows: the next thing and which kinds a thread has (for the tag and the filters), for many threads in one pass. */
export async function chatSummaries(pairs: { chefId: number; locationId: number }[], viewer: ChatViewer, now = new Date()) {
  const rows = await loadRows(pairs);
  return new Map(Array.from(rows, ([key, value]) => {
    const context = buildChatContext(value, viewer, now);
    const kinds = Array.from(new Set([...context.upcoming, ...context.events.map(event => event.item)].map(item => item.kind)));
    return [key, { next: context.upcoming[0] ?? null, kinds, imageUrl: context.kitchen.imageUrl }] as const;
  }));
}

async function loadRows(pairs: { chefId: number; locationId: number }[]): Promise<Map<string, Rows>> {
  const result = new Map<string, Rows>();
  if (!pairs.length) return result;
  const chefIds = Array.from(new Set(pairs.map(pair => pair.chefId))), locationIds = Array.from(new Set(pairs.map(pair => pair.locationId)));
  const [locationRows, kitchenRows] = await Promise.all([
    db.select({ id: locations.id, name: locations.name, address: locations.address, logoUrl: locations.logoUrl, timezone: locations.timezone }).from(locations).where(inArray(locations.id, locationIds)),
    db.select({ id: kitchens.id, locationId: kitchens.locationId, name: kitchens.name, imageUrl: kitchens.imageUrl }).from(kitchens).where(inArray(kitchens.locationId, locationIds)),
  ]);
  const kitchenIds = kitchenRows.map(row => row.id);
  const [bookings, tours, rentals, applications] = await Promise.all([
    kitchenIds.length ? db.select().from(kitchenBookings).where(and(inArray(kitchenBookings.chefId, chefIds), inArray(kitchenBookings.kitchenId, kitchenIds))).orderBy(desc(kitchenBookings.bookingDate)) : [],
    db.select().from(kitchenViewings).where(and(inArray(kitchenViewings.chefId, chefIds), inArray(kitchenViewings.locationId, locationIds))),
    kitchenIds.length ? db.select({ rental: storageBookings, name: storageListings.name, kitchenId: storageListings.kitchenId }).from(storageBookings)
      .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
      .where(and(inArray(storageBookings.chefId, chefIds), inArray(storageListings.kitchenId, kitchenIds))) : [],
    db.select({ chefId: chefKitchenApplications.chefId, locationId: chefKitchenApplications.locationId, status: chefKitchenApplications.status }).from(chefKitchenApplications)
      .where(and(inArray(chefKitchenApplications.chefId, chefIds), inArray(chefKitchenApplications.locationId, locationIds), or(eq(chefKitchenApplications.status, 'approved'), eq(chefKitchenApplications.status, 'inReview')))),
  ]);
  const locationOfKitchen = new Map(kitchenRows.map(row => [row.id, row.locationId]));
  for (const { chefId, locationId } of pairs) {
    const mine = (rowChef: number | null, rowLocation: number | null | undefined) => rowChef === chefId && rowLocation === locationId;
    result.set(`${chefId}:${locationId}`, {
      location: locationRows.find(row => row.id === locationId),
      kitchenRows: kitchenRows.filter(row => row.locationId === locationId),
      bookings: bookings.filter(row => mine(row.chefId, locationOfKitchen.get(row.kitchenId))),
      tours: tours.filter(row => mine(row.chefId, row.locationId)),
      rentals: rentals.filter(row => mine(row.rental.chefId, locationOfKitchen.get(row.kitchenId!))),
      applications: applications.filter(row => mine(row.chefId, row.locationId)),
    });
  }
  return result;
}

type Rows = {
  location?: { name: string; address: string | null; logoUrl: string | null; timezone: string | null };
  kitchenRows: { id: number; name: string; imageUrl: string | null }[];
  bookings: (typeof kitchenBookings.$inferSelect)[];
  tours: (typeof kitchenViewings.$inferSelect)[];
  rentals: { rental: typeof storageBookings.$inferSelect; name: string }[];
  applications: { status: string }[];
};

/** Pure: the rows for one chef at one location → what the thread shows. */
export function buildChatContext({ location, kitchenRows, bookings, tours, rentals, applications }: Rows, viewer: ChatViewer, now = new Date()): ChatContext {
  const prefix = viewer === 'manager' ? '/manager' : '';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: location?.timezone || 'America/St_Johns' }).format(now);
  const dayOf = (value: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: location?.timezone || 'America/St_Johns' }).format(new Date(value));

  const items: { item: ChatContextItem; upcoming: boolean; sortAt: string }[] = [];
  const events: ChatContextEvent[] = [];
  for (const b of bookings) {
    const item: ChatContextItem = { kind: 'booking', id: b.id, status: b.status, date: dayOf(b.bookingDate), startTime: b.startTime, endTime: b.endTime, href: `${prefix}/booking/${b.id}` };
    items.push({ item, upcoming: ['pending', 'confirmed', 'cancellation_requested'].includes(b.status) && item.date! >= today, sortAt: `${item.date}T${b.startTime}` });
    if (b.createdAt) events.push({ kind: 'booking', id: b.id, action: b.status === 'pending' ? 'requested' : 'confirmed', at: iso(b.createdAt)!, item });
    if (b.status === 'cancelled') events.push({ kind: 'booking', id: b.id, action: 'cancelled', at: iso(b.cancellationEffectiveAt ?? b.updatedAt)!, item });
  }
  for (const v of tours) {
    // Local Cooks' first look is never shown (owner rule): the kitchen doesn't see the request yet, the chef sees "requested".
    if (viewer === 'manager' && (v.status === 'pending_local_cooks' || v.adminReviewDecision === 'denied')) continue;
    const status = v.status === 'pending_local_cooks' ? 'pending' : v.status;
    const item: ChatContextItem = { kind: 'tour', id: v.id, status, at: iso(v.scheduledAt) ?? undefined, href: `${prefix}/dashboard?view=viewings&viewing=${v.id}` };
    items.push({ item, upcoming: ['pending', 'confirmed'].includes(status) && !!v.scheduledAt && new Date(v.scheduledAt) >= now, sortAt: iso(v.scheduledAt) ?? '' });
    const requestedAt = viewer === 'manager' ? v.adminReviewedAt ?? v.createdAt : v.createdAt;
    if (requestedAt) events.push({ kind: 'tour', id: v.id, action: 'requested', at: iso(requestedAt)!, item });
    if (v.confirmedAt) events.push({ kind: 'tour', id: v.id, action: 'confirmed', at: iso(v.confirmedAt)!, item });
    if (v.cancelledAt) events.push({ kind: 'tour', id: v.id, action: 'cancelled', at: iso(v.cancelledAt)!, item });
  }
  for (const { rental: r, name } of rentals) {
    if (!r.rentalState || !r.termStart) continue;
    const item: ChatContextItem = { kind: 'storage', id: r.id, status: r.rentalState, from: r.termStart, to: r.paidThrough ?? undefined, label: name, href: `${prefix}/storage/${r.id}` };
    items.push({ item, upcoming: LIVE_STORAGE.includes(r.rentalState), sortAt: r.termStart });
    if (r.createdAt) events.push({ kind: 'storage', id: r.id, action: 'requested', at: iso(r.createdAt)!, item });
    if (r.approvedAt) events.push({ kind: 'storage', id: r.id, action: 'confirmed', at: iso(r.approvedAt)!, item });
    if (r.cancellationAcceptedAt) events.push({ kind: 'storage', id: r.id, action: 'cancelled', at: iso(r.cancellationAcceptedAt)!, item });
  }

  // Next dated thing first (the next booking or tour); storage already under way comes after.
  const ahead = (row: { sortAt: string }) => row.sortAt.slice(0, 10) >= today ? 0 : 1;
  const upcoming = items.filter(row => row.upcoming).sort((a, b) => ahead(a) - ahead(b) || a.sortAt.localeCompare(b.sortAt)).map(row => row.item);
  // Most recent first; something cancelled ahead of its date is listed after what actually happened.
  const happened = (row: { item: ChatContextItem; sortAt: string }) => row.item.status !== 'cancelled' && row.sortAt.slice(0, 10) <= today ? 0 : 1;
  const past = items.filter(row => !row.upcoming).sort((a, b) => happened(a) - happened(b) || b.sortAt.localeCompare(a.sortAt)).map(row => row.item);
  const upcomingKeys = new Set(upcoming.map(item => `${item.kind}-${item.id}`));
  const firstBooking = bookings.at(-1);
  const kitchenImage = kitchenRows.find(row => row.imageUrl)?.imageUrl ?? location?.logoUrl ?? null;
  return {
    kitchen: { name: location?.name ?? kitchenRows[0]?.name ?? '', address: location?.address ?? null, imageUrl: kitchenImage, timezone: location?.timezone || 'America/St_Johns' },
    access: applications.some(app => app.status === 'approved') ? 'approved' : applications.length ? 'inReview' : null,
    upcoming,
    past: { count: past.length, latest: past.slice(0, 3) },
    ...(viewer === 'manager' ? { customer: {
      since: firstBooking ? iso(firstBooking.createdAt) : null,
      completedBookings: bookings.filter(b => b.status === 'completed').length,
      noShows: bookings.filter(b => !!b.noShowDetectedAt).length,
    } } : {}),
    // The thread shows what changed lately or what's still ahead, not a customer's whole history.
    events: events.filter(event => upcomingKeys.has(`${event.kind}-${event.id}`) || now.getTime() - new Date(event.at).getTime() < 14 * 86_400_000)
      .sort((a, b) => a.at.localeCompare(b.at)).slice(-20),
  };
}
