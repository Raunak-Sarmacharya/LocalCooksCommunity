import { sql, type SQL } from "drizzle-orm";

/**
 * Deletion safety: what still references a kitchen, a location or an account.
 *
 * Bookings, extensions, add-ons, claims and payment rows are payment history. They are never removed by a
 * delete; deleting is blocked while anything is still live, and archived/anonymized once only history is left.
 */

export interface DeletionRef { ref: string; detail?: string }
export interface DeletionBlockers {
  upcomingBookings: { total: number; refs: DeletionRef[] };
  openClaims: { total: number; refs: DeletionRef[] };
  pendingMoney: { total: number; refs: DeletionRef[] };
  checkoutIncidents: { total: number; refs: DeletionRef[] };
  /** Storage rentals still in the chef's or kitchen's hands. Absent on older callers. */
  openRentals?: { total: number; refs: DeletionRef[] };
  /** Kitchen and location deletes only: tours not yet held, and booking offers a customer can still accept. */
  openTours?: { total: number; refs: DeletionRef[] };
  openInvitations?: { total: number; refs: DeletionRef[] };
  blocked: boolean;
}

export type DeletionScope =
  | { kind: "kitchens"; kitchenIds: readonly number[] }
  | { kind: "location"; locationId: number }
  | { kind: "user"; userId: number };

export type DeletionSubject = "kitchen" | "location" | "account";

export class DeletionBlockedError extends Error {
  readonly status = 409;
  readonly code = "DELETION_BLOCKED";
  constructor(public subject: DeletionSubject, public blockers: DeletionBlockers, message?: string) {
    super(message ?? describeDeletionBlockers(subject, blockers));
    this.name = "DeletionBlockedError";
  }
}

const OPEN_CLAIM_EXCLUDED = ["draft", "rejected", "resolved", "expired", "charge_succeeded"];
const OPEN_RENTAL_STATES = ["requested", "reserved", "active", "move_out_requested", "removal_review"];
const REF_LIMIT = 8;

function kitchensOfScope(scope: DeletionScope): SQL {
  if (scope.kind === "kitchens") return sql`(${sql.join(scope.kitchenIds.map(id => sql`${id}`), sql`, `)})`;
  if (scope.kind === "location") return sql`(SELECT id FROM kitchens WHERE location_id = ${scope.locationId})`;
  return sql`(SELECT k.id FROM kitchens k JOIN locations l ON l.id = k.location_id WHERE l.manager_id = ${scope.userId})`;
}

/** Predicate over kitchen_bookings aliased `kb`. */
function bookingPredicate(scope: DeletionScope): SQL {
  const kitchenIds = kitchensOfScope(scope);
  if (scope.kind === "user") return sql`(kb.chef_id = ${scope.userId} OR kb.created_by = ${scope.userId} OR kb.kitchen_id IN ${kitchenIds})`;
  return sql`kb.kitchen_id IN ${kitchenIds}`;
}

function empty() { return { total: 0, refs: [] as DeletionRef[] }; }

function toBucket(rows: any[], refOf: (row: any) => DeletionRef) {
  if (!rows?.length) return empty();
  return { total: Number(rows[0].total ?? rows.length), refs: rows.slice(0, REF_LIMIT).map(refOf) };
}

/** "Oct 16, 2026": booking dates are stored at the operating day's noon UTC. */
const friendlyDate = (value: unknown) => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value) : null;
  return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(date) : undefined;
};
const bookingRef = (row: any): DeletionRef => ({
  ref: row.reference_code || `KB-${row.id}`,
  detail: friendlyDate(row.booking_date),
});

/** One round-trip per category; `exec` is `db` or a transaction. */
export async function getDeletionBlockers(exec: { execute: (q: SQL) => Promise<{ rows: any[] }> }, scope: DeletionScope): Promise<DeletionBlockers> {
  if (scope.kind === "kitchens" && scope.kitchenIds.length === 0) {
    return { upcomingBookings: empty(), openClaims: empty(), pendingMoney: empty(), checkoutIncidents: empty(), openRentals: empty(), blocked: false };
  }
  const bw = bookingPredicate(scope);
  const claimScope = scope.kind === "user"
    ? sql`dc.chef_id = ${scope.userId} OR dc.manager_id = ${scope.userId} OR dc.kitchen_booking_id IN (SELECT kb.id FROM kitchen_bookings kb WHERE ${bw})`
    : scope.kind === "location"
      ? sql`dc.location_id = ${scope.locationId} OR dc.kitchen_booking_id IN (SELECT kb.id FROM kitchen_bookings kb WHERE ${bw})`
      : sql`dc.kitchen_booking_id IN (SELECT kb.id FROM kitchen_bookings kb WHERE ${bw})
        OR dc.storage_booking_id IN (SELECT sb.id FROM storage_bookings sb WHERE sb.storage_listing_id IN (SELECT id FROM storage_listings WHERE kitchen_id IN ${kitchensOfScope(scope)}))`;
  const rentalScope = scope.kind === "user"
    ? sql`(sb.chef_id = ${scope.userId} OR sl.kitchen_id IN ${kitchensOfScope(scope)})`
    : sql`sl.kitchen_id IN ${kitchensOfScope(scope)}`;
  const moneyScope = scope.kind === "user"
    ? sql`(kb.id IS NOT NULL OR sb.id IS NOT NULL OR pt.chef_id = ${scope.userId} OR pt.manager_id = ${scope.userId})`
    : sql`(kb.id IS NOT NULL OR sb.id IS NOT NULL)`;
  const incidentScope = scope.kind === "user" ? sql`i.chef_id = ${scope.userId} OR i.kitchen_id IN ${kitchensOfScope(scope)}` : sql`i.kitchen_id IN ${kitchensOfScope(scope)}`;

  const upcoming = await exec.execute(sql`
    SELECT kb.id, kb.reference_code, kb.booking_date, COUNT(*) OVER()::int AS total
    FROM kitchen_bookings kb
    WHERE ${bw} AND kb.status IN ('pending', 'confirmed', 'cancellation_requested') AND kb.booking_type <> 'manager_blocked'
    ORDER BY kb.booking_date, kb.id LIMIT ${REF_LIMIT}`);
  const claims = await exec.execute(sql`
    SELECT dc.id, dc.reference_code, COUNT(*) OVER()::int AS total
    FROM damage_claims dc
    WHERE (${claimScope}) AND dc.status::text NOT IN (${sql.join(OPEN_CLAIM_EXCLUDED.map(s => sql`${s}`), sql`, `)})
    ORDER BY dc.id LIMIT ${REF_LIMIT}`);
  // Authorized/processing money, a pending charge on a live booking, a refund still being recovered, or a payout not yet sent.
  const money = await exec.execute(sql`
    SELECT pt.id, COALESCE(kb.reference_code, sb.reference_code) AS reference_code, kb.id AS kb_id, COUNT(*) OVER()::int AS total
    FROM payment_transactions pt
    LEFT JOIN kitchen_bookings kb ON pt.booking_type IN ('kitchen', 'bundle') AND kb.id = pt.booking_id AND (${bw})
    LEFT JOIN storage_listings sl ON sl.id = (SELECT storage_listing_id FROM storage_bookings WHERE id = pt.booking_id AND pt.booking_type = 'storage')
    LEFT JOIN storage_bookings sb ON pt.booking_type = 'storage' AND sb.id = pt.booking_id AND (${rentalScope})
    WHERE ${moneyScope} AND (
      pt.status::text IN ('authorized', 'processing')
      OR (pt.status::text = 'pending' AND (kb.status::text <> 'cancelled' OR sb.rental_state IN ('requested', 'reserved', 'active', 'move_out_requested', 'removal_review')))
      OR COALESCE(pt.metadata->'cancellationRefundOperation'->>'status', '') IN ('executing', 'recovery_required')
      OR (pt.status::text IN ('succeeded', 'partially_refunded') AND pt.payout_timing IN ('after_closeout', 'storage_term') AND pt.transfer_id IS NULL
          AND COALESCE(pt.metadata->>'payoutNoEntitlement', 'false') <> 'true')
    ) ORDER BY pt.id LIMIT ${REF_LIMIT}`);
  const actions = await exec.execute(sql`
    SELECT a.id, kb.reference_code, COUNT(*) OVER()::int AS total
    FROM support_actions a JOIN kitchen_bookings kb ON kb.id = a.booking_id
    WHERE (${bw}) AND a.status IN ('executing', 'recovery_required') ORDER BY a.id LIMIT ${REF_LIMIT}`);
  const incidents = await exec.execute(sql`
    SELECT i.id, i.operating_date, COUNT(*) OVER()::int AS total
    FROM kitchen_checkout_incidents i
    WHERE (${incidentScope}) AND i.outcome IN ('inventory_conflict', 'needs_support', 'verifying')
      AND i.money_status IN ('unverified', 'refund_pending') ORDER BY i.id LIMIT ${REF_LIMIT}`);
  const rentals = await exec.execute(sql`
    SELECT sb.id, sb.reference_code, sb.term_start, COUNT(*) OVER()::int AS total
    FROM storage_bookings sb
    JOIN storage_listings sl ON sl.id = sb.storage_listing_id
    WHERE ${rentalScope} AND sb.rental_state IN (${sql.join(OPEN_RENTAL_STATES.map(state => sql`${state}`), sql`, `)})
    ORDER BY sb.term_start, sb.id LIMIT ${REF_LIMIT}`);

  const upcomingBookings = toBucket(upcoming.rows, bookingRef);
  const openClaims = toBucket(claims.rows, row => ({ ref: row.reference_code || `DC-${row.id}` }));
  // Booking references only: internal payment/case ids mean nothing to a kitchen or chef.
  const moneyBucket = toBucket(money.rows, row => ({ ref: row.reference_code || (row.kb_id ? `KB-${row.kb_id}` : 'a payment without a booking') }));
  const actionBucket = toBucket(actions.rows, row => ({ ref: row.reference_code || 'a support case' }));
  const pendingMoney = {
    total: moneyBucket.total + actionBucket.total,
    refs: [...moneyBucket.refs, ...actionBucket.refs].filter((r, i, all) => all.findIndex(o => o.ref === r.ref) === i).slice(0, REF_LIMIT),
  };
  // Never a payment-provider session id: the checkout's day is what people recognise.
  const checkoutIncidents = toBucket(incidents.rows, row => ({ ref: friendlyDate(row.operating_date) ? `Checkout for ${friendlyDate(row.operating_date)}` : 'A checkout' }));
  const openRentals = toBucket(rentals.rows, row => ({ ref: row.reference_code || `SB-${row.id}`, detail: friendlyDate(row.term_start) }));
  // A kitchen or location must not vanish under a visit that is still coming or an offer a customer can still accept
  // (owner, Oct 24). Account deletion keeps its own rule: open offers are removed with the account.
  let openTours = empty(), openInvitations = empty();
  if (scope.kind !== "user") {
    const tourScope = scope.kind === "location" ? sql`v.location_id = ${scope.locationId}` : sql`v.targeted_kitchen_id IN ${kitchensOfScope(scope)}`;
    const tours = await exec.execute(sql`
      SELECT v.id, v.scheduled_at, COUNT(*) OVER()::int AS total FROM kitchen_viewings v
      WHERE ${tourScope} AND v.status IN ('pending_local_cooks', 'pending', 'confirmed')
        AND v.scheduled_at + v.duration_minutes * interval '1 minute' > now()
      ORDER BY v.scheduled_at, v.id LIMIT ${REF_LIMIT}`);
    const invitationScope = scope.kind === "location" ? sql`i.location_id = ${scope.locationId}` : sql`i.kitchen_id IN ${kitchensOfScope(scope)}`;
    const offers = await exec.execute(sql`
      SELECT i.id, i.date, COUNT(*) OVER()::int AS total FROM kitchen_invitations i
      WHERE ${invitationScope} AND i.status = 'sent' AND i.expires_at > now()
      ORDER BY i.expires_at, i.id LIMIT ${REF_LIMIT}`);
    openTours = toBucket(tours.rows, row => ({ ref: `TOUR-${row.id}`, detail: friendlyDate(row.scheduled_at) }));
    openInvitations = toBucket(offers.rows, row => ({ ref: friendlyDate(row.date) ? `Offer for ${friendlyDate(row.date)}` : 'An offer' }));
  }
  const blocked = upcomingBookings.total + openClaims.total + pendingMoney.total + checkoutIncidents.total + openRentals.total
    + openTours.total + openInvitations.total > 0;
  return { upcomingBookings, openClaims, pendingMoney, checkoutIncidents, openRentals, ...(scope.kind !== "user" ? { openTours, openInvitations } : {}), blocked };
}

/** Does anything that must be kept (bookings other than manager blocks, claims, incidents) still reference the scope? */
export async function hasDeletionHistory(exec: { execute: (q: SQL) => Promise<{ rows: any[] }> }, scope: DeletionScope): Promise<boolean> {
  if (scope.kind === "kitchens" && scope.kitchenIds.length === 0) return false;
  const bw = bookingPredicate(scope);
  const claimScope = scope.kind === "user"
    ? sql`dc.chef_id = ${scope.userId} OR dc.manager_id = ${scope.userId}`
    : scope.kind === "location" ? sql`dc.location_id = ${scope.locationId}` : sql`FALSE`;
  const incidentScope = scope.kind === "user" ? sql`i.chef_id = ${scope.userId} OR i.kitchen_id IN ${kitchensOfScope(scope)}` : sql`i.kitchen_id IN ${kitchensOfScope(scope)}`;
  const result = await exec.execute(sql`SELECT (
      EXISTS (SELECT 1 FROM kitchen_bookings kb WHERE ${bw} AND kb.booking_type <> 'manager_blocked')
      OR EXISTS (SELECT 1 FROM damage_claims dc WHERE ${claimScope}
        OR dc.kitchen_booking_id IN (SELECT kb.id FROM kitchen_bookings kb WHERE ${bw}))
      OR EXISTS (SELECT 1 FROM kitchen_checkout_incidents i WHERE ${incidentScope})
      OR EXISTS (SELECT 1 FROM storage_bookings sb WHERE sb.storage_listing_id IN (SELECT id FROM storage_listings WHERE kitchen_id IN ${kitchensOfScope(scope)})${scope.kind === "user" ? sql` OR sb.chef_id = ${scope.userId}` : sql``})
      OR EXISTS (SELECT 1 FROM payment_transactions pt WHERE ${scope.kind === "user" ? sql`pt.chef_id = ${scope.userId} OR pt.manager_id = ${scope.userId}` : sql`pt.booking_type IN ('kitchen', 'bundle') AND pt.booking_id IN (SELECT kb.id FROM kitchen_bookings kb WHERE ${bw})`})
    ) AS has_history`);
  return Boolean(result.rows[0]?.has_history);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const list = (refs: DeletionRef[], total: number) =>
  `${refs.map(r => (r.detail ? `${r.ref}, ${r.detail}` : r.ref)).join("; ")}${total > refs.length ? `; and ${total - refs.length} more` : ""}`;

/** Plain, calm message: what references it, then what to do. */
export function describeDeletionBlockers(subject: DeletionSubject, b: DeletionBlockers): string {
  const parts: string[] = [];
  if (b.upcomingBookings.total) parts.push(`${plural(b.upcomingBookings.total, "upcoming or unfinished booking", "upcoming or unfinished bookings")} (${list(b.upcomingBookings.refs, b.upcomingBookings.total)})`);
  if (b.openClaims.total) parts.push(`${plural(b.openClaims.total, "open damage claim", "open damage claims")} (${list(b.openClaims.refs, b.openClaims.total)})`);
  if (b.pendingMoney.total) parts.push(`${plural(b.pendingMoney.total, "payment, refund or payout still in progress", "payments, refunds or payouts still in progress")} (${list(b.pendingMoney.refs, b.pendingMoney.total)})`);
  if (b.checkoutIncidents.total) parts.push(`${plural(b.checkoutIncidents.total, "checkout waiting on Local Cooks", "checkouts waiting on Local Cooks")} (${list(b.checkoutIncidents.refs, b.checkoutIncidents.total)})`);
  if (b.openRentals?.total) parts.push(`${plural(b.openRentals.total, "open storage rental", "open storage rentals")} (${list(b.openRentals.refs, b.openRentals.total)})`);
  if (b.openTours?.total) parts.push(`${plural(b.openTours.total, "upcoming kitchen tour", "upcoming kitchen tours")} (${list(b.openTours.refs, b.openTours.total)})`);
  if (b.openInvitations?.total) parts.push(`${plural(b.openInvitations.total, "booking offer a customer can still accept", "booking offers customers can still accept")} (${list(b.openInvitations.refs, b.openInvitations.total)})`);
  const what = subject === "account" ? "This account has" : `This ${subject} has`;
  const rentals = b.openRentals?.total ? " and storage rentals" : "";
  const openItems = [b.openTours?.total ? "cancel the tours" : "", b.openInvitations?.total ? "withdraw the offers" : ""].filter(Boolean).join(" and ");
  const alsoOpen = openItems ? `, ${openItems}` : "";
  const next = subject === "kitchen"
    ? `Cancel or finish the bookings${rentals}${alsoOpen} and resolve the claims and payments first, or take the kitchen off the listing instead.`
    : subject === "location"
      ? `Cancel or finish the bookings${rentals}${alsoOpen} and resolve the claims and payments first, or take its kitchens off the listing instead.`
      : `Cancel or finish the bookings${rentals} and resolve the claims and payments first, then delete the account. Contact Local Cooks if you need help.`;
  return `${what} ${parts.join(", ")}. ${next}`;
}

/** True when a Postgres foreign key (RESTRICT) refused the delete because history appeared mid-flight. */
export function isForeignKeyViolation(error: any): boolean {
  return error?.code === "23503" || error?.cause?.code === "23503";
}
