import { StorageIcon as Package } from "@/components/ui/inventory-icons";
/**
 * OverstayPenaltyQueue Component
 * 
 * Manager dashboard component for reviewing and managing storage overstay penalties.
 * Implements enterprise-grade manager-controlled penalty workflow with TanStack Table.
 */

import { useState, useMemo } from "react";
import { mt } from "@/i18n/manager";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ColumnDef, flexRender, getCoreRowModel, getSortedRowModel, getFilteredRowModel, SortingState, useReactTable } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from "@/components/ui/app-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, Clock, DollarSign, CheckCircle, XCircle, CreditCard, User, RefreshCw, MoreHorizontal, ArrowUpDown, ChevronDown, ChevronUp, Shield, Settings } from "@/components/ui/manager-icons";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import { OverstayPenaltySettings } from "./OverstayPenaltySettings";
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";
import { overstayCollectionError } from '@shared/overstay-collection';

// Types
interface OverstayRecord {
  overstayId: number;
  itemsRemovedAt: string | null;
  chefDisputeDeadline: string | null;
  chefDisputedAt: string | null;
  disputeReviewedAt: string | null;
  storageBookingId: number;
  status: string;
  daysOverdue: number;
  gracePeriodEndsAt: string;
  calculatedPenaltyCents: number;
  finalPenaltyCents: number | null;
  detectedAt: string;
  bookingStartDate: string;
  bookingEndDate: string;
  bookingTotalPrice: string;
  storageListingId: number;
  storageName: string;
  storageType: string;
  dailyRateCents: number;
  gracePeriodDays: number;
  penaltyRate: string;
  maxPenaltyDays: number;
  kitchenId: number;
  kitchenName: string;
  kitchenTaxRatePercent: number;
  locationId: number;
  chefId: number | null;
  chefEmail: string | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
}

interface OverstayStats {
  total: number;
  pendingReview: number;
  inGracePeriod: number;
  approved: number;
  waived: number;
  charged: number;
  failed: number;
  resolved: number;
  escalated: number;
  totalPenaltiesCollected: number;
  totalPenaltiesWaived: number;
}

// Status badge colors
const getStatusBadge = (status: string) => {
  switch (status) {
    case 'detected':
    case 'grace_period':
      return <Badge variant="warning"><Clock className="w-3 h-3 mr-1" />{mt("gracePeriod")}</Badge>;
    case 'pending_review':
      return <Badge variant="warning"><AlertTriangle className="w-3 h-3 mr-1" />{mt("pendingReview")}</Badge>;
    case 'penalty_approved':
      return <Badge variant="info"><CheckCircle className="w-3 h-3 mr-1" />{mt("approved")}</Badge>;
    case 'penalty_waived':
      return <Badge variant="success"><XCircle className="w-3 h-3 mr-1" />{mt("waived")}</Badge>;
    case 'charge_pending':
      return <Badge variant="info"><CreditCard className="w-3 h-3 mr-1" />{mt("charging")}</Badge>;
    case 'charge_succeeded':
      return <Badge variant="success"><DollarSign className="w-3 h-3 mr-1" />{mt("charged")}</Badge>;
    case 'charge_failed':
      return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />{mt("chargeFailed")}</Badge>;
    case 'resolved':
      return <Badge variant="outline" className="text-muted-foreground"><CheckCircle className="w-3 h-3 mr-1" />{mt("resolved")}</Badge>;
    case 'escalated':
      return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />{mt("escalated")}</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

// Format currency
const formatCurrency = (cents: number) => {
  return `$${(cents / 100).toFixed(2)} CAD`;
};

// Single overstay card component
function OverstayCard({ 
  overstay, 
  onApprove, 
  onWaive, 
  onCharge, 
  onResolve,
  isProcessing 
}: { 
  overstay: OverstayRecord;
  onApprove: (id: number, amount?: number, notes?: string) => Promise<unknown>;
  onWaive: (id: number, reason: string, notes?: string) => Promise<unknown>;
  onCharge: (id: number) => void;
  onResolve: (id: number, type: string, notes?: string) => Promise<unknown>;
  isProcessing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showWaiveDialog, setShowWaiveDialog] = useState(false);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [pendingActionExit, setPendingActionExit] = useState<"approve" | "waive" | "resolve" | null>(null);
  const [adjustedAmount, setAdjustedAmount] = useState<string>((overstay.calculatedPenaltyCents / 100).toFixed(2));
  const [waiveReason, setWaiveReason] = useState("");
  const [managerNotes, setManagerNotes] = useState("");
  const [resolutionType, setResolutionType] = useState<string>("extended");

  const requestActionClose = (action: "approve" | "waive" | "resolve") => {
    const dirty = action === "approve"
      ? Math.round(parseFloat(adjustedAmount) * 100) !== overstay.calculatedPenaltyCents || !!managerNotes.trim()
      : action === "waive" ? !!waiveReason.trim() || !!managerNotes.trim() : resolutionType !== "extended";
    if (dirty) setPendingActionExit(action);
    else if (action === "approve") setShowApproveDialog(false);
    else if (action === "waive") setShowWaiveDialog(false);
    else setShowResolveDialog(false);
  };
  const discardActionDraft = () => {
    if (pendingActionExit === "approve") setShowApproveDialog(false);
    if (pendingActionExit === "waive") setShowWaiveDialog(false);
    if (pendingActionExit === "resolve") setShowResolveDialog(false);
    setAdjustedAmount((overstay.calculatedPenaltyCents / 100).toFixed(2));
    setWaiveReason("");
    setManagerNotes("");
    setResolutionType("extended");
    setPendingActionExit(null);
  };

  const isInGracePeriod = overstay.status === 'grace_period' || overstay.status === 'detected';
  const canApprove = !!overstay.itemsRemovedAt && (overstay.status === 'pending_review' || overstay.status === 'charge_failed' || (overstay.status === 'penalty_approved' && !overstay.chefDisputeDeadline));
  const canCharge = !overstayCollectionError(overstay) && (overstay.status === 'penalty_approved' || overstay.status === 'charge_failed');
  const canResolve = !overstay.itemsRemovedAt || !['resolved', 'charge_succeeded', 'penalty_waived', 'escalated'].includes(overstay.status);
  const hasPaymentMethod = overstay.stripeCustomerId && overstay.stripePaymentMethodId;

  // Derived calculation values (mirrors server formula for transparent display)
  const penaltyRateDecimal = parseFloat(overstay.penaltyRate);
  const penaltyDays = isInGracePeriod ? 0 : Math.max(0, Math.min(overstay.daysOverdue - overstay.gracePeriodDays, overstay.maxPenaltyDays));
  const dailyPenaltyChargeCents = Math.round(overstay.dailyRateCents * (1 + penaltyRateDecimal));

  // An empty amount field parses to NaN, and every comparison against NaN is
  // false — so `amount > max` alone left the Approve button enabled and sent
  // NaN to the API. Validate the parsed value explicitly instead.
  const adjustedAmountCents = Math.round(parseFloat(adjustedAmount) * 100);
  const canConfirmApprove =
    Number.isFinite(adjustedAmountCents) &&
    adjustedAmountCents > 0 &&
    adjustedAmountCents <= overstay.calculatedPenaltyCents;

  return (
    <>
      <Card className="mb-3 rounded-xl border-border shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-lg">{overstay.storageName}</CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <User className="w-4 h-4" />
                {overstay.chefEmail || mt("unknownChef")}
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-2">
              {getStatusBadge(overstay.status)}
              <span className="text-sm text-muted-foreground">
                {overstay.daysOverdue} day{overstay.daysOverdue !== 1 ? 's' : ''} past end date
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-xs text-muted-foreground">{mt("endDate")}</p>
              <p className="font-medium">{format(new Date(overstay.bookingEndDate), 'MMM d, yyyy')}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{mt("gracePeriod")}</p>
              <p className="font-medium">{overstay.gracePeriodDays} day{overstay.gracePeriodDays !== 1 ? 's' : ''} (ends {format(new Date(overstay.gracePeriodEndsAt), 'MMM d')})</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{mt("billableDays")}</p>
              <p className="font-medium text-orange-600">{penaltyDays} day{penaltyDays !== 1 ? 's' : ''}</p>
              {!isInGracePeriod && penaltyDays > 0 && (
                <p className="text-[10px] text-muted-foreground">{overstay.daysOverdue} overdue − {overstay.gracePeriodDays} grace{penaltyDays === overstay.maxPenaltyDays ? ' (capped)' : ''}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{mt("calculatedPenalty")}</p>
              {!overstay.itemsRemovedAt && <p className="text-xs text-muted-foreground">Accruing estimate. Confirm removal before final review and payment.</p>}
              <p className="font-medium text-orange-600">{formatCurrency(overstay.calculatedPenaltyCents)}</p>
            </div>
          </div>

          {/* Keep the calculation available without making every card a full report. */}
          {expanded && !isInGracePeriod && penaltyDays > 0 && (
            <div className="bg-muted/40 border rounded-md p-3 mb-2 text-sm">
              <p className="text-xs font-medium text-muted-foreground mb-2">{mt("penaltyCalculation")}</p>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
                <span className="font-mono">{formatCurrency(overstay.dailyRateCents)}/day</span>
                <span className="text-muted-foreground">×</span>
                <span className="font-mono">(1 + {(penaltyRateDecimal * 100).toFixed(0)}%)</span>
                <span className="text-muted-foreground">=</span>
                <span className="font-mono font-medium">{formatCurrency(dailyPenaltyChargeCents)}/day</span>
                <span className="text-muted-foreground">×</span>
                <span className="font-mono">{penaltyDays} day{penaltyDays !== 1 ? 's' : ''}</span>
                <span className="text-muted-foreground">=</span>
                <span className="font-mono font-semibold text-orange-600">{formatCurrency(overstay.calculatedPenaltyCents)}</span>
              </div>
            </div>
          )}

          {/* Tax breakdown summary */}
          {expanded && overstay.kitchenTaxRatePercent > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3 mb-2">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{mt("chefTotalChargeWithTax")}</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-lg font-bold text-amber-700 dark:text-amber-300">
                  {formatCurrency(Math.round(overstay.calculatedPenaltyCents * (1 + overstay.kitchenTaxRatePercent / 100)))}
                </span>
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  ({formatCurrency(overstay.calculatedPenaltyCents)} + {overstay.kitchenTaxRatePercent.toFixed(1)}% tax)
                </span>
              </div>
            </div>
          )}

          {/* Expandable details */}
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setExpanded(!expanded)}
            className="w-full justify-center"
          >
            {expanded ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
            {expanded ? mt("lessDetails") : mt("moreDetails")}
          </Button>

          {expanded && (
            <div className="mt-4 pt-4 border-t space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground">{mt("kitchen")}</p>
                  <p>{overstay.kitchenName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{mt("storageType")}</p>
                  <p className="capitalize">{overstay.storageType}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{mt("penaltyRate")}</p>
                  <p>{mt("percentPerDay", { percent: (parseFloat(overstay.penaltyRate) * 100).toFixed(0) })}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{mt("maxPenaltyDays")}</p>
                  <p>{mt("daysCount", { count: overstay.maxPenaltyDays })}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{mt("bookingTotal")}</p>
                  <p>{formatCurrency(parseInt(overstay.bookingTotalPrice))}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{mt("taxRate")}</p>
                  <p>{overstay.kitchenTaxRatePercent > 0 ? mt("hstPercent", { percent: overstay.kitchenTaxRatePercent.toFixed(1) }) : mt("noTax")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{mt("paymentMethod")}</p>
                  <p className={hasPaymentMethod ? 'text-green-600' : 'text-red-600'}>
                    {hasPaymentMethod ? `✓ ${mt("saved")}` : `✗ ${mt("notSaved")}`}
                  </p>
                </div>
              </div>
              <div className="pt-2">
                <p className="text-muted-foreground">{mt("detected")}</p>
                <p>{formatDistanceToNow(new Date(overstay.detectedAt), { addSuffix: true })}</p>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
            {isInGracePeriod && (
              <p className="text-sm text-yellow-600 flex items-center gap-1 w-full mb-2">
                <Shield className="w-4 h-4" />{mt("chefIsInGracePeriodNoActionRequiredYet")}</p>
            )}
            
            {canApprove && (
              <Button 
                size="sm" 
                onClick={() => setShowApproveDialog(true)}
                disabled={isProcessing}
              >
                <CheckCircle className="w-4 h-4 mr-1" />{mt("approvePenalty")}</Button>
            )}
            
            {canCharge && (
              <Button 
                size="sm" 
                variant="default"
                onClick={() => onCharge(overstay.overstayId)}
                disabled={isProcessing || !hasPaymentMethod}
              >
                <CreditCard className="w-4 h-4 mr-1" />{mt("chargeNow")}</Button>
            )}
            
            {canApprove && (
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => setShowWaiveDialog(true)}
                disabled={isProcessing}
              >
                <XCircle className="w-4 h-4 mr-1" />{mt("waivePenalty")}</Button>
            )}
            
            {canResolve && (
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => setShowResolveDialog(true)}
                disabled={isProcessing}
              >{mt("markResolved")}</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Approve Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={(open) => open ? setShowApproveDialog(true) : requestActionClose("approve")}>
        <AppDialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <AppDialogHeader
            icon={<CheckCircle className="w-4 h-4" />}
            title={mt("approvePenalty")}
            description={<>Review and approve the penalty amount for {overstay.storageName}.</>}
          />
          <AppDialogBody className="space-y-4">
            <div>
              <label className="text-sm font-medium">{mt("penaltyAmountCAD")}</label>
              <CurrencyInput
                value={adjustedAmount}
                onValueChange={(val) => {
                  const value = parseFloat(val);
                  const maxAmount = overstay.calculatedPenaltyCents / 100;
                  if (!isNaN(value) && value > maxAmount) {
                    setAdjustedAmount(maxAmount.toFixed(2));
                  } else {
                    setAdjustedAmount(val);
                  }
                }}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Maximum: {formatCurrency(overstay.calculatedPenaltyCents)} — {formatCurrency(dailyPenaltyChargeCents)}/day × {penaltyDays} billable day{penaltyDays !== 1 ? 's' : ''} ({overstay.daysOverdue} overdue − {overstay.gracePeriodDays} grace)
              </p>
            </div>

            {/* Tax Breakdown - Chef Charge Summary */}
            {parseFloat(adjustedAmount) > 0 && (
              <div className="bg-muted/50 border rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />{mt("chefWillBeCharged")}</p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{mt("basePenalty")}</span>
                    <span>${parseFloat(adjustedAmount).toFixed(2)}</span>
                  </div>
                  {overstay.kitchenTaxRatePercent > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Tax ({overstay.kitchenTaxRatePercent.toFixed(1)}% HST):
                      </span>
                      <span>${(parseFloat(adjustedAmount) * overstay.kitchenTaxRatePercent / 100).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold pt-2 border-t">
                    <span>{mt("totalCharge")}</span>
                    <span className="text-primary">
                      ${(parseFloat(adjustedAmount) * (1 + overstay.kitchenTaxRatePercent / 100)).toFixed(2)} CAD
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  The chef receives the final amount and can dispute it during the admin-configured window. Collection is available after that window and any dispute review.
                </p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium">{mt("notesOptional")}</label>
              <Textarea
                value={managerNotes}
                onChange={(e) => setManagerNotes(e.target.value)}
                placeholder={mt("addAnyNotesAboutThisDecision")}
                className="mt-1"
              />
            </div>
          </AppDialogBody>
          <AppDialogFooter>
            <Button variant="ghost" onClick={() => requestActionClose("approve")}>{mt("cancel")}</Button>
            <Button 
              onClick={() => {
                // Enforce maximum penalty cap
                const cappedAmountCents = Math.min(adjustedAmountCents, overstay.calculatedPenaltyCents);
                void onApprove(overstay.overstayId, cappedAmountCents, managerNotes).then(() => {
                  setShowApproveDialog(false);
                  setManagerNotes("");
                  setAdjustedAmount((overstay.calculatedPenaltyCents / 100).toFixed(2));
                }).catch(() => {});
              }}
              disabled={isProcessing || !canConfirmApprove}
            >
              <CheckCircle className="w-4 h-4 mr-1" />Approve final amount</Button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog>

      {/* Waive Dialog */}
      <Dialog open={showWaiveDialog} onOpenChange={(open) => open ? setShowWaiveDialog(true) : requestActionClose("waive")}>
        <AppDialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <AppDialogHeader
            icon={<XCircle className="w-4 h-4" />}
            title={mt("waivePenalty")}
            description={<>Waive the penalty for {overstay.storageName}. A reason is required.</>}
          />
          <AppDialogBody className="space-y-4">
            <div>
              <label className="text-sm font-medium">{mt("reasonForWaivingRequired")}</label>
              <Textarea
                value={waiveReason}
                onChange={(e) => setWaiveReason(e.target.value)}
                placeholder={mt("eGFirstTimeOffenseGoodCustomerRelationshipItemsAlreadyRemove")}
                className="mt-1"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">{mt("additionalNotesOptional")}</label>
              <Textarea
                value={managerNotes}
                onChange={(e) => setManagerNotes(e.target.value)}
                placeholder={mt("anyAdditionalNotes")}
                className="mt-1"
              />
            </div>
          </AppDialogBody>
          <AppDialogFooter>
            <Button variant="ghost" onClick={() => requestActionClose("waive")}>{mt("cancel")}</Button>
            <Button 
              onClick={() => {
                void onWaive(overstay.overstayId, waiveReason, managerNotes).then(() => {
                  setShowWaiveDialog(false);
                  setWaiveReason("");
                  setManagerNotes("");
                }).catch(() => {});
              }}
              disabled={isProcessing || !waiveReason.trim()}
            >{mt("waivePenalty")}</Button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      <AlertDialog open={showResolveDialog} onOpenChange={(open) => open ? setShowResolveDialog(true) : requestActionClose("resolve")}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mt("markAsResolved")}</AlertDialogTitle>
            <AlertDialogDescription>{mt("howWasThisOverstayResolved")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 space-y-4">
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="resolutionType"
                  value="extended"
                  checked={resolutionType === 'extended'}
                  onChange={(e) => setResolutionType(e.target.value)}
                />{mt("chefExtendedTheirBooking")}</label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="resolutionType"
                  value="removed"
                  checked={resolutionType === 'removed'}
                  onChange={(e) => setResolutionType(e.target.value)}
                />{mt("chefRemovedTheirItems")}</label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="resolutionType"
                  value="escalated"
                  checked={resolutionType === 'escalated'}
                  onChange={(e) => setResolutionType(e.target.value)}
                />{mt("escalateToLegalCollections")}</label>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(event) => { if (resolutionType !== "extended") { event.preventDefault(); requestActionClose("resolve"); } }}>{mt("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isProcessing}
              onClick={(event) => {
                event.preventDefault();
                void onResolve(overstay.overstayId, resolutionType).then(() => {
                  setShowResolveDialog(false);
                  setResolutionType("extended");
                }).catch(() => {});
              }}
            >{mt("confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UnsavedChangesDialog open={pendingActionExit !== null} onOpenChange={(open) => { if (!open) setPendingActionExit(null); }} description={mt("overstayActionUnsavedDescription")} onDiscard={discardActionDraft} />
    </>
  );
}

// Main component
export function OverstayPenaltyQueue({ locationId }: { locationId?: number }) {
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showPastPenalties, setShowPastPenalties] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [confirmSettingsExit, setConfirmSettingsExit] = useState(false);

  const closeSettings = () => {
    if (settingsDirty) setConfirmSettingsExit(true);
    else setIsSettingsOpen(false);
  };

  // Fetch overstays (including past if toggled)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['/api/manager/overstays', 'all'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/manager/overstays?includeAll=true');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const overstays: OverstayRecord[] = data?.overstays || [];
  const pastOverstays: OverstayRecord[] = data?.pastOverstays || [];
  const stats: OverstayStats | null = data?.stats || null;

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async ({ id, amount, notes }: { id: number; amount?: number; notes?: string }) => {
      const response = await apiRequest('POST', `/api/manager/overstays/${id}/approve`, {
        finalPenaltyCents: amount,
        managerNotes: notes,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data?.chargeResult?.success) {
        toast({ title: mt("penaltyApprovedCharged"), description: mt("toastPenaltyApprovedChargedDesc") });
      } else {
        toast({ title: mt("penaltyApprovedChargeFailed"), 
          description: data?.chargeResult?.error || "Auto-charge failed. A payment link has been sent to the chef's email.",
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/manager/overstays'] });
    },
    onError: (error: Error) => {
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
    },
  });

  // Waive mutation
  const waiveMutation = useMutation({
    mutationFn: async ({ id, reason, notes }: { id: number; reason: string; notes?: string }) => {
      const response = await apiRequest('POST', `/api/manager/overstays/${id}/waive`, {
        waiveReason: reason,
        managerNotes: notes,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: mt("penaltyWaived"), description: mt("thePenaltyHasBeenWaived") });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/overstays'] });
    },
    onError: (error: Error) => {
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
    },
  });

  // Charge mutation
  const chargeMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('POST', `/api/manager/overstays/${id}/charge`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: mt("chargeSuccessful"), description: mt("toastPenaltyChargedToChefCard") });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/overstays'] });
    },
    onError: (error: Error) => {
      toast({ title: mt("chargeFailed2"), description: error.message, variant: "destructive" });
    },
  });

  // Resolve mutation
  const resolveMutation = useMutation({
    mutationFn: async ({ id, type, notes }: { id: number; type: string; notes?: string }) => {
      const response = await apiRequest('POST', `/api/manager/overstays/${id}/resolve`, {
        resolutionType: type,
        resolutionNotes: notes,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: mt("resolved"), description: mt("theOverstayHasBeenMarkedAsResolved") });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/overstays'] });
    },
    onError: (error: Error) => {
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
    },
  });

  const isProcessing = approveMutation.isPending || waiveMutation.isPending || chargeMutation.isPending || resolveMutation.isPending;

  if (isLoading) {
    return (
      <div className="space-y-4" aria-label={mt("navOverstayPenalties")}>
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-border shadow-sm">
        <CardContent className="py-12 text-center">
          <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <h3 className="font-semibold">{mt("overstaysLoadFailed")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{mt("overstaysLoadFailedHelp")}</p>
          <Button onClick={() => refetch()} className="mt-5" variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />{mt("retry")}</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{mt("navOverstayPenalties")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{mt("overstaysPageDescription")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setIsSettingsOpen(true)} disabled={!locationId} title={!locationId ? mt("selectALocationToManageSettings") : undefined}>
            <Settings className="mr-2 h-4 w-4" />{mt("settings")}
          </Button>
          {pastOverstays.length > 0 && <Button variant={showPastPenalties ? "secondary" : "outline"} onClick={() => setShowPastPenalties(!showPastPenalties)}>
            {showPastPenalties ? mt("hidePastPenalties") : `${mt("showPastPenalties")} (${pastOverstays.length})`}
          </Button>}
        </div>
      </div>

      {/* Stats Summary */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{overstays.filter(o => ['pending_review', 'charge_failed', 'escalated'].includes(o.status)).length}</p>
                  <p className="text-xs text-muted-foreground">{mt("actionRequired")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-500" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{overstays.filter(o => ['detected', 'grace_period'].includes(o.status)).length}</p>
                  <p className="text-xs text-muted-foreground">{mt("inGracePeriod")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{formatCurrency(stats.totalPenaltiesCollected)}</p>
                  <p className="text-xs text-muted-foreground">{mt("collected")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{pastOverstays.length}</p>
                  <p className="text-xs text-muted-foreground">{mt("pastPenalties")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Overstay List */}
      {overstays.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center py-14 text-center">
            <Package className="mb-4 h-9 w-9 text-muted-foreground/60" />
            <h3 className="text-lg font-semibold">{stats?.total ? mt("noActiveOverstaysTitle") : mt("noOverstayHistoryTitle")}</h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">{stats?.total ? mt("noActiveOverstaysHelp") : mt("noOverstayHistoryHelp")}</p>
            {pastOverstays.length > 0 && !showPastPenalties && <Button variant="outline" size="sm" className="mt-5" onClick={() => setShowPastPenalties(true)}>{mt("showPastPenalties")}</Button>}
          </CardContent>
        </Card>
      ) : (
        <div>
          {/* Pending review first */}
          {overstays.filter(o => o.status === 'pending_review' || o.status === 'charge_failed').length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-lg font-semibold">{mt("actionRequired")}</h3>
              {overstays
                .filter(o => o.status === 'pending_review' || o.status === 'charge_failed')
                .map(overstay => (
                  <OverstayCard
                    key={overstay.overstayId}
                    overstay={overstay}
                    onApprove={(id, amount, notes) => approveMutation.mutateAsync({ id, amount, notes })}
                    onWaive={(id, reason, notes) => waiveMutation.mutateAsync({ id, reason, notes })}
                    onCharge={(id) => chargeMutation.mutate(id)}
                    onResolve={(id, type, notes) => resolveMutation.mutateAsync({ id, type, notes })}
                    isProcessing={isProcessing}
                  />
                ))}
            </div>
          )}

          {/* Grace period */}
          {overstays.filter(o => o.status === 'grace_period' || o.status === 'detected').length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-lg font-semibold">{mt("inGracePeriod")}</h3>
              {overstays
                .filter(o => o.status === 'grace_period' || o.status === 'detected')
                .map(overstay => (
                  <OverstayCard
                    key={overstay.overstayId}
                    overstay={overstay}
                    onApprove={(id, amount, notes) => approveMutation.mutateAsync({ id, amount, notes })}
                    onWaive={(id, reason, notes) => waiveMutation.mutateAsync({ id, reason, notes })}
                    onCharge={(id) => chargeMutation.mutate(id)}
                    onResolve={(id, type, notes) => resolveMutation.mutateAsync({ id, type, notes })}
                    isProcessing={isProcessing}
                  />
                ))}
            </div>
          )}

          {/* Approved, awaiting charge */}
          {overstays.filter(o => o.status === 'penalty_approved' || o.status === 'charge_pending').length > 0 && (
            <div className="mb-6">
                <h3 className="mb-3 text-lg font-semibold">{mt("readyToCharge")}</h3>
              {overstays
                .filter(o => o.status === 'penalty_approved' || o.status === 'charge_pending')
                .map(overstay => (
                  <OverstayCard
                    key={overstay.overstayId}
                    overstay={overstay}
                    onApprove={(id, amount, notes) => approveMutation.mutateAsync({ id, amount, notes })}
                    onWaive={(id, reason, notes) => waiveMutation.mutateAsync({ id, reason, notes })}
                    onCharge={(id) => chargeMutation.mutate(id)}
                    onResolve={(id, type, notes) => resolveMutation.mutateAsync({ id, type, notes })}
                    isProcessing={isProcessing}
                  />
                ))}
            </div>
          )}

          {/* Escalated — requires manual collection */}
          {overstays.filter(o => o.status === 'escalated').length > 0 && (
            <div className="mb-6">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                <h3 className="text-lg font-semibold text-red-700">
                  Escalated — Manual Collection Required ({overstays.filter(o => o.status === 'escalated').length})
                </h3>
                <p className="text-sm text-red-600 mt-1">
                  These penalties failed auto-charge after multiple attempts. A payment link has been sent to the chef. Admin has been notified.
                </p>
              </div>
              {overstays
                .filter(o => o.status === 'escalated')
                .map(overstay => (
                  <OverstayCard
                    key={overstay.overstayId}
                    overstay={overstay}
                    onApprove={(id, amount, notes) => approveMutation.mutateAsync({ id, amount, notes })}
                    onWaive={(id, reason, notes) => waiveMutation.mutateAsync({ id, reason, notes })}
                    onCharge={(id) => chargeMutation.mutate(id)}
                    onResolve={(id, type, notes) => resolveMutation.mutateAsync({ id, type, notes })}
                    isProcessing={isProcessing}
                  />
                ))}
            </div>
          )}
        </div>
      )}

      {/* Past Penalties Section */}
      {showPastPenalties && pastOverstays.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-lg font-semibold">
            {mt("pastPenaltiesWithCount", { count: pastOverstays.length })}
          </h3>
          <div className="space-y-3 opacity-75">
            {pastOverstays.map(overstay => (
              <Card key={overstay.overstayId} className="border-gray-200">
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-purple-600" />
                        <span className="font-medium">{overstay.storageName}</span>
                        {getStatusBadge(overstay.status)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {overstay.kitchenName} • {overstay.daysOverdue} days overdue
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Detected: {format(new Date(overstay.detectedAt), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {formatCurrency(overstay.finalPenaltyCents || overstay.calculatedPenaltyCents)}
                      </p>
                      {overstay.chefEmail && (
                        <p className="text-xs text-muted-foreground">{overstay.chefEmail}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={isSettingsOpen} onOpenChange={(open) => open ? setIsSettingsOpen(true) : closeSettings()}>
        <AppDialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <AppDialogHeader
            icon={<Settings className="w-4 h-4" />}
            title={mt("storageOverstayPenaltyDefaults")}
            description={mt("configureDefaultPenaltySettingsForStorageOverstays")}
          />
          <AppDialogBody>
            {locationId ? (
              <OverstayPenaltySettings locationId={locationId} onDirtyChange={setSettingsDirty} />
            ) : (
              <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">{mt("selectALocationToManageSettings")}</div>
            )}
          </AppDialogBody>
        </AppDialogContent>
      </Dialog>
      <UnsavedChangesDialog
        open={confirmSettingsExit}
        onOpenChange={setConfirmSettingsExit}
        description={mt("overstaySettingsUnsavedDescription")}
        onDiscard={() => { setConfirmSettingsExit(false); setSettingsDirty(false); setIsSettingsOpen(false); }}
      />
    </div>
  );
}

export default OverstayPenaltyQueue;
