/**
 * Before capture Stripe has not charged a fee yet (the charge has no balance transaction), so the kitchen sees an estimate.
 * The rate is the admin's card-fee setting (Stripe Canada standard pricing unless Local Cooks has custom pricing), plus
 * Stripe's international-card surcharge when the held card was issued outside Canada. Charges are in CAD, so no conversion
 * fee applies. The actual fee replaces this once the chef is charged.
 */
export type CardFeeRate = { percent: number; fixedCents: number };

/** shortcut: Stripe Canada's published international-card surcharge; make it an admin setting if Stripe changes it. */
export const INTERNATIONAL_CARD_SURCHARGE = 0.008;

/** The rate for the card that was actually held. */
export function cardFeeRate(base: CardFeeRate, cardCountry?: string | null): CardFeeRate {
  return cardCountry && cardCountry !== 'CA' ? { ...base, percent: base.percent + INTERNATIONAL_CARD_SURCHARGE } : base;
}

export function estimateCardFeeCents(amountCents: number, rate: CardFeeRate) {
  if (!(amountCents > 0)) return 0;
  return Math.round(amountCents * rate.percent + rate.fixedCents);
}

/**
 * A display estimate when the rate is known, else the server's estimate scaled to the amount (an older response).
 * Never a rate typed into the page.
 */
export function cardFeeForAmount(amountCents: number, rate?: CardFeeRate | null, serverEstimate?: { amountCents: number; feeCents: number } | null) {
  if (rate) return estimateCardFeeCents(amountCents, rate);
  if (!serverEstimate?.amountCents) return 0;
  return Math.round(serverEstimate.feeCents * amountCents / serverEstimate.amountCents);
}
