import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { CARD_RADIUS } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ChefPageHeader } from "@/components/chef/ui";

export type SavedCard = { id: string; brand: string; last4: string; expMonth: number; expYear: number; lastUsedAt: string | null; wallet: string | null };

const brandName = (brand: string) => brand === "amex" ? "Amex" : brand === "mastercard" ? "Mastercard" : brand.charAt(0).toUpperCase() + brand.slice(1);
// A card is good through the last day of its expiry month.
const expired = (card: SavedCard, now = new Date()) => card.expYear < now.getFullYear() || (card.expYear === now.getFullYear() && card.expMonth < now.getMonth() + 1);

/** Payments → Saved cards: the cards Stripe keeps for payments the chef confirms, each removable (Airbnb, Turo; owner Oct 28). */
export function SavedCards() {
  const { t, i18n } = useTranslation("chef");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<SavedCard | null>(null);
  const cards = useQuery({ queryKey: ["/api/chef/saved-cards"], retry: false,
    queryFn: async () => (await (await apiRequest("GET", "/api/chef/saved-cards")).json() as { cards: SavedCard[] }).cards });
  const remove = useMutation({
    mutationFn: async (card: SavedCard) => apiRequest("POST", `/api/chef/saved-cards/${encodeURIComponent(card.id)}/remove`),
    onSuccess: (_result, card) => {
      setRemoving(null);
      queryClient.setQueryData<SavedCard[]>(["/api/chef/saved-cards"], rows => rows?.filter(row => row.id !== card.id));
      toast({ title: t("scRemoved", { card: `${brandName(card.brand)} •••• ${card.last4}` }) });
    },
  });
  const label = (card: SavedCard) => `${brandName(card.brand)} •••• ${card.last4}`;
  const date = (iso: string) => new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));

  return (
    <div className="space-y-6">
      <ChefPageHeader title={t("scTitle")} description={t("scLead")} />
      {cards.isLoading ? (
        <div className="space-y-3" role="status" aria-label={t("scLoading")}>{[0, 1].map(index => <Skeleton key={index} className="h-[72px] w-full rounded-xl" />)}</div>
      ) : cards.error ? (
        <p role="alert" className="text-sm">{t("scLoadError")} <Button variant="link" className="h-auto p-0" onClick={() => void cards.refetch()}>{t("scRetry")}</Button></p>
      ) : !cards.data?.length ? (
        <div className={cn(CARD_RADIUS, "border px-5 py-8 text-center")}>
          <p className="font-medium">{t("scEmptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("scEmptyBody")}</p>
        </div>
      ) : (
        <ul aria-label={t("scTitle")} className={cn(CARD_RADIUS, "divide-y border")}>
          {cards.data.map(card => (
            <li key={card.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
              <span aria-hidden="true" className="flex h-10 w-14 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold tracking-tight text-foreground">{brandName(card.brand)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium tabular-nums">{label(card)}{card.wallet ? <span className="font-normal text-muted-foreground"> · {t(card.wallet === "apple_pay" ? "scApplePay" : card.wallet === "google_pay" ? "scGooglePay" : "scWallet")}</span> : null}</span>
                <span className={cn("mt-0.5 block text-sm tabular-nums", expired(card) ? "text-destructive" : "text-muted-foreground")}>
                  {t(expired(card) ? "scExpired" : "scExpires", { date: `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}` })}
                  {card.lastUsedAt ? ` · ${t("scLastUsed", { date: date(card.lastUsedAt) })}` : ""}
                </span>
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => { remove.reset(); setRemoving(card); }} aria-label={t("scRemoveLabel", { card: label(card) })}>{t("scRemove")}</Button>
            </li>
          ))}
        </ul>
      )}
      <p className="max-w-2xl text-sm text-muted-foreground">{t("scFootnote")}</p>

      <AlertDialog open={!!removing} onOpenChange={open => { if (!open && !remove.isPending) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removing ? t("scConfirmTitle", { card: label(removing) }) : ""}</AlertDialogTitle>
            <AlertDialogDescription>{t("scConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          {remove.error && <p role="alert" className="text-sm text-destructive">{remove.error.message || t("scRemoveError")}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>{t("scKeep")}</AlertDialogCancel>
            {/* Not AlertDialogAction: it closes on click, and an error must stay readable in the dialog. */}
            <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => removing && remove.mutate(removing)}>{remove.isPending ? t("scRemoving") : t("scConfirm")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
