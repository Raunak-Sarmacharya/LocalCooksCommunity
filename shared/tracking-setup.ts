type Settings = Record<string, unknown>;
export function hasTrackingNotes(settings: Settings | null | undefined, storage = false) {
  const arrival = storage ? 'storageCheckinInstructions' : 'checkinInstructions';
  const departure = storage ? 'storageCheckoutInstructions' : 'checkoutInstructions';
  return [arrival, departure].every(key => typeof settings?.[key] === 'string' && (settings[key] as string).trim().length > 0);
}

/** One tracking choice per workflow; duties/photos are never a setup gate. */
export function normalizeTrackingSetup(patch: Settings, existing: Settings | null | undefined) {
  const normalized = { ...patch };
  for (const storage of [false, true]) {
    const arrival = storage ? 'storageCheckin' : 'checkin';
    const departure = storage ? 'storageCheckout' : 'checkout';
    const keys = [arrival, departure].flatMap(prefix => ['Enabled', 'Instructions', 'Items', 'PhotoRequirements'].map(suffix => prefix + suffix));
    if (!keys.some(key => Object.hasOwn(patch, key))) continue;
    const flags = [normalized[arrival + 'Enabled'], normalized[departure + 'Enabled']].filter(value => value !== undefined);
    if (flags.some(value => typeof value !== 'boolean') || flags.length === 2 && flags[0] !== flags[1])
      return { error: 'Check-in and checkout must use the same tracking setting.' };
    const enabled = flags.length ? flags[0] === true : existing?.[arrival + 'Enabled'] === true || existing?.[departure + 'Enabled'] === true;
    const merged = { ...existing, ...normalized };
    for (const prefix of [arrival, departure]) {
      const note = merged[prefix + 'Instructions'];
      if (note != null && typeof note !== 'string') return { error: 'Arrival and departure notes must be text.' };
    }
    if (enabled && !hasTrackingNotes(merged, storage))
      return { error: `Save arrival and departure notes before enabling ${storage ? 'storage' : 'kitchen'} check-in/out.` };
    normalized[arrival + 'Enabled'] = enabled;
    normalized[departure + 'Enabled'] = enabled;
  }
  return { patch: normalized };
}
