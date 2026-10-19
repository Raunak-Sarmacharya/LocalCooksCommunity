export type CheckoutOutcome = {
  state: 'request_created' | 'verifying' | 'slot_taken' | 'needs_support';
  sessionId: string; bookingId: number | null; paymentIntentId: string | null; referenceCode?: string | null;
  operatingDate: string; amountCents: number | null; currency: string;
  /** Every day of a multi-day checkout; empty or one entry for a single day. */
  dates?: string[];
  moneyStatus: string; refundId: string | null; lastCheckedAt: string | Date | null;
  /** Present when this request replaced an earlier one ("Change request"): how the earlier request ended. */
  /** Booked through a kitchen's invitation: paying confirms it (no kitchen review). `confirmed` once that's recorded. */
  invitation?: boolean; confirmed?: boolean;
  /** The booked kitchen, for the "Need storage too?" prompt. */
  kitchenId?: number;
  replacement?: { outcome: 'pending' | 'withdrawn' | 'releasing' | 'two_bookings' | 'ended' | 'needs_support'; oldBookingId: number; oldReference: string | null; newReference: string | null; kitchenName: string | null };
};
