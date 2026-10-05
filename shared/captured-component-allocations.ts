/** Allocate the already-agreed aggregate tax in integer cents, once before capture. */
export function capturedComponentAllocations(components: Array<{ kind: 'kitchen' | 'storage' | 'equipment'; bookingId: number; subtotalCents: number }>, taxCents: number) {
  if (!Number.isSafeInteger(taxCents) || taxCents < 0 || components.some(item => !Number.isSafeInteger(item.subtotalCents) || item.subtotalCents < 0))
    throw new Error('Original captured component amounts require review');
  const subtotal = components.reduce((sum, item) => sum + item.subtotalCents, 0);
  if (!subtotal || !Number.isSafeInteger(subtotal)) throw new Error('Original captured subtotal requires review');
  const allocations = components.map(item => {
    const numerator = BigInt(item.subtotalCents) * BigInt(taxCents);
    return { ...item, taxCents: Number(numerator / BigInt(subtotal)), remainder: numerator % BigInt(subtotal) };
  });
  let remaining = taxCents - allocations.reduce((sum, item) => sum + item.taxCents, 0);
  const order = allocations.map((item, index) => ({ index, remainder: item.remainder })).sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const item of order) { if (!remaining) break; allocations[item.index].taxCents++; remaining--; }
  return allocations.map(({ remainder, ...item }) => ({ ...item, managerGrossCents: item.subtotalCents + item.taxCents }));
}
