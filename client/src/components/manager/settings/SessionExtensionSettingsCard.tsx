import { SettingChangePreview } from './SettingChangePreview';
import { useSettingImpact } from '@/lib/setting-impact';
/**
 * Kitchen settings → Bookings: "Approve extensions automatically when the time is free" (default off).
 * `admin` shows the Local Cooks per-kitchen override (on / off / follow the kitchen) with a required reason.
 */
import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { apiGet, apiPutWithMessage } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"

type Settings = { kitchenId: number; kitchenName: string; enabled: boolean; autoApprove: boolean; override: boolean | null; overrideReason: string | null; effectiveAutoApprove: boolean }

export function SessionExtensionSettingsCard({ kitchenId, admin = false }: { kitchenId: number; admin?: boolean }) {
  const { t } = useTranslation("manager")
  const path = `/${admin ? "admin" : "manager"}/kitchens/${kitchenId}/session-extension-settings`
  const { data, isError, refetch } = useQuery<Settings>({ queryKey: ["session-extension-settings", admin, kitchenId], queryFn: () => apiGet(path) })
  const impact = useSettingImpact(kitchenId)
  const [draft, setDraft] = useState(false)
  useEffect(() => { if (data) setDraft(data.effectiveAutoApprove) }, [data])
  const [override, setOverride] = useState<"follow" | "on" | "off">("follow")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  useEffect(() => { if (data) setOverride(data.override == null ? "follow" : data.override ? "on" : "off") }, [data])

  const save = async (body: Record<string, unknown>) => {
    setBusy(true); setMessage("")
    try { await apiPutWithMessage(path, body); await refetch(); setMessage(t("sxsSaved", { defaultValue: "Saved." })) }
    catch (error) { setMessage(error instanceof Error ? error.message : t("sxsError", { defaultValue: "This setting couldn’t be saved. Try again." })) }
    finally { setBusy(false) }
  }
  const nextAutoApprove = override === 'follow' ? !!data?.autoApprove : override === 'on'
  const locked = !admin && data?.override != null
  return (
    <Card data-testid="session-extension-settings">
      <CardHeader><CardTitle>{t("sxsTitle", { defaultValue: "Extra time during a booking" })}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {isError ? <p role="alert">{t("sxsError", { defaultValue: "This setting couldn’t be loaded. Try again." })} <Button variant="outline" onClick={() => void refetch()}>{t("sxsRetry", { defaultValue: "Retry" })}</Button></p> : <>
          <div className="flex items-start justify-between gap-4">
            <label htmlFor={`auto-extend-${kitchenId}`} className="space-y-1">
              <span className="block text-sm font-medium">{t("sxsToggle", { defaultValue: "Approve extensions automatically when the time is free" })}</span>
              <span className="block text-xs text-muted-foreground">{t("sxsHelper", { defaultValue: "When off, you’ll get a request to approve with one tap." })}</span>
            </label>
            <Switch id={`auto-extend-${kitchenId}`} checked={admin ? !!data?.autoApprove : draft} disabled={!data || busy || locked || admin}
              onCheckedChange={setDraft} />
          </div>
          {!admin && <SettingChangePreview whatChanges={t(draft ? 'scpAutoOnWhat' : 'scpAutoOffWhat', { kitchen: data?.kitchenName })}
            appliesTo={t(draft ? 'scpAutoWhen' : 'scpNow')} impact={impact}
            rightNow={impact ? t(draft ? 'scpAutoImpact' : 'scpAutoOffImpact', { ...impact }) : undefined}
            undo={t('scpAutoUndo')} confirm={draft} actionLabel={t(draft ? 'scpApproveAuto' : 'scpSave')}
            cancelLabel={t('scpKeepManual')} disabled={!data || busy || locked || draft === data.effectiveAutoApprove}
            onSave={() => save({ autoApprove: draft })} />}
          {locked && <p className="text-sm">{t("sxsLocked", { defaultValue: "Local Cooks set this for your kitchen: {reason}", reason: data?.overrideReason || "" })}</p>}
          {data && !data.enabled && <p className="text-sm text-muted-foreground">{t("sxsPaused", { defaultValue: "Extra time is paused on Local Cooks right now. Chefs can still message you." })}</p>}
          {admin && data && <fieldset className="space-y-2 border-t pt-3">
            <legend className="text-sm font-medium">{t("sxsOverride", { defaultValue: "Local Cooks override" })}</legend>
            {(["follow", "on", "off"] as const).map(value => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name={`extension-override-${kitchenId}`} value={value} checked={override === value} onChange={() => setOverride(value)} />
                {value === "follow" ? t("sxsFollow", { defaultValue: "Follow the kitchen’s choice ({choice})", choice: data.autoApprove ? t("sxsOn", { defaultValue: "on" }) : t("sxsOff", { defaultValue: "off" }) })
                  : value === "on" ? t("sxsForceOn", { defaultValue: "Always approve automatically" }) : t("sxsForceOff", { defaultValue: "Always ask the kitchen" })}
              </label>
            ))}
            <label className="block text-sm">{t("sxsReason", { defaultValue: "Reason (required)" })}
              <textarea className="mt-1 block w-full rounded border p-2" value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} /></label>
            <SettingChangePreview whatChanges={t(nextAutoApprove ? 'scpAutoOnWhat' : 'scpAutoOffWhat', { kitchen: data.kitchenName })}
              appliesTo={t('scpAutoWhen')} impact={impact} undo={t('scpAutoUndo')}
              confirm={nextAutoApprove && !data.effectiveAutoApprove} actionLabel={t('scpSaveOverride')} disabled={busy || !reason.trim()}
              onSave={() => save({ override: override === 'follow' ? null : override === 'on', reason: reason.trim() })} />
          </fieldset>}
        </>}
        {message && <p role="status" className="text-sm">{message}</p>}
      </CardContent>
    </Card>
  )
}

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
        <p className="text-sm">{data?.enabled === false ? t("sxsPlatformPaused", { defaultValue: "Paused: chefs and kitchens can’t add or charge extra time. Payments already in progress still finish." })
          : t("sxsPlatformOn", { defaultValue: "On: chefs can ask for more time, kitchens can offer it and charge for extra time." })}</p>
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
