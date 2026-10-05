/** Hide retired access tasks and their linked photos from legacy checklist rows. */
export function activeChecklist<T extends Record<string, unknown>>(checklist: T): T {
  const result = { ...checklist };
  for (const section of ['checkin', 'checkout', 'storageCheckin', 'storageCheckout']) {
    const itemsKey = `${section}Items`;
    const photosKey = `${section}PhotoRequirements`;
    const items = checklist[itemsKey];
    if (!Array.isArray(items)) continue;
    const retiredIds = new Set(items.filter(item => item?.category === 'smart_lock').map(item => item.id));
    if (!retiredIds.size) continue;
    Object.assign(result, { [itemsKey]: items.filter(item => item?.category !== 'smart_lock') });
    const photos = checklist[photosKey];
    if (Array.isArray(photos)) {
      Object.assign(result, { [photosKey]: photos.filter(photo => !retiredIds.has(photo?.id)) });
    }
  }
  return result;
}
