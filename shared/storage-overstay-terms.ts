export interface StorageOverstayTerms {
  version: 1;
  gracePeriodDays: number;
  penaltyRate: number;
  maxPenaltyDays: number;
  dailyRateCents: number;
  pricingModel: string;
  timezone: string;
  policyText: string | null;
  quotedAt: string;
  acceptedAt?: string;
}

export function isStorageOverstayTerms(value: unknown): value is StorageOverstayTerms {
  if (!value || typeof value !== 'object') return false;
  const terms = value as StorageOverstayTerms;
  return terms.version === 1 && Number.isSafeInteger(terms.gracePeriodDays) && terms.gracePeriodDays >= 0
    && Number.isSafeInteger(terms.maxPenaltyDays) && terms.maxPenaltyDays > 0
    && Number.isFinite(terms.penaltyRate) && terms.penaltyRate >= 0 && terms.penaltyRate <= 1
    && Number.isSafeInteger(terms.dailyRateCents) && terms.dailyRateCents >= 0
    && typeof terms.timezone === 'string' && !!terms.timezone && typeof terms.pricingModel === 'string'
    && typeof terms.quotedAt === 'string' && Number.isFinite(Date.parse(terms.quotedAt))
    && (terms.acceptedAt === undefined || (typeof terms.acceptedAt === 'string' && Number.isFinite(Date.parse(terms.acceptedAt))));
}
