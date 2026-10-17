/** Real SQL (PGlite) through the repository queries the booking lists and pages use; no provider is contacted. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as s from '@shared/schema';
import { createTestDatabase } from '../../services/kitchen-booking-changes.pglite';

const h = vi.hoisted(() => ({ db: null as any, client: null as any }));
vi.mock('../../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }), pool: {} }));
vi.mock('../../services/stripe-checkout-fee-service', () => ({ getFeeConfig: async () => ({ stripePercentageFee: 0.029, stripeFlatFeeCents: 30 }) }));
import { BookingRepository } from './booking.repository';

const offer = { id: '11111111-1111-4111-8111-111111111111', state: 'waiting', intentId: 'pi_1', actorId: 2, answeredBy: 3,
  supportReason: 'customer_asked: private call notes', proposedAt: '2099-01-01T10:00:00.000Z', deadlineAt: '2099-01-02T10:00:00.000Z',
  equipment: [{ id: 31, status: 'cancelled' }], declined: [{ id: 31, name: 'Mixer', cents: 3000 }], oldTotalCents: 18300, newTotalCents: 14640 };

beforeAll(async () => {
  const created = await createTestDatabase([s.users, s.locations, s.kitchens, s.kitchenBookings, s.kitchenBookingVisits, s.kitchenBookingAttendanceEvents, s.chefKitchenApplications, s.paymentTransactions, s.kitchenBookingDayPayouts]);
  h.db = created.db; h.client = created.client;
  await h.db.insert(s.users).values([{ id: 2, username: 'manager@test.invalid', password: 'x', role: 'manager' }, { id: 3, username: 'chef@test.invalid', password: 'x', role: 'chef' }]);
  await h.db.insert(s.locations).values({ id: 9, managerId: 2, name: 'Test', address: 'Test', timezone: 'America/St_Johns' });
  await h.db.insert(s.kitchens).values({ id: 4, locationId: 9, name: 'Kitchen North', hourlyRate: '5000' });
  await h.db.insert(s.kitchenBookings).values({ id: 112, chefId: 3, kitchenId: 4, bookingDate: new Date('2099-01-03T00:00:00Z'), startTime: '09:00', endTime: '11:00',
    status: 'pending', paymentStatus: 'authorized', paymentIntentId: 'pi_1', totalPrice: '10000', partialAcceptance: offer });
}, 60_000);
afterAll(async () => { await h.client?.close(); });

const publicOffer = { id: offer.id, state: 'waiting', intentId: 'pi_1', proposedAt: offer.proposedAt, deadlineAt: offer.deadlineAt,
  equipment: offer.equipment, declined: offer.declined, oldTotalCents: 18300, newTotalCents: 14640 };

describe('the offer in chef and kitchen booking responses', () => {
  it('the manager bookings LIST carries the offer the "Waiting for the chef" pill needs, without internal fields', async () => {
    const [row] = await new BookingRepository().getBookingsByManagerId(2);
    expect(row).toMatchObject({ id: 112, status: 'pending', paymentStatus: 'authorized', partialAcceptance: publicOffer });
    expect(row.partialAcceptance).not.toHaveProperty('supportReason');
    expect(row.partialAcceptance).not.toHaveProperty('actorId');
    expect(row.partialAcceptance).not.toHaveProperty('answeredBy');
  });
  it('the chef bookings list carries it too (the "Answer needed" pill), without internal fields', async () => {
    const [row] = await new BookingRepository().getKitchenBookingsByChefId(3);
    expect(row.partialAcceptance).toEqual(publicOffer);
  });
  it('the booking pages (chef and kitchen details read the booking by id) never see the support note or user ids', async () => {
    const booking = await new BookingRepository().getKitchenBookingById(112);
    expect(booking!.partialAcceptance).toEqual(publicOffer);
    expect(JSON.stringify(booking)).not.toContain('private call notes');
  });
  it('Local Cooks (the raw row the support console reads) keeps them', async () => {
    const [raw] = await h.db.select().from(s.kitchenBookings);
    expect(raw.partialAcceptance).toMatchObject({ actorId: 2, answeredBy: 3, supportReason: 'customer_asked: private call notes' });
  });
});
