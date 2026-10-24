import { SettingChangePreview } from './SettingChangePreview';
/**
 * Local Cooks' platform switch for extra time. There is no automatic approval: a customer's request always
 * waits for the kitchen (owner, Oct 24).
 */
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { apiGet, apiPutWithMessage } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** Platform kill switch: pauses every new extension, offer and extra-time payment. */
export function SessionExtensionsPlatformSwitch() {
  const { t } = useTranslation("manager")
  const { data, refetch } = useQuery<{ enabled: boolean; openRequests?: number }>({ queryKey: ["session-extensions-platform"], queryFn: () => apiGet("/admin/session-extensions") })
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const toggle = async () => {
    if (!data) return
    setBusy(true); setMessage("")
    try { await apiPutWithMessage("/admin/session-extensions", { enabled: !data.enabled, reason: reason.trim() }); setReason(""); await refetch() }
    catch (error) { setMessage(error instanceof Error ? error.message : t("sxsError", { defaultValue: "This setting couldn’t be saved. Try again." })) }
    finally { setBusy(false) }
  }
  return (
    <Card data-testid="session-extensions-platform">
      <CardHeader><CardTitle>{t("sxsPlatformTitle", { defaultValue: "Extra time (all kitchens)" })}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{data?.enabled === false ? t("sxsPlatformPaused", { defaultValue: "Paused: customers and kitchens can’t add or charge extra time. Payments already in progress still finish." })
          : t("sxsPlatformOn", { defaultValue: "On: customers can ask for more time, kitchens can offer it and charge for extra time." })}</p>
        <label className="block text-sm">{t("sxsReason", { defaultValue: "Reason (required)" })}
          <textarea className="mt-1 block w-full rounded border p-2" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
        <SettingChangePreview whatChanges={t(data?.enabled === false ? 'scpResumeWhat' : 'scpPauseWhat')}
          appliesTo="now" rightNow={data?.openRequests == null ? t('scpOpenUnknown') : t('scpPauseImpact', { openRequests: data.openRequests })}
          undo={t('scpPauseUndo')} confirm actionLabel={t(data?.enabled === false ? 'sxsResume' : 'sxsPause')}
          disabled={!data || busy || !reason.trim()} onSave={toggle} />
        {message && <p role="status" className="text-sm">{message}</p>}
      </CardContent>
    </Card>
  )
}
