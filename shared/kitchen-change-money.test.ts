import { describe, expect, it } from 'vitest';
import { kitchenMoneyDifference, retainedKitchenMoney } from './kitchen-change-money';
const original = { kitchen: 10000, tax: 1500, fee: 700 };
describe('signed chef, manager and platform component identities', () => {
  it.each([
    [12000, 1800, 840, 2440, 2300, 140],
    [8000, 1200, 560, -2440, -2300, -140],
    [12000, 2400, 840, 3040, 2900, 140],
    [8000, 1600, 560, -2040, -1900, -140],
    [10000, 2000, 700, 500, 500, 0],
    [11000, 0, 770, -430, -500, 70],
  ])('settles target %s/%s/%s components exactly', (kitchen, tax, fee, customer, manager, platform) => {
    const result = kitchenMoneyDifference(original, { kitchen, tax, fee });
    expect(result).toMatchObject({ customer, manager, platform, charge: Math.max(0, customer), refund: Math.max(0, -customer) });
    expect(result.customer).toBe(result.manager + result.platform);
  });
  it('retains actual multiple sources and partial refunds without recounting receipt deliveries', () => {
    const refund = { id: 're_one', components: { kitchen: 2000, tax: 300, fee: 140 } };
    const retained = retainedKitchenMoney([
      { id: 'pi_original', captured: original, refunds: [refund, refund] },
      { id: 'pi_increase', captured: { kitchen: 2000, tax: 300, fee: 140 }, refunds: [] },
      { id: 'pi_extension', captured: { kitchen: 3000, tax: 600, fee: 210 }, refunds: [] },
    ]);
    expect(retained).toEqual({ kitchen: 13000, tax: 2100, fee: 910 });
    expect(kitchenMoneyDifference(retained, { kitchen: 0, tax: 0, fee: 0 })).toMatchObject({ customer: -16010, manager: -15100, platform: -910 });
  });
  it('rejects component over-refunds and conflicting duplicate identities', () => {
    expect(() => retainedKitchenMoney([{ id: 'pi', captured: original, refunds: [{ id: 're', components: { kitchen: 10001, tax: 0, fee: 0 } }] }])).toThrow();
    expect(() => retainedKitchenMoney([{ id: 'pi', captured: original, refunds: [
      { id: 're', components: { kitchen: 1, tax: 0, fee: 0 } }, { id: 're', components: { kitchen: 2, tax: 0, fee: 0 } },
    ] }])).toThrow('Conflicting');
  });
});
