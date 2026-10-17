import { z } from 'zod';

export const supportActionTypes = ['confirm_for_manager', 'decline_for_manager', 'release_hold_for_chef',
  'replay_payment_decision', 'cancel_kitchen_caused', 'request_cancellation_for_chef', 'accept_cancellation_for_manager',
  'issue_visit_code', 'set_arrival_mode', 'record_assisted_arrival', 'correct_attendance',
  'clear_checkout_for_manager', 'report_issue_for_manager', 'goodwill_refund', 'resend_notice', 'open_flag', 'resolve_flag', 'release_payout', 'resolve_money_attempt',
  'finish_kitchen_refund', 'refund_captured_request', 'retry_refund', 'mark_refunded', 'accept_proposal_for_chef'] as const;
const item = z.object({ id: z.number().int().positive(), action: z.enum(['confirmed', 'cancelled']) }).strict();
export const supportActionInput = z.object({
  type: z.enum(supportActionTypes), actingFor: z.enum(['chef', 'manager', 'local_cooks']),
  requestSource: z.enum(['message', 'call', 'email', 'in_person', 'proactive']), sourceRef: z.string().trim().max(500).optional(),
  reasonCode: z.string().trim().min(1).max(100), note: z.string().trim().min(10).max(2000),
  operationKey: z.string().min(8).max(128).regex(/^[a-zA-Z0-9:_-]+$/),
  amountCents: z.number().int().positive().optional(), confirmException: z.boolean().optional(),
  details: z.object({
    installmentId: z.number().int().positive().optional(),
    /** Multi-day bookings: the days a cancellation is for (none = every remaining day). */
    visitIds: z.array(z.number().int().positive()).min(1).max(14).optional(),
    refundOperationId: z.string().min(8).max(500).regex(/^[a-zA-Z0-9:_-]+$/).optional(), transactionId: z.number().int().positive().optional(),
    storageActions: z.array(item).optional(), equipmentActions: z.array(item).optional(),
    visitId: z.number().int().positive().optional(), targetKey: z.string().max(100).optional(), all: z.boolean().optional(),
    mode: z.enum(['staffed', 'self']).optional(), publicMessage: z.string().trim().min(10).max(2000).optional(),
    actualAt: z.string().datetime({ offset: true }).optional(),
    expectedUpdatedAt: z.string().datetime().optional(), expectedBookingUpdatedAt: z.string().datetime().optional(),
    attendanceAction: z.enum(['report_no_show', 'report_attended', 'withdraw_attendance']).optional(),
    confirmsChefAbsent: z.boolean().optional(), fundedByLocalCooks: z.boolean().optional(), quoteHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    claimTitle: z.string().trim().min(5).max(200).optional(), claimDescription: z.string().trim().min(50).max(2000).optional(),
    claimedAmountCents: z.number().int().positive().optional(),
    eventId: z.number().int().positive().optional(), recipientId: z.number().int().positive().optional(),
    force: z.boolean().optional(), flagId: z.number().int().positive().optional(),
  }).strict().optional(),
}).strict();
export type SupportActionInput = z.infer<typeof supportActionInput>;
export type SupportActionType = SupportActionInput['type'];
export type SupportMoneyPreview = {
  currency: string; chefReceivesCents: number | null; chefPaysCents: number | null;
  managerPaysCents: number | null; localCooksPaysCents: number | null; processingFeeCents: number | null;
  maximumCents: number | null; requiresExceptionAboveCents: number | null; providerVerified: boolean;
};
export type AvailableSupportAction = { type: SupportActionType; label: string; moneyPreview: SupportMoneyPreview };
