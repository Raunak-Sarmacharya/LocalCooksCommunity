export type CheckoutOutcome = {
  state: 'request_created' | 'verifying' | 'slot_taken' | 'needs_support';
  sessionId: string; bookingId: number | null; paymentIntentId: string | null; referenceCode?: string | null;
  operatingDate: string; amountCents: number | null; currency: string;
  moneyStatus: string; refundId: string | null; lastCheckedAt: string | Date | null;
};
