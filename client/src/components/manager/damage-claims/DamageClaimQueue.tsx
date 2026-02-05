/**
 * Damage Claim Queue Component
 * 
 * Manager interface for creating, viewing, and managing damage claims.
 * Follows the same pattern as OverstayPenaltyQueue.tsx
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  CreditCard,
  FileText,
  Plus,
  RefreshCw,
  Eye,
  Send,
  X,
  Camera,
  Receipt,
  Loader2,
  Info,
  Save,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DamageClaimDetailSheet } from "./DamageClaimDetailSheet";

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
  chefEmail: string | null;
  chefName: string | null;
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
    resolved: { variant: "outline", label: "Resolved" },
    expired: { variant: "outline", label: "Expired" },
  };

  const config = statusConfig[status] || { variant: "outline" as const, label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

// Claim Card Component
function ClaimCard({
  claim,
  onSubmit,
  onCharge,
  onView,
  isProcessing,
}: {
  claim: DamageClaim;
  onSubmit: (id: number) => void;
  onCharge: (id: number) => void;
  onView: (id: number) => void;
  isProcessing: boolean;
}) {
  const canSubmit = claim.status === 'draft' && claim.evidence.length >= 2;
  const canCharge = ['approved', 'partially_approved', 'chef_accepted'].includes(claim.status);
  const showChefResponse = claim.chefResponse && claim.chefRespondedAt;

  return (
    <Card className="mb-4">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-orange-600" />
              <span className="font-medium">{claim.claimTitle}</span>
              {getStatusBadge(claim.status)}
            </div>
            
            <p className="text-sm text-muted-foreground line-clamp-2">
              {claim.claimDescription}
            </p>
            
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span>
                <strong>Chef:</strong> {claim.chefName || claim.chefEmail || 'Unknown'}
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

            {showChefResponse && (
              <div className="mt-2 p-2 bg-muted rounded-md">
                <p className="text-sm">
                  <strong>Chef Response:</strong> {claim.chefResponse}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Responded {format(new Date(claim.chefRespondedAt!), 'MMM d, yyyy h:mm a')}
                </p>
              </div>
            )}

            {claim.status === 'submitted' && (
              <p className="text-xs text-muted-foreground">
                Response deadline: {format(new Date(claim.chefResponseDeadline), 'MMM d, yyyy h:mm a')}
              </p>
            )}
          </div>

          <div className="text-right ml-4">
            <p className="text-xl font-bold">{formatCurrency(claim.claimedAmountCents)}</p>
            {claim.finalAmountCents && claim.finalAmountCents !== claim.claimedAmountCents && (
              <p className="text-sm text-green-600">
                Final: {formatCurrency(claim.finalAmountCents)}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-4 pt-4 border-t">
          <Button variant="outline" size="sm" onClick={() => onView(claim.id)}>
            <Eye className="w-4 h-4 mr-1" />
            View Details
          </Button>

          {canSubmit && (
            <Button 
              size="sm" 
              onClick={() => onSubmit(claim.id)}
              disabled={isProcessing}
            >
              <Send className="w-4 h-4 mr-1" />
              Submit to Chef
            </Button>
          )}

          {canCharge && (
            <Button 
              size="sm" 
              variant="default"
              onClick={() => onCharge(claim.id)}
              disabled={isProcessing}
            >
              <CreditCard className="w-4 h-4 mr-1" />
              Charge Chef
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Types for recent bookings
interface RecentBooking {
  id: number;
  type: 'kitchen' | 'storage';
  chefId: number;
  chefName: string;
  locationName: string;
  kitchenName: string | null;
  startDate: string;
  endDate: string;
  status: string;
  label: string;
}

// Evidence types for the form
const EVIDENCE_TYPE_OPTIONS = [
  { value: 'photo_before', label: 'Before Photo', icon: Camera },
  { value: 'photo_after', label: 'After Photo', icon: Camera },
  { value: 'receipt', label: 'Receipt', icon: Receipt },
  { value: 'invoice', label: 'Invoice', icon: FileText },
  { value: 'document', label: 'Document', icon: FileText },
  { value: 'third_party_report', label: 'Third Party Report', icon: FileText },
];

// Pending evidence item (before claim is created)
interface PendingEvidence {
  id: string;
  file: File;
  evidenceType: string;
  description: string;
  preview?: string;
}

// Create Claim Sheet - Redesigned for single-step process
function CreateClaimSheet({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'form' | 'evidence'>('form');
  const [selectedBooking, setSelectedBooking] = useState<RecentBooking | null>(null);
  const [formData, setFormData] = useState({
    claimTitle: '',
    claimDescription: '',
    damageDate: format(new Date(), 'yyyy-MM-dd'),
    claimedAmount: '',
  });
  
  // Evidence state
  const [pendingEvidence, setPendingEvidence] = useState<PendingEvidence[]>([]);
  const [newEvidenceType, setNewEvidenceType] = useState('photo_after');
  const [newEvidenceDescription, setNewEvidenceDescription] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // File upload hook
  const { uploadFile } = useSessionFileUpload();

  // Fetch recent bookings eligible for damage claims
  const { data: bookingsData, isLoading: loadingBookings } = useQuery({
    queryKey: ['/api/manager/damage-claims/recent-bookings'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/manager/damage-claims/recent-bookings');
      return response.json();
    },
    enabled: open,
  });

  const recentBookings: RecentBooking[] = bookingsData?.bookings || [];
  const deadlineDays = bookingsData?.deadlineDays || 14;

  // Reset form when sheet closes
  const resetForm = useCallback(() => {
    setStep('form');
    setSelectedBooking(null);
    setFormData({
      claimTitle: '',
      claimDescription: '',
      damageDate: format(new Date(), 'yyyy-MM-dd'),
      claimedAmount: '',
    });
    setPendingEvidence([]);
    setNewEvidenceType('photo_after');
    setNewEvidenceDescription('');
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const id = `pending-${Date.now()}`;
    
    // Create preview for images
    let preview: string | undefined;
    if (file.type.startsWith('image/')) {
      preview = URL.createObjectURL(file);
    }

    setPendingEvidence(prev => [...prev, {
      id,
      file,
      evidenceType: newEvidenceType,
      description: newEvidenceDescription,
      preview,
    }]);

    // Reset input
    setNewEvidenceDescription('');
    e.target.value = '';
  }, [newEvidenceType, newEvidenceDescription]);

  // Remove pending evidence
  const removePendingEvidence = useCallback((id: string) => {
    setPendingEvidence(prev => {
      const item = prev.find(e => e.id === id);
      if (item?.preview) {
        URL.revokeObjectURL(item.preview);
      }
      return prev.filter(e => e.id !== id);
    });
  }, []);

  // Create claim mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBooking) throw new Error("Please select a booking");
      
      const response = await apiRequest('POST', '/api/manager/damage-claims', {
        bookingType: selectedBooking.type,
        [selectedBooking.type === 'storage' ? 'storageBookingId' : 'kitchenBookingId']: selectedBooking.id,
        claimTitle: formData.claimTitle,
        claimDescription: formData.claimDescription,
        damageDate: formData.damageDate,
        claimedAmountCents: Math.round(parseFloat(formData.claimedAmount) * 100),
      });
      return response.json();
    },
    onSuccess: () => {
      // Claim created successfully
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Upload evidence to created claim
  const uploadEvidenceToClaim = async (claimId: number, evidence: PendingEvidence) => {
    // Upload file to R2
    const uploadResult = await uploadFile(evidence.file, 'damage-claims');
    if (!uploadResult || !uploadResult.success || !uploadResult.url) {
      throw new Error(`Failed to upload ${evidence.file.name}`);
    }

    // Add evidence to claim
    await apiRequest('POST', `/api/manager/damage-claims/${claimId}/evidence`, {
      evidenceType: evidence.evidenceType,
      fileUrl: uploadResult.url,
      fileName: evidence.file.name,
      fileSize: evidence.file.size,
      mimeType: evidence.file.type,
      description: evidence.description || null,
    });
  };

  // Submit claim mutation
  const submitClaimMutation = useMutation({
    mutationFn: async (claimId: number) => {
      const response = await apiRequest('POST', `/api/manager/damage-claims/${claimId}/submit`);
      return response.json();
    },
  });

  // Handle Save as Draft
  const handleSaveAsDraft = async () => {
    if (!selectedBooking) {
      toast({ title: "Error", description: "Please select a booking", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      // Create claim
      const result = await createMutation.mutateAsync();
      const claimId = result.claim.id;

      // Upload evidence if any
      for (const evidence of pendingEvidence) {
        await uploadEvidenceToClaim(claimId, evidence);
      }

      toast({ 
        title: "Draft saved", 
        description: "Your claim has been saved as a draft. You can add more evidence and submit later." 
      });
      
      setOpen(false);
      resetForm();
      onCreated();
      queryClient.invalidateQueries({ queryKey: ['/api/manager/damage-claims'] });
    } catch (error) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  // Handle Submit to Chef
  const handleSubmitToChef = async () => {
    if (!selectedBooking) {
      toast({ title: "Error", description: "Please select a booking", variant: "destructive" });
      return;
    }

    if (pendingEvidence.length < 2) {
      toast({ 
        title: "More evidence required", 
        description: "Please add at least 2 pieces of evidence before submitting to the chef.", 
        variant: "destructive" 
      });
      return;
    }

    setIsUploading(true);
    try {
      // Create claim
      const result = await createMutation.mutateAsync();
      const claimId = result.claim.id;

      // Upload all evidence
      for (const evidence of pendingEvidence) {
        await uploadEvidenceToClaim(claimId, evidence);
      }

      // Submit to chef
      await submitClaimMutation.mutateAsync(claimId);

      toast({ 
        title: "Claim submitted to chef", 
        description: "The chef has been notified and has 72 hours to respond. If they accept, their card will be automatically charged." 
      });
      
      setOpen(false);
      resetForm();
      onCreated();
      queryClient.invalidateQueries({ queryKey: ['/api/manager/damage-claims'] });
    } catch (error) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const canProceedToEvidence = selectedBooking && 
    formData.claimTitle.length >= 5 && 
    formData.claimDescription.length >= 50 && 
    parseFloat(formData.claimedAmount) >= 10;

  return (
    <Sheet open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) resetForm();
    }}>
      <SheetTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          New Damage Claim
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {step === 'form' ? 'Create Damage Claim' : 'Add Evidence'}
          </SheetTitle>
          <SheetDescription>
            {step === 'form' 
              ? "Fill in the claim details, then add evidence and submit to the chef."
              : "Upload photos, receipts, or documents as evidence for your claim."
            }
          </SheetDescription>
        </SheetHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 my-4">
          <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm ${step === 'form' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            <span className="w-5 h-5 rounded-full bg-background/20 flex items-center justify-center text-xs">1</span>
            Details
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm ${step === 'evidence' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            <span className="w-5 h-5 rounded-full bg-background/20 flex items-center justify-center text-xs">2</span>
            Evidence & Submit
          </div>
        </div>

        {step === 'form' ? (
          <div className="space-y-4 mt-4">
            {/* Booking Selection */}
            <div className="space-y-2">
              <Label>Select Booking</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Only past bookings from the last {deadlineDays} days are eligible
              </p>
              {loadingBookings ? (
                <Skeleton className="h-10 w-full" />
              ) : recentBookings.length === 0 ? (
                <div className="p-4 border rounded-md bg-muted/50 text-center">
                  <p className="text-sm text-muted-foreground">
                    No eligible bookings found in the last {deadlineDays} days
                  </p>
                </div>
              ) : (
                <Select
                  value={selectedBooking ? `${selectedBooking.type}-${selectedBooking.id}` : ''}
                  onValueChange={(value) => {
                    const [type, id] = value.split('-');
                    const booking = recentBookings.find(b => b.type === type && b.id === parseInt(id));
                    setSelectedBooking(booking || null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a booking..." />
                  </SelectTrigger>
                  <SelectContent>
                    {recentBookings.map((booking) => (
                      <SelectItem 
                        key={`${booking.type}-${booking.id}`} 
                        value={`${booking.type}-${booking.id}`}
                      >
                        <div className="flex flex-col">
                          <span>{booking.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Selected Booking Info */}
            {selectedBooking && (
              <div className="p-3 border rounded-md bg-muted/30 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Type:</span>
                  <Badge variant="outline">{selectedBooking.type === 'storage' ? 'Storage' : 'Kitchen'}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Chef:</span>
                  <span className="font-medium">{selectedBooking.chefName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Location:</span>
                  <span>{selectedBooking.locationName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">End Date:</span>
                  <span>{format(new Date(selectedBooking.endDate), 'MMM d, yyyy')}</span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Claim Title</Label>
              <Input
                placeholder="Brief description of the damage"
                value={formData.claimTitle}
                onChange={(e) => setFormData({ ...formData, claimTitle: e.target.value })}
                minLength={5}
                maxLength={200}
              />
            </div>

            <div className="space-y-2">
              <Label>Detailed Description</Label>
              <Textarea
                placeholder="Describe the damage in detail (minimum 50 characters)"
                value={formData.claimDescription}
                onChange={(e) => setFormData({ ...formData, claimDescription: e.target.value })}
                minLength={50}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                {formData.claimDescription.length}/50 characters minimum
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Damage Date</Label>
                <Input
                  type="date"
                  value={formData.damageDate}
                  onChange={(e) => setFormData({ ...formData, damageDate: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Claimed Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="10"
                  placeholder="0.00"
                  value={formData.claimedAmount}
                  onChange={(e) => setFormData({ ...formData, claimedAmount: e.target.value })}
                />
              </div>
            </div>

            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button 
                type="button"
                onClick={() => setStep('evidence')}
                disabled={!canProceedToEvidence}
              >
                Next: Add Evidence
              </Button>
            </SheetFooter>
          </div>
        ) : (
          <div className="space-y-4 mt-4">
            {/* Info Alert */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>How it works:</strong> When you submit, the chef will be notified and has 72 hours to respond.
                If they accept, <strong>their card will be automatically charged</strong> using the payment method from their booking.
                If they dispute, an admin will review the claim.
              </AlertDescription>
            </Alert>

            {/* Claim Summary */}
            <div className="p-3 border rounded-md bg-muted/30 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{formData.claimTitle}</span>
                <span className="font-bold">${formData.claimedAmount}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Chef: {selectedBooking?.chefName} • {selectedBooking?.type === 'storage' ? 'Storage' : 'Kitchen'} booking
              </p>
            </div>

            {/* Evidence Upload */}
            <div className="space-y-3">
              <Label>Upload Evidence</Label>
              
              <div className="grid grid-cols-2 gap-2">
                <Select value={newEvidenceType} onValueChange={setNewEvidenceType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_TYPE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Input
                  placeholder="Description (optional)"
                  value={newEvidenceDescription}
                  onChange={(e) => setNewEvidenceDescription(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept="image/*,.pdf,.doc,.docx"
                  onChange={handleFileSelect}
                  className="flex-1"
                />
              </div>

              {/* Pending Evidence List */}
              {pendingEvidence.length > 0 && (
                <div className="space-y-2 mt-3">
                  <p className="text-sm font-medium">Evidence to upload ({pendingEvidence.length} items):</p>
                  {pendingEvidence.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                      {ev.preview ? (
                        <img src={ev.preview} alt="" className="w-10 h-10 object-cover rounded" />
                      ) : (
                        <FileText className="w-10 h-10 p-2 text-muted-foreground" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ev.file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {EVIDENCE_TYPE_OPTIONS.find(o => o.value === ev.evidenceType)?.label}
                          {ev.description && ` • ${ev.description}`}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removePendingEvidence(ev.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {pendingEvidence.length < 2 && (
                <p className="text-xs text-amber-600">
                  ⚠️ At least 2 pieces of evidence are required to submit to chef
                </p>
              )}
            </div>

            <SheetFooter className="pt-4 flex-col sm:flex-row gap-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setStep('form')}
                disabled={isUploading}
              >
                Back
              </Button>
              <div className="flex gap-2 flex-1 justify-end">
                <Button 
                  type="button"
                  variant="secondary"
                  onClick={handleSaveAsDraft}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" /> Save as Draft</>
                  )}
                </Button>
                <Button 
                  type="button"
                  onClick={handleSubmitToChef}
                  disabled={isUploading || pendingEvidence.length < 2}
                >
                  {isUploading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" /> Submit to Chef</>
                  )}
                </Button>
              </div>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Main Component
export function DamageClaimQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);

  // Fetch claims
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['/api/manager/damage-claims', showAll],
    queryFn: async () => {
      const url = showAll 
        ? '/api/manager/damage-claims?includeAll=true' 
        : '/api/manager/damage-claims';
      const response = await apiRequest('GET', url);
      return response.json();
    },
    refetchInterval: 30000,
  });

  const claims: DamageClaim[] = data?.claims || [];

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('POST', `/api/manager/damage-claims/${id}/submit`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Claim submitted", description: "The chef has been notified." });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/damage-claims'] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Charge mutation
  const chargeMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('POST', `/api/manager/damage-claims/${id}/charge`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Charge successful", description: "The chef's card has been charged." });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/damage-claims'] });
    },
    onError: (error: Error) => {
      toast({ title: "Charge failed", description: error.message, variant: "destructive" });
    },
  });

  const isProcessing = submitMutation.isPending || chargeMutation.isPending;

  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  const handleView = (id: number) => {
    setSelectedClaimId(id);
    setDetailSheetOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
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

  // Group claims by status
  const draftClaims = claims.filter(c => c.status === 'draft');
  const pendingClaims = claims.filter(c => ['submitted', 'under_review'].includes(c.status));
  const actionRequiredClaims = claims.filter(c => 
    ['approved', 'partially_approved', 'chef_accepted', 'charge_failed'].includes(c.status)
  );
  const resolvedClaims = claims.filter(c => 
    ['charge_succeeded', 'resolved', 'rejected', 'expired'].includes(c.status)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Damage Claims</h2>
          <p className="text-muted-foreground">File and manage damage claims against chef bookings</p>
        </div>
        <div className="flex gap-2">
          <CreateClaimSheet onCreated={() => refetch()} />
          <Button 
            variant={showAll ? "default" : "outline"} 
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "Hide" : "Show"} Resolved
          </Button>
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-2xl font-bold">{draftClaims.length}</p>
                <p className="text-xs text-muted-foreground">Drafts</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-yellow-500" />
              <div>
                <p className="text-2xl font-bold">{pendingClaims.length}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              <div>
                <p className="text-2xl font-bold">{actionRequiredClaims.length}</p>
                <p className="text-xs text-muted-foreground">Action Required</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{resolvedClaims.length}</p>
                <p className="text-xs text-muted-foreground">Resolved</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Claims List */}
      {claims.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium">No Damage Claims</h3>
            <p className="text-muted-foreground">You haven&apos;t filed any damage claims yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Action Required */}
          {actionRequiredClaims.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                Action Required ({actionRequiredClaims.length})
              </h3>
              {actionRequiredClaims.map(claim => (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
                  onSubmit={(id) => submitMutation.mutate(id)}
                  onCharge={(id) => chargeMutation.mutate(id)}
                  onView={handleView}
                  isProcessing={isProcessing}
                />
              ))}
            </div>
          )}

          {/* Drafts */}
          {draftClaims.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <FileText className="w-5 h-5 text-gray-500" />
                Drafts ({draftClaims.length})
              </h3>
              {draftClaims.map(claim => (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
                  onSubmit={(id) => submitMutation.mutate(id)}
                  onCharge={(id) => chargeMutation.mutate(id)}
                  onView={handleView}
                  isProcessing={isProcessing}
                />
              ))}
            </div>
          )}

          {/* Pending */}
          {pendingClaims.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-500" />
                Pending Response ({pendingClaims.length})
              </h3>
              {pendingClaims.map(claim => (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
                  onSubmit={(id) => submitMutation.mutate(id)}
                  onCharge={(id) => chargeMutation.mutate(id)}
                  onView={handleView}
                  isProcessing={isProcessing}
                />
              ))}
            </div>
          )}

          {/* Resolved (if showing all) */}
          {showAll && resolvedClaims.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-gray-500" />
                Resolved ({resolvedClaims.length})
              </h3>
              <div className="opacity-75">
                {resolvedClaims.map(claim => (
                  <ClaimCard
                    key={claim.id}
                    claim={claim}
                    onSubmit={(id) => submitMutation.mutate(id)}
                    onCharge={(id) => chargeMutation.mutate(id)}
                    onView={handleView}
                    isProcessing={isProcessing}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail Sheet for viewing claim and uploading evidence */}
      <DamageClaimDetailSheet
        claimId={selectedClaimId}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        onClaimUpdated={() => refetch()}
      />
    </div>
  );
}

export default DamageClaimQueue;
