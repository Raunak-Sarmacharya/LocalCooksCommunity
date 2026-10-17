export const problemStatuses = ['reported', 'acknowledged', 'escalated', 'resolved'] as const;
export type ProblemStatus = typeof problemStatuses[number];
export type ProblemHistory = { revision: number; at: string; actorId: number; actorRole?: string; action: string; note: string };

/** Safety first; the order is also the order shown to participants. */
export const problemCategories = ['safety', 'access', 'equipment', 'cleanliness', 'other'] as const;
/** Not offered in the report dialog: sent only by "I was there" (a chef disputing a no-show or a missing check-in). */
export const ATTENDANCE_CATEGORY = 'attendance' as const;
export type ProblemCategory = typeof problemCategories[number] | typeof ATTENDANCE_CATEGORY;
export function parseProblemCategory(value: unknown): ProblemCategory | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && ((problemCategories as readonly string[]).includes(value) || value === ATTENDANCE_CATEGORY) ? value as ProblemCategory : undefined;
}
export function problemCategoryLabel(category: string | null | undefined) {
  return category ? ({ safety: 'Safety', access: 'Access', equipment: 'Equipment', cleanliness: 'Cleanliness', other: 'Other', attendance: 'Attendance' } as Record<string, string>)[category] || category : '';
}

export function problemStatusLabel(status: string) {
  return ({ reported: 'Awaiting response', acknowledged: 'In progress', escalated: 'Further review', resolved: 'Resolved' } as Record<string, string>)[status] || status;
}

export function problemTransition(status: ProblemStatus, action: string, claimedBy: number | null, actorId: number, note: string): ProblemStatus {
  if (status === 'resolved') throw new Error('This problem is already resolved');
  if (action === 'claim') return status;
  if (action === 'reassign' && note.trim()) return status;
  if (claimedBy !== actorId) throw new Error('Claim this Local Cooks task before responding');
  if (!note.trim()) throw new Error('Record a participant-visible response');
  if (action === 'acknowledge' && status === 'reported') return 'acknowledged';
  if (action === 'escalate') return 'escalated';
  if (action === 'reply') return status;
  if (action === 'resolve' && status !== 'reported') return 'resolved';
  throw new Error('Acknowledge the report before resolving it');
}

export function problemDestination(kind: string, id: number, role: string) {
  if (role === 'admin') return '/admin?section=live-problems';
  if (kind === 'storage') return role === 'manager' ? `/manager/storage/${id}` : `/storage/${id}`;
  if (kind === 'booking') return role === 'manager' ? `/manager/booking/${id}` : `/booking/${id}`;
  return `${role === 'manager' ? '/manager/dashboard' : '/dashboard'}?view=viewings&viewing=${id}`;
}
