/**
 * OverstayPenaltyQueue Component
 * 
 * Manager dashboard component for reviewing and managing storage overstay penalties.
 * Implements enterprise-grade manager-controlled penalty workflow with TanStack Table.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  AlertTriangle, 
  Clock, 
  DollarSign, 
  CheckCircle, 
  XCircle, 
  CreditCard,
  Package,
  User,
  RefreshCw,
  MoreHorizontal,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Shield,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";

// Types
interface OverstayRecord {
  overstayId: number;
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
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200"><Clock className="w-3 h-3 mr-1" />Grace Period</Badge>;
    case 'pending_review':
      return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200"><AlertTriangle className="w-3 h-3 mr-1" />Pending Review</Badge>;
    case 'penalty_approved':
      return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
    case 'penalty_waived':
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><XCircle className="w-3 h-3 mr-1" />Waived</Badge>;
    case 'charge_pending':
      return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200"><CreditCard className="w-3 h-3 mr-1" />Charging...</Badge>;
    case 'charge_succeeded':
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><DollarSign className="w-3 h-3 mr-1" />Charged</Badge>;
    case 'charge_failed':
      return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Charge Failed</Badge>;
    case 'resolved':
      return <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200"><CheckCircle className="w-3 h-3 mr-1" />Resolved</Badge>;
    case 'escalated':
      return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Escalated</Badge>;
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
  onApprove: (id: number, amount?: number, notes?: string) => void;
  onWaive: (id: number, reason: string, notes?: string) => void;
  onCharge: (id: number) => void;
  onResolve: (id: number, type: string, notes?: string) => void;
  isProcessing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showWaiveDialog, setShowWaiveDialog] = useState(false);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [adjustedAmount, setAdjustedAmount] = useState<string>((overstay.calculatedPenaltyCents / 100).toFixed(2));
  const [waiveReason, setWaiveReason] = useState("");
  const [managerNotes, setManagerNotes] = useState("");
  const [resolutionType, setResolutionType] = useState<string>("extended");

  const isInGracePeriod = overstay.status === 'grace_period' || overstay.status === 'detected';
  const canApprove = overstay.status === 'pending_review' || overstay.status === 'charge_failed';
  const canCharge = overstay.status === 'penalty_approved';
  const canResolve = !['resolved', 'charge_succeeded', 'escalated'].includes(overstay.status);
  const hasPaymentMethod = overstay.stripeCustomerId && overstay.stripePaymentMethodId;

  // Derived calculation values (mirrors server formula for transparent display)
  const penaltyRateDecimal = parseFloat(overstay.penaltyRate);
  const penaltyDays = isInGracePeriod ? 0 : Math.min(overstay.daysOverdue - overstay.gracePeriodDays, overstay.maxPenaltyDays);
  const dailyPenaltyChargeCents = Math.round(overstay.dailyRateCents * (1 + penaltyRateDecimal));

  return (
    <>
      <Card className={`mb-4 ${isInGracePeriod ? 'border-yellow-200' : overstay.status === 'pending_review' ? 'border-orange-200' : ''}`}>
        <CardHeader className="pb-2">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Package className="w-5 h-5 text-muted-foreground" />
                {overstay.storageName}
              </CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <User className="w-4 h-4" />
                {overstay.chefEmail || 'Unknown Chef'}
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
              <p className="text-xs text-muted-foreground">End Date</p>
              <p className="font-medium">{format(new Date(overstay.bookingEndDate), 'MMM d, yyyy')}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Grace Period</p>
              <p className="font-medium">{overstay.gracePeriodDays} day{overstay.gracePeriodDays !== 1 ? 's' : ''} (ends {format(new Date(overstay.gracePeriodEndsAt), 'MMM d')})</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Billable Days</p>
              <p className="font-medium text-orange-600">{penaltyDays} day{penaltyDays !== 1 ? 's' : ''}</p>
              {!isInGracePeriod && penaltyDays > 0 && (
                <p className="text-[10px] text-muted-foreground">{overstay.daysOverdue} overdue − {overstay.gracePeriodDays} grace{penaltyDays === overstay.maxPenaltyDays ? ' (capped)' : ''}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Calculated Penalty</p>
              <p className="font-medium text-orange-600">{formatCurrency(overstay.calculatedPenaltyCents)}</p>
            </div>
          </div>

          {/* Transparent formula breakdown */}
          {!isInGracePeriod && penaltyDays > 0 && (
            <div className="bg-muted/40 border rounded-md p-3 mb-2 text-sm">
              <p className="text-xs font-medium text-muted-foreground mb-2">Penalty Calculation</p>
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
          {overstay.kitchenTaxRatePercent > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3 mb-2">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200">Chef Total Charge (with tax):</p>
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
            {expanded ? 'Less Details' : 'More Details'}
          </Button>

          {expanded && (
            <div className="mt-4 pt-4 border-t space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground">Kitchen</p>
                  <p>{overstay.kitchenName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Storage Type</p>
                  <p className="capitalize">{overstay.storageType}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Penalty Rate</p>
                  <p>{(parseFloat(overstay.penaltyRate) * 100).toFixed(0)}% per day</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Max Penalty Days</p>
                  <p>{overstay.maxPenaltyDays} days</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Booking Total</p>
                  <p>{formatCurrency(parseInt(overstay.bookingTotalPrice))}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Tax Rate</p>
                  <p>{overstay.kitchenTaxRatePercent > 0 ? `${overstay.kitchenTaxRatePercent.toFixed(1)}% HST` : 'No tax'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Payment Method</p>
                  <p className={hasPaymentMethod ? 'text-green-600' : 'text-red-600'}>
                    {hasPaymentMethod ? '✓ Saved' : '✗ Not saved'}
                  </p>
                </div>
              </div>
              <div className="pt-2">
                <p className="text-muted-foreground">Detected</p>
                <p>{formatDistanceToNow(new Date(overstay.detectedAt), { addSuffix: true })}</p>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
            {isInGracePeriod && (
              <p className="text-sm text-yellow-600 flex items-center gap-1 w-full mb-2">
                <Shield className="w-4 h-4" />
                Chef is in grace period. No action required yet.
              </p>
            )}
            
            {canApprove && (
              <Button 
                size="sm" 
                onClick={() => setShowApproveDialog(true)}
                disabled={isProcessing}
              >
                <CheckCircle className="w-4 h-4 mr-1" />
                Approve Penalty
              </Button>
            )}
            
            {canCharge && (
              <Button 
                size="sm" 
                variant="default"
                onClick={() => onCharge(overstay.overstayId)}
                disabled={isProcessing || !hasPaymentMethod}
              >
                <CreditCard className="w-4 h-4 mr-1" />
                Charge Now
              </Button>
            )}
            
            {canApprove && (
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => setShowWaiveDialog(true)}
                disabled={isProcessing}
              >
                <XCircle className="w-4 h-4 mr-1" />
                Waive Penalty
              </Button>
            )}
            
            {canResolve && (
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => setShowResolveDialog(true)}
                disabled={isProcessing}
              >
                Mark Resolved
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Approve Sheet */}
      <Sheet open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Approve Penalty</SheetTitle>
            <SheetDescription>
              Review and approve the penalty amount for {overstay.storageName}.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Penalty Amount (CAD)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max={(overstay.calculatedPenaltyCents / 100).toFixed(2)}
                value={adjustedAmount}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  const maxAmount = overstay.calculatedPenaltyCents / 100;
                  // Cap at maximum calculated penalty
                  if (value > maxAmount) {
                    setAdjustedAmount(maxAmount.toFixed(2));
                  } else {
                    setAdjustedAmount(e.target.value);
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
                  <DollarSign className="w-4 h-4" />
                  Chef Will Be Charged:
                </p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Base Penalty:</span>
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
                    <span>Total Charge:</span>
                    <span className="text-primary">
                      ${(parseFloat(adjustedAmount) * (1 + overstay.kitchenTaxRatePercent / 100)).toFixed(2)} CAD
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  The chef&apos;s card on file will be automatically charged this amount.
                </p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea
                value={managerNotes}
                onChange={(e) => setManagerNotes(e.target.value)}
                placeholder="Add any notes about this decision..."
                className="mt-1"
              />
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => {
                const amountCents = Math.round(parseFloat(adjustedAmount) * 100);
                // Enforce maximum penalty cap
                const cappedAmountCents = Math.min(amountCents, overstay.calculatedPenaltyCents);
                onApprove(overstay.overstayId, cappedAmountCents, managerNotes);
                setShowApproveDialog(false);
              }}
              disabled={isProcessing || parseFloat(adjustedAmount) * 100 > overstay.calculatedPenaltyCents}
            >
              <CreditCard className="w-4 h-4 mr-1" />
              Approve & Charge
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Waive Sheet */}
      <Sheet open={showWaiveDialog} onOpenChange={setShowWaiveDialog}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Waive Penalty</SheetTitle>
            <SheetDescription>
              Waive the penalty for {overstay.storageName}. A reason is required.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Reason for Waiving *</label>
              <Textarea
                value={waiveReason}
                onChange={(e) => setWaiveReason(e.target.value)}
                placeholder="e.g., First-time offense, good customer relationship, items already removed..."
                className="mt-1"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Additional Notes (optional)</label>
              <Textarea
                value={managerNotes}
                onChange={(e) => setManagerNotes(e.target.value)}
                placeholder="Any additional notes..."
                className="mt-1"
              />
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setShowWaiveDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => {
                onWaive(overstay.overstayId, waiveReason, managerNotes);
                setShowWaiveDialog(false);
              }}
              disabled={isProcessing || !waiveReason.trim()}
            >
              Waive Penalty
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Resolve Dialog */}
      <AlertDialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as Resolved</AlertDialogTitle>
            <AlertDialogDescription>
              How was this overstay resolved?
            </AlertDialogDescription>
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
                />
                Chef extended their booking
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="resolutionType"
                  value="removed"
                  checked={resolutionType === 'removed'}
                  onChange={(e) => setResolutionType(e.target.value)}
                />
                Chef removed their items
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="resolutionType"
                  value="escalated"
                  checked={resolutionType === 'escalated'}
                  onChange={(e) => setResolutionType(e.target.value)}
                />
                Escalate to legal/collections
              </label>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                onResolve(overstay.overstayId, resolutionType);
                setShowResolveDialog(false);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Main component
export function OverstayPenaltyQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showPastPenalties, setShowPastPenalties] = useState(false);

  // Fetch overstays (including past if toggled)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['/api/manager/overstays', showPastPenalties],
    queryFn: async () => {
      const url = showPastPenalties 
        ? '/api/manager/overstays?includeAll=true' 
        : '/api/manager/overstays';
      const response = await apiRequest('GET', url);
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
        toast({ title: "Penalty approved & charged", description: "The penalty has been approved and the chef's card has been charged." });
      } else {
        toast({ 
          title: "Penalty approved — charge failed", 
          description: data?.chargeResult?.error || "Auto-charge failed. A payment link has been sent to the chef's email.",
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/manager/overstays'] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
      toast({ title: "Penalty waived", description: "The penalty has been waived." });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/overstays'] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Charge mutation
  const chargeMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('POST', `/api/manager/overstays/${id}/charge`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Charge successful", description: "The penalty has been charged to the chef's card." });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/overstays'] });
    },
    onError: (error: Error) => {
      toast({ title: "Charge failed", description: error.message, variant: "destructive" });
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
      toast({ title: "Resolved", description: "The overstay has been marked as resolved." });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/overstays'] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isProcessing = approveMutation.isPending || waiveMutation.isPending || chargeMutation.isPending || resolveMutation.isPending;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">Error loading overstays: {(error as Error).message}</p>
          <Button onClick={() => refetch()} className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.pendingReview}</p>
                  <p className="text-xs text-muted-foreground">Pending Review</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.inGracePeriod}</p>
                  <p className="text-xs text-muted-foreground">In Grace Period</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">{formatCurrency(stats.totalPenaltiesCollected)}</p>
                  <p className="text-xs text-muted-foreground">Collected</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-gray-500" />
                <div>
                  <p className="text-2xl font-bold">{formatCurrency(stats.totalPenaltiesWaived)}</p>
                  <p className="text-xs text-muted-foreground">Waived</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Overstay Penalties</h2>
          <p className="text-muted-foreground">Review and manage storage overstay situations</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant={showPastPenalties ? "default" : "outline"} 
            onClick={() => setShowPastPenalties(!showPastPenalties)}
          >
            {showPastPenalties ? "Hide" : "Show"} Past Penalties
          </Button>
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Overstay List */}
      {overstays.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium">No Overstays</h3>
            <p className="text-muted-foreground">All storage bookings are within their rental period.</p>
          </CardContent>
        </Card>
      ) : (
        <div>
          {/* Pending review first */}
          {overstays.filter(o => o.status === 'pending_review' || o.status === 'charge_failed').length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                Action Required
              </h3>
              {overstays
                .filter(o => o.status === 'pending_review' || o.status === 'charge_failed')
                .map(overstay => (
                  <OverstayCard
                    key={overstay.overstayId}
                    overstay={overstay}
                    onApprove={(id, amount, notes) => approveMutation.mutate({ id, amount, notes })}
                    onWaive={(id, reason, notes) => waiveMutation.mutate({ id, reason, notes })}
                    onCharge={(id) => chargeMutation.mutate(id)}
                    onResolve={(id, type, notes) => resolveMutation.mutate({ id, type, notes })}
                    isProcessing={isProcessing}
                  />
                ))}
            </div>
          )}

          {/* Grace period */}
          {overstays.filter(o => o.status === 'grace_period' || o.status === 'detected').length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-500" />
                In Grace Period
              </h3>
              {overstays
                .filter(o => o.status === 'grace_period' || o.status === 'detected')
                .map(overstay => (
                  <OverstayCard
                    key={overstay.overstayId}
                    overstay={overstay}
                    onApprove={(id, amount, notes) => approveMutation.mutate({ id, amount, notes })}
                    onWaive={(id, reason, notes) => waiveMutation.mutate({ id, reason, notes })}
                    onCharge={(id) => chargeMutation.mutate(id)}
                    onResolve={(id, type, notes) => resolveMutation.mutate({ id, type, notes })}
                    isProcessing={isProcessing}
                  />
                ))}
            </div>
          )}

          {/* Approved, awaiting charge */}
          {overstays.filter(o => o.status === 'penalty_approved' || o.status === 'charge_pending').length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-blue-500" />
                Ready to Charge
              </h3>
              {overstays
                .filter(o => o.status === 'penalty_approved' || o.status === 'charge_pending')
                .map(overstay => (
                  <OverstayCard
                    key={overstay.overstayId}
                    overstay={overstay}
                    onApprove={(id, amount, notes) => approveMutation.mutate({ id, amount, notes })}
                    onWaive={(id, reason, notes) => waiveMutation.mutate({ id, reason, notes })}
                    onCharge={(id) => chargeMutation.mutate(id)}
                    onResolve={(id, type, notes) => resolveMutation.mutate({ id, type, notes })}
                    isProcessing={isProcessing}
                  />
                ))}
            </div>
          )}

          {/* Escalated — requires manual collection */}
          {overstays.filter(o => o.status === 'escalated').length > 0 && (
            <div className="mb-6">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-red-700">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
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
                    onApprove={(id, amount, notes) => approveMutation.mutate({ id, amount, notes })}
                    onWaive={(id, reason, notes) => waiveMutation.mutate({ id, reason, notes })}
                    onCharge={(id) => chargeMutation.mutate(id)}
                    onResolve={(id, type, notes) => resolveMutation.mutate({ id, type, notes })}
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
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-gray-500" />
            Past Penalties ({pastOverstays.length})
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

      {showPastPenalties && pastOverstays.length === 0 && (
        <Card className="mt-8 border-gray-200">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">No past penalties found.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default OverstayPenaltyQueue;
