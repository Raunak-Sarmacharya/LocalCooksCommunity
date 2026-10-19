/**
 * Before capture Stripe has not charged a fee yet (the charge has no balance transaction), so the kitchen sees an estimate.
 * The held card's country sets the rate: Stripe Canada standard pricing is 2.9% + 30¢ for Canadian cards and 0.8% more for
 * international cards (charges are in CAD, so no conversion fee). The actual fee replaces this once the chef is charged.
 * shortcut: standard Stripe Canada rates; switch to the account's own rates if Local Cooks moves to custom Stripe pricing.
 */
export function estimateCardFeeCents(amountCents: number, cardCountry?: string | null) {
  if (!(amountCents > 0)) return 0;
  return Math.round(amountCents * (cardCountry && cardCountry !== 'CA' ? 0.037 : 0.029) + 30);
}
