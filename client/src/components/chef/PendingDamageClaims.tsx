/**
 * Pending Damage Claims Component
 * 
 * Chef interface for viewing and responding to damage claims filed against them.
 * Uses TanStack Table for enterprise-grade table display.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  CreditCard,
  FileText,
  Image,
  RefreshCw,
  XCircle,
  Eye,
  MessageSquare,
  ExternalLink,
  MoreHorizontal,
  ArrowUpDown,
  Download,
  MapPin,
  DollarSign,
  Loader2,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { cn } from "@/lib/utils";

// Types
interface DamageEvidence {
  id: number;
  evidenceType: string;
  fileUrl: string;
  fileName: string | null;
  description: string | null;
  uploadedAt: string;
  amountCents: number | null;
  vendorName: string | null;
}

interface DamageClaim {
  id: number;
  bookingType: string;
  kitchenBookingId: number | null;
  storageBookingId: number | null;
  chefId: number;
  managerId: number;
  locationId: number;
  status: string;
  claimTitle: string;
  claimDescription: string;
  damageDate: string;
  claimedAmountCents: number;
  approvedAmountCents: number | null;
  finalAmountCents: number | null;
  chefResponse: string | null;
  chefRespondedAt: string | null;
  chefResponseDeadline: string;
  adminDecisionReason: string | null;
  createdAt: string;
  submittedAt: string | null;
  managerName: string | null;
  locationName: string | null;
  evidence: DamageEvidence[];
  damagedItems?: Array<{
    equipmentBookingId?: number | null;
    equipmentListingId: number;
    equipmentType: string;
    brand?: string | null;
    description?: string | null;
  }>;
  // Payment fields for charged claims
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  chargeSucceededAt: string | null;
}

// Helper functions
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(cents / 100);
}

function getStatusBadge(status: string) {
  const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    submitted: { variant: "default", label: "Awaiting Your Response" },
    chef_accepted: { variant: "secondary", label: "You Accepted" },
    chef_disputed: { variant: "destructive", label: "You Disputed" },
    under_review: { variant: "default", label: "Under Admin Review" },
    approved: { variant: "secondary", label: "Approved" },
    partially_approved: { variant: "secondary", label: "Partially Approved" },
    rejected: { variant: "outline", label: "Rejected" },
    charge_pending: { variant: "default", label: "Payment Processing" },
    charge_succeeded: { variant: "destructive", label: "Charged" },
    charge_failed: { variant: "outline", label: "Charge Failed" },
    resolved: { variant: "outline", label: "Resolved" },
    expired: { variant: "outline", label: "Expired" },
  };

  const config = statusConfig[status] || { variant: "outline" as const, label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function getEvidenceTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    photo_before: "Before Photo",
    photo_after: "After Photo",
    receipt: "Receipt",
    invoice: "Invoice",
    video: "Video",
    document: "Document",
    third_party_report: "Third Party Report",
  };
  return labels[type] || type;
}

// Response Dialog Component
function ResponseDialog({
  claim,
  open,
  onOpenChange,
  onSuccess,
}: {
  claim: DamageClaim;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [action, setAction] = useState<'accept' | 'dispute' | null>(null);
  const [response, setResponse] = useState("");

  const respondMutation = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error("Please select an action");
      const res = await apiRequest('POST', `/api/chef/damage-claims/${claim.id}/respond`, {
        action,
        response,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: action === 'accept' ? "Claim Accepted" : "Claim Disputed",
        description: action === 'accept' 
          ? "You have accepted the damage claim. Your card will be charged."
          : "Your dispute has been submitted for admin review.",
      });
      onOpenChange(false);
      setAction(null);
      setResponse("");
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const { deadline, isExpired, hoursRemaining } = useMemo(() => {
    const d = new Date(claim.chefResponseDeadline);
    const now = new Date();
    return {
      deadline: d,
      isExpired: d < now,
      hoursRemaining: Math.max(0, Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60))),
    };
  }, [claim.chefResponseDeadline]);

  // Check if claim is already resolved (no response allowed)
  const isResolved = ['charge_succeeded', 'resolved', 'rejected', 'expired', 'charge_failed'].includes(claim.status);
  const canRespond = claim.status === 'submitted' && !isExpired && !isResolved;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isResolved ? 'Damage Claim Details' : 'Respond to Damage Claim'}</SheetTitle>
          <SheetDescription>
            {isResolved 
              ? 'View the details of this resolved damage claim.'
              : 'Review the claim details and evidence, then choose to accept or dispute.'}
          </SheetDescription>
        </SheetHeader>

        {/* Resolved Status Banner */}
        {isResolved && (
          <Alert className={claim.status === 'charge_succeeded' ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-gray-50'}>
            <CheckCircle className={`h-4 w-4 ${claim.status === 'charge_succeeded' ? 'text-green-600' : 'text-gray-600'}`} />
            <AlertTitle className={claim.status === 'charge_succeeded' ? 'text-green-800' : 'text-gray-800'}>
              {claim.status === 'charge_succeeded' ? 'Payment Completed' : 
               claim.status === 'rejected' ? 'Claim Rejected' :
               claim.status === 'expired' ? 'Claim Expired' :
               claim.status === 'charge_failed' ? 'Payment Failed' : 'Claim Resolved'}
            </AlertTitle>
            <AlertDescription className={claim.status === 'charge_succeeded' ? 'text-green-700' : 'text-gray-700'}>
              {claim.status === 'charge_succeeded' 
                ? `Your card was charged ${formatCurrency(claim.finalAmountCents || claim.claimedAmountCents)} for this damage claim.`
                : claim.status === 'rejected'
                ? 'This claim was rejected by the admin. No payment was required.'
                : claim.status === 'expired'
                ? 'This claim expired without a response.'
                : claim.status === 'charge_failed'
                ? 'The payment attempt failed. Please contact support.'
                : 'This claim has been resolved.'}
            </AlertDescription>
          </Alert>
        )}

        {/* Deadline Warning - only show if not resolved */}
        {!isResolved && !isExpired && hoursRemaining <= 24 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Response Deadline Approaching</AlertTitle>
            <AlertDescription>
              You have {hoursRemaining} hours to respond. If you don&apos;t respond, the claim may be automatically approved.
            </AlertDescription>
          </Alert>
        )}

        {!isResolved && isExpired && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Response Deadline Passed</AlertTitle>
            <AlertDescription>
              The response deadline has passed. Please contact support if you believe this is an error.
            </AlertDescription>
          </Alert>
        )}

        {/* Claim Details */}
        <div className="space-y-4">
          <div className="bg-muted p-4 rounded-lg space-y-2">
            <h4 className="font-semibold">{claim.claimTitle}</h4>
            <p className="text-sm text-muted-foreground">{claim.claimDescription}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <span><strong>Amount:</strong> {formatCurrency(claim.claimedAmountCents)}</span>
              <span><strong>Damage Date:</strong> {format(new Date(claim.damageDate), 'MMM d, yyyy')}</span>
              <span><strong>Location:</strong> {claim.locationName || 'Unknown'}</span>
            </div>
          </div>

          {/* Damaged Equipment */}
          {claim.damagedItems && claim.damagedItems.length > 0 && (
            <div className="border rounded-md p-3 space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground">Damaged Equipment ({claim.damagedItems.length})</h4>
              <div className="space-y-1">
                {claim.damagedItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm p-2 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                      <span className="font-medium capitalize">{item.equipmentType}</span>
                      {item.brand && <span className="text-muted-foreground">({item.brand})</span>}
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      {item.equipmentBookingId ? 'Rented' : 'Included'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Evidence */}
          {claim.evidence.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2">Evidence ({claim.evidence.length} items)</h4>
              <div className="grid grid-cols-2 gap-2">
                {claim.evidence.map((ev) => (
                  <a
                    key={ev.id}
                    href={getR2ProxyUrl(ev.fileUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2 border rounded-lg hover:bg-muted transition-colors"
                  >
                    {ev.evidenceType.includes('photo') || ev.evidenceType === 'video' ? (
                      <Image className="w-4 h-4 text-blue-500" />
                    ) : (
                      <FileText className="w-4 h-4 text-gray-500" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {getEvidenceTypeLabel(ev.evidenceType)}
                      </p>
                      {ev.description && (
                        <p className="text-xs text-muted-foreground truncate">{ev.description}</p>
                      )}
                    </div>
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Auto-Charge Warning - only show if can respond */}
          {canRespond && (
            <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950">
              <CreditCard className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800 dark:text-amber-200">Payment Method on File</AlertTitle>
              <AlertDescription className="text-amber-700 dark:text-amber-300">
                If you accept this claim, your card from the original booking will be <strong>automatically charged</strong> for {formatCurrency(claim.claimedAmountCents)}.
                If you dispute and an admin approves the claim, your card will also be charged automatically.
              </AlertDescription>
            </Alert>
          )}

          {/* Response Options - only show if can respond */}
          {canRespond && (
            <div className="space-y-4">
              <Label>Your Response</Label>
              <div className="grid grid-cols-2 gap-4">
                <Button
                  type="button"
                  variant={action === 'accept' ? 'default' : 'outline'}
                  className="h-auto py-4 flex flex-col items-center gap-2"
                  onClick={() => setAction('accept')}
                >
                  <CheckCircle className="w-6 h-6" />
                  <span className="font-semibold">Accept Claim</span>
                  <span className="text-xs text-muted-foreground">
                    Agree to pay {formatCurrency(claim.claimedAmountCents)}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant={action === 'dispute' ? 'destructive' : 'outline'}
                  className="h-auto py-4 flex flex-col items-center gap-2"
                  onClick={() => setAction('dispute')}
                >
                  <XCircle className="w-6 h-6" />
                  <span className="font-semibold">Dispute Claim</span>
                  <span className="text-xs text-muted-foreground">
                    Request admin review
                  </span>
                </Button>
              </div>

              {action && (
                <div className="space-y-2">
                  <Label htmlFor="response">
                    {action === 'accept' ? 'Optional Comments' : 'Reason for Dispute (Required)'}
                  </Label>
                  <Textarea
                    id="response"
                    placeholder={
                      action === 'accept'
                        ? "Any comments about the claim..."
                        : "Explain why you are disputing this claim (minimum 50 characters)..."
                    }
                    value={response}
                    onChange={(e) => setResponse(e.target.value)}
                    rows={4}
                    required={action === 'dispute'}
                  />
                  {action === 'dispute' && response.length < 50 && (
                    <p className="text-xs text-muted-foreground">
                      {50 - response.length} more characters required
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isResolved ? 'Close' : 'Cancel'}
          </Button>
          {canRespond && action && (
            <Button
              onClick={() => respondMutation.mutate()}
              disabled={
                respondMutation.isPending ||
                (action === 'dispute' && response.length < 50)
              }
              variant={action === 'accept' ? 'default' : 'destructive'}
            >
              {respondMutation.isPending
                ? "Submitting..."
                : action === 'accept'
                ? "Accept & Pay"
                : "Submit Dispute"}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// Column definitions for damage claims table
type ClaimViewType = "pending" | "in_progress" | "resolved" | "all";

interface DamageClaimColumnsProps {
  onRespond: (claim: DamageClaim) => void;
  onDownloadInvoice: (claimId: number) => void;
  downloadingInvoiceId: number | null;
}

const getDamageClaimColumns = ({
  onRespond,
  onDownloadInvoice,
  downloadingInvoiceId,
}: DamageClaimColumnsProps): ColumnDef<DamageClaim>[] => [
  {
    accessorKey: "createdAt",
    header: () => null,
    cell: () => null,
    enableHiding: true,
  },
  {
    accessorKey: "claimTitle",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 -ml-3"
      >
        Claim
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const claim = row.original;
      return (
        <div className="flex flex-col max-w-[250px]">
          <span className="font-medium text-sm truncate">{claim.claimTitle}</span>
          <div className="flex items-center text-xs text-muted-foreground mt-0.5">
            <MapPin className="h-3 w-3 mr-1 flex-shrink-0" />
            <span className="truncate">{claim.locationName || 'Unknown Location'}</span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      const claim = row.original;
      
      // Calculate deadline info for pending claims
      const deadline = new Date(claim.chefResponseDeadline);
      const now = new Date();
      const isExpired = deadline < now;
      const hoursRemaining = Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60)));
      
      return (
        <div className="flex flex-col gap-1">
          {getStatusBadge(status)}
          {status === 'submitted' && !isExpired && hoursRemaining <= 24 && (
            <span className="text-xs text-red-600 font-medium">
              {hoursRemaining}h left
            </span>
          )}
          {status === 'submitted' && isExpired && (
            <span className="text-xs text-red-600">Expired</span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "claimedAmountCents",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 justify-end w-full"
      >
        Amount
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const claim = row.original;
      const finalAmount = claim.finalAmountCents || claim.claimedAmountCents;
      const isDifferent = claim.finalAmountCents && claim.finalAmountCents !== claim.claimedAmountCents;
      
      return (
        <div className="text-right">
          <div className="font-medium text-sm flex items-center justify-end gap-1">
            <DollarSign className="h-3 w-3 text-muted-foreground" />
            {formatCurrency(finalAmount)}
          </div>
          {isDifferent && (
            <div className="text-xs text-muted-foreground line-through">
              {formatCurrency(claim.claimedAmountCents)}
            </div>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "bookingType",
    header: "Type",
    cell: ({ row }) => {
      const type = row.getValue("bookingType") as string;
      return (
        <Badge variant="outline" className="capitalize">
          {type === 'storage' ? 'Storage' : 'Kitchen'}
        </Badge>
      );
    },
  },
  {
    accessorKey: "damageDate",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 -ml-3"
      >
        Damage Date
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      return (
        <div className="text-sm text-muted-foreground">
          {format(new Date(row.getValue("damageDate")), 'MMM d, yyyy')}
        </div>
      );
    },
  },
  {
    accessorKey: "evidence",
    header: "Evidence",
    cell: ({ row }) => {
      const evidence = row.original.evidence;
      if (!evidence || evidence.length === 0) {
        return <span className="text-muted-foreground text-xs">—</span>;
      }
      
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 cursor-help">
                <Image className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{evidence.length}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-sm">{evidence.length} evidence item{evidence.length !== 1 ? 's' : ''}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      const claim = row.original;
      const deadline = new Date(claim.chefResponseDeadline);
      const isExpired = deadline < new Date();
      const canRespond = claim.status === 'submitted' && !isExpired;
      const isDownloading = downloadingInvoiceId === claim.id;
      const canDownloadInvoice = claim.status === 'charge_succeeded';

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canRespond ? (
              <DropdownMenuItem onClick={() => onRespond(claim)}>
                <MessageSquare className="h-4 w-4 mr-2" />
                Respond to Claim
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onRespond(claim)}>
                <Eye className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>
            )}

            {canDownloadInvoice && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDownloadInvoice(claim.id)}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Download Invoice
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

// Main Component
export function PendingDamageClaims() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedClaim, setSelectedClaim] = useState<DamageClaim | null>(null);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<number | null>(null);
  const [viewType, setViewType] = useState<ClaimViewType>("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  // Fetch claims
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['/api/chef/damage-claims'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/chef/damage-claims');
      return response.json();
    },
    refetchInterval: 30000,
  });

  const claims: DamageClaim[] = data?.claims || [];

  // Download invoice handler
  const handleDownloadInvoice = async (claimId: number) => {
    try {
      setDownloadingInvoiceId(claimId);
      const response = await apiRequest('GET', `/api/chef/damage-claims/${claimId}/invoice`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to download invoice');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `damage-claim-invoice-${claimId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({ title: "Invoice Downloaded", description: "Your damage claim invoice has been downloaded." });
    } catch (err) {
      toast({ 
        title: "Download Failed", 
        description: err instanceof Error ? err.message : 'Failed to download invoice',
        variant: "destructive" 
      });
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  // Categorize claims
  const { pendingClaims, inProgressClaims, resolvedClaims } = useMemo(() => {
    const pending = claims.filter(c => c.status === 'submitted');
    const inProgress = claims.filter(c => 
      ['chef_accepted', 'chef_disputed', 'under_review', 'approved', 'partially_approved', 'charge_pending'].includes(c.status)
    );
    const resolved = claims.filter(c => 
      ['charge_succeeded', 'resolved', 'rejected', 'expired', 'charge_failed'].includes(c.status)
    );
    return { pendingClaims: pending, inProgressClaims: inProgress, resolvedClaims: resolved };
  }, [claims]);

  // Get current view data
  const currentViewData = useMemo(() => {
    if (viewType === "pending") return pendingClaims;
    if (viewType === "in_progress") return inProgressClaims;
    if (viewType === "resolved") return resolvedClaims;
    return claims;
  }, [viewType, pendingClaims, inProgressClaims, resolvedClaims, claims]);

  // Column definitions
  const columns = useMemo(
    () => getDamageClaimColumns({
      onRespond: setSelectedClaim,
      onDownloadInvoice: handleDownloadInvoice,
      downloadingInvoiceId,
    }),
    [downloadingInvoiceId]
  );

  // TanStack Table instance
  const table = useReactTable({
    data: currentViewData,
    columns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnVisibility: { createdAt: false },
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">Error loading damage claims: {(error as Error).message}</p>
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
      {/* Urgent Claims Alert */}
      {pendingClaims.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Action Required</AlertTitle>
          <AlertDescription>
            You have {pendingClaims.length} damage claim{pendingClaims.length > 1 ? 's' : ''} awaiting your response.
            Please review and respond before the deadline.
          </AlertDescription>
        </Alert>
      )}

      {/* Main Card with Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Damage Claims
              </CardTitle>
              <CardDescription>
                {table.getFilteredRowModel().rows.length} of {claims.length} claim{claims.length !== 1 ? 's' : ''}
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* View Type Tabs */}
          <Tabs value={viewType} onValueChange={(v) => setViewType(v as ClaimViewType)} className="w-full">
            <TabsList className="w-full flex flex-wrap gap-1 h-auto p-1">
              <TabsTrigger value="all" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                All
                <Badge variant="secondary" className="ml-1">{claims.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="pending" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                <span className="hidden sm:inline">Pending</span>
                <span className="sm:hidden">Pend</span>
                <Badge variant="secondary" className="ml-1">{pendingClaims.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="in_progress" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                <span className="hidden sm:inline">In Progress</span>
                <span className="sm:hidden">Active</span>
                <Badge variant="secondary" className="ml-1">{inProgressClaims.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="resolved" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                <span className="hidden sm:inline">Resolved</span>
                <span className="sm:hidden">Done</span>
                <Badge variant="secondary" className="ml-1">{resolvedClaims.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="whitespace-nowrap">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      className={cn(
                        "hover:bg-muted/50",
                        row.original.status === "submitted" && "bg-orange-50/50",
                        row.original.status === "charge_succeeded" && "bg-green-50/30"
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="py-3">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CheckCircle className="h-8 w-8 text-green-500" />
                        <p className="text-sm font-medium">No Damage Claims</p>
                        <p className="text-sm text-muted-foreground">
                          {viewType === "all" 
                            ? "You don't have any damage claims filed against you."
                            : `No ${viewType.replace('_', ' ')} claims to display.`}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Response Dialog */}
      {selectedClaim && (
        <ResponseDialog
          claim={selectedClaim}
          open={!!selectedClaim}
          onOpenChange={(open) => !open && setSelectedClaim(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['/api/chef/damage-claims'] });
          }}
        />
      )}
    </div>
  );
}

export default PendingDamageClaims;
