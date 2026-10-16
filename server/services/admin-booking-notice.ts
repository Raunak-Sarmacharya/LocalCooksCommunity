import { collapseDoublePeriods } from '@shared/i18n/sentence';

/**
 * Local Cooks (admin) copy of the booking events the owner wants to track (Oct 15): bookings & money, and problems.
 * Admins get their own factual summary — never the chef's or kitchen's second-person wording. Email still goes only to
 * admins with operational email on (`users.admin_email_notifications`); routine reminders and visit milestones are excluded.
 */
export const ADMIN_BOOKING_KINDS = new Set([
  // Bookings & money
  'requested', 'confirmed', 'cancelled', 'cancellation_reviewed', 'storage_cancellation_reviewed', 'refund_issued',
  'payout_released', 'payout_on_hold', 'payment_recovery_needed', 'booking_changed', 'addon_removed',
  // Problems
  'report_attended', 'report_no_show', 'checkout_claim_filed',
]);

/**
 * Local Cooks' tracking list for standalone storage rentals (WP-ST3): money and legal events only, in the same
 * factual voice as `ADMIN_BOOKING_KINDS`. Reminders, move-in/move-out milestones and ending notices are excluded.
 */
export const ADMIN_STORAGE_KINDS = new Set([
  'storage_requested', 'storage_expired', 'storage_confirmed', 'storage_extension_paid',
  'storage_refund_issued', 'storage_payout_released', 'storage_payout_on_hold',
  'storage_holdover_raised', 'storage_holdover_waived', 'storage_holdover_disputed',
  'storage_reclaim_served', 'storage_removal_review', 'storage_kitchen_debt', 'storage_payment_recovery',
]);

type Cancellation = { cause?: 'chef' | 'kitchen'; refundCents?: number; feeCents?: number; kitchenShareRetainedCents?: number; feePending?: boolean };
type Addon = { state?: string; itemName: string; free?: boolean; afterDeadline?: boolean; refundCents?: number; kitchenRefundCents?: number; kitchenDebtCents?: number; feeCents?: number };
export type AdminBookingFacts = {
  chef: string; kitchen: string; reference: string; when: string; message: string; locale?: string | null;
  cancellation?: Cancellation; addon?: Addon; requestExpired?: boolean; requestOutcome?: 'declined' | 'withdrawn' | 'support' | 'replaced'; payoutCents?: number;
  /** A new request that replaces an earlier one of the same chef ("Change request"). */ replacesRef?: string; replacedByRef?: string; holdReason?: string | null;
  /** Paid through a kitchen's invitation: its kitchen-time price and the listed price. */ invitation?: { listCents?: number; offeredCents?: number };
};

export function adminBookingNotice(kind: string, facts: AdminBookingFacts): { title: string; message: string } | undefined {
  if (!ADMIN_BOOKING_KINDS.has(kind)) return undefined;
  const money = (cents = 0) => new Intl.NumberFormat(facts.locale || 'en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const who = `${facts.chef} at ${facts.kitchen} · ${facts.when} · ${facts.reference}`;
  switch (kind) {
    case 'requested':
      return { title: `New booking request · ${facts.chef}`, message: `${who}. The chef's card is on hold until the kitchen responds.${facts.replacesRef ? ` (replaces ${facts.replacesRef})` : ''}` };
    case 'confirmed':
      if (facts.invitation) return { title: `Booking confirmed · ${facts.chef}`, message: `${who}. Booked through the kitchen's invitation (kitchen time ${money(facts.invitation.offeredCents)}${facts.invitation.listCents && facts.invitation.listCents !== facts.invitation.offeredCents ? `, listed ${money(facts.invitation.listCents)}` : ''}); the chef paid and their card was charged.` };
      return { title: `Booking confirmed · ${facts.chef}`, message: `${who}. The kitchen accepted and the chef's card was charged.` };
    case 'cancelled': {
      if (facts.requestExpired) return { title: `Request expired · ${facts.chef}`, message: `${who}. The kitchen didn't respond in time; the card hold was released.` };
      if (facts.requestOutcome === 'declined') return { title: `Request declined · ${facts.chef}`, message: `${who}. ${facts.kitchen} declined the request; the card hold was released.` };
      if (facts.requestOutcome === 'replaced') return { title: `Request replaced · ${facts.chef}`, message: `${who}. The chef sent a new request${facts.replacedByRef ? ` (${facts.replacedByRef})` : ''} in its place; the card hold was released.` };
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
    case 'addon_removed': {
      const a = facts.addon;
      if (!a) return { title: `Add-on removed · ${facts.reference}`, message: `${who}. ${facts.message}` };
      const moneyLine = a.free ? 'It wasn’t charged.' : a.state === 'fee_pending' ? 'Refund waiting for the actual processing fee to be verified.'
        : !(a.refundCents || 0) ? 'Not refundable: the refund deadline had passed.'
        : [`${a.state === 'processing' ? 'Processing refund' : 'Refunded'} ${money(a.refundCents)}.`, `Kitchen payout −${money(a.kitchenRefundCents)}.`,
          (a.feeCents || 0) > 0 ? `Card fee kept: ${money(a.feeCents)}.` : '', (a.kitchenDebtCents || 0) > 0 ? `The kitchen owes Local Cooks ${money(a.kitchenDebtCents)}.` : ''].filter(Boolean).join(' ');
      return { title: `Add-on removed · ${facts.reference}`, message: `${facts.chef} removed ${a.itemName} at ${facts.kitchen} · ${facts.when} · ${facts.reference}. ${moneyLine}` };
    }
    case 'refund_issued':
      return { title: `Refund issued · ${facts.reference}`, message: `${who}. ${facts.message}` };
    // The chef moved a confirmed booking and the kitchen approved (the message carries the old and new time and the money).
    case 'booking_changed':
      return { title: `Booking changed · ${facts.reference}`, message: `${who}. ${facts.message}` };
    case 'payout_released':
      return { title: `Payout sent · ${facts.kitchen}${facts.payoutCents ? ` · ${money(facts.payoutCents)}` : ''}`, message: `${who}. Transferred to the kitchen's Stripe account.` };
    case 'payout_on_hold':
      return { title: `Payout on hold · ${facts.kitchen}`, message: `${who}. ${facts.holdReason || facts.message}` };
    case 'payment_recovery_needed':
      return { title: `Payment needs attention · ${facts.reference}`, message: `${who}. ${facts.message}` };
    case 'report_attended':
      return { title: `Attendance reported · ${facts.reference}`, message: `${who}. ${facts.message}` };
    // No refund follows (owner, Oct 15); the chef can contest it with "I was there", which reaches support.
    case 'report_no_show':
      return { title: `No-show reported · ${facts.chef}`, message: `${who}. ${facts.message} No-shows aren’t refunded. If the chef says they were there, it comes to support as a problem report.` };
    case 'checkout_claim_filed':
      return { title: `Issue reported at checkout · ${facts.reference}`, message: `${who}. ${facts.message}` };
  }
  return undefined;
}

export type AdminStorageFacts = {
  chef: string; kitchen: string; listing: string; reference: string; when: string; message?: string;
  locale?: string | null;
  /** Money in cents; each kind labels its own amount (hold, charge, payout, refund). */
  amountCents?: number; days?: number;
  /** Kitchen-local dates, already formatted for the reader's locale. */
  paidThrough?: string; byDate?: string; deadline?: string;
  holdReason?: string | null;
};

/** Local Cooks' factual summary for a storage-rental event; never the chef's or kitchen's second-person wording. */
export function adminStorageNotice(kind: string, facts: AdminStorageFacts): { title: string; message: string } | undefined {
  const notice = storageNoticeCopy(kind, facts);
  // This copy is built outside i18n, so collapse the double period a time-suffixed deadline would create.
  return notice && { title: collapseDoublePeriods(notice.title), message: collapseDoublePeriods(notice.message) };
}

function storageNoticeCopy(kind: string, facts: AdminStorageFacts): { title: string; message: string } | undefined {
  if (!ADMIN_STORAGE_KINDS.has(kind)) return undefined;
  const money = (cents = 0) => new Intl.NumberFormat(facts.locale || 'en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const who = `${facts.chef} at ${facts.kitchen} · ${facts.listing} · ${facts.reference}`;
  const days = `${facts.days ?? 0} ${(facts.days ?? 0) === 1 ? 'day' : 'days'}`;
  switch (kind) {
    case 'storage_requested':
      return { title: `New storage request · ${facts.chef}`, message: `${who}. ${facts.when}. The chef's card is on hold until the kitchen answers.` };
    case 'storage_expired':
      return { title: `Storage request expired · ${facts.chef}`, message: `${who}. The kitchen didn't answer in time; the card hold was released.` };
    case 'storage_confirmed':
      return { title: `Storage confirmed · ${facts.chef}`, message: `${who}. The kitchen accepted and the chef's card was charged ${money(facts.amountCents)}.` };
    case 'storage_extension_paid':
      return { title: `Storage extension paid · ${facts.chef}`, message: `${who}. The chef paid ${money(facts.amountCents)}; storage now runs to ${facts.paidThrough || 'the new end date'}.` };
    case 'storage_refund_issued':
      return { title: `Storage refund issued · ${facts.reference}`, message: `${who}. Refunded ${money(facts.amountCents)}.` };
    case 'storage_payout_released':
      return { title: `Storage payout sent · ${facts.kitchen}${facts.amountCents ? ` · ${money(facts.amountCents)}` : ''}`, message: `${who}. Transferred to the kitchen's Stripe account.` };
    case 'storage_payout_on_hold':
      return { title: `Storage payout on hold · ${facts.kitchen}`, message: `${who}. ${facts.holdReason || facts.message || 'Paused while Local Cooks reviews an open issue.'}` };
    case 'storage_holdover_raised':
      return { title: `Holdover charge raised · ${facts.chef}`, message: `${who}. ${money(facts.amountCents)} for ${days}; the chef can dispute by ${facts.deadline || 'the recorded deadline'}.` };
    case 'storage_holdover_waived':
      return { title: `Holdover charge waived · ${facts.chef}`, message: `${who}. The kitchen waived the holdover charge.` };
    case 'storage_holdover_disputed':
      return { title: `Holdover charge disputed · ${facts.chef}`, message: `${who}. The chef disputed the charge; Local Cooks decides.` };
    case 'storage_reclaim_served':
      return { title: `Move-out notice served · ${facts.chef}`, message: `${who}. The kitchen asks the chef to move out by ${facts.byDate || 'the notice date'}; unused days are refunded.` };
    case 'storage_removal_review':
      return { title: `Storage removal review · ${facts.chef}`, message: `${who}. ${facts.message || 'Removal review opened; the kitchen may act only after the final-notice deadlines.'}` };
    case 'storage_kitchen_debt':
      return { title: `Kitchen debt recorded · ${facts.kitchen}`, message: `${who}. A refund of ${money(facts.amountCents)} couldn't be recovered from the kitchen's balance; the kitchen owes Local Cooks.` };
    case 'storage_payment_recovery':
      return { title: `Storage payment needs attention · ${facts.reference}`, message: `${who}. ${facts.message || 'Verify the current state before retrying any money movement.'}` };
  }
  return undefined;
}
