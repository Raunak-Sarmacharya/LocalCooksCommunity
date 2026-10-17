import { StorageIcon as Package } from "@/components/ui/inventory-icons";
import { logger } from "@/lib/logger";
import { useState } from 'react';
import { overstayCollectionError } from '@shared/overstay-collection';
import { Textarea } from '@/components/ui/textarea';
/**
 * PendingOverstayPenalties Component
 *
 * Displays pending overstay penalties for chefs and allows them to pay via Stripe.
 */

import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InfoChip } from "@/components/chef/info-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CreditCard, Calendar, Building2 } from "lucide-react";
import { auth } from "@/lib/firebase";
import { toast } from "sonner";
import { formatCurrency as formatCad } from "@shared/i18n";
import { ct } from "@/i18n/chef-ns";
import { storageDay } from "@/lib/storage-rentals";
import { friendlyTimezoneName } from "@shared/timezone-utils";

interface PendingPenalty {
  itemsRemovedAt: string | null;
  chefDisputeDeadline: string | null;
  chefDisputedAt: string | null;
  disputeReviewedAt: string | null;
  overstayId: number;
  storageBookingId: number;
  status: string;
  daysOverdue: number;
  calculatedPenaltyCents: number;
  finalPenaltyCents: number | null;
  detectedAt: string;
  penaltyApprovedAt: string;
  chargeSucceededAt?: string | null;
  storageName: string;
  storageType: string;
  kitchenName: string;
  bookingEndDate: string;
  paidThrough?: string | null;
  penaltyTotalCents?: number;
  penaltyAmountCents: number;
  isResolved?: boolean;
  isPaid?: boolean;
  idempotencyKey?: string | null;
}

const isHoldover = (p: PendingPenalty) => !!p.idempotencyKey?.startsWith('holdover:');
// The shared rule returns English messages for the server; the chef sees these keys instead.
const RULE_KEYS: Record<string, string> = {
  'Collection is paused for admin review of the chef dispute': 'ovhRuleDisputeReview',
  'Manager-confirmed removal is required before payment': 'ovhRuleRemoval',
  'The final penalty notice must be sent before collection': 'ovhRuleNotice',
  'The chef dispute window is still open': 'ovhRuleWindow',
};
// A moment in the chef's own clock, with the zone name.
const localMoment = (at: string, locale: string) => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(at))} (${friendlyTimezoneName(zone, locale)})`;
};

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };
    }
  } catch (error) {
    logger.error('Error getting Firebase token:', error);
  }
  return {
    'Content-Type': 'application/json',
  };
}

/** `title` relabels the card where the same charges read as storage "Holdover". */
export function PendingOverstayPenalties({ title }: { title?: string } = {}) {
  const [disputeId, setDisputeId] = useState<number | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const { t, i18n } = useTranslation("chef");

  // Fetch pending penalties
  const { data: penalties = [], isLoading, error, refetch } = useQuery<PendingPenalty[]>({
    queryKey: ['/api/chef/overstay-penalties'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/chef/overstay-penalties', {
        headers,
        credentials: 'include',
      });
      if (!response.ok) throw new Error(ct("failedToFetchPenalties"));
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Pay penalty mutation
  const payMutation = useMutation({
    mutationFn: async (overstayId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/chef/overstay-penalties/${overstayId}/pay`, {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || ct('ovhPayFailed'));
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        // Safety: ensure Radix UI hasn't left pointer-events:none on body
        document.body.style.pointerEvents = '';
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || t("overstayPaymentFailed", "Failed to initiate payment"));
    },
  });

  // Separate pending and resolved penalties
  const disputeMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/chef/overstay-penalties/${id}/dispute`, {
        method: 'POST', credentials: 'include', headers: await getAuthHeaders(), body: JSON.stringify({ reason: disputeReason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || ct('ovhDisputeFailed'));
    },
    onSuccess: () => { setDisputeId(null); setDisputeReason(''); refetch(); toast.success(ct('ovhDisputed')); },
    onError: (error: Error) => toast.error(error.message),
  });
  const pendingPenalties = penalties.filter(p => !p.isResolved);

  // Don't render anything if no PENDING penalties (resolved ones show on storage cards)
  if (!isLoading && pendingPenalties.length === 0) {
    return null;
  }

  if (isLoading) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return null; // Silently fail - don't show error to user
  }

  const allHoldover = pendingPenalties.every(isHoldover);
  const loc = i18n.language;

  // Only show pending penalties - resolved ones show on storage cards
  return (
    <Card className="border border-destructive/30">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <CardTitle className="text-lg">
            {title ?? t("overstayPenaltiesTitle", "Outstanding Overstay Penalties")}
          </CardTitle>
          <InfoChip variant="destructive">
            {allHoldover ? t("ovhChip") : t("overstayPaymentRequired", "Payment required")}
          </InfoChip>
        </div>
        <CardDescription>
          {allHoldover ? t("ovhDesc") : t("overstayPenaltiesDesc", { count: pendingPenalties.length })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendingPenalties.map((penalty) => {
          const holdover = isHoldover(penalty);
          const ruleKey = RULE_KEYS[overstayCollectionError(penalty) ?? ''];
          // The chef sees what Stripe will charge: the amount plus the kitchen's tax.
          const amount = formatCad(penalty.penaltyTotalCents ?? penalty.penaltyAmountCents, { locale: loc });
          return (
          <div
            key={penalty.overstayId}
            className="rounded-[1.35rem] border p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-purple-600" />
                  <span className="font-medium">{penalty.storageName}</span>
                  <InfoChip variant="outline" className="capitalize">
                    {penalty.storageType}
                  </InfoChip>
                </div>

                {holdover ? (
                  <p className="text-sm text-muted-foreground">
                    {t("ovhBody", { kitchen: penalty.kitchenName, amount, days: penalty.daysOverdue, paidThrough: storageDay((penalty.paidThrough ?? penalty.bookingEndDate).slice(0, 10), loc) })}
                  </p>
                ) : <>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{penalty.kitchenName}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      {t("overstayEndedOn", {
                        date: storageDay(penalty.bookingEndDate.slice(0, 10), loc, true),
                      })}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <InfoChip variant="destructive">
                    {t("overstayDaysOverdue", {
                      count: penalty.daysOverdue,
                      defaultValue: `${penalty.daysOverdue} day${penalty.daysOverdue !== 1 ? "s" : ""} overdue`,
                    })}
                  </InfoChip>
                </div>
                </>}
              </div>

              <div className="text-right space-y-2">
                <div className="text-xl font-bold">
                  {amount}
                </div>
                <Button
                  size="sm"
                  onClick={() => payMutation.mutate(penalty.overstayId)}
                  disabled={payMutation.isPending || !!overstayCollectionError(penalty)}
                >
                  <CreditCard className="h-4 w-4 mr-1" />
                  {payMutation.isPending
                    ? t("processing", "Processing...")
                    : holdover ? t("ovhPay", { amount }) : t("payNow", "Pay Now")}
                </Button>
              </div>
            </div>

            {overstayCollectionError(penalty) && <p className="text-sm">{ruleKey ? ct(ruleKey) : overstayCollectionError(penalty)}</p>}
            {penalty.status === 'penalty_approved' && penalty.chefDisputeDeadline && Date.now() < new Date(penalty.chefDisputeDeadline).getTime() && (
              <div className="space-y-2">
                <Button variant="outline" onClick={() => { setDisputeId(penalty.overstayId); setDisputeReason(''); }}>{holdover ? t("ovhDispute") : t("ovhLegacyDispute")}</Button>
                {disputeId === penalty.overstayId && <>
                  <Textarea aria-label={t("ovhReasonLabel")} value={disputeReason} onChange={event => setDisputeReason(event.target.value)} placeholder={holdover ? t("ovhReasonPrompt") : t("ovhLegacyPrompt")} />
                  <Button disabled={disputeMutation.isPending || disputeReason.trim().length < 10} onClick={() => disputeMutation.mutate(penalty.overstayId)}>{holdover ? t("ovhSend") : t("ovhLegacySend")}</Button>
                </>}
              </div>
            )}
            {penalty.chefDisputeDeadline && <p className="text-sm">{t(holdover ? "ovhDeadline" : "ovhLegacyDeadline", { date: localMoment(penalty.chefDisputeDeadline, loc) })}</p>}
            {!holdover && penalty.penaltyApprovedAt && <p className="text-xs text-muted-foreground border-t pt-2">
              {t("overstayApprovedOn", {
                date: localMoment(penalty.penaltyApprovedAt, loc),
              })}
            </p>}
          </div>
          );
        })}

        {!allHoldover && <p className="text-xs text-muted-foreground text-center pt-2">
          {t(
            "overstayPenaltiesFooter",
            "Please pay your outstanding penalties to maintain good standing and continue using storage facilities."
          )}
        </p>}
      </CardContent>
    </Card>
  );
}

export default PendingOverstayPenalties;
