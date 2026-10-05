export const problemStatuses = ['reported', 'acknowledged', 'escalated', 'resolved'] as const;
export type ProblemStatus = typeof problemStatuses[number];
export type ProblemHistory = { revision: number; at: string; actorId: number; actorRole?: string; action: string; note: string };

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
  if (kind === 'booking') return role === 'manager' ? `/manager/booking/${id}` : `/booking/${id}`;
  return `${role === 'manager' ? '/manager/dashboard' : '/dashboard'}?view=viewings&viewing=${id}`;
}
