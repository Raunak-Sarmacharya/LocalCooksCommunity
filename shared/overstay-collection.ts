/** Collection follows verified removal, notice, and the saved dispute deadline. */
export function overstayCollectionError(record: {
  itemsRemovedAt: Date | string | null;
  chefDisputeDeadline: Date | string | null;
  chefDisputedAt: Date | string | null;
  disputeReviewedAt: Date | string | null;
  idempotencyKey?: string | null;
}, now = new Date()): string | undefined {
  // A storage holdover request is paid by the chef on-session at any time; only an unreviewed dispute pauses it.
  if (record.idempotencyKey?.startsWith('holdover:')) return record.chefDisputedAt && !record.disputeReviewedAt ? 'Collection is paused for admin review of the chef dispute' : undefined;
  if (!record.itemsRemovedAt) return 'Manager-confirmed removal is required before payment';
  if (record.chefDisputedAt && !record.disputeReviewedAt) return 'Collection is paused for admin review of the chef dispute';
  if (!record.chefDisputeDeadline || !Number.isFinite(new Date(record.chefDisputeDeadline).getTime())) {
    return 'The final penalty notice must be sent before collection';
  }
  if (now.getTime() < new Date(record.chefDisputeDeadline).getTime()) return 'The chef dispute window is still open';
}
