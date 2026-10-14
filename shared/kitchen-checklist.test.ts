import { expect, it } from 'vitest';
import { kitchenChecklistFields, resolveKitchenChecklist } from './kitchen-checklist';

it('uses the location row unchanged until kitchen overrides exist', () => {
  const location = { checkinEnabled: false, checkinInstructions: 'Arrive here', checkoutItems: [] };
  expect(resolveKitchenChecklist(null, location)).toBe(location);
  expect(resolveKitchenChecklist(undefined, location)).toBe(location);
  expect(location.checkinEnabled).toBe(false);
});
it('returns null for missing settings without inventing tasks or storage flags', () => {
  expect(resolveKitchenChecklist(null, null)).toBeNull();
  expect(resolveKitchenChecklist(null, undefined)).toBeNull();
});
it('resolves an explicit override including empty values without mutating either row', () => {
  const location = { checkinInstructions: 'Location', checkinItems: ['task'], storageCheckinEnabled: true };
  const kitchen = { checkinInstructions: '', checkinItems: [], storageCheckinEnabled: false };
  expect(resolveKitchenChecklist(kitchen, location)).toEqual({ ...location, checkinInstructions: '', checkinItems: [] });
  expect(location.checkinItems).toEqual(['task']);
});

it.each(kitchenChecklistFields)('merges %s independently, including null inheritance and empty removal', field => {
  const location = Object.fromEntries(kitchenChecklistFields.map(key => [key, key.endsWith('Instructions') ? 'Location' : ['Location']]));
  const empty = field.endsWith('Instructions') ? '' : [];
  expect(resolveKitchenChecklist({ [field]: empty }, location)).toEqual({ ...location, [field]: empty });
  expect(resolveKitchenChecklist({ [field]: null }, location)).toEqual(location);
  expect(resolveKitchenChecklist({ [field]: undefined }, location)).toEqual(location);
});
it('does not leak override identity or storage fields into the effective location row', () => {
  expect(resolveKitchenChecklist({ id: 2, kitchenId: 4, storageCheckinEnabled: false, checkinInstructions: 'Kitchen' } as any,
    { id: 1, storageCheckinEnabled: true, checkinInstructions: 'Location' })).toEqual({ id: 1, storageCheckinEnabled: true, checkinInstructions: 'Kitchen' });
});
