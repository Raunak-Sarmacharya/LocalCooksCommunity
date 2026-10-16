import { describe, expect, it, vi } from 'vitest';

const listings = [
  { id: 7, kitchenId: 54, equipmentType: 'Convection oven', brand: 'Rational', sessionRate: '2500' },
  { id: 8, kitchenId: 54, equipmentType: 'Mixer', brand: null, sessionRate: '1000' },
];
vi.mock('../db', () => ({ db: { select: () => ({ from: () => ({
  where: async () => listings,
  innerJoin: () => ({ where: () => ({ limit: async () => [{ kitchenId: 54, taxRatePercent: '15', active: true, listingStatus: 'active' }] }) }),
}) }) } }));
vi.mock('./stripe-checkout-fee-service', () => ({
  calculateCheckoutFeesAsync: async (subtotal: number) => ({ platformCommissionInCents: Math.round(subtotal * 0.07) }),
}));
const { invitationCheckoutPricing, InvitationError } = await import('./kitchen-invitations');

const row = { kitchenId: 54, offeredSubtotalCents: 4000, taxCents: 600, serviceFeeCents: 280, totalCents: 4880 } as any;

describe('invitation checkout with equipment', () => {
  it('no equipment keeps the exact offered total, even if fees changed since', async () => {
    expect(await invitationCheckoutPricing(row, [])).toMatchObject({ subtotalCents: 4000, taxCents: 600, serviceFeeCents: 280, totalCents: 4880, equipment: [] });
  });
  it('equipment is added at its listed price, taxed and charged the service fee, once each', async () => {
    const pricing = await invitationCheckoutPricing(row, [7, 7]);
    expect(pricing.equipment).toEqual([{ listingId: 7, name: 'Equipment: Rational Convection oven', priceCents: 2500 }]);
    expect(pricing).toMatchObject({ subtotalCents: 6500, taxCents: 975, serviceFeeCents: 455, totalCents: 7930 });
  });
  it('refuses equipment the kitchen does not rent out, and malformed input', async () => {
    await expect(invitationCheckoutPricing(row, [99])).rejects.toMatchObject({ status: 409, code: 'equipment_unavailable' });
    await expect(invitationCheckoutPricing(row, ['7'])).rejects.toBeInstanceOf(InvitationError);
    await expect(invitationCheckoutPricing(row, Array.from({ length: 11 }, (_, i) => i))).rejects.toBeInstanceOf(InvitationError);
  });
});
