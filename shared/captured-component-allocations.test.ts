import { expect, it } from 'vitest';
import { capturedComponentAllocations } from './captured-component-allocations';
it('freezes the original aggregate tax exactly, including indivisible cents', () => {
  const components = capturedComponentAllocations([{ kind: 'kitchen', bookingId: 10, subtotalCents: 10000 },
    { kind: 'storage', bookingId: 77, subtotalCents: 2000 }, { kind: 'equipment', bookingId: 88, subtotalCents: 1000 }], 1951);
  expect(components.reduce((sum, item) => sum + item.taxCents, 0)).toBe(1951);
  expect(components.reduce((sum, item) => sum + item.managerGrossCents, 0)).toBe(14951);
  expect(components[1]).toMatchObject({ subtotalCents: 2000, taxCents: 300, managerGrossCents: 2300 });
});
