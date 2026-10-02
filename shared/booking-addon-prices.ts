import { BookingTermsReviewRequired } from './booking-capture-terms';

export function bookingAddonPrices(metadata: Record<string, string>) {
  if (!metadata.addon_prices) return null;
  try {
    const prices = JSON.parse(metadata.addon_prices) as { s: number[][]; e: number[][] };
    for (const items of [prices.s, prices.e]) {
      if (!Array.isArray(items) || new Set(items.map(item => item[0])).size !== items.length
        || items.some(item => !Array.isArray(item) || item.length !== 2 || !Number.isSafeInteger(item[0]) || item[0] <= 0
          || !Number.isSafeInteger(item[1]) || item[1] < 0)) throw new Error('Invalid item prices');
    }
    return prices;
  } catch { throw new BookingTermsReviewRequired(); }
}
