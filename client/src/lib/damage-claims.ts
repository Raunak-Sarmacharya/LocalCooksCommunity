import { apiClient } from '@/lib/api';
import type { ClaimLine, ClaimVisitEvidence, ClaimSupportInput } from '@shared/damage-claims';

export type DamageClaimCardData = { id: number; referenceCode: string | null; bookingId: number | null; visitId: number | null;
  chefId: number; managerId: number; status: string; claimVersion: number; description: string; amountCents: number; claimedAmountCents: number;
  lines: ClaimLine[]; visitEvidence: ClaimVisitEvidence | null; chefResponse: string | null; deadline: string; upheldAt: string | null;
  publicMessage: string | null; kitchenPaid: boolean; fundedBy: string; chefOwes: boolean; chefVisible: boolean;
  reviewRequest: string | null; kitchenReply: string | null; paymentBusy: boolean; compensationPending: boolean;
  resolutionType?: string | null;
  holdReleasedAt?: string | null;
  withdrawalPending?: boolean;
  kitchenPaymentPending?: boolean;
  evidence: Array<{ id: number; evidenceType: string; fileUrl: string; fileName: string | null; uploadedBy: number; description: string | null }>;
  history: Array<{ id: number; action: string; status: string; createdAt: string }> };
export type FilingContext = { allowed: boolean; deadline: string; endedAt: string; timezone: string; kitchenName: string; before: string[]; after: string[] };
export async function claimRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = body === undefined ? await apiClient.get(path) : await apiClient.post(path, body);
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Please refresh the claim and try again.');
  return result;
}
export const claimMoney = (amountCents: number, locale: string) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(amountCents / 100);
export const claimWhen = (at: string, timezone: string, locale: string) => new Intl.DateTimeFormat(locale,
  { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(at));
export const claimAction = (bookingId: number, input: ClaimSupportInput) => claimRequest(`/admin/booking-support/${bookingId}/claims/actions`, input);
