"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  AlertTriangle,
  Clock,
  Send,
  X,
  Calendar,
  MapPin,
  Info,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

export type CancellationTier = "immediate" | "request"

export interface CancellationTarget {
  type: "kitchen" | "storage"
  id: number
  name: string
  date?: string
  location?: string
  tier: CancellationTier
}

interface CancellationRequestSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: CancellationTarget | null
  isPending?: boolean
  onConfirm: (id: number, reason?: string) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CancellationRequestSheet({
  open,
  onOpenChange,
  target,
  isPending = false,
  onConfirm,
}: CancellationRequestSheetProps) {
  const { t: tStrict } = useTranslation("chef")
  const t = (key: string, options?: Record<string, unknown>): string =>
    String(tStrict(key as never, options as never))

  const [reason, setReason] = useState("")

  const handleSubmit = () => {
    if (!target) return
    onConfirm(target.id, target.tier === "request" ? reason || undefined : undefined)
    setReason("")
  }

  const handleClose = () => {
    setReason("")
    onOpenChange(false)
  }

  if (!target) return null

  const isRequest = target.tier === "request"
  const typeLabel =
    target.type === "kitchen" ? t("crTypeBooking") : t("crTypeStorageBooking")

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="sm:max-w-[440px] flex flex-col p-0 gap-0">
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            {isRequest ? (
              <Send className="h-5 w-5 text-muted-foreground" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
            {isRequest
              ? t("crRequestTitle", { type: typeLabel })
              : t("crCancelTitle", { type: typeLabel })}
          </SheetTitle>
          <SheetDescription className="text-sm">
            {isRequest ? t("crRequestDesc") : t("crImmediateDesc")}
          </SheetDescription>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Booking Details Card */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2.5">
            <p className="text-sm font-semibold text-foreground">{target.name}</p>
            {target.date && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>{target.date}</span>
              </div>
            )}
            {target.location && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                <span>{target.location}</span>
              </div>
            )}
          </div>

          {/* Process Explanation */}
          {isRequest ? (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("crHowThisWorks")}</p>
                  <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                    <li>{t("crStep1")}</li>
                    <li>{t("crStep2")}</li>
                    <li>{t("crStep3")}</li>
                  </ol>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Badge variant="warning" className="text-[11px]">
                  <Clock className="h-3 w-3 mr-1" />
                  {t("crManagerReviewRequired")}
                </Badge>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-destructive/30 p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t("crImmediateCancellation")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("crImmediateCancellationDesc")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Reason Field (only for tier 2 — cancellation requests) */}
          {isRequest && (
            <div className="space-y-2">
              <label htmlFor="cancellation-reason" className="text-sm font-medium">
                {t("crReasonLabel")}
                <span className="text-muted-foreground font-normal ml-1">
                  {t("crReasonOptional")}
                </span>
              </label>
              <Textarea
                id="cancellation-reason"
                placeholder={t("crReasonPlaceholder")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-[100px] resize-none"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">{reason.length}/500</p>
            </div>
          )}
        </div>

        <Separator />

        {/* Footer */}
        <SheetFooter className="px-6 py-4 flex flex-row gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleClose}
            disabled={isPending}
          >
            <X className="h-4 w-4 mr-1.5" />
            {t("crGoBack")}
          </Button>
          <Button
            variant={isRequest ? "default" : "destructive"}
            className="flex-1"
            onClick={handleSubmit}
            disabled={isPending}
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t("crProcessing")}
              </span>
            ) : isRequest ? (
              <span className="flex items-center gap-1.5">
                <Send className="h-4 w-4" />
                {t("crSubmitRequest")}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                {t("crConfirmCancellation")}
              </span>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
