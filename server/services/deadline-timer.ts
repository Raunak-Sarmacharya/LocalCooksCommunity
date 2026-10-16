import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { kitchenBookings } from '@shared/schema';
import type { db as Database } from '../db';
import { logger } from '../logger';
import { isE2eOutboundSuppressed } from '../e2e-outbound-guard';

/**
 * Exact deadlines (WP-T). Waiting for a deadline costs nothing: an Inngest function sleeps until the instant and then runs
 * the SAME idempotent per-item expiry the recurring worker uses, scoped to that one id. Every producer sends the event
 * best-effort after it saves a deadline; a failed send never fails the user's action, because the worker tick stays
 * the backstop. Sending twice (or the worker winning the race) is harmless: each expiry re-checks its row under lock.
 */
export const deadlineScheduledEvent = 'localcooks/deadline.scheduled';
export type DeadlineKind = 'extension' | 'booking_request' | 'closeout' | 'kitchen_change' | 'storage_request';
export const deadlineKinds: readonly DeadlineKind[] = ['extension', 'booking_request', 'closeout', 'kitchen_change', 'storage_request'];
/** Runs just after the deadline so "now >= deadline" holds even with small clock differences. */
export const deadlineGraceMs = 5_000;
/** Inngest sleeps are bounded (plan limits); anything further out is picked up by the tick, then re-armed. */
export const deadlineHorizonMs = 6 * 86_400_000;

const timersEnabled = () => !!process.env.INNGEST_EVENT_KEY && !isE2eOutboundSuppressed();

/** Best-effort, never throws, never awaits the network. `dueAt` null/past-horizon is a no-op (the tick covers it). */
export function scheduleDeadlineTimer(kind: DeadlineKind, id: number, dueAt: Date | string | null | undefined, now = Date.now()) {
  try {
    if (!dueAt || !timersEnabled() || !Number.isSafeInteger(id) || id <= 0) return;
    const due = new Date(dueAt);
    if (!Number.isFinite(due.getTime()) || due.getTime() - now > deadlineHorizonMs) return;
    const dueIso = due.toISOString();
    void import('../lifecycle-inngest')
      // The event id dedupes repeat sends of the same deadline (retries, replays) inside Inngest.
      .then(({ inngest }) => inngest.send({ id: `deadline:${kind}:${id}:${due.getTime()}`, name: deadlineScheduledEvent, data: { kind, id, dueAt: dueIso } }))
      .catch(error => logger.warn('[Deadlines] Timer not sent; the worker tick will expire it', { kind, id, error: error instanceof Error ? error.message : String(error) }));
  } catch (error) {
    logger.warn('[Deadlines] Timer not scheduled; the worker tick will expire it', { kind, id, error: error instanceof Error ? error.message : String(error) });
  }
}

/** A kitchen request is answered by its response deadline; computed with the caller's reader so it sees an uncommitted row. */
export async function scheduleBookingRequestTimer(reader: Pick<typeof Database, 'select'>, bookingId: number) {
  if (!timersEnabled()) return;
  try {
    const [booking] = await reader.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (!booking || booking.status !== 'pending' || booking.paymentStatus !== 'authorized' || !booking.createdAt) return;
    const { getBookingResponseDeadline } = await import('./booking-response-deadline');
    scheduleDeadlineTimer('booking_request', bookingId, await getBookingResponseDeadline(booking, reader));
  } catch (error) {
    logger.warn('[Deadlines] Request timer not scheduled; the worker tick will expire it', { bookingId, error: error instanceof Error ? error.message : String(error) });
  }
}

async function expiryStripe(): Promise<Stripe | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  const { default: StripeClient } = await import('stripe');
  return new StripeClient(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
}

/** The timer's work: one id, the same idempotent expiry the worker runs. Throws on failure so Inngest retries it. */
export async function runDeadlineExpiry(kind: DeadlineKind, id: number, now = new Date()) {
  if (kind === 'storage_request') {
    return { kind, ...await (await import('./storage-rentals')).expireRental(id, now) };
  }
  if (kind === 'extension') {
    const stripe = await expiryStripe();
    if (!stripe) return { kind, skipped: 'stripe_unconfigured' };
    return { kind, ...await (await import('./session-extensions')).expireSessionExtension(stripe, id, now) };
  }
  if (kind === 'booking_request') {
    const { db } = await import('../db');
    const [booking] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, id)).limit(1);
    if (!booking) return { kind, expired: false };
    const { lazyExpireKitchenBookingAuth } = await import('./auth-expiry-service');
    return { kind, expired: await lazyExpireKitchenBookingAuth(booking) };
  }
  if (kind === 'closeout') {
    const { persistBookingCloseout } = await import('./clock-closeout');
    const { db } = await import('../db');
    const result = await db.transaction(tx => persistBookingCloseout(id, tx, now));
    // The payout engine re-checks eligibility under its own lock; it defers while anything is still open.
    if (result.changed) await (await import('./kitchen-payout-service')).releaseKitchenPayout(id, 'closeout_timer', now)
      .catch(error => logger.error('[Payout] Closeout saved; payout will retry from the sweep', { bookingId: id, error }));
    return { kind, changed: result.changed };
  }
  if (kind === 'kitchen_change') {
    // The id is the booking id: one change is open per booking, so the expiry re-reads whichever one is overdue.
    const changes = await import('./kitchen-booking-changes');
    return { kind, ...await changes.expireKitchenChangeForBooking(await changes.changeProviderStripe(), id, now) };
  }
  throw Error('Unknown deadline kind');
}
