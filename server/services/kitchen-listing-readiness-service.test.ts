import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkinCheckoutChecklists, storageListings, kitchenViewingSettings, kitchenViewingAvailability } from '@shared/schema';

const mocks = vi.hoisted(() => ({
  kitchen: { id: 7, locationId: 12, name: 'Test Kitchen', checkinCheckoutEnabled: true },
  checklist: null as any,
  select: vi.fn(),
  storage: [] as any[],
  tours: [] as any[],
  tourHours: [] as any[],
  location: {} as any,
}));
vi.mock('../db', () => ({ db: { select: mocks.select } }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: {
  getKitchenById: vi.fn(async () => mocks.kitchen),
  getKitchenAvailability: vi.fn(async () => []),
} }));
vi.mock('../domains/locations/location.service', () => ({ locationService: {
  getLocationById: vi.fn(async () => ({ id: 12, name: 'Test Location', ...mocks.location })),
  getLocationRequirementsWithDefaults: vi.fn(async () => ({ requireFoodHandlerCert: true })),
} }));
vi.mock('./stripe-connect-service', () => ({ getAccountStatus: vi.fn() }));
vi.mock('./kitchen-checkout-service', () => ({ getCheckinSettings: vi.fn(async () => ({
  checkinWindowMinutesBefore: 15, noShowGraceMinutes: 30, checkoutReviewWindowMinutes: 60,
})) }));
import { buildKitchenReadiness } from './kitchen-listing-readiness-service';

beforeEach(() => {
  mocks.kitchen.checkinCheckoutEnabled = true;
  mocks.checklist = null;
  mocks.storage = [];
  mocks.tours = [];
  mocks.tourHours = [];
  mocks.location = {};
  mocks.select.mockImplementation(() => ({ from: (table: unknown) => {
    const rows = table === checkinCheckoutChecklists && mocks.checklist ? [mocks.checklist] : table === storageListings ? mocks.storage : table === kitchenViewingSettings ? mocks.tours : table === kitchenViewingAvailability ? mocks.tourHours : [];
    const query = { where: () => query, limit: async () => rows,
      then: (resolve: (value: any[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  } }));
});

it('keeps terms and their upload date location-owned even if obsolete kitchen columns contain data', async () => {
  Object.assign(mocks.kitchen, { kitchenTermsUrl: '/unused-kitchen.pdf', kitchenTermsUploadedAt: new Date('2026-10-12') });
  mocks.location = { kitchenTermsUrl: '/location.pdf', kitchenTermsUploadedAt: new Date('2026-10-01') };
  let review = await buildKitchenReadiness(7);
  expect(review?.details.termsUploadedAt).toBe('2026-10-01T00:00:00.000Z');
  expect(review?.checklist.openRecommendationIds).not.toContain('terms');
  mocks.location = {};
  review = await buildKitchenReadiness(7);
  expect(review?.details.termsUploadedAt).toBeNull();
  expect(review?.checklist.openRecommendationIds).toContain('terms');
});

it('keeps missing, incomplete and paused tours out of the publishing requirements', async () => {
  const baseline = await buildKitchenReadiness(7);
  for (const settings of [null, { isActive: true }, { isActive: false, arrivalNotes: 'Arrive.', departureNotes: 'Leave.' }, { isActive: true, arrivalNotes: 'Arrive.', departureNotes: 'Leave.' }]) {
    mocks.tours = settings ? [settings] : [];
    mocks.tourHours = [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isAvailable: true }];
    const review = await buildKitchenReadiness(7);
    expect(review?.checklist.requirements).toEqual(baseline?.checklist.requirements);
    expect(review?.checklist.canPublish).toBe(baseline?.checklist.canPublish);
    expect(review?.details.toursEnabled).toBe(Boolean(settings?.isActive && settings?.arrivalNotes && settings?.departureNotes));
  }
});

it('keeps storage setup independent from kitchen listing requirements', async () => {
  mocks.storage = [{ id: 1 }];
  const review = await buildKitchenReadiness(7);
  expect(review?.checklist.requirements.map(row => row.id)).not.toContain('storageVisitSetup');
  expect(review?.details).not.toHaveProperty('storageVisitSetup');
});

describe('listing visit setup from saved configuration', () => {
  it.each([
    null,
    { checkinEnabled: true, checkoutEnabled: false },
    { checkinEnabled: false, checkoutEnabled: true },
    { storageCheckinEnabled: true, storageCheckoutEnabled: true },
  ])('blocks publishing without both kitchen actions: %j', async checklist => {
    mocks.checklist = checklist;
    const review = await buildKitchenReadiness(7);
    expect(review?.checklist.missingRequirementIds).toContain('visitSetup');
  });

  it('accepts both actions with no checklist duties or photos and reports the actual windows', async () => {
    mocks.checklist = { checkinEnabled: true, checkoutEnabled: true,
      checkinInstructions: 'Meet the manager at reception.', checkoutInstructions: 'Return the key to reception.',
      checkinItems: [], checkoutItems: [], checkinPhotoRequirements: [], checkoutPhotoRequirements: [] };
    const review = await buildKitchenReadiness(7);
    expect(review?.checklist.missingRequirementIds).not.toContain('visitSetup');
    expect(review?.details.visitSetup).toMatchObject({ checkinEnabled: true,
      checkoutEnabled: true, arrivalRequirementCount: 0, departureRequirementCount: 0,
      checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60 });
  });

  it('accepts both instructions and zero tasks with every legacy kitchen flag off', async () => {
    mocks.kitchen.checkinCheckoutEnabled = false;
    mocks.checklist = { checkinEnabled: false, checkoutEnabled: false,
      checkinInstructions: 'Arrive here.', checkoutInstructions: 'Leave here.', checkinItems: [], checkoutItems: [] };
    const review = await buildKitchenReadiness(7);
    expect(review?.checklist.missingRequirementIds).not.toContain('visitSetup');
    expect(review?.details.visitSetup).toMatchObject({ checkinEnabled: true, checkoutEnabled: true,
      arrivalRequirementCount: 0, departureRequirementCount: 0 });
    expect(review?.details.visitSetup).not.toHaveProperty('trackingEnabled');
  });

  it('requires saved arrival and departure notes even when duties are present', async () => {
    mocks.checklist = { checkinEnabled: true, checkoutEnabled: true, checkinInstructions: '   ',
      checkoutInstructions: 'Return keys', checkinItems: [{ id: 'duty' }], checkoutItems: [{ id: 'duty' }] };
    const review = await buildKitchenReadiness(7);
    expect(review?.checklist.missingRequirementIds).toContain('visitSetup');
    expect(review?.details.visitSetup).toMatchObject({ arrivalNotesSaved: false, departureNotesSaved: true });
  });

  it('summarizes required active duties, excluding optional and retired access-code items', async () => {
    mocks.checklist = { checkinEnabled: true, checkoutEnabled: true,
      checkinItems: [{ id: 'clean', required: true }, { id: 'optional', required: false },
        { id: 'retired', category: 'smart_lock' }],
      checkinPhotoRequirements: [{ id: 'clean' }, { id: 'retired' }],
      checkoutItems: [{ id: 'tidy' }], checkoutPhotoRequirements: [] };
    const review = await buildKitchenReadiness(7);
    expect(review?.details.visitSetup).toMatchObject({ arrivalRequirementCount: 2, departureRequirementCount: 1 });
  });
});
