/**
 * Pending Damage Claims Component
 * 
 * Chef interface for viewing and responding to damage claims filed against them.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isResolved ? 'Damage Claim Details' : 'Respond to Damage Claim'}</DialogTitle>
          <DialogDescription>
            {isResolved 
              ? 'View the details of this resolved damage claim.'
              : 'Review the claim details and evidence, then choose to accept or dispute.'}
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Claim Card Component
function ClaimCard({
  claim,
  onRespond,
  onDownloadInvoice,
}: {
  claim: DamageClaim;
  onRespond: (claim: DamageClaim) => void;
  onDownloadInvoice: (claimId: number) => void;
}) {
  const { deadline, isExpired, hoursRemaining } = useMemo(() => {
    const d = new Date(claim.chefResponseDeadline);
    const now = new Date();
    return {
      deadline: d,
      isExpired: d < now,
      hoursRemaining: Math.max(0, Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60))),
    };
  }, [claim.chefResponseDeadline]);
  const canRespond = claim.status === 'submitted' && !isExpired;

  return (
    <Card className={canRespond ? "border-orange-300 bg-orange-50/50" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{claim.claimTitle}</CardTitle>
            <CardDescription>
              Filed by {claim.managerName || 'Manager'} • {claim.locationName || 'Unknown Location'}
            </CardDescription>
          </div>
          {getStatusBadge(claim.status)}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
          {claim.claimDescription}
        </p>

        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-4">
          <span>
            <strong>Amount:</strong> {formatCurrency(claim.claimedAmountCents)}
          </span>
          <span>
            <strong>Type:</strong> {claim.bookingType === 'storage' ? 'Storage' : 'Kitchen'}
          </span>
          <span>
            <strong>Damage Date:</strong> {format(new Date(claim.damageDate), 'MMM d, yyyy')}
          </span>
          <span>
            <strong>Evidence:</strong> {claim.evidence.length} items
          </span>
        </div>

        {/* Response deadline for pending claims */}
        {claim.status === 'submitted' && (
          <div className={`text-sm mb-4 ${hoursRemaining <= 24 ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
            <Clock className="w-4 h-4 inline mr-1" />
            {isExpired
              ? "Response deadline passed"
              : `Respond within ${hoursRemaining} hours (by ${format(deadline, 'MMM d, h:mm a')})`}
          </div>
        )}

        {/* Chef's previous response */}
        {claim.chefResponse && (
          <div className="bg-muted p-3 rounded-lg mb-4">
            <p className="text-sm font-medium mb-1">Your Response:</p>
            <p className="text-sm text-muted-foreground">{claim.chefResponse}</p>
            {claim.chefRespondedAt && (
              <p className="text-xs text-muted-foreground mt-1">
                Responded {format(new Date(claim.chefRespondedAt), 'MMM d, yyyy h:mm a')}
              </p>
            )}
          </div>
        )}

        {/* Admin decision */}
        {claim.adminDecisionReason && (
          <div className="bg-blue-50 p-3 rounded-lg mb-4 border border-blue-200">
            <p className="text-sm font-medium mb-1 text-blue-800">Admin Decision:</p>
            <p className="text-sm text-blue-700">{claim.adminDecisionReason}</p>
          </div>
        )}

        {/* Final amount if different */}
        {claim.finalAmountCents && claim.finalAmountCents !== claim.claimedAmountCents && (
          <div className="text-sm mb-4">
            <strong>Final Amount:</strong>{" "}
            <span className="text-green-600">{formatCurrency(claim.finalAmountCents)}</span>
            <span className="text-muted-foreground ml-2">
              (originally {formatCurrency(claim.claimedAmountCents)})
            </span>
          </div>
        )}

        {/* Charged claim info */}
        {claim.status === 'charge_succeeded' && claim.chargeSucceededAt && (
          <div className="bg-green-50 p-3 rounded-lg mb-4 border border-green-200">
            <p className="text-sm font-medium text-green-800">
              ✓ Payment Completed on {format(new Date(claim.chargeSucceededAt), 'MMM d, yyyy h:mm a')}
            </p>
            <p className="text-xs text-green-700 mt-1">
              Amount charged: {formatCurrency(claim.finalAmountCents || claim.claimedAmountCents)}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {canRespond && (
            <Button onClick={() => onRespond(claim)}>
              <MessageSquare className="w-4 h-4 mr-2" />
              Respond to Claim
            </Button>
          )}
          {!canRespond && (
            <Button variant="outline" onClick={() => onRespond(claim)}>
              <Eye className="w-4 h-4 mr-2" />
              View Details
            </Button>
          )}
          {/* Download Invoice for charged claims */}
          {claim.status === 'charge_succeeded' && (
            <Button 
              variant="outline" 
              onClick={() => onDownloadInvoice(claim.id)}
            >
              <FileText className="w-4 h-4 mr-2" />
              Download Invoice
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Main Component
export function PendingDamageClaims() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedClaim, setSelectedClaim] = useState<DamageClaim | null>(null);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<number | null>(null);

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

  // Separate pending from resolved
  const pendingClaims = claims.filter(c => c.status === 'submitted');
  const inProgressClaims = claims.filter(c => 
    ['chef_accepted', 'chef_disputed', 'under_review', 'approved', 'partially_approved', 'charge_pending'].includes(c.status)
  );
  const resolvedClaims = claims.filter(c => 
    ['charge_succeeded', 'resolved', 'rejected', 'expired', 'charge_failed'].includes(c.status)
  );

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
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Damage Claims</h2>
          <p className="text-muted-foreground">
            Review and respond to damage claims filed against your bookings
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

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

      {/* No Claims */}
      {claims.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium">No Damage Claims</h3>
            <p className="text-muted-foreground">
              You don&apos;t have any damage claims filed against you.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pending Claims */}
      {pendingClaims.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            Awaiting Your Response ({pendingClaims.length})
          </h3>
          <div className="space-y-4">
            {pendingClaims.map(claim => (
              <ClaimCard
                key={claim.id}
                claim={claim}
                onRespond={setSelectedClaim}
                onDownloadInvoice={handleDownloadInvoice}
              />
            ))}
          </div>
        </div>
      )}

      {/* In Progress Claims */}
      {inProgressClaims.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Clock className="w-5 h-5 text-yellow-500" />
            In Progress ({inProgressClaims.length})
          </h3>
          <div className="space-y-4">
            {inProgressClaims.map(claim => (
              <ClaimCard
                onDownloadInvoice={handleDownloadInvoice}
                key={claim.id}
                claim={claim}
                onRespond={setSelectedClaim}
              />
            ))}
          </div>
        </div>
      )}

      {/* Resolved Claims */}
      {resolvedClaims.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-gray-500" />
            Resolved ({resolvedClaims.length})
          </h3>
          <div className="space-y-4">
            {resolvedClaims.map(claim => (
              <ClaimCard
                key={claim.id}
                claim={claim}
                onRespond={setSelectedClaim}
                onDownloadInvoice={handleDownloadInvoice}
              />
            ))}
          </div>
        </div>
      )}

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
