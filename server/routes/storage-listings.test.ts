import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  kitchen: vi.fn(), listings: vi.fn(), create: vi.fn(), update: vi.fn(), single: vi.fn(),
  managerLocations: vi.fn(), location: vi.fn(), settings: vi.fn(), instructions: vi.fn(), occupancy: vi.fn(),
}));

vi.mock('../services/storage-listing-readiness', () => ({ storageInstructions: mocks.instructions }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: { getKitchenById: mocks.kitchen } }));
vi.mock('../domains/inventory/inventory.service', () => ({
  inventoryService: { getStorageListingsByKitchen: mocks.listings, createStorageListing: mocks.create, updateStorageListing: mocks.update, getStorageListingById: mocks.single },
}));
vi.mock('../domains/locations/location.service', () => ({ locationService: { getLocationById: mocks.location, getLocationsByManagerId: mocks.managerLocations } }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn() }));
vi.mock('./middleware', () => ({ requireChef: vi.fn() }));
vi.mock('../services/storage-settings', async () => ({ ...(await vi.importActual<typeof import('../services/storage-settings')>('../services/storage-settings')), storageSettings: mocks.settings }));
vi.mock('../services/storage-availability', async () => ({ ...(await vi.importActual<typeof import('../services/storage-availability')>('../services/storage-availability')), occupancyByListing: mocks.occupancy }));

import router, { validateStorageListingInput } from './storage-listings';

const handlerFor = (path: string) => (router as any).stack.find((entry: any) => entry.route?.path === path).route.stack.at(-1).handle;
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.instructions.mockResolvedValue({ storageCheckinInstructions: "Arrive here", storageCheckoutInstructions: "Leave here" });
  mocks.settings.mockResolvedValue({ maxTermDays: 30, kitchenDisposalEnabled: false });
  mocks.occupancy.mockResolvedValue(new Map());
  mocks.kitchen.mockResolvedValue({ id: 1, isActive: true, listingStatus: 'active', locationId: 5 });
  mocks.location.mockResolvedValue({ id: 5, timezone: 'America/St_Johns' });
  mocks.managerLocations.mockResolvedValue([{ id: 5, timezone: 'America/St_Johns' }]);
});

describe('storage listing input', () => {
  it('keeps the unit count from 1 to 200', () => {
    expect(validateStorageListingInput({ name: 'Shelf', storageType: 'dry', dailyPriceCents: 500, unitCount: 0 }, 30).error).toMatch(/units/);
    expect(validateStorageListingInput({ name: 'Shelf', storageType: 'dry', dailyPriceCents: 500, unitCount: 201 }, 30).error).toMatch(/units/);
    expect(validateStorageListingInput({ name: 'Shelf', storageType: 'dry', dailyPriceCents: 500, unitCount: 3 }, 30).value)
      .toMatchObject({ unitCount: 3, basePrice: 500, pricingModel: 'daily' });
  });

  it('maps the daily price to base_price and forces the daily model', () => {
    expect(validateStorageListingInput({ name: 'Shelf', storageType: 'dry', dailyPriceCents: 900, maxTermDays: 7 }, 30).value)
      .toMatchObject({ basePrice: 900, maxTermDays: 7, pricingModel: 'daily' });
    expect(validateStorageListingInput({ name: 'Shelf', storageType: 'dry', basePrice: 1200 }, 30).value)
      .toMatchObject({ basePrice: 1200, pricingModel: 'daily' });
    expect(validateStorageListingInput({ name: 'Shelf', storageType: 'dry', dailyPriceCents: 0 }, 30).error).toMatch(/Price per day/);
  });

  it('refuses a term longer than the platform maximum', () => {
    expect(validateStorageListingInput({ name: 'Shelf', storageType: 'dry', dailyPriceCents: 500, maxTermDays: 45 }, 30).error).toMatch(/1 to 30/);
    expect(validateStorageListingInput({ name: 'Shelf', storageType: 'dry', dailyPriceCents: 500, maxTermDays: 30 }, 30).value).toMatchObject({ maxTermDays: 30 });
    expect(validateStorageListingInput({ name: 'Shelf', storageType: 'dry', dailyPriceCents: 500, maxTermDays: null }, 30).value).toMatchObject({ maxTermDays: null });
  });
});

describe('simplified listing form input', () => {
  const base = { name: 'Shelf', storageType: 'dry', dailyPriceCents: 500 };

  it('defaults access to kitchen hours and accepts only the three options on write', () => {
    expect(validateStorageListingInput(base, 30).value).toMatchObject({ accessType: 'kitchen_hours' });
    for (const accessType of ['kitchen_hours', 'anytime', 'by_arrangement']) {
      expect(validateStorageListingInput({ ...base, accessType }, 30).value).toMatchObject({ accessType });
    }
    expect(validateStorageListingInput({ ...base, accessType: 'shelving-unit' }, 30).error).toMatch(/Access/);
    expect(validateStorageListingInput({ accessType: 'my own words' }, 30, true).error).toMatch(/Access/);
    expect(validateStorageListingInput({ isActive: false }, 30, true).value).not.toHaveProperty('accessType');
  });

  it('forces a one-day minimum and drops size in cubic feet and the overstay settings', () => {
    const { value } = validateStorageListingInput({ ...base, minimumBookingDuration: 9, totalVolume: 12, pricePerCubicFoot: 3, overstayGracePeriodDays: 4,
      overstayPenaltyRate: '0.5', overstayMaxPenaltyDays: 10, overstayPolicyText: 'x' }, 30);
    expect(value).toMatchObject({ minimumBookingDuration: 1, bookingDurationUnit: 'daily' });
    for (const key of ['totalVolume', 'pricePerCubicFoot', 'overstayGracePeriodDays', 'overstayPenaltyRate', 'overstayMaxPenaltyDays', 'overstayPolicyText']) expect(value).not.toHaveProperty(key);
  });

  it('keeps a trimmed size label, clears an empty one and checks photos', () => {
    expect(validateStorageListingInput({ ...base, sizeLabel: '  One shelf, 36 in wide ' }, 30).value).toMatchObject({ sizeLabel: 'One shelf, 36 in wide' });
    expect(validateStorageListingInput({ ...base, sizeLabel: '  ' }, 30).value).toMatchObject({ sizeLabel: null });
    expect(validateStorageListingInput({ ...base, sizeLabel: 'x'.repeat(121) }, 30).error).toMatch(/Size/);
    expect(validateStorageListingInput({ ...base, photos: ['https://img/1.jpg'] }, 30).value).toMatchObject({ photos: ['https://img/1.jpg'] });
    expect(validateStorageListingInput({ ...base, photos: [1] }, 30).error).toMatch(/Photos/);
  });
});

describe('storage listing routes', () => {
  it('saves the size label and ignores removed fields when creating', async () => {
    mocks.create.mockResolvedValue({ id: 9 });
    const res = response();
    await handlerFor('/manager/storage-listings')({ neonUser: { id: 1 }, body: { kitchenId: 1, ...{ name: 'Cooler', storageType: 'cold', dailyPriceCents: 700 },
      accessType: 'anytime', sizeLabel: 'Half rack', temperatureRange: '35–40 °F', minimumBookingDuration: 7, overstayGracePeriodDays: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const saved = mocks.create.mock.calls[0][0];
    expect(saved).toMatchObject({ kitchenId: 1, accessType: 'anytime', sizeLabel: 'Half rack', temperatureRange: '35–40 °F', minimumBookingDuration: 1 });
    expect(saved).not.toHaveProperty('overstayGracePeriodDays');
  });

  it('rejects a 45-day listing before it is written', async () => {
    const res = response();
    await handlerFor('/manager/storage-listings')({ neonUser: { id: 1 }, body: { kitchenId: 1, name: 'Shelf', storageType: 'dry', dailyPriceCents: 500, maxTermDays: 45 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/1 to 30/) });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates a listing with units, the daily price and the term cap', async () => {
    mocks.create.mockResolvedValue({ id: 9 });
    const res = response();
    await handlerFor('/manager/storage-listings')({ neonUser: { id: 1 }, body: { kitchenId: 1, name: 'Shelf', storageType: 'dry', dailyPriceCents: 500, unitCount: 3, maxTermDays: 7 } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ kitchenId: 1, unitCount: 3, basePrice: 500, maxTermDays: 7, pricingModel: 'daily' }));
  });

  it('clamps a listing term to a lowered platform maximum on read', async () => {
    mocks.settings.mockResolvedValue({ maxTermDays: 20, kitchenDisposalEnabled: false });
    mocks.listings.mockResolvedValue([{ id: 9, kitchenId: 1, name: 'Shelf', storageType: 'dry', status: 'active', isActive: true, unitCount: 2, maxTermDays: 30, basePrice: 500 }]);
    const res = response();
    await handlerFor('/manager/kitchens/:kitchenId/storage-listings')({ neonUser: { id: 1 }, params: { kitchenId: '1' } }, res);
    expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ id: 9, maxTermDays: 20, storedMaxTermDays: 30, platformMaxTermDays: 20 })]);
  });

  it('returns availability instead of hiding a listing awaiting removal', async () => {
    mocks.listings.mockResolvedValue([{ id: 9, kitchenId: 1, name: 'Shelf', storageType: 'dry', status: 'active', isActive: true, unitCount: 1, maxTermDays: null, basePrice: 500, awaitingRemoval: true }]);
    mocks.occupancy.mockResolvedValue(new Map([[9, [{ unitIndex: 1, from: '2020-01-01', to: null }]]]));
    const res = response();
    await handlerFor('/chef/kitchens/:kitchenId/storage-listings')({ params: { kitchenId: '1' } }, res);
    const [rows] = res.json.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 9, maxTermDays: 30, availability: { state: 'full' } });
  });

  it('reports the availability of a listing with a free unit', async () => {
    mocks.listings.mockResolvedValue([{ id: 9, name: 'Shelf', storageType: 'dry', status: 'active', isActive: true, unitCount: 2, maxTermDays: 7, basePrice: 500 }]);
    mocks.occupancy.mockResolvedValue(new Map([[9, [{ unitIndex: 1, from: '2020-01-01', to: null }]]]));
    const res = response();
    await handlerFor('/chef/kitchens/:kitchenId/storage-availability')({ params: { kitchenId: '1' } }, res);
    expect(res.json).toHaveBeenCalledWith([{ listingId: 9, name: 'Shelf', storageType: 'dry', dailyPriceCents: 500, maxTermDays: 7, availability: { state: 'now' },
      unitCount: 2, sizeLabel: null, accessType: null, temperatureRange: null, notes: null, photos: [],
      kitchenName: undefined, locationId: 5, timezone: 'America/St_Johns' }]);
  });
});

for (const path of ['/chef/kitchens/:kitchenId/storage-listings', '/chef/kitchens/:kitchenId/storage-availability', '/public/kitchens/:kitchenId/storage-listings']) {
  it(`hides unready listings at ${path}`, async () => {
    mocks.instructions.mockResolvedValue({ storageCheckinInstructions: '  ', storageCheckoutInstructions: 'Leave here' });
    mocks.listings.mockResolvedValue([{ id: 9, name: 'Shelf', storageType: 'dry', isActive: true, unitCount: 2, basePrice: 500 }]);
    const res = response();
    await handlerFor(path)({ params: { kitchenId: '1' } }, res);
    expect(res.json).toHaveBeenCalledWith([]);
  });
}
it('creates drafts by default and refuses an unready explicit listing with the missing items', async () => {
  mocks.instructions.mockResolvedValue(null);
  const req = { neonUser: { id: 1 }, body: { kitchenId: 1, name: 'Shelf', storageType: 'dry', dailyPriceCents: 500 } };
  await handlerFor('/manager/storage-listings')(req, response());
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, status: 'draft' }));
  mocks.create.mockClear();
  const res = response();
  await handlerFor('/manager/storage-listings')({ ...req, body: { ...req.body, isActive: true } }, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({ error: expect.any(String), missing: ['moveIn', 'moveOut'] });
  expect(mocks.create).not.toHaveBeenCalled();
});
it('refuses listing an unready saved draft, but allows pausing it', async () => {
  mocks.single.mockResolvedValue({ id: 9, kitchenId: 1, name: 'Shelf', storageType: 'dry', basePrice: 500, unitCount: 1 });
  mocks.instructions.mockResolvedValue(null);
  const req = { neonUser: { id: 1 }, params: { listingId: '9' }, body: { isActive: true } };
  const route = (router as any).stack.find((entry: any) => entry.route?.path === '/manager/storage-listings/:listingId' && entry.route.methods.put).route.stack.at(-1).handle;
  const res = response();
  await route(req, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(mocks.update).not.toHaveBeenCalled();
  await route({ ...req, body: { isActive: false } }, response());
  expect(mocks.update).toHaveBeenCalledWith(9, expect.objectContaining({ isActive: false }));
});
