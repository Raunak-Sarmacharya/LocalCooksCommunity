export type KitchenMoney = { kitchen: number; tax: number; fee: number };
export function kitchenMoneyDifference(retained: KitchenMoney, target: KitchenMoney) {
  if (![...Object.values(retained), ...Object.values(target)].every(value => Number.isSafeInteger(value) && value >= 0))
    throw new Error('Verified retained and target components must be nonnegative integer cents.');
  const kitchen = target.kitchen - retained.kitchen, tax = target.tax - retained.tax, fee = target.fee - retained.fee;
  const manager = kitchen + tax, customer = manager + fee;
  return { kitchen, tax, fee, manager, platform: fee, customer,
    charge: Math.max(0, customer), refund: Math.max(0, -customer), retained, target };
}

export type KitchenMoneySource = { id: string; captured: KitchenMoney; refunds: Array<{ id: string; components: KitchenMoney }> };
/** Refund identities are immutable. Repeated delivery counts once; conflicting receipts fail closed. */
export function retainedKitchenMoney(sources: KitchenMoneySource[]): KitchenMoney {
  const total: KitchenMoney = { kitchen: 0, tax: 0, fee: 0 }, sourceIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) throw new Error('Duplicate capture source.');
    sourceIds.add(source.id);
    kitchenMoneyDifference({ kitchen: 0, tax: 0, fee: 0 }, source.captured);
    const remaining = { ...source.captured }, receipts = new Map<string, KitchenMoney>();
    for (const refund of source.refunds) {
      kitchenMoneyDifference({ kitchen: 0, tax: 0, fee: 0 }, refund.components);
      const prior = receipts.get(refund.id);
      if (prior) {
        if (Object.keys(prior).some(key => prior[key as keyof KitchenMoney] !== refund.components[key as keyof KitchenMoney]))
          throw new Error('Conflicting refund receipt.');
        continue;
      }
      receipts.set(refund.id, refund.components);
      for (const key of ['kitchen', 'tax', 'fee'] as const) remaining[key] -= refund.components[key];
    }
    kitchenMoneyDifference({ kitchen: 0, tax: 0, fee: 0 }, remaining);
    for (const key of ['kitchen', 'tax', 'fee'] as const) total[key] += remaining[key];
  }
  kitchenMoneyDifference({ kitchen: 0, tax: 0, fee: 0 }, total);
  return total;
}
