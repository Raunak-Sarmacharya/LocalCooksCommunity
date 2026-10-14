import { z } from 'zod';

export const CLAIM_CAP_CENTS = 25_000;
export const CLAIM_WINDOW_MS = 72 * 60 * 60 * 1000;
export const CLAIM_BOOKING_HOLD_MS = 7 * 24 * 60 * 60 * 1000;
export const claimUpload = z.object({ fileUrl: z.string().url().refine(value => value.startsWith('https://'), 'Use an uploaded file'),
  fileName: z.string().trim().min(1).max(255), mimeType: z.string().max(100).optional() }).strict();
export const claimLine = z.object({ type: z.enum(['damage', 'extra_cleaning']), description: z.string().trim().min(3).max(500),
  amountCents: z.number().int().positive().max(CLAIM_CAP_CENTS), document: claimUpload }).strict();
export const fileClaimInput = z.object({ bookingId: z.number().int().positive(), visitId: z.number().int().positive().optional(),
  description: z.string().trim().min(10).max(2000), lines: z.array(claimLine).min(1).max(20),
  photos: z.array(claimUpload).max(20).default([]), requestKey: z.string().min(8).max(128).regex(/^[\w:-]+$/) }).strict();
export type ClaimLine = z.infer<typeof claimLine>;
export type FileClaimInput = z.infer<typeof fileClaimInput>;
export type ClaimVisitEvidence = { before: string[]; after: string[]; checkinNotes: string | null; checkoutNotes: string | null;
  endedAt: string; timezone: string; chefName?: string; kitchenName?: string };
export type ClaimMoneyOperation = { key: string; state: 'pending' | 'ready' | 'cancel_pending' | 'cancelled' | 'succeeded';
  amountCents: number; startedAt: string; attemptedAt?: string; intentId?: string; transferId?: string;
  customerId?: string; paymentMethodId?: string; destination?: string; sourceCharge?: string; error?: string };

export function claimTotal(lines: ClaimLine[]) { return lines.reduce((sum, line) => sum + line.amountCents, 0); }
export function validateClaimLines(lines: unknown): ClaimLine[] {
  const parsed = z.array(claimLine).min(1).max(20).parse(lines);
  if (claimTotal(parsed) > CLAIM_CAP_CENTS) throw Error('For amounts over $250, Local Cooks handles it with you');
  return parsed;
}
export function claimFilingWindow(bookedEnd: Date, actualDeparture: Date | null, now = new Date()) {
  const endedAt = actualDeparture || bookedEnd, deadline = new Date(endedAt.getTime() + CLAIM_WINDOW_MS);
  return { endedAt, deadline, allowed: Number.isFinite(endedAt.getTime()) && now >= endedAt && now <= deadline };
}
export const claimResponseDeadline = (submittedAt: Date) => new Date(submittedAt.getTime() + CLAIM_WINDOW_MS);
export const claimNeedsEscalation = (status: string, deadline: Date, now = new Date()) => status === 'submitted' && now >= deadline;
export const payableClaimStatuses = ['submitted', 'approved', 'partially_approved', 'chef_accepted', 'charge_failed', 'escalated'];
export function claimBookingHeld(claim: { upheldAt?: Date | string | null; chefOwes?: boolean; holdReleasedAt?: Date | string | null;
  resolvedAt?: Date | string | null; chargeSucceededAt?: Date | string | null; status: string }, now = new Date()) {
  return claim.chefOwes === true && !!claim.upheldAt && !claim.holdReleasedAt && !claim.resolvedAt && !claim.chargeSucceededAt
    && !['rejected', 'resolved', 'charge_succeeded', 'expired'].includes(claim.status)
    && now.getTime() >= new Date(claim.upheldAt).getTime() + CLAIM_BOOKING_HOLD_MS;
}
export function approvedClaimAmount(claimed: number, approved = claimed) {
  if (!Number.isSafeInteger(approved) || approved <= 0 || approved > claimed || approved > CLAIM_CAP_CENTS)
    throw Error('Choose whole cents greater than zero, no more than the claim, up to $250');
  return approved;
}
export const claimSupportTypes = ['claim_uphold', 'claim_reduce', 'claim_reject', 'claim_compensate', 'claim_close', 'claim_release_hold'] as const;
export const claimSupportInput = z.object({ type: z.enum(claimSupportTypes), claimId: z.number().int().positive(),
  amountCents: z.number().int().positive().max(CLAIM_CAP_CENTS).optional(), chefStillOwes: z.boolean().optional(),
  reasonCode: z.string().trim().min(1).max(100), note: z.string().trim().min(10).max(2000),
  publicMessage: z.string().trim().min(10).max(2000), requestSource: z.enum(['message', 'call', 'email', 'in_person', 'proactive']),
  operationKey: z.string().min(8).max(128).regex(/^[\w:-]+$/) }).strict().superRefine((value, ctx) => {
    if (['claim_reduce', 'claim_compensate'].includes(value.type) && !value.amountCents)
      ctx.addIssue({ code: 'custom', path: ['amountCents'], message: 'Choose the approved amount' });
    if (value.type === 'claim_compensate' && value.chefStillOwes === undefined)
      ctx.addIssue({ code: 'custom', path: ['chefStillOwes'], message: 'Choose write-off or chef still owes' });
  });
export type ClaimSupportInput = z.infer<typeof claimSupportInput>;
