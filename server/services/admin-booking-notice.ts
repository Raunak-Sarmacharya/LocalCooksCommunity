/**
 * Local Cooks (admin) copy of the booking events the owner wants to track (Oct 15): bookings & money, and problems.
 * Admins get their own factual summary — never the chef's or kitchen's second-person wording. Email still goes only to
 * admins with operational email on (`users.admin_email_notifications`); routine reminders and visit milestones are excluded.
 */
export const ADMIN_BOOKING_KINDS = new Set([
  // Bookings & money
  'requested', 'confirmed', 'cancelled', 'cancellation_reviewed', 'storage_cancellation_reviewed', 'refund_issued',
  'payout_released', 'payout_on_hold', 'payment_recovery_needed',
  // Problems
  'report_attended', 'checkout_claim_filed',
]);

type Cancellation = { cause?: 'chef' | 'kitchen'; refundCents?: number; feeCents?: number; kitchenShareRetainedCents?: number; feePending?: boolean };
export type AdminBookingFacts = {
  chef: string; kitchen: string; reference: string; when: string; message: string; locale?: string | null;
  cancellation?: Cancellation; requestExpired?: boolean; requestOutcome?: 'declined' | 'withdrawn' | 'support'; payoutCents?: number; holdReason?: string | null;
};

export function adminBookingNotice(kind: string, facts: AdminBookingFacts): { title: string; message: string } | undefined {
  if (!ADMIN_BOOKING_KINDS.has(kind)) return undefined;
  const money = (cents = 0) => new Intl.NumberFormat(facts.locale || 'en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const who = `${facts.chef} at ${facts.kitchen} · ${facts.when} · ${facts.reference}`;
  switch (kind) {
    case 'requested':
      return { title: `New booking request · ${facts.chef}`, message: `${who}. The chef's card is on hold until the kitchen responds.` };
    case 'confirmed':
      return { title: `Booking confirmed · ${facts.chef}`, message: `${who}. The kitchen accepted and the chef's card was charged.` };
    case 'cancelled': {
      if (facts.requestExpired) return { title: `Request expired · ${facts.chef}`, message: `${who}. The kitchen didn't respond in time; the card hold was released.` };
      if (facts.requestOutcome === 'declined') return { title: `Request declined · ${facts.chef}`, message: `${who}. ${facts.kitchen} declined the request; the card hold was released.` };
      if (facts.requestOutcome === 'withdrawn') return { title: `Request withdrawn · ${facts.chef}`, message: `${who}. The chef withdrew the request; the card hold was released.` };
      if (facts.requestOutcome === 'support') return { title: `Request released by Local Cooks · ${facts.chef}`, message: `${who}. Local Cooks released the request; the card hold was released.` };
      const c = facts.cancellation;
      if (!c) return { title: `Booking cancelled · ${facts.reference}`, message: `${who}. ${facts.message}` };
      const by = c.cause === 'kitchen' ? `${facts.kitchen} cancelled` : `${facts.chef} cancelled`;
      const money_ = c.feePending ? 'Refund waiting for the actual processing fee to be verified.'
        : [(c.refundCents || 0) > 0 ? `Refunded ${money(c.refundCents)}.` : 'No refund under the kitchen’s policy.',
          (c.refundCents || 0) > 0 && (c.feeCents || 0) > 0 ? `Processing fee kept: ${money(c.feeCents)}.` : '',
          (c.kitchenShareRetainedCents || 0) > 0 ? `Kitchen keeps ${money(c.kitchenShareRetainedCents)} under its policy.` : ''].filter(Boolean).join(' ');
      return { title: `Booking cancelled · ${facts.reference}`, message: `${by} — ${who}. ${money_}` };
    }
    case 'cancellation_reviewed': case 'storage_cancellation_reviewed':
      return { title: `Cancellation request answered · ${facts.reference}`, message: `${who}. ${facts.message}` };
    case 'refund_issued':
      return { title: `Refund issued · ${facts.reference}`, message: `${who}. ${facts.message}` };
    case 'payout_released':
      return { title: `Payout sent · ${facts.kitchen}${facts.payoutCents ? ` · ${money(facts.payoutCents)}` : ''}`, message: `${who}. Transferred to the kitchen's Stripe account.` };
    case 'payout_on_hold':
      return { title: `Payout on hold · ${facts.kitchen}`, message: `${who}. ${facts.holdReason || facts.message}` };
    case 'payment_recovery_needed':
      return { title: `Payment needs attention · ${facts.reference}`, message: `${who}. ${facts.message}` };
    case 'report_attended':
      return { title: `Attendance reported · ${facts.reference}`, message: `${who}. ${facts.message}` };
    case 'checkout_claim_filed':
      return { title: `Issue reported at checkout · ${facts.reference}`, message: `${who}. ${facts.message}` };
  }
  return undefined;
}
