import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ results: [] as unknown[], selects: 0 }));
vi.mock('../db', () => {
  const chain = (): unknown => new Proxy(function () {}, {
    get: (_target, prop) => {
      if (prop === 'then') return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(mocks.results.length ? mocks.results.shift() : []).then(resolve, reject);
      return () => chain();
    },
  });
  return { db: { select: () => { mocks.selects++; return chain(); } } };
});
vi.mock('./location-access-notices', () => ({ accessEndedMarker: 'Access ended by manager: ' }));
vi.mock('./lifecycle-settings', () => ({ getLifecycleSettings: vi.fn(async () => ({ managerResponseBufferHours: 1, inspectionAutoCloseHours: 24 })) }));
vi.mock('../domains/locations/location.service', () => ({ locationService: { getLocationRequirementsWithDefaults: vi.fn(async () => ({})) } }));

import { bookingOutcome, claimNextActor, getCustomerPage } from './manager-customer-page';

describe('past booking outcomes are explicit and never a guess', () => {
  const base = { status: 'completed', checkinStatus: 'checked_out', checkoutApprovedBy: null as number | null, cancellationCause: null as string | null };
  it.each([
    [{ ...base, checkoutApprovedBy: 2 }, 'completed_cleared'],
    [{ ...base }, 'completed'],
    [{ ...base, checkinStatus: 'checkout_claim_filed' }, 'claim_filed'],
    [{ ...base, status: 'cancelled', checkinStatus: 'not_checked_in', cancellationCause: 'chef' }, 'cancelled_by_customer'],
    [{ ...base, status: 'cancelled', checkinStatus: 'not_checked_in', cancellationCause: 'kitchen' }, 'cancelled_by_you'],
    [{ ...base, status: 'cancelled', checkinStatus: 'not_checked_in' }, 'cancelled'],
    [{ ...base, status: 'confirmed', checkinStatus: 'not_checked_in' }, 'visit_ended'],
    [{ ...base, status: 'pending', checkinStatus: 'not_checked_in' }, 'request_unanswered'],
    [{ ...base, status: 'confirmed', checkinStatus: 'no_show' }, 'attendance_reported'],
  ])('%j → %s', (booking, outcome) => expect(bookingOutcome(booking, 2)).toBe(outcome));
  it('a booking cleared by another manager is not described as cleared by you', () => {
    expect(bookingOutcome({ ...base, checkoutApprovedBy: 9 }, 2)).toBe('completed');
  });
  it('never names a missing tap a no-show', () => {
    for (const status of ['pending', 'confirmed', 'completed', 'cancelled', 'cancellation_requested'])
      for (const checkinStatus of [null, 'not_checked_in', 'checked_in', 'checked_out'])
        expect(bookingOutcome({ status, checkinStatus, checkoutApprovedBy: null, cancellationCause: null }, 2)).not.toMatch(/no.?show/);
  });
});

describe('claims name who acts next', () => {
  it.each([
    ['draft', 'you'], ['awaiting_kitchen', 'you'], ['submitted', 'customer'], ['approved', 'customer'], ['in_review', 'local_cooks'],
    ['chef_disputed', 'local_cooks'], ['charge_failed', 'local_cooks'], ['charge_succeeded', 'nobody'], ['resolved', 'nobody'], ['rejected', 'nobody'],
  ])('%s → %s', (status, actor) => expect(claimNextActor(status)).toBe(actor));
});

describe('customer page access', () => {
  beforeEach(() => { mocks.results.length = 0; mocks.selects = 0; });
  const harbour = [{ id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns' }];
  it('another manager’s location is a 404 and nothing about the person is read', async () => {
    mocks.results.push([]);
    await expect(getCustomerPage(2, 7, 99)).rejects.toMatchObject({ statusCode: 404, message: 'Location not found' });
    expect(mocks.selects).toBe(1);
  });
  it('a person with no relationship to any of the manager’s locations is a 404', async () => {
    mocks.results.push(harbour, harbour, harbour);
    await expect(getCustomerPage(2, 7, 47)).rejects.toMatchObject({ statusCode: 404, message: 'Customer not found' });
  });
});
