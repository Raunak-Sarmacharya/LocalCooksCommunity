export class BookingTermsReviewRequired extends Error {
  readonly status = 409;
  readonly code = 'BOOKING_PAYMENT_REVIEW_REQUIRED';
  constructor() { super('The original checkout terms cannot be verified. Local Cooks must review this booking before it can be accepted.'); }
}

function cents(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new BookingTermsReviewRequired();
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new BookingTermsReviewRequired();
  return amount;
}

export function bookingCaptureTerms(metadata: Record<string, string>, authorizedAmount: number) {
  if (metadata.fee_model !== 'separate-charge-commission-v1') throw new BookingTermsReviewRequired();
  const subtotal = cents(metadata.total_price_cents);
  const tax = cents(metadata.tax_cents);
  const commission = cents(metadata.platform_fee_cents);
  const rate = metadata.tax_rate_percent?.trim() ? Number(metadata.tax_rate_percent) : NaN;
  if (subtotal <= 0 || !Number.isFinite(rate) || rate < 0 || rate > 100
    || Math.round(subtotal * rate / 100) !== tax
    || !Number.isSafeInteger(authorizedAmount) || subtotal + tax + commission !== authorizedAmount)
    throw new BookingTermsReviewRequired();
  return { subtotal, tax, commission, rate, authorizedAmount };
}

export function approvedBookingCapture(terms: ReturnType<typeof bookingCaptureTerms>, approvedSubtotal: number) {
  if (!Number.isSafeInteger(approvedSubtotal) || approvedSubtotal <= 0 || approvedSubtotal > terms.subtotal)
    throw new BookingTermsReviewRequired();
  // Scale agreed fee cents; integer half-up rounding avoids reconstructing an admin rate.
  const commission = Number((BigInt(terms.commission) * BigInt(approvedSubtotal) * BigInt(2) + BigInt(terms.subtotal)) / (BigInt(terms.subtotal) * BigInt(2)));
  const tax = Math.round(approvedSubtotal * terms.rate / 100);
  const amount = approvedSubtotal + tax + commission;
  if (!Number.isSafeInteger(amount) || amount > terms.authorizedAmount) throw new BookingTermsReviewRequired();
  return { commission, tax, amount };
}
