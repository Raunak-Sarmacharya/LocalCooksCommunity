import { apiClient } from '@/lib/api';
import { CLAIM_BOOKING_HOLD_MS, type ClaimLine, type ClaimVisitEvidence, type ClaimSupportInput } from '@shared/damage-claims';

export type DamageClaimCardData = { id: number; referenceCode: string | null; bookingId: number | null; visitId: number | null; storageRentalId?: number | null;
  /** Which booking and day the claim is about (kitchen bookings). */
  bookingReference?: string | null; day?: { number: number; total: number; date: string } | null; createdAt?: string; chefName?: string;
  chefId: number; managerId: number; status: string; claimVersion: number; description: string; amountCents: number; claimedAmountCents: number;
  lines: ClaimLine[]; visitEvidence: ClaimVisitEvidence | null; chefResponse: string | null; deadline: string; upheldAt: string | null;
  publicMessage: string | null; kitchenPaid: boolean; fundedBy: string; chefOwes: boolean; chefVisible: boolean;
  reviewRequest: string | null; kitchenReply: string | null; paymentBusy: boolean; compensationPending: boolean;
  resolutionType?: string | null;
  holdReleasedAt?: string | null;
  withdrawalPending?: boolean;
  kitchenPaymentPending?: boolean;
  /** Local Cooks only: why the chef's payment is held for review (start it over from support). */
  paymentReview?: string | null;
  evidence: Array<{ id: number; evidenceType: string; fileUrl: string; fileName: string | null; uploadedBy: number; description: string | null }>;
  history: Array<{ id: number; action: string; status: string; createdAt: string }> };
export type FilingContext = { allowed: boolean; deadline: string; endedAt: string; timezone: string; kitchenName: string; before: string[]; after: string[];
  noBaseline?: boolean; baselineNote?: string | null };
export async function claimRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = body === undefined ? await apiClient.get(path) : await apiClient.post(path, body);
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Please refresh the claim and try again.');
  return result;
}
export const claimMoney = (amountCents: number, locale: string) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(amountCents / 100);
export const claimWhen = (at: string, timezone: string, locale: string) => new Intl.DateTimeFormat(locale,
  { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(at));
/** Last day to pay an upheld charge before new bookings pause (the existing 7-day hold after the final decision). */
export const claimPayByDate = (upheldAt: string, timezone: string, locale: string) => new Intl.DateTimeFormat(locale,
  { timeZone: timezone, month: 'short', day: 'numeric' }).format(new Date(new Date(upheldAt).getTime() + CLAIM_BOOKING_HOLD_MS));
export const claimAction = (bookingId: number, input: ClaimSupportInput) => claimRequest(`/admin/booking-support/${bookingId}/claims/actions`, input);
