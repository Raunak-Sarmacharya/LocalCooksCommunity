import { mt } from '@/i18n/manager';

export type TrackingTimingSettings = {
  timeWindowSettings?: { checkinWindowMinutesBefore?: number | null };
  platformDefaults?: { checkinWindowMinutesBefore?: number; checkoutReviewWindowMinutes?: number };
  storageDefaults?: { checkoutReviewWindowMinutes?: number };
};

/** Display effective settings, never a second hardcoded timing policy. */
export function TrackingWorkflowHelp({ storage = false, settings }: { storage?: boolean; settings?: TrackingTimingSettings }) {
  const arrival = settings?.timeWindowSettings?.checkinWindowMinutesBefore ?? settings?.platformDefaults?.checkinWindowMinutesBefore;
  const review = storage ? settings?.storageDefaults?.checkoutReviewWindowMinutes : settings?.platformDefaults?.checkoutReviewWindowMinutes;
  return <div className="space-y-2">
    <p>{mt(storage ? 'storageTrackingRolesHelp' : 'kitchenTrackingRolesHelp')}</p>
    <p>{mt(storage ? 'storageTrackingSetupHelp' : 'kitchenTrackingSetupHelp')}</p>
    {Number.isSafeInteger(review) && (storage || Number.isSafeInteger(arrival)) &&
      <p>{mt(storage ? 'storageTrackingWindowsHelp' : 'kitchenTrackingWindowsHelp', { arrival, review })}</p>}
    <p>{mt(storage ? 'storageTrackingTimingOwnerHelp' : 'kitchenTrackingTimingOwnerHelp')}</p>
  </div>;
}
