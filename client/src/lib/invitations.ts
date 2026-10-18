import { getAuthHeaders } from '@/lib/api';

/** Kitchen invitations ("Invite to book"): the shapes the server returns (see .phase0-harness/invitations-brief.md). */
export type InvitationStatus = 'sent' | 'accepted_pending_payment' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'superseded' | 'unavailable';
export type InvitationDiscount = { type: 'amount' | 'percent'; value: number };
export type InvitationPricing = { listSubtotalCents: number; offeredSubtotalCents: number; discount: InvitationDiscount | null;
  taxCents: number; serviceFeeCents: number; totalCents: number; managerEstimatedPayoutCents?: number };
export type InvitationDay = {
  date: string; pricingMode: 'hourly' | 'daily'; startTime: string; endTime: string;
  equipment: Array<{ listingId: number; name: string; cents: number }>;
  listKitchenCents?: number; offeredKitchenCents?: number;
};
export type Invitation = {
  id: string; version: number; status: InvitationStatus;
  kitchen: { id: number; name: string; locationId: number; locationName: string; photoUrl: string | null };
  chef: { id: number; name: string } | null;
  date: string; startTime: string; endTime: string; timezone: string;
  /** Every invited day; one entry for a legacy one-date invitation. */
  dayCount: number; days: InvitationDay[]; /** A frozen day set (CP10), rather than a legacy one-date invitation. */
  dated: boolean;
  pricing: InvitationPricing; note: string | null; expiresAt: string; createdAt: string; bookingId: number | null;
  startAt: string; unavailableReason?: string;
  /** One refund deadline for the whole booking, from the first day. */
  cancellation: { noticeHours: number; lateChargePercent: number; refundDeadlineAt: string };
  canWithdraw?: boolean; canReplace?: boolean; canPay?: boolean; canDecline?: boolean;
};
export type InvitationPreview = { pricing: InvitationPricing | null; expiresAt: string | null; available: boolean;
  unavailableReason?: string; warnings: string[];
  dayErrors?: Array<{ date: string; reason: string; message: string }> };
export type InvitationDayDraft = { date: string; pricingMode: 'hourly' | 'daily';
  slots: Array<{ startTime: string; endTime: string }>; equipmentIds: number[] };
export type InvitationDraft = {
  kitchenId: number; chefId: number;
  date?: string; startTime?: string; endTime?: string;
  /** A new day set (one or more days); replaces the legacy scalar fields. */
  days?: InvitationDayDraft[];
  discount?: InvitationDiscount; expiresInHours: 24 | 48 | 168; note?: string;
};

/** Authenticated JSON call; a refused request throws the server's plain message. */
export async function invitationRequest<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: await getAuthHeaders(),
    credentials: 'include', cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((result as { error?: string; message?: string }).error || (result as { message?: string }).message || 'Something went wrong. Try again.');
  return result as T;
}

/** An invitation still waiting for the chef's answer (expiry is evaluated by the server on read). */
export const invitationOpen = (invitation: Pick<Invitation, 'status'>) => invitation.status === 'sent' || invitation.status === 'accepted_pending_payment';

/** "HH:MM" plus whole hours, wrapping past midnight. */
export function addHours(time: string, hours: number) {
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m + hours * 60) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
