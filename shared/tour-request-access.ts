export type TourRequestHistory = {
  id: number; status: string; scheduledAt: Date | string; durationMinutes?: number | null;
  targetedKitchenId?: number | null; disruptionReason?: string | null; requestExpiredAt?: Date | string | null;
  repeatAuthorizationId?: number | null;
};
export type TourRequestBlock = 'pending' | 'confirmed' | 'ended' | 'completed' | 'unverified';
export type TourRequestAccess = {
  canRequest: boolean; reason: TourRequestBlock | 'application' | null;
  tour: { id: number; kind: TourRequestBlock | 'failed'; scheduledAt: string; durationMinutes: number } | null;
  authorization: { id: number; expiresAt: string; recovery: boolean } | null;
};

export function tourRequestBlock(tour: TourRequestHistory, now = Date.now()): TourRequestBlock | null {
  if (tour.status === 'completed') return 'completed';
  if (tour.disruptionReason === 'outcome_unknown') return 'unverified';
  if (tour.status === 'confirmed') {
    const end = new Date(tour.scheduledAt).getTime() + (tour.durationMinutes ?? 30) * 60_000;
    return end <= now ? 'ended' : 'confirmed';
  }
  if (['pending_local_cooks', 'pending'].includes(tour.status) && !tour.requestExpiredAt
    && new Date(tour.scheduledAt).getTime() > now) return 'pending';
  return null;
}

/** A failed attempt never erases a previous completed introduction. Kitchen identity is exact. */
export function kitchenTourRequestBlock(tours: TourRequestHistory[], kitchenId: number, now = Date.now()) {
  const matching = tours.filter(tour => tour.targetedKitchenId === kitchenId).sort((a, b) => b.id - a.id);
  const active = matching.find(tour => ['pending', 'confirmed', 'ended'].includes(tourRequestBlock(tour, now) || ''));
  const tour = active || matching.find(tour => tourRequestBlock(tour, now));
  return tour ? { tour, kind: tourRequestBlock(tour, now)! } : null;
}
