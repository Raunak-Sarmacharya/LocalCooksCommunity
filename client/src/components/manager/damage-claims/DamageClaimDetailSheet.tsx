/**
 * Damage Claim Detail Sheet
 * 
 * Manager interface for viewing claim details and uploading evidence photos.
 * Evidence types: photo, receipt, quote, report
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle,
  Camera,
  FileText,
  Receipt,
  Upload,
  Loader2,
  X,
  Trash2,
  ExternalLink,
  Image,
  File,
  History,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";

interface ClaimHistoryEntry {
  id: number;
  previousStatus: string | null;
  newStatus: string;
  action: string;
  actionBy: string;
  actionByUserId: number | null;
  notes: string | null;
  createdAt: string;
}

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

interface DamagedItem {
  equipmentBookingId?: number | null;
  equipmentListingId: number;
  equipmentType: string;
  brand?: string | null;
  description?: string | null;
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
  chefEmail: string | null;
  chefName: string | null;
  locationName: string | null;
  evidence: DamageEvidence[];
  damagedItems?: DamagedItem[];
}

interface DamageClaimDetailSheetProps {
  claimId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClaimUpdated?: () => void;
}

const EVIDENCE_TYPES = [
  { value: 'photo_before', label: 'Photo (Before)', icon: Camera },
  { value: 'photo_after', label: 'Photo (After/Damage)', icon: Camera },
  { value: 'receipt', label: 'Receipt', icon: Receipt },
  { value: 'invoice', label: 'Invoice/Quote', icon: FileText },
  { value: 'video', label: 'Video', icon: File },
  { value: 'document', label: 'Document', icon: File },
  { value: 'third_party_report', label: 'Third Party Report', icon: FileText },
];

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(cents / 100);
}

function getStatusBadge(status: string) {
  const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    draft: { variant: "outline", label: "Draft" },
    submitted: { variant: "default", label: "Awaiting Chef Response" },
    chef_accepted: { variant: "secondary", label: "Chef Accepted" },
    chef_disputed: { variant: "destructive", label: "Disputed" },
    under_review: { variant: "default", label: "Under Admin Review" },
    approved: { variant: "secondary", label: "Approved" },
    partially_approved: { variant: "secondary", label: "Partially Approved" },
    rejected: { variant: "destructive", label: "Rejected" },
    charge_pending: { variant: "default", label: "Charging..." },
    charge_succeeded: { variant: "secondary", label: "Paid" },
    charge_failed: { variant: "destructive", label: "Charge Failed" },
    escalated: { variant: "destructive", label: "Escalated — Awaiting Chef Payment" },
    resolved: { variant: "outline", label: "Resolved" },
    expired: { variant: "outline", label: "Expired" },
  };

  const config = statusConfig[status] || { variant: "outline" as const, label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function getEvidenceIcon(type: string) {
  const typeConfig = EVIDENCE_TYPES.find(t => t.value === type);
  const Icon = typeConfig?.icon || File;
  return <Icon className="h-4 w-4" />;
}

export function DamageClaimDetailSheet({
  claimId,
  open,
  onOpenChange,
  onClaimUpdated,
}: DamageClaimDetailSheetProps) {
  const { toast } = useToast();
  
  // Evidence upload form state
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [evidenceForm, setEvidenceForm] = useState({
    evidenceType: 'photo_after',
    description: '',
    amountCents: '',
    vendorName: '',
  });

  // Fetch claim details
  const { data: claimData, isLoading, refetch } = useQuery({
    queryKey: ['/api/manager/damage-claims', claimId],
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/manager/damage-claims/${claimId}`);
      return response.json();
    },
    enabled: open && claimId !== null,
  });

  const claim: DamageClaim | null = claimData?.claim || null;

  // Fetch claim history
  const { data: historyData } = useQuery({
    queryKey: ['/api/manager/damage-claims', claimId, 'history'],
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/manager/damage-claims/${claimId}/history`);
      return response.json();
    },
    enabled: open && claimId !== null,
  });

  const history: ClaimHistoryEntry[] = historyData?.history || [];

  // File upload hook
  const { uploadFile, isUploading, uploadProgress } = useSessionFileUpload({
    maxSize: 4.5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'],
    onSuccess: (response) => {
      setUploadedFileUrl(response.url);
      setUploadedFileName(response.fileName);
      toast({
        title: "File uploaded",
        description: "Now add details and save the evidence.",
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error,
        variant: "destructive",
      });
    },
  });

  // Add evidence mutation
  const addEvidenceMutation = useMutation({
    mutationFn: async () => {
      if (!uploadedFileUrl || !claimId) {
        throw new Error("Please upload a file first");
      }

      const response = await apiRequest('POST', `/api/manager/damage-claims/${claimId}/evidence`, {
        evidenceType: evidenceForm.evidenceType,
        fileUrl: uploadedFileUrl,
        fileName: uploadedFileName,
        description: evidenceForm.description || null,
        amountCents: evidenceForm.amountCents ? Math.round(parseFloat(evidenceForm.amountCents) * 100) : null,
        vendorName: evidenceForm.vendorName || null,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Evidence added", description: "Evidence has been added to the claim." });
      resetUploadForm();
      refetch();
      onClaimUpdated?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Delete evidence mutation
  const deleteEvidenceMutation = useMutation({
    mutationFn: async (evidenceId: number) => {
      const response = await apiRequest('DELETE', `/api/manager/damage-claims/${claimId}/evidence/${evidenceId}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Evidence removed", description: "Evidence has been removed from the claim." });
      refetch();
      onClaimUpdated?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Delete claim mutation
  const deleteClaimMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('DELETE', `/api/manager/damage-claims/${claimId}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Claim deleted", description: "Draft claim has been deleted." });
      onOpenChange(false);
      onClaimUpdated?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file, "damage-claims");
      e.target.value = '';
    }
  }, [uploadFile]);

  const resetUploadForm = () => {
    setShowUploadForm(false);
    setUploadedFileUrl(null);
    setUploadedFileName(null);
    setEvidenceForm({
      evidenceType: 'photo_after',
      description: '',
      amountCents: '',
      vendorName: '',
    });
  };

  const handleSaveEvidence = () => {
    if (!uploadedFileUrl) {
      toast({
        title: "No file uploaded",
        description: "Please upload a file first",
        variant: "destructive",
      });
      return;
    }
    addEvidenceMutation.mutate();
  };

  const canAddEvidence = claim?.status === 'draft';
  const canDeleteEvidence = claim?.status === 'draft';

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Damage Claim Details</SheetTitle>
          <SheetDescription>
            View and manage evidence for this damage claim
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : claim ? (
          <div className="space-y-6 mt-6">
            {/* Claim Header */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{claim.claimTitle}</h3>
                {getStatusBadge(claim.status)}
              </div>
              <p className="text-sm text-muted-foreground">{claim.claimDescription}</p>
            </div>

            {/* Claim Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <Label className="text-xs text-muted-foreground">Chef</Label>
                <p>{claim.chefName || claim.chefEmail || 'Unknown'}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Damage Date</Label>
                <p>{format(new Date(claim.damageDate), 'MMM d, yyyy')}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Claimed Amount</Label>
                <p className="font-semibold">{formatCurrency(claim.claimedAmountCents)}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Booking Type</Label>
                <p>{claim.bookingType === 'storage' ? 'Storage' : 'Kitchen'}</p>
              </div>
            </div>

            {/* Damaged Equipment Items */}
            {claim.damagedItems && claim.damagedItems.length > 0 && (
              <div className="border rounded-md p-3 space-y-2">
                <Label className="text-xs text-muted-foreground">Damaged Equipment ({claim.damagedItems.length})</Label>
                <div className="space-y-1.5">
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

            {/* Chef Response */}
            {claim.chefResponse && (
              <div className="bg-muted/50 rounded-lg p-3">
                <Label className="text-xs text-muted-foreground">Chef Response</Label>
                <p className="text-sm mt-1">{claim.chefResponse}</p>
                {claim.chefRespondedAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Responded {format(new Date(claim.chefRespondedAt), 'MMM d, yyyy h:mm a')}
                  </p>
                )}
              </div>
            )}

            <Separator />

            {/* Evidence Section */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="font-semibold flex items-center gap-2">
                    <Image className="h-4 w-4" />
                    Evidence ({claim.evidence.length})
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {claim.status === 'draft' 
                      ? 'Upload at least 2 pieces of evidence before submitting' 
                      : 'Evidence attached to this claim'}
                  </p>
                </div>
                {canAddEvidence && !showUploadForm && (
                  <Button size="sm" onClick={() => setShowUploadForm(true)}>
                    <Upload className="h-4 w-4 mr-2" />
                    Add Evidence
                  </Button>
                )}
              </div>

              {/* Upload Form */}
              {showUploadForm && canAddEvidence && (
                <Card className="mb-4">
                  <CardContent className="pt-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h5 className="font-medium">Upload Evidence</h5>
                      <Button variant="ghost" size="sm" onClick={resetUploadForm}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* File Upload */}
                    {!uploadedFileUrl ? (
                      <div
                        className={cn(
                          "border-2 border-dashed border-border rounded-lg p-6 hover:border-primary/50 transition-colors",
                          isUploading && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                          onChange={handleFileUpload}
                          className="hidden"
                          id="evidence-upload"
                          disabled={isUploading}
                        />
                        <label
                          htmlFor="evidence-upload"
                          className="flex flex-col items-center justify-center cursor-pointer"
                        >
                          {isUploading ? (
                            <>
                              <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
                              <span className="text-sm text-muted-foreground">
                                Uploading... {Math.round(uploadProgress)}%
                              </span>
                            </>
                          ) : (
                            <>
                              <Camera className="h-8 w-8 text-muted-foreground mb-2" />
                              <span className="text-sm font-medium">Click to upload photo or document</span>
                              <span className="text-xs text-muted-foreground">JPG, PNG, WebP, or PDF (max 4.5MB)</span>
                            </>
                          )}
                        </label>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                        <FileText className="h-8 w-8 text-primary" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{uploadedFileName}</p>
                          <p className="text-xs text-green-600">Uploaded successfully</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => {
                          setUploadedFileUrl(null);
                          setUploadedFileName(null);
                        }}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                    {/* Evidence Details */}
                    <div className="space-y-3">
                      <div>
                        <Label>Evidence Type</Label>
                        <Select
                          value={evidenceForm.evidenceType}
                          onValueChange={(value) => setEvidenceForm({ ...evidenceForm, evidenceType: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EVIDENCE_TYPES.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                <div className="flex items-center gap-2">
                                  <type.icon className="h-4 w-4" />
                                  {type.label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label>Description (optional)</Label>
                        <Textarea
                          placeholder="Describe this evidence..."
                          value={evidenceForm.description}
                          onChange={(e) => setEvidenceForm({ ...evidenceForm, description: e.target.value })}
                          rows={2}
                        />
                      </div>

                      {(evidenceForm.evidenceType === 'receipt' || evidenceForm.evidenceType === 'quote') && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Amount</Label>
                            <CurrencyInput
                              placeholder="0.00"
                              value={evidenceForm.amountCents}
                              onValueChange={(val) => setEvidenceForm({ ...evidenceForm, amountCents: val })}
                            />
                          </div>
                          <div>
                            <Label>Vendor Name</Label>
                            <Input
                              placeholder="Company name"
                              value={evidenceForm.vendorName}
                              onChange={(e) => setEvidenceForm({ ...evidenceForm, vendorName: e.target.value })}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={resetUploadForm}>
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleSaveEvidence}
                        disabled={!uploadedFileUrl || addEvidenceMutation.isPending}
                      >
                        {addEvidenceMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : null}
                        Save Evidence
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Evidence List */}
              {claim.evidence.length === 0 ? (
                <div className="text-center py-8 border-2 border-dashed rounded-lg">
                  <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No evidence uploaded yet</p>
                  {claim.status === 'draft' && (
                    <p className="text-xs text-muted-foreground mt-1">
                      You need at least 2 pieces of evidence to submit this claim
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {claim.evidence.map((evidence) => (
                    <div
                      key={evidence.id}
                      className="flex items-start gap-3 p-3 border rounded-lg"
                    >
                      {/* Thumbnail or Icon */}
                      <div className="w-16 h-16 rounded bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                        {evidence.fileUrl.match(/\.(jpg|jpeg|png|webp|gif)$/i) ? (
                          <img
                            src={getR2ProxyUrl(evidence.fileUrl)}
                            alt={evidence.fileName || 'Evidence'}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          getEvidenceIcon(evidence.evidenceType)
                        )}
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {EVIDENCE_TYPES.find(t => t.value === evidence.evidenceType)?.label || evidence.evidenceType}
                          </Badge>
                          {evidence.amountCents && (
                            <span className="text-xs font-medium text-green-600">
                              {formatCurrency(evidence.amountCents)}
                            </span>
                          )}
                        </div>
                        {evidence.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {evidence.description}
                          </p>
                        )}
                        {evidence.vendorName && (
                          <p className="text-xs text-muted-foreground">
                            Vendor: {evidence.vendorName}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Uploaded {format(new Date(evidence.uploadedAt), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(getR2ProxyUrl(evidence.fileUrl), '_blank')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        {canDeleteEvidence && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteEvidenceMutation.mutate(evidence.id)}
                            disabled={deleteEvidenceMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Minimum Evidence Warning */}
            {claim.status === 'draft' && claim.evidence.length < 2 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">
                      More evidence needed
                    </p>
                    <p className="text-xs text-amber-700">
                      Upload at least {2 - claim.evidence.length} more piece(s) of evidence before you can submit this claim.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <Separator />

            {/* History Section */}
            <div>
              <h4 className="font-semibold flex items-center gap-2 mb-4">
                <History className="h-4 w-4" />
                Claim History ({history.length})
              </h4>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No history available</p>
              ) : (
                <div className="space-y-3">
                  {history.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">
                          {entry.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </p>
                        {entry.notes && (
                          <p className="text-muted-foreground text-xs mt-0.5">{entry.notes}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(entry.createdAt), 'MMM d, yyyy h:mm a')} • by {entry.actionBy}
                        </p>
                      </div>
                      {entry.newStatus && (
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {entry.newStatus.replace(/_/g, ' ')}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Delete Draft Button */}
            {claim.status === 'draft' && (
              <>
                <Separator />
                <div className="flex justify-end">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteClaimMutation.mutate()}
                    disabled={deleteClaimMutation.isPending}
                  >
                    {deleteClaimMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Delete Draft Claim
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            Claim not found
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default DamageClaimDetailSheet;
