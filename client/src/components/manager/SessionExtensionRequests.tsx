/** Manager dashboard: chefs asking for more time right now, with one-tap Approve / Decline (POST only). */
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "wouter"
import { Clock, Loader2 } from "lucide-react"
import { apiGet } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { decideExtension, kitchenClock, money, type ExtensionItem } from "@/lib/session-extensions"

type Pending = ExtensionItem & { bookingId: number; kitchenName: string; timezone: string | null; chefName: string | null }

export function SessionExtensionRequests() {
  const { t, i18n } = useTranslation("manager")
  const locale = i18n.resolvedLanguage || i18n.language || "en-CA"
  const { data, refetch } = useQuery<{ requests: Pending[] }>({ queryKey: ["session-extension-requests"], queryFn: () => apiGet("/manager/session-extensions/pending"),
    refetchInterval: 60_000, refetchIntervalInBackground: false })
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ id: number; text: string; error?: boolean } | null>(null)
  const requests = data?.requests || []
  if (!requests.length && !message) return null
  const decide = async (item: Pending, action: "approve" | "approve_free" | "decline") => {
    setBusy(`${action}-${item.id}`); setMessage(null)
    try {
      await decideExtension(item.bookingId, item.id, { action })
      setMessage({ id: item.id, text: action !== "decline" ? t("sxrApproved", { defaultValue: "Approved. {chef} has more time.", chef: item.chefName || t("sxrChef", { defaultValue: "The chef" }) })
        : t("sxrDeclined", { defaultValue: "Declined. Their card hold is released." }) })
    } catch (error) { setMessage({ id: item.id, text: error instanceof Error ? error.message : t("sxrFailed", { defaultValue: "That didn’t go through. Open the booking to try again." }), error: true }) }
    finally { setBusy(null); await refetch() }
  }
  return (
    <section className="space-y-2 rounded-xl border border-primary/40 p-4" aria-labelledby="extension-requests-title" data-testid="extension-requests">
      <h2 id="extension-requests-title" className="flex items-center gap-2 text-base font-semibold"><Clock className="h-4 w-4" aria-hidden />{t("sxrTitle", { defaultValue: "Chefs asking for more time" })}</h2>
      {requests.map(item => {
        const zone = item.timezone || "America/St_Johns"
        return (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
            <p className="text-sm">{t("sxrLine", { defaultValue: "{chef} asked for {minutes} more minutes at {kitchen} (until {time}) · you’d get {payout}",
              chef: item.chefName || t("sxrChef", { defaultValue: "The chef" }), minutes: item.minutes, kitchen: item.kitchenName,
              time: kitchenClock(item.endAt, zone, locale), payout: money(item.kitchenGrossCents ?? 0, "CAD", locale) })}
              {" "}<Link href={`/manager/booking/${item.bookingId}`} className="underline underline-offset-4">{t("sxrOpen", { defaultValue: "Open booking" })}</Link></p>
            <div className="flex gap-2">
              <Button size="sm" className="min-h-11" disabled={!!busy} onClick={() => void decide(item, "approve")}>
                {busy === `approve-${item.id}` && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}{t("sxrApproveCharge", { defaultValue: "Approve · charge {amount}", amount: money(item.amountCents, "CAD", locale) })}</Button>
              <Button size="sm" variant="outline" className="min-h-11" disabled={!!busy} onClick={() => void decide(item, "approve_free")}>{t("sxrApproveFree", { defaultValue: "Approve for free" })}</Button>
              <Button size="sm" variant="outline" className="min-h-11" disabled={!!busy} onClick={() => void decide(item, "decline")}>{t("sxrDecline", { defaultValue: "Decline" })}</Button>
            </div>
          </div>
        )
      })}
      {message && <p role={message.error ? "alert" : "status"} className={`text-sm ${message.error ? "text-destructive" : ""}`}>{message.text}</p>}
    </section>
  )
}
