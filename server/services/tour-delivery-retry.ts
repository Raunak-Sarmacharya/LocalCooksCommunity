export const tourEmailAttemptLimit = 3;

export type TourDeliveryAttempt = {
  status: 'sending' | 'uncertain' | 'failed' | 'accepted' | 'verified' | 'retry_authorized';
  recipient: string;
  attempts: number;
  lastAttemptAt: string;
  diagnostic?: 'acceptance_unknown' | 'smtp_rejected' | 'connection_failed' | 'send_failed';
  review?: { actorId: number; at: string; decision: 'accepted' | 'resend'; evidence: string };
};
export type TourDeliveryRecovery = {
  deliveryAttempts?: Record<string, TourDeliveryAttempt>;
  deliveryPaused?: boolean;
  deliveryFailures?: number;
};

export function tourEmailNeedsReview(attempt?: TourDeliveryAttempt) {
  return !!attempt && (attempt.status === 'sending' || attempt.status === 'uncertain'
    || attempt.status === 'failed' && attempt.attempts >= tourEmailAttemptLimit);
}

export function tourAttemptDiagnostic(attempt?: TourDeliveryAttempt) {
  if (attempt?.diagnostic === 'acceptance_unknown' || attempt?.status === 'sending')
    return 'SMTP acceptance is uncertain. Automatic resend is paused; verify provider or inbox evidence before recording delivery or authorizing one resend.';
  if (attempt?.diagnostic === 'smtp_rejected') return 'SMTP rejected this attempt; verify the recipient and provider configuration.';
  if (attempt?.diagnostic === 'connection_failed') return 'The SMTP connection could not be established; verify provider connectivity.';
  if (attempt?.diagnostic === 'send_failed') return 'This attempt failed before recorded acceptance; inspect server diagnostics.';
  return null;
}
