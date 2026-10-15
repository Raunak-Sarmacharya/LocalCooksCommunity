/**
 * Read-only: the other money a chef paid on a kitchen booking besides its own charge, i.e. session extensions,
 * extra-time charges and damage/cleaning claim payments. Each is its own `payment_transactions` row with the same
 * booking id (`booking_type = 'kitchen'`) and a different PaymentIntent. Used by the booking-details responses so the
 * booking page can show the true total. Role-scoped: the chef gets what they paid; the kitchen also gets its share.
 * No writes, no provider calls.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { paymentTransactions } from '@shared/schema';

export type AdditionalChargeKind = 'extension' | 'extra_time' | 'damage_claim';
export interface AdditionalCharge {
  id: number;
  kind: AdditionalChargeKind;
  /** Booked minutes added (extensions / extra time); null for claims. */
  minutes: number | null;
  /** What the chef paid for this line, in cents. */
  amountCents: number;
  /** Manager view only: what the kitchen nets from this line, in cents (after its card processing fee; claims carry none). */
  kitchenShareCents?: number;
  refundedCents: number;
  paidAt: string | null;
  status: string;
}

type Row = { id: number; amount: string | number | null; managerRevenue: string | number | null; stripeProcessingFee?: string | number | null; refundAmount: string | number | null;
  status: string; paidAt: Date | string | null; paymentIntentId: string | null; metadata: unknown };

const PAID = ['succeeded', 'partially_refunded', 'refunded'] as const;
const cents = (value: string | number | null | undefined) => { const n = Math.round(Number(value ?? 0)); return Number.isFinite(n) ? n : 0; };

export function chargeKind(metadata: unknown): AdditionalChargeKind | null {
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
  if (meta.type === 'damage_claim' || meta.damage_claim_id != null) return 'damage_claim';
  if (meta.type === 'session_extension' || meta.sessionExtensionId != null) return meta.extensionKind === 'extra_time' ? 'extra_time' : 'extension';
  return null;
}

/** Pure: rows → role-scoped lines. The parent booking charge and anything unpaid or unrecognised are left out. */
export function toAdditionalCharges(rows: Row[], role: 'chef' | 'manager', parentPaymentIntentId?: string | null): AdditionalCharge[] {
  return rows.flatMap(row => {
    const kind = chargeKind(row.metadata);
    if (!kind || !(PAID as readonly string[]).includes(row.status)) return [];
    if (parentPaymentIntentId && row.paymentIntentId === parentPaymentIntentId) return [];
    const meta = (row.metadata || {}) as Record<string, unknown>;
    // A claim Local Cooks funded (compensation recovery) was never the kitchen's money from this row.
    // Extensions and extra time carry their own processing fee like the booking charge; Local Cooks absorbs it on claims.
    const kitchenShare = kind === 'damage_claim' ? (meta.fundedBy === 'local_cooks' || meta.platformRecovery === true ? 0 : cents(row.managerRevenue))
      : Math.max(0, cents(row.managerRevenue) - cents(row.stripeProcessingFee));
    const minutes = kind === 'damage_claim' ? null : Number.isFinite(Number(meta.minutes)) ? Number(meta.minutes) : null;
    const line: AdditionalCharge = { id: row.id, kind, minutes, amountCents: cents(row.amount), refundedCents: cents(row.refundAmount),
      paidAt: row.paidAt ? new Date(row.paidAt).toISOString() : null, status: row.status };
    return [role === 'manager' ? { ...line, kitchenShareCents: kitchenShare } : line];
  });
}

/** Reads the booking's extra charge rows (same booking, other PaymentIntents) and maps them for the viewer. */
export async function readAdditionalCharges(db: any, bookingId: number, role: 'chef' | 'manager', parentPaymentIntentId?: string | null): Promise<AdditionalCharge[]> {
  const rows: Row[] = await db.select({
    id: paymentTransactions.id, amount: paymentTransactions.amount, managerRevenue: paymentTransactions.managerRevenue, stripeProcessingFee: paymentTransactions.stripeProcessingFee,
    refundAmount: paymentTransactions.refundAmount, status: paymentTransactions.status, paidAt: paymentTransactions.paidAt,
    paymentIntentId: paymentTransactions.paymentIntentId, metadata: paymentTransactions.metadata,
  }).from(paymentTransactions).where(and(
    eq(paymentTransactions.bookingId, bookingId),
    eq(paymentTransactions.bookingType, 'kitchen'),
    inArray(paymentTransactions.status, [...PAID]),
    sql`(${paymentTransactions.metadata} ? 'sessionExtensionId' OR ${paymentTransactions.metadata}->>'type' IN ('session_extension', 'damage_claim') OR ${paymentTransactions.metadata} ? 'damage_claim_id')`,
  )).orderBy(asc(paymentTransactions.id)).limit(50);
  return toAdditionalCharges(rows, role, parentPaymentIntentId);
}
