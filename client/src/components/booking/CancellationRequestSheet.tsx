"use client"

import { useState } from "react"
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
  const typeLabel = target.type === "kitchen" ? "Booking" : "Storage Booking"

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="sm:max-w-[440px] flex flex-col p-0 gap-0">
        {/* Header */}
        <SheetHeader className={`px-6 pt-6 pb-4 border-b ${isRequest ? "bg-gradient-to-br from-amber-50 to-orange-50" : "bg-gradient-to-br from-red-50 to-orange-50"}`}>
          <SheetTitle className="flex items-center gap-2 text-base">
            {isRequest ? (
              <Send className="h-5 w-5 text-amber-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-red-600" />
            )}
            {isRequest ? `Request ${typeLabel} Cancellation` : `Cancel ${typeLabel}`}
          </SheetTitle>
          <SheetDescription className="text-sm">
            {isRequest
              ? "Submit a cancellation request for the kitchen manager to review. You'll be notified once they respond."
              : "This action will cancel your booking immediately. This cannot be undone."}
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
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-amber-900">How this works</p>
                  <ol className="text-xs text-amber-800 space-y-1.5 list-decimal list-inside">
                    <li>Your cancellation request is sent to the kitchen manager</li>
                    <li>The manager reviews and approves or declines within the review window</li>
                    <li>If approved, a refund will be processed to your payment method</li>
                  </ol>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Badge variant="warning" className="text-[11px]">
                  <Clock className="h-3 w-3 mr-1" />
                  Manager Review Required
                </Badge>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-red-900">Immediate cancellation</p>
                  <p className="text-xs text-red-700">
                    This booking will be cancelled immediately. Any payment hold will be released back to your account.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Reason Field (only for tier 2 — cancellation requests) */}
          {isRequest && (
            <div className="space-y-2">
              <label htmlFor="cancellation-reason" className="text-sm font-medium">
                Reason for cancellation
                <span className="text-muted-foreground font-normal ml-1">(optional)</span>
              </label>
              <Textarea
                id="cancellation-reason"
                placeholder="Let the manager know why you'd like to cancel..."
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
            Go Back
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
                Processing...
              </span>
            ) : isRequest ? (
              <span className="flex items-center gap-1.5">
                <Send className="h-4 w-4" />
                Submit Request
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Confirm Cancellation
              </span>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
