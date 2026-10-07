import { describe, expect, it } from 'vitest';
import { insertKitchenViewingSchema, requestKitchenViewingSchema, requiredViewingIntakeDataSchema, viewingIntakeDataSchema } from './schema';

const intake = { intendedUse: 'Meal prep', estimatedWeeklyHours: '5-10', hasLicense: false, targetStartDate: '2026-11-01' };
const request = { locationId: 33, targetedKitchenId: 40, chefId: 8, scheduledAt: '2026-10-08T12:30:00Z' };

describe('new tour intake answers', () => {
  it('requires intake only for new submissions and leaves historical rows valid', () => {
    expect(requestKitchenViewingSchema.safeParse(request).success).toBe(false);
    expect(insertKitchenViewingSchema.safeParse(request).success).toBe(true);
    expect(viewingIntakeDataSchema.safeParse({}).success).toBe(true);
  });
  it.each(Object.keys(intake))('requires %s', field => {
    const partial: Record<string, unknown> = { ...intake };
    delete partial[field];
    expect(requiredViewingIntakeDataSchema.safeParse(partial).success).toBe(false);
  });
  it.each(['intendedUse', 'estimatedWeeklyHours'])('rejects whitespace for %s', field => {
    expect(requiredViewingIntakeDataSchema.safeParse({ ...intake, [field]: ' \n\t ' }).success).toBe(false);
  });
  it.each(['false', 0, null, ''])('rejects nonboolean license answer %j', hasLicense => {
    expect(requiredViewingIntakeDataSchema.safeParse({ ...intake, hasLicense }).success).toBe(false);
  });
  it.each(['', 'soon', '2026-02-30', '2026-13-01', '2026-11-01T00:00:00Z'])('rejects invalid date %j', targetStartDate => {
    expect(requiredViewingIntakeDataSchema.safeParse({ ...intake, targetStartDate }).success).toBe(false);
  });
  it('trims answers, preserves explicit No and optional notes, and accepts meaningful hours outside preset ranges', () => {
    const parsed = requiredViewingIntakeDataSchema.parse({ ...intake, intendedUse: '  Meal prep  ', estimatedWeeklyHours: '  12 hours  ', additionalInfo: 'Needs freezer space' });
    expect(parsed).toEqual({ ...intake, estimatedWeeklyHours: '12 hours', additionalInfo: 'Needs freezer space' });
    expect(requiredViewingIntakeDataSchema.safeParse({ ...intake, hasLicense: true, targetStartDate: '2028-02-29' }).success).toBe(true);
    expect(requiredViewingIntakeDataSchema.parse({ ...intake, targetStartDate: ' not_decided ' }).targetStartDate).toBe('not_decided');
  });
});
