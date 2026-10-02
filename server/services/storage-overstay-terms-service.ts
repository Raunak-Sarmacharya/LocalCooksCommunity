import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { storageListings, kitchens, locations, storageOverstayQuotes } from '@shared/schema';
import type { StorageOverstayTerms } from '@shared/storage-overstay-terms';
import { getEffectivePenaltyConfig } from './overstay-defaults-service';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';

export async function quoteStorageOverstayTerms(storageListingId: number): Promise<StorageOverstayTerms> {
  const [listing] = await db.select({ listing: storageListings, locationId: kitchens.locationId,
    timezone: locations.timezone }).from(storageListings)
    .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
    .innerJoin(locations, eq(kitchens.locationId, locations.id))
    .where(eq(storageListings.id, storageListingId)).limit(1);
  if (!listing) throw new Error('Storage listing not found');
  const config = await getEffectivePenaltyConfig(listing.listing.overstayGracePeriodDays,
    listing.listing.overstayPenaltyRate, listing.listing.overstayMaxPenaltyDays, listing.locationId);
  return { version: 1, ...config, dailyRateCents: Math.round(Number(listing.listing.basePrice)),
    pricingModel: listing.listing.pricingModel, timezone: listing.timezone || DEFAULT_TIMEZONE,
    policyText: listing.listing.overstayPolicyText ?? config.policyText, quotedAt: new Date().toISOString() };
}

export async function saveStorageOverstayQuote(storageListingId: number, chefId: number, snapshot?: StorageOverstayTerms) {
  const terms = snapshot ?? await quoteStorageOverstayTerms(storageListingId);
  const id = randomUUID();
  await db.insert(storageOverstayQuotes).values({ id, chefId, storageListingId, terms });
  return { id, terms };
}

export function describeStorageOverstayTerms(terms: StorageOverstayTerms) {
  const description = terms.pricingModel === 'daily'
    ? `${terms.gracePeriodDays} grace days. After grace: $${(Math.round(terms.dailyRateCents * (1 + terms.penaltyRate)) / 100).toFixed(2)} CAD per day, capped at ${terms.maxPenaltyDays} penalty days. Manager review required. ${terms.policyText || ''}`
    : 'Overstay requires review; automatic daily penalties do not apply to this pricing model.';
  if (description.length > 2000) throw new Error('Storage overstay policy exceeds checkout display limit');
  return description;
}
