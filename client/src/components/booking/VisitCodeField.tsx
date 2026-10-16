import { localCooksSupportHref } from "@/components/support/ContactLocalCooks";
import { BookingProblemReport } from "./BookingProblemReport"
/**
 * VisitCodeField
 *
 * Chef-side arrival code surface. It is rendered inside the existing arrival section and its value is
 * submitted together with the arrival evidence by the parent. The code is never stored, logged or echoed
 * anywhere except this controlled input.
 */
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { KeyRound, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { getAuthHeaders } from "@/lib/api"
import UnifiedChatView from "@/components/chat/UnifiedChatView"
import { VISIT_CODE_LENGTH, VISIT_CODE_MAX_ATTEMPTS, type ChefVisitCodeState, type VisitCodeErrorCode } from "@shared/visit-code"

export type VisitCodeGate = "none" | "code" | "self" | "locked" | "revoked"

/** What the arrival form must do for this visit. `none` = legacy behaviour (tap to arrive). */
export function visitCodeGate(state: ChefVisitCodeState | null | undefined, serverCode?: VisitCodeErrorCode | null): VisitCodeGate {
  if (!state || state.consumed) return "none"
  if (state.revoked || serverCode === "VISIT_CODE_REVOKED") return "revoked"
  if (state.mode === "self") return "self"
  if (state.locked || serverCode === "VISIT_CODE_LOCKED") return "locked"
  return state.codeRequired ? "code" : "none"
}

export interface VisitCodeProblem { code: VisitCodeErrorCode; attemptsLeft?: number }

interface VisitCodeFieldProps {
  gate: VisitCodeGate
  state: ChefVisitCodeState
  value: string
  onChange: (digits: string) => void
  problem: VisitCodeProblem | null
  canReportProblem?: boolean
  disabled?: boolean
  bookingId: number
  chefId: number
  kitchenName: string
}

export function VisitCodeField({ gate, state, value, onChange, problem, disabled, canReportProblem, bookingId, chefId, kitchenName }: VisitCodeFieldProps) {
  const { t } = useTranslation("chef")
  const id = useId()
  const [chat, setChat] = useState<{ conversationId: string; draft: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [chatError, setChatError] = useState("")
  const failed = t("kciVcMessageFailed", { defaultValue: "Could not open the conversation. Try again or contact Local Cooks." })
  const messageKitchen = async () => {
    if (busy) return
    setBusy(true); setChatError("")
    try {
      const response = await fetch(`/api/bookings/${bookingId}/conversation`, { method: "POST", headers: await getAuthHeaders(), credentials: "include" })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.conversationId) throw new Error(result.error || failed)
      setChat({ conversationId: result.conversationId, draft: t("kciVcAskNewDraft", { defaultValue: "Hi, I need a new check-in code for my booking at {kitchen}.", kitchen: kitchenName }) })
    } catch (error) {
      setChatError(error instanceof Error ? error.message : failed)
    } finally { setBusy(false) }
  }

  const attemptsLeft = problem?.attemptsLeft ?? state.attemptsLeft
  const attemptsText = (count: number) => t("kciVcAttemptsLeft", { defaultValue: "{count, plural, one {# attempt left} other {# attempts left}}", count })
  const problemText = (() => {
    switch (problem?.code) {
      case "VISIT_CODE_WRONG": return t("kciVcWrong", { defaultValue: "That check-in code is not correct. Check it with the kitchen staff and try again." })
      case "VISIT_CODE_REQUIRED": return t("kciVcRequired", { defaultValue: "Enter the 6-digit check-in code the kitchen gave you to confirm arrival." })
      case "VISIT_CODE_ALREADY_RECORDED": return t("kciVcAlreadyRecorded", { defaultValue: "Arrival is already recorded for this visit." })
      default: return ""
    }
  })()
  const tap = "min-h-11 w-full sm:w-auto whitespace-normal h-auto py-2"

  const message = (
    <>
      <Button type="button" variant="outline" className={tap} disabled={busy} onClick={() => void messageKitchen()}>
        <MessageSquare className="h-4 w-4 mr-2 shrink-0" />
        {busy ? t("kciVcOpening", { defaultValue: "Opening conversation…" }) : t("kciVcMessageKitchen", { defaultValue: "Message kitchen" })}
      </Button>
      {chatError && <p role="alert" className="text-sm text-destructive">{chatError}</p>}
      <Dialog open={!!chat} onOpenChange={open => { if (!open) setChat(null) }}>
        <DialogContent showCloseButton className="flex h-[85dvh] w-[calc(100%_-_1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
          <div className="min-w-0 shrink-0 border-b px-5 py-4 pr-14">
            <DialogTitle>{t("kciVcMessageKitchen", { defaultValue: "Message kitchen" })}</DialogTitle>
            <DialogDescription>{kitchenName}</DialogDescription>
          </div>
          {chat && <div className="min-h-0 flex-1 overflow-hidden">
            <UnifiedChatView userId={chefId} role="chef" initialDraft={chat.draft} initialConversationId={chat.conversationId} hideConversationList />
          </div>}
        </DialogContent>
      </Dialog>
    </>
  )

  const noAccess = <div><p className="text-sm text-muted-foreground">{t("kciAcNoAccess", { defaultValue: "Can't get inside or find staff? Contact the kitchen. Don't confirm arrival until you're at the kitchen." })}</p>{canReportProblem && <BookingProblemReport bookingId={bookingId} initialCategory="access" />}</div>

  if (gate === "self") {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 text-sm" data-testid="visit-code-self">
        <p className="flex items-start gap-2"><KeyRound className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t("kciVcSelfNote", { defaultValue: "The kitchen turned on self check-in for this visit, so you do not need a check-in code. Follow the arrival instructions, then confirm your arrival." })}</span></p>
      </div>
    )
  }

  if (gate === "locked" || gate === "revoked") {
    return (
      <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3" data-testid="visit-code-blocked">
        <p role="alert" className="text-sm text-destructive">{gate === "locked"
          ? t("kciVcLockedAsk", { defaultValue: "Ask the kitchen for a new check-in code" })
          : t("kciVcRevoked", { defaultValue: "This check-in code is no longer valid. Contact the kitchen." })}</p>
        {gate === "locked" && <p className="text-sm text-muted-foreground">{t("kciVcLocked", { defaultValue: "Too many incorrect check-in codes. Your check-in details are kept while you wait." })}</p>}
        {noAccess}
        {message}
        {gate === "locked" && <a className="flex min-h-11 items-center text-sm underline underline-offset-4" href={localCooksSupportHref({ bookingId, role: "chef", situation: "Visit code locked" })}>{t("kciAcGetHelp", { defaultValue: "Get help from Local Cooks" })}</a>}
      </div>
    )
  }

  const showAttempts = problem?.code === "VISIT_CODE_WRONG" || attemptsLeft < VISIT_CODE_MAX_ATTEMPTS
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">{t("kciVcLabel", { defaultValue: "Check-in code" })}</label>
      <Input
        id={id}
        name="visit-code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={VISIT_CODE_LENGTH}
        value={value}
        disabled={disabled}
        aria-invalid={!!problemText}
        aria-describedby={`${id}-hint ${id}-status`}
        placeholder="000000"
        className="h-12 sm:h-12 min-h-12 max-w-[12rem] text-center text-2xl font-semibold tracking-[0.35em] tabular-nums"
        onChange={event => onChange(event.target.value.replace(/\D/g, "").slice(0, VISIT_CODE_LENGTH))}
      />
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">{t("kciVcHint", { defaultValue: "Kitchen staff will give you your check-in code when you arrive." })}</p>
      {noAccess}
      <div id={`${id}-status`} aria-live="polite" className="space-y-1">
        {problemText && <p className="text-sm text-destructive">{problemText}</p>}
        {showAttempts && <p className="text-sm text-muted-foreground">{attemptsText(attemptsLeft)}</p>}
      </div>
    </div>
  )
}
