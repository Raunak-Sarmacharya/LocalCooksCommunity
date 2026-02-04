/**
 * Admin Damage Claim Review Component
 * 
 * Admin interface for reviewing disputed damage claims and making decisions.
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
  FileText,
  Image,
  RefreshCw,
  XCircle,
  Gavel,
  ExternalLink,
  DollarSign,
  User,
  Building,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

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
  adminNotes: string | null;
  createdAt: string;
  submittedAt: string | null;
  chefName: string | null;
  chefEmail: string | null;
  managerName: string | null;
  locationName: string | null;
  evidence: DamageEvidence[];
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
    under_review: { variant: "default", label: "Under Review" },
    approved: { variant: "secondary", label: "Approved" },
    partially_approved: { variant: "secondary", label: "Partially Approved" },
    rejected: { variant: "outline", label: "Rejected" },
    charge_pending: { variant: "default", label: "Charge Pending" },
    charge_succeeded: { variant: "secondary", label: "Charged" },
    charge_failed: { variant: "destructive", label: "Charge Failed" },
    resolved: { variant: "outline", label: "Resolved" },
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

// Decision Dialog Component
function DecisionDialog({
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
  const [decision, setDecision] = useState<'approve' | 'partially_approve' | 'reject' | null>(null);
  const [approvedAmount, setApprovedAmount] = useState<string>((claim.claimedAmountCents / 100).toFixed(2));
  const [decisionReason, setDecisionReason] = useState("");
  const [notes, setNotes] = useState("");

  const decideMutation = useMutation({
    mutationFn: async () => {
      if (!decision) throw new Error("Please select a decision");
      if (!decisionReason || decisionReason.length < 20) {
        throw new Error("Please provide a decision reason (minimum 20 characters)");
      }
      
      const payload: {
        decision: string;
        decisionReason: string;
        notes?: string;
        approvedAmountCents?: number;
      } = {
        decision,
        decisionReason,
        notes: notes || undefined,
      };

      if (decision === 'partially_approve') {
        const amountCents = Math.round(parseFloat(approvedAmount) * 100);
        if (isNaN(amountCents) || amountCents <= 0 || amountCents >= claim.claimedAmountCents) {
          throw new Error("Partial approval amount must be between $0 and the claimed amount");
        }
        payload.approvedAmountCents = amountCents;
      }

      const res = await apiRequest('POST', `/api/admin/damage-claims/${claim.id}/decision`, payload);
      return res.json();
    },
    onSuccess: () => {
      const decisionLabels = {
        approve: 'approved',
        partially_approve: 'partially approved',
        reject: 'rejected',
      };
      toast({
        title: "Decision Submitted",
        description: `The claim has been ${decisionLabels[decision!]}.`,
      });
      onOpenChange(false);
      setDecision(null);
      setDecisionReason("");
      setNotes("");
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review Disputed Claim</DialogTitle>
          <DialogDescription>
            Review the evidence and make a decision on this disputed damage claim.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">Claim Details</TabsTrigger>
            <TabsTrigger value="evidence">Evidence ({claim.evidence.length})</TabsTrigger>
            <TabsTrigger value="decision">Make Decision</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 mt-4">
            {/* Claim Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Claim Title</Label>
                <p className="font-medium">{claim.claimTitle}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Claimed Amount</Label>
                <p className="font-medium text-lg">{formatCurrency(claim.claimedAmountCents)}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Description</Label>
              <p className="text-sm">{claim.claimDescription}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Damage Date</Label>
                <p>{format(new Date(claim.damageDate), 'MMM d, yyyy')}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Booking Type</Label>
                <p className="capitalize">{claim.bookingType}</p>
              </div>
            </div>

            {/* Parties */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t">
              <div className="space-y-2">
                <Label className="text-muted-foreground flex items-center gap-1">
                  <User className="w-4 h-4" /> Chef
                </Label>
                <p className="font-medium">{claim.chefName || 'Unknown'}</p>
                <p className="text-sm text-muted-foreground">{claim.chefEmail}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground flex items-center gap-1">
                  <Building className="w-4 h-4" /> Location
                </Label>
                <p className="font-medium">{claim.locationName || 'Unknown'}</p>
                <p className="text-sm text-muted-foreground">Manager: {claim.managerName || 'Unknown'}</p>
              </div>
            </div>

            {/* Chef's Dispute */}
            {claim.chefResponse && (
              <div className="pt-4 border-t">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Chef&apos;s Dispute Reason</AlertTitle>
                  <AlertDescription className="mt-2">
                    {claim.chefResponse}
                  </AlertDescription>
                </Alert>
                {claim.chefRespondedAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Disputed on {format(new Date(claim.chefRespondedAt), 'MMM d, yyyy h:mm a')}
                  </p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="evidence" className="space-y-4 mt-4">
            {claim.evidence.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No evidence submitted</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {claim.evidence.map((ev) => (
                  <Card key={ev.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0">
                          {ev.evidenceType.includes('photo') || ev.evidenceType === 'video' ? (
                            <Image className="w-8 h-8 text-blue-500" />
                          ) : (
                            <FileText className="w-8 h-8 text-gray-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="font-medium">{getEvidenceTypeLabel(ev.evidenceType)}</p>
                            <a
                              href={ev.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline flex items-center gap-1 text-sm"
                            >
                              View <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          {ev.description && (
                            <p className="text-sm text-muted-foreground mt-1">{ev.description}</p>
                          )}
                          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                            {ev.amountCents && (
                              <span>Amount: {formatCurrency(ev.amountCents)}</span>
                            )}
                            {ev.vendorName && (
                              <span>Vendor: {ev.vendorName}</span>
                            )}
                            <span>Uploaded: {format(new Date(ev.uploadedAt), 'MMM d, yyyy')}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="decision" className="space-y-4 mt-4">
            {/* Decision Options */}
            <div className="space-y-4">
              <Label>Your Decision</Label>
              <div className="grid grid-cols-3 gap-4">
                <Button
                  type="button"
                  variant={decision === 'approve' ? 'default' : 'outline'}
                  className="h-auto py-4 flex flex-col items-center gap-2"
                  onClick={() => setDecision('approve')}
                >
                  <CheckCircle className="w-6 h-6 text-green-600" />
                  <span className="font-semibold">Approve</span>
                  <span className="text-xs text-muted-foreground">
                    Full amount
                  </span>
                </Button>
                <Button
                  type="button"
                  variant={decision === 'partially_approve' ? 'default' : 'outline'}
                  className="h-auto py-4 flex flex-col items-center gap-2"
                  onClick={() => setDecision('partially_approve')}
                >
                  <DollarSign className="w-6 h-6 text-yellow-600" />
                  <span className="font-semibold">Partial</span>
                  <span className="text-xs text-muted-foreground">
                    Reduced amount
                  </span>
                </Button>
                <Button
                  type="button"
                  variant={decision === 'reject' ? 'destructive' : 'outline'}
                  className="h-auto py-4 flex flex-col items-center gap-2"
                  onClick={() => setDecision('reject')}
                >
                  <XCircle className="w-6 h-6" />
                  <span className="font-semibold">Reject</span>
                  <span className="text-xs text-muted-foreground">
                    No payment
                  </span>
                </Button>
              </div>

              {/* Partial Amount Input */}
              {decision === 'partially_approve' && (
                <div className="space-y-2">
                  <Label htmlFor="approvedAmount">Approved Amount (CAD)</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">$</span>
                    <Input
                      id="approvedAmount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={(claim.claimedAmountCents / 100 - 0.01).toFixed(2)}
                      value={approvedAmount}
                      onChange={(e) => setApprovedAmount(e.target.value)}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">
                      of {formatCurrency(claim.claimedAmountCents)} claimed
                    </span>
                  </div>
                </div>
              )}

              {/* Decision Reason */}
              {decision && (
                <div className="space-y-2">
                  <Label htmlFor="decisionReason">
                    Decision Reason <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="decisionReason"
                    placeholder="Explain your decision (minimum 20 characters)..."
                    value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)}
                    rows={3}
                  />
                  {decisionReason.length < 20 && (
                    <p className="text-xs text-muted-foreground">
                      {20 - decisionReason.length} more characters required
                    </p>
                  )}
                </div>
              )}

              {/* Internal Notes */}
              {decision && (
                <div className="space-y-2">
                  <Label htmlFor="notes">Internal Notes (Optional)</Label>
                  <Textarea
                    id="notes"
                    placeholder="Any internal notes for record-keeping..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {decision && (
            <Button
              onClick={() => decideMutation.mutate()}
              disabled={decideMutation.isPending || decisionReason.length < 20}
              variant={decision === 'reject' ? 'destructive' : 'default'}
            >
              {decideMutation.isPending ? "Submitting..." : "Submit Decision"}
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
  onReview,
}: {
  claim: DamageClaim;
  onReview: (claim: DamageClaim) => void;
}) {
  const { submittedAt } = useMemo(() => {
    return {
      submittedAt: claim.submittedAt ? new Date(claim.submittedAt) : null,
    };
  }, [claim.submittedAt]);

  return (
    <Card className="border-orange-300 bg-orange-50/30">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{claim.claimTitle}</CardTitle>
            <CardDescription>
              {claim.locationName || 'Unknown Location'} • {claim.bookingType === 'storage' ? 'Storage' : 'Kitchen'} Booking
            </CardDescription>
          </div>
          {getStatusBadge(claim.status)}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
          {claim.claimDescription}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
          <div>
            <p className="text-muted-foreground">Claimed Amount</p>
            <p className="font-semibold text-lg">{formatCurrency(claim.claimedAmountCents)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Chef</p>
            <p className="font-medium">{claim.chefName || 'Unknown'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Manager</p>
            <p className="font-medium">{claim.managerName || 'Unknown'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Evidence</p>
            <p className="font-medium">{claim.evidence.length} items</p>
          </div>
        </div>

        {/* Chef's dispute reason preview */}
        {claim.chefResponse && (
          <div className="bg-red-50 border border-red-200 p-3 rounded-lg mb-4">
            <p className="text-sm font-medium text-red-800 mb-1">Chef&apos;s Dispute:</p>
            <p className="text-sm text-red-700 line-clamp-2">{claim.chefResponse}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            <Clock className="w-4 h-4 inline mr-1" />
            {submittedAt ? `Submitted ${format(submittedAt, 'MMM d, yyyy')}` : 'Not submitted'}
          </div>
          <Button onClick={() => onReview(claim)}>
            <Gavel className="w-4 h-4 mr-2" />
            Review & Decide
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Main Component
export function DamageClaimReview() {
  const queryClient = useQueryClient();
  const [selectedClaim, setSelectedClaim] = useState<DamageClaim | null>(null);

  // Fetch disputed claims
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['/api/admin/damage-claims'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/admin/damage-claims');
      return response.json();
    },
    refetchInterval: 30000,
  });

  const claims: DamageClaim[] = data?.claims || [];

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
          <h2 className="text-2xl font-bold">Damage Claim Review</h2>
          <p className="text-muted-foreground">
            Review and make decisions on disputed damage claims
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Pending Claims Alert */}
      {claims.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Claims Pending Review</AlertTitle>
          <AlertDescription>
            You have {claims.length} disputed damage claim{claims.length > 1 ? 's' : ''} awaiting your decision.
          </AlertDescription>
        </Alert>
      )}

      {/* No Claims */}
      {claims.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium">No Pending Reviews</h3>
            <p className="text-muted-foreground">
              All disputed damage claims have been reviewed.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Claims List */}
      {claims.length > 0 && (
        <div className="space-y-4">
          {claims.map(claim => (
            <ClaimCard
              key={claim.id}
              claim={claim}
              onReview={setSelectedClaim}
            />
          ))}
        </div>
      )}

      {/* Decision Dialog */}
      {selectedClaim && (
        <DecisionDialog
          claim={selectedClaim}
          open={!!selectedClaim}
          onOpenChange={(open) => !open && setSelectedClaim(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['/api/admin/damage-claims'] });
          }}
        />
      )}
    </div>
  );
}

export default DamageClaimReview;
