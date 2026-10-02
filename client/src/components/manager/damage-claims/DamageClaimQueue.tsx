/**
 * Damage Claim Queue Component
 * 
 * Manager interface for creating, viewing, and managing damage claims.
 * Uses TanStack Table for enterprise-grade table display.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { mt } from "@/i18n/manager";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ColumnDef, flexRender, getCoreRowModel, getSortedRowModel, getFilteredRowModel, SortingState, useReactTable } from "@tanstack/react-table";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DateField } from "@/components/ui/date-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MobileTableCards } from "@/components/ui/mobile-table-cards";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AppDialogContent } from "@/components/ui/app-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle, Clock, CreditCard, FileText, Plus, RefreshCw, Eye, Send, X, Camera, Receipt, Loader2, Info, Save, Download, ArrowUpDown } from "@/components/ui/manager-icons";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DamageClaimDetailDialog } from "./DamageClaimDetailDialog";
import { UnsavedChangesDialog } from "@/components/manager/UnsavedChangesDialog";
import { hasRequiredDamageClaimEvidence } from "@shared/damage-claim-evidence";
import { cn } from "@/lib/utils";
import { SmartImage } from "@/components/ui/smart-image";

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
  referenceCode?: string | null;
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
  const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning"; label: string }> = {
    draft: { variant: "outline", label: mt("draftStatus") },
    submitted: { variant: "warning", label: mt("awaitingChefResponse") },
    chef_accepted: { variant: "secondary", label: mt("chefAccepted") },
    chef_disputed: { variant: "destructive", label: mt("disputed") },
    under_review: { variant: "warning", label: mt("underAdminReview") },
    approved: { variant: "success", label: mt("approved") },
    partially_approved: { variant: "success", label: mt("partiallyApproved") },
    rejected: { variant: "destructive", label: mt("rejected") },
    charge_pending: { variant: "warning", label: mt("charging") },
    charge_succeeded: { variant: "success", label: mt("paid") },
    charge_failed: { variant: "destructive", label: mt("chargeFailed") },
    escalated: { variant: "destructive", label: mt("escalatedAwaitingChefPayment") },
    resolved: { variant: "outline", label: mt("resolved") },
    expired: { variant: "outline", label: mt("expired") },
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
  onDownloadInvoice,
  isProcessing,
  isDownloading,
}: {
  claim: DamageClaim;
  onSubmit: (id: number) => void;
  onCharge: (id: number) => void;
  onView: (id: number) => void;
  onDownloadInvoice: (id: number) => void;
  isProcessing: boolean;
  isDownloading: boolean;
}) {
  const canSubmit = claim.status === 'draft' && hasRequiredDamageClaimEvidence(claim.evidence);
  const canCharge = ['approved', 'partially_approved', 'chef_accepted', 'charge_failed', 'escalated'].includes(claim.status);
  const canDownloadInvoice = claim.status === 'charge_succeeded';
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
                <strong>{mt("chef2")}</strong> {claim.chefName || claim.chefEmail || mt("unknown")}
              </span>
              <span>
                <strong>{mt("type2")}</strong> {claim.bookingType === 'storage' ? mt("storage") : mt("kitchen")}
              </span>
              <span>
                <strong>{mt("damageDate2")}</strong> {format(new Date(claim.damageDate), 'MMM d, yyyy')}
              </span>
              <span>
                <strong>{mt("evidence")}</strong> {mt("evidenceItemsCount", { count: claim.evidence.length })}
              </span>
            </div>

            {showChefResponse && (
              <div className="mt-2 p-2 bg-muted rounded-md">
                <p className="text-sm">
                  <strong>{mt("chefResponse2")}</strong> {claim.chefResponse}
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
                {mt("finalAmountLabel", { amount: formatCurrency(claim.finalAmountCents) })}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-4 pt-4 border-t">
          <Button variant="outline" size="sm" onClick={() => onView(claim.id)}>
            <Eye className="w-4 h-4 mr-1" />{mt("viewDetails")}</Button>

          {canSubmit && (
            <Button 
              size="sm" 
              onClick={() => onSubmit(claim.id)}
              disabled={isProcessing}
            >
              <Send className="w-4 h-4 mr-1" />{mt("submitToChef")}</Button>
          )}

          {canCharge && (
            <Button 
              size="sm" 
              variant="default"
              onClick={() => onCharge(claim.id)}
              disabled={isProcessing}
            >
              <CreditCard className="w-4 h-4 mr-1" />{mt("chargeChef")}</Button>
          )}

          {canDownloadInvoice && (
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => onDownloadInvoice(claim.id)}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-1" />
              )}
              {mt("invoice")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Types for recent bookings
interface EquipmentItem {
  equipmentBookingId: number | null;
  equipmentListingId: number;
  equipmentType: string;
  brand: string | null;
  availabilityType: string;
  status: string;
}

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
  equipment: EquipmentItem[];
}

// Evidence types for the form
const EVIDENCE_TYPE_OPTIONS = [
  { value: 'photo_before', label: mt("beforePhoto"), icon: Camera },
  { value: 'photo_after', label: mt("afterPhoto"), icon: Camera },
  { value: 'receipt', label: mt("receipt"), icon: Receipt },
  { value: 'invoice', label: mt("invoice"), icon: FileText },
  { value: 'document', label: mt("documentLabel"), icon: FileText },
  { value: 'third_party_report', label: mt("thirdPartyReport"), icon: FileText },
];

// Pending evidence item (before claim is created)
interface PendingEvidence {
  id: string;
  file: File;
  evidenceType: string;
  description: string;
  preview?: string;
}

// Create Claim Dialog - Redesigned for single-step process
function CreateClaimDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [step, setStep] = useState<'form' | 'evidence'>('form');
  const [selectedBooking, setSelectedBooking] = useState<RecentBooking | null>(null);
  const [formData, setFormData] = useState({
    claimTitle: '',
    claimDescription: '',
    damageDate: format(new Date(), 'yyyy-MM-dd'),
    claimedAmount: '',
  });
  
  // Equipment damage state (for kitchen bookings)
  const [selectedDamagedEquipment, setSelectedDamagedEquipment] = useState<Set<number>>(new Set());
  
  // Evidence state
  const [pendingEvidence, setPendingEvidence] = useState<PendingEvidence[]>([]);
  const [newEvidenceType, setNewEvidenceType] = useState('photo_after');
  const [newEvidenceDescription, setNewEvidenceDescription] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // File upload hook
  const { uploadFile } = useSessionFileUpload();

  // Fetch recent bookings eligible for damage claims
  const { data: bookingsData, isLoading: loadingBookings, isError: bookingsError, refetch: retryBookings } = useQuery({
    queryKey: ['/api/manager/damage-claims/recent-bookings'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/manager/damage-claims/recent-bookings');
      return response.json();
    },
    enabled: open,
  });

  const recentBookings: RecentBooking[] = bookingsData?.bookings || [];
  const deadlineDays = bookingsData?.deadlineDays || 14;

  // Reset form when dialog closes
  const resetForm = useCallback(() => {
    setStep('form');
    setSelectedBooking(null);
    setFormData({
      claimTitle: '',
      claimDescription: '',
      damageDate: format(new Date(), 'yyyy-MM-dd'),
      claimedAmount: '',
    });
    setSelectedDamagedEquipment(new Set());
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

  // Create claim mutation — accepts submitImmediately to create+submit atomically
  const createMutation = useMutation({
    mutationFn: async ({ submitImmediately }: { submitImmediately: boolean }) => {
      if (!selectedBooking) throw new Error(mt("pleaseSelectBooking"));
      
      // Build damaged items array from selected equipment
      const damagedItems = selectedBooking.type === 'kitchen' && selectedDamagedEquipment.size > 0
        ? selectedBooking.equipment
            .filter(eq => selectedDamagedEquipment.has(eq.equipmentListingId))
            .map(eq => ({
              equipmentBookingId: eq.equipmentBookingId,
              equipmentListingId: eq.equipmentListingId,
              equipmentType: eq.equipmentType,
              brand: eq.brand,
            }))
        : undefined;

      const response = await apiRequest('POST', '/api/manager/damage-claims', {
        bookingType: selectedBooking.type,
        [selectedBooking.type === 'storage' ? 'storageBookingId' : 'kitchenBookingId']: selectedBooking.id,
        claimTitle: formData.claimTitle,
        claimDescription: formData.claimDescription,
        damageDate: formData.damageDate,
        claimedAmountCents: Math.round(parseFloat(formData.claimedAmount) * 100),
        ...(damagedItems && damagedItems.length > 0 ? { damagedItems } : {}),
        ...(submitImmediately ? { submitImmediately: true } : {}),
      });
      return response.json();
    },
    onError: (error: Error) => {
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
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

  // Handle Save as Draft
  const handleSaveAsDraft = async () => {
    if (!selectedBooking) {
      toast({ title: mt("error"), description: mt("pleaseSelectABooking"), variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      // Create claim as draft
      const result = await createMutation.mutateAsync({ submitImmediately: false });
      const claimId = result.claim.id;

      // Upload evidence if any
      for (const evidence of pendingEvidence) {
        await uploadEvidenceToClaim(claimId, evidence);
      }

      toast({ title: mt("draftSaved"), 
        description: mt("yourClaimHasBeenSavedAsADraftYouCanAddMoreEvidenceAndSubmitL") 
      });
      
      setOpen(false);
      resetForm();
      onCreated();
      queryClient.invalidateQueries({ queryKey: ['/api/manager/damage-claims'] });
    } catch (error) {
      toast({ title: mt("error"), description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  // Handle Submit to Chef — atomic create+submit, no redundant draft
  const handleSubmitToChef = async () => {
    if (!selectedBooking) {
      toast({ title: mt("error"), description: mt("pleaseSelectABooking"), variant: "destructive" });
      return;
    }

    if (pendingEvidence.length < 2) {
      toast({ title: mt("moreEvidenceRequired"), 
        description: mt("pleaseAddAtLeast2PiecesOfEvidenceBeforeSubmittingToTheChef"), 
        variant: "destructive" 
      });
      return;
    }

    setIsUploading(true);
    try {
      // Create claim and submit to chef in one atomic operation
      const result = await createMutation.mutateAsync({ submitImmediately: true });
      const claimId = result.claim.id;

      // Upload all evidence
      for (const evidence of pendingEvidence) {
        await uploadEvidenceToClaim(claimId, evidence);
      }

      toast({ title: mt("claimSubmittedToChef"), 
        description: mt("theChefHasBeenNotifiedAndHas72HoursToRespondIfTheyAcceptThei") 
      });
      
      setOpen(false);
      resetForm();
      onCreated();
      queryClient.invalidateQueries({ queryKey: ['/api/manager/damage-claims'] });
    } catch (error) {
      toast({ title: mt("error"), description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const canProceedToEvidence = selectedBooking && 
    formData.claimTitle.length >= 5 && 
    formData.claimDescription.length >= 50 && 
    parseFloat(formData.claimedAmount) >= 10;

  const hasUnsavedClaim = Boolean(selectedBooking || formData.claimTitle.trim() || formData.claimDescription.trim() || formData.claimedAmount || pendingEvidence.length || selectedDamagedEquipment.size || newEvidenceDescription.trim() || formData.damageDate !== format(new Date(), 'yyyy-MM-dd'));
  const requestClose = () => {
    if (isUploading) return;
    if (hasUnsavedClaim) setConfirmExit(true);
    else { setOpen(false); resetForm(); }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (isOpen) setOpen(true);
      else requestClose();
    }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />{mt("newDamageClaim")}</Button>
      </DialogTrigger>
      <AppDialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {step === 'form' ? mt("createDamageClaim") : mt("addEvidence")}
          </DialogTitle>
          <DialogDescription>
            {step === 'form' 
              ? mt("fillClaimDetailsDesc")
              : mt("uploadEvidenceDesc")
            }
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 my-4">
          <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm ${step === 'form' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            <span className="w-5 h-5 rounded-full bg-background/20 flex items-center justify-center text-xs">1</span>{mt("details")}</div>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm ${step === 'evidence' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            <span className="w-5 h-5 rounded-full bg-background/20 flex items-center justify-center text-xs">2</span>{mt("evidenceSubmit")}</div>
        </div>

        {step === 'form' ? (
          <div className="space-y-4 mt-4">
            {/* Booking Selection */}
            <div className="space-y-2">
              <Label>{mt("selectBooking")}</Label>
              <p className="text-xs text-muted-foreground mb-2">
                {mt("onlyPastBookingsEligible", { days: deadlineDays })}
              </p>
              {loadingBookings ? (
                <Skeleton className="h-10 w-full" />
              ) : bookingsError ? (
                <div className="rounded-lg border border-dashed p-5 text-center">
                  <p className="text-sm text-muted-foreground">{mt("eligibleBookingsLoadFailed")}</p>
                  <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => retryBookings()}>{mt("retry")}</Button>
                </div>
              ) : recentBookings.length === 0 ? (
                <div className="p-4 border rounded-md bg-muted/50 text-center">
                  <p className="text-sm text-muted-foreground">
                    {mt("noEligibleBookingsFound", { days: deadlineDays })}
                  </p>
                </div>
              ) : (
                <Select
                  value={selectedBooking ? `${selectedBooking.type}-${selectedBooking.id}` : ''}
                  onValueChange={(value) => {
                    const [type, id] = value.split('-');
                    const booking = recentBookings.find(b => b.type === type && b.id === parseInt(id));
                    setSelectedBooking(booking || null);
                    setSelectedDamagedEquipment(new Set());
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={mt("selectABooking")} />
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
              <div className="p-3 border rounded-md bg-muted/30 space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{mt("type2")}</span>
                    <Badge variant="outline">{selectedBooking.type === 'storage' ? mt("storage") : mt("kitchen")}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{mt("chef2")}</span>
                    <span className="font-medium">{selectedBooking.chefName}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{mt("location2")}</span>
                    <span>{selectedBooking.locationName}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{mt("endDate2")}</span>
                    <span>{format(new Date(selectedBooking.endDate), 'MMM d, yyyy')}</span>
                  </div>
                </div>

                {/* Equipment Selection (Kitchen bookings only) */}
                {selectedBooking.type === 'kitchen' && selectedBooking.equipment.length > 0 && (
                  <div className="border-t pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">{mt("damagedEquipment")}</Label>
                      <span className="text-xs text-muted-foreground">{mt("optionalSelectIfApplicable")}</span>
                    </div>
                    <div className="space-y-1.5">
                      {selectedBooking.equipment.map((eq) => {
                        const isSelected = selectedDamagedEquipment.has(eq.equipmentListingId);
                        return (
                          <button
                            key={eq.equipmentListingId}
                            type="button"
                            onClick={() => {
                              setSelectedDamagedEquipment(prev => {
                                const next = new Set(prev);
                                if (next.has(eq.equipmentListingId)) {
                                  next.delete(eq.equipmentListingId);
                                } else {
                                  next.add(eq.equipmentListingId);
                                }
                                return next;
                              });
                            }}
                            className={cn(
                              "w-full flex items-center gap-2 p-2 rounded-md border text-left text-sm transition-colors",
                              isSelected
                                ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20"
                                : "border-border hover:bg-muted/50"
                            )}
                          >
                            <div className={cn(
                              "h-4 w-4 rounded border flex items-center justify-center flex-shrink-0",
                              isSelected
                                ? "border-amber-500 bg-amber-500 text-white"
                                : "border-muted-foreground/30"
                            )}>
                              {isSelected && <CheckCircle className="h-3 w-3" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="font-medium capitalize">{eq.equipmentType}</span>
                              {eq.brand && <span className="text-muted-foreground ml-1">({eq.brand})</span>}
                            </div>
                            <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                              {eq.availabilityType === 'included' ? mt("included") : mt("rented")}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                    {selectedDamagedEquipment.size > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {selectedDamagedEquipment.size} equipment item{selectedDamagedEquipment.size > 1 ? 's' : ''} marked as damaged
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>{mt("claimTitle")}</Label>
              <Input
                placeholder={mt("briefDescriptionOfTheDamage")}
                value={formData.claimTitle}
                onChange={(e) => setFormData({ ...formData, claimTitle: e.target.value })}
                minLength={5}
                maxLength={200}
              />
            </div>

            <div className="space-y-2">
              <Label>{mt("detailedDescription")}</Label>
              <Textarea
                placeholder={mt("describeTheDamageInDetailMinimum50Characters")}
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
                <Label>{mt("damageDate")}</Label>
                {/* A damage date is in the past by definition — no lower bound. */}
                <DateField
                  value={formData.damageDate}
                  onChange={(damageDate) => setFormData({ ...formData, damageDate })}
                  placeholder={mt("damageDate")}
                  minToday={false}
                />
              </div>

              <div className="space-y-2">
                <Label>{mt("claimedAmount")}</Label>
                <CurrencyInput
                  placeholder="0.00"
                  value={formData.claimedAmount}
                  onValueChange={(val) => setFormData({ ...formData, claimedAmount: val })}
                />
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={requestClose}>{mt("cancel")}</Button>
              <Button 
                type="button"
                onClick={() => setStep('evidence')}
                disabled={!canProceedToEvidence}
              >{mt("nextAddEvidence")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 mt-4">
            {/* Info Alert */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>{mt("howItWorks2")}</strong> {mt("damageClaimSubmitHowItWorks")}
              </AlertDescription>
            </Alert>

            {/* Claim Summary */}
            <div className="p-3 border rounded-md bg-muted/30 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{formData.claimTitle}</span>
                <span className="font-bold">${formData.claimedAmount}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {mt("chefBookingSummary", {
                  chef: selectedBooking?.chefName ?? "",
                  type: selectedBooking?.type === "storage" ? mt("storage") : mt("kitchen"),
                })}
              </p>
            </div>

            {/* Evidence Upload */}
            <div className="space-y-3">
              <Label>{mt("uploadEvidence")}</Label>
              
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
                  placeholder={mt("descriptionOptional2")}
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
                  <p className="text-sm font-medium">{mt("evidenceToUploadCount", { count: pendingEvidence.length })}</p>
                  {pendingEvidence.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                      {ev.preview ? (
                        <SmartImage src={ev.preview} alt="" className="w-10 h-10 object-cover rounded" />
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

            <DialogFooter className="pt-4 flex-col sm:flex-row gap-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setStep('form')}
                disabled={isUploading}
              >{mt("back")}</Button>
              <div className="flex gap-2 flex-1 justify-end">
                <Button 
                  type="button"
                  variant="secondary"
                  onClick={handleSaveAsDraft}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{mt("saving")}</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" />{mt("saveAsDraft")}</>
                  )}
                </Button>
                <Button 
                  type="button"
                  onClick={handleSubmitToChef}
                  disabled={isUploading || pendingEvidence.length < 2}
                >
                  {isUploading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{mt("submitting")}</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" />{mt("submitToChef")}</>
                  )}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </AppDialogContent>
    </Dialog>
    <UnsavedChangesDialog open={confirmExit} onOpenChange={setConfirmExit} description={mt("damageClaimUnsavedDescription")} onDiscard={() => { setConfirmExit(false); setOpen(false); resetForm(); }} />
    </>
  );
}

// Main Component
export function DamageClaimQueue() {
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [globalFilter, setGlobalFilter] = useState("");

  // Fetch claims
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['/api/manager/damage-claims', 'all'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/manager/damage-claims?includeAll=true');
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
      toast({ title: mt("claimSubmitted"), description: mt("theChefHasBeenNotified") });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/damage-claims'] });
    },
    onError: (error: Error) => {
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
    },
  });

  // Charge mutation
  const chargeMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('POST', `/api/manager/damage-claims/${id}/charge`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: mt("chargeSuccessful"), description: mt("toastChefCardCharged") });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/damage-claims'] });
    },
    onError: (error: Error) => {
      toast({ title: mt("chargeFailed2"), description: error.message, variant: "destructive" });
    },
  });

  const isProcessing = submitMutation.isPending || chargeMutation.isPending;

  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const openedOverviewClaim = useRef<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("claim");
    if (!id || openedOverviewClaim.current === id || !claims.some((claim) => claim.id === Number(id))) return;
    openedOverviewClaim.current = id;
    setSelectedClaimId(Number(id));
    setDetailDialogOpen(true);
  }, [claims]);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<number | null>(null);

  const handleView = (id: number) => {
    setSelectedClaimId(id);
    setDetailDialogOpen(true);
  };

  // Group claims by status
  const draftClaims = useMemo(() => claims.filter(c => c.status === 'draft'), [claims]);
  const pendingClaims = useMemo(() => claims.filter(c => ['submitted', 'chef_disputed', 'under_review', 'charge_pending'].includes(c.status)), [claims]);
  const actionRequiredClaims = useMemo(() => claims.filter(c => 
    ['approved', 'partially_approved', 'chef_accepted', 'charge_failed', 'escalated'].includes(c.status)
  ), [claims]);
  const resolvedClaims = useMemo(() => claims.filter(c => 
    ['charge_succeeded', 'resolved', 'rejected', 'expired'].includes(c.status)
  ), [claims]);

  // Get filtered claims based on active tab
  const filteredClaims = useMemo(() => {
    switch (activeTab) {
      case "action": return actionRequiredClaims;
      case "drafts": return draftClaims;
      case "pending": return pendingClaims;
      case "resolved": return resolvedClaims;
      default: return claims;
    }
  }, [activeTab, actionRequiredClaims, draftClaims, pendingClaims, resolvedClaims, claims]);

  // TanStack Table columns
  const columns: ColumnDef<DamageClaim>[] = useMemo(() => [
    {
      accessorKey: "createdAt",
      header: () => null,
      cell: () => null,
      enableHiding: true,
      meta: { hidden: true },
    },
    {
      id: "reference",
      header: mt("ref"),
      cell: ({ row }) => {
        const ref = row.original.referenceCode || row.original.kitchenBookingId || row.original.id;
        return (
          <div className="font-mono text-xs text-muted-foreground whitespace-nowrap">
            {ref ? `#${ref}` : "—"}
          </div>
        );
      },
    },
    {
      accessorKey: "claimTitle",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 px-2"
        >{mt("claim")}<ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const claim = row.original;
        return (
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-orange-600 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-medium truncate">{claim.claimTitle}</p>
              <p className="text-xs text-muted-foreground truncate">{claim.claimDescription}</p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "chefName",
      header: mt("chefHeader"),
      cell: ({ row }) => {
        const claim = row.original;
        return (
          <span className="text-sm">{claim.chefName || claim.chefEmail || mt("unknown")}</span>
        );
      },
    },
    {
      accessorKey: "bookingType",
      header: mt("type"),
      cell: ({ row }) => (
        <Badge variant="outline" className="capitalize">
          {row.original.bookingType}
        </Badge>
      ),
    },
    {
      accessorKey: "damageDate",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 px-2"
        >{mt("date")}<ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => format(new Date(row.original.damageDate), 'MMM d, yyyy'),
    },
    {
      accessorKey: "claimedAmountCents",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 px-2"
        >{mt("amount")}<ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const claim = row.original;
        return (
          <div className="text-right">
            <p className="font-semibold">{formatCurrency(claim.claimedAmountCents)}</p>
            {claim.finalAmountCents && claim.finalAmountCents !== claim.claimedAmountCents && (
              <p className="text-xs text-green-600">{mt("finalAmountLabel", { amount: formatCurrency(claim.finalAmountCents) })}</p>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: mt("status"),
      cell: ({ row }) => getStatusBadge(row.original.status),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const claim = row.original;
        return (
          <Button variant="outline" size="sm" onClick={() => handleView(claim.id)}>{mt("viewDetails")}</Button>
        );
      },
    },
  ], []);

  // TanStack Table instance
  const table = useReactTable({
    data: filteredClaims,
    columns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { sorting, globalFilter, columnVisibility: { createdAt: false } },
    onGlobalFilterChange: setGlobalFilter,
  });

  // Handle invoice download for charged damage claims
  const handleDownloadInvoice = async (claimId: number) => {
    setDownloadingInvoiceId(claimId);
    try {
      const response = await apiRequest('GET', `/api/manager/damage-claims/${claimId}/invoice`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to download invoice');
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

      toast({ title: mt("invoiceDownloaded2"), description: mt("damageClaimInvoiceHasBeenDownloaded") });
    } catch (error) {
      toast({ title: mt("downloadFailed2"), description: (error as Error).message, variant: "destructive" });
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4" aria-label={mt("navDamageClaims")}>
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-border shadow-sm">
        <CardContent className="py-12 text-center">
          <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <h3 className="font-semibold">{mt("damageClaimsLoadFailed")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{mt("damageClaimsLoadFailedHelp")}</p>
          <Button onClick={() => refetch()} className="mt-5" variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />{mt("retry")}</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{mt("navDamageClaims")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{mt("damageClaimsPageDescription")}</p>
        </div>
        <div className="flex gap-2">
          <CreateClaimDialog onCreated={() => refetch()} />
        </div>
      </div>

      {/* Search + Tabs */}
      {claims.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [mt("actionRequired"), actionRequiredClaims.length, "action"],
          [mt("drafts"), draftClaims.length, "drafts"],
          [mt("pendingResponse"), pendingClaims.length, "pending"],
          [mt("resolved"), resolvedClaims.length, "resolved"],
        ].map(([label, count, tab]) => <button key={tab} type="button" onClick={() => setActiveTab(String(tab))} className="rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/30">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{count}</p>
        </button>)}
      </div>}

      {claims.length > 0 && <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <Input
          placeholder={mt("searchClaims")}
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
          <TabsList className="gap-1">
            <TabsTrigger value="action" className="text-xs sm:text-sm px-2 sm:px-3 py-1.5">{mt("action")}<Badge variant="count" className="ml-1">{actionRequiredClaims.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="drafts" className="text-xs sm:text-sm px-2 sm:px-3 py-1.5">{mt("drafts")}<Badge variant="count" className="ml-1">{draftClaims.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="pending" className="text-xs sm:text-sm px-2 sm:px-3 py-1.5">{mt("pending")}<Badge variant="count" className="ml-1">{pendingClaims.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="resolved" className="text-xs sm:text-sm px-2 sm:px-3 py-1.5">{mt("resolved")}<Badge variant="count" className="ml-1">{resolvedClaims.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="all" className="text-xs sm:text-sm px-2 sm:px-3 py-1.5">{mt("filterAll")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>}

      {/* TanStack Table */}
      {filteredClaims.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center py-14 text-center">
            <FileText className="mb-4 h-9 w-9 text-muted-foreground/60" />
            <h3 className="text-lg font-semibold">{claims.length === 0 ? mt("noDamageClaimsYetTitle") : globalFilter ? mt("noResults") : mt("noClaimsInThisCategory")}</h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {claims.length === 0 ? mt("noDamageClaimsYetHelp") : globalFilter ? mt("damageClaimsClearSearchHelp") : mt("noTabClaimsFound", { tab: activeTab === "action" ? mt("action") : activeTab === "drafts" ? mt("drafts") : activeTab === "pending" ? mt("pending") : mt("resolved") })}
            </p>
            {globalFilter && <Button variant="outline" size="sm" className="mt-5" onClick={() => setGlobalFilter("")}>{mt("clearSearch")}</Button>}
            {claims.length > 0 && !globalFilter && activeTab !== "all" && <Button variant="outline" size="sm" className="mt-5" onClick={() => setActiveTab("all")}>{mt("allClaims")}</Button>}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {activeTab === "action" && mt("actionRequired")}
              {activeTab === "drafts" && mt("drafts")}
              {activeTab === "pending" && mt("pendingResponse")}
              {activeTab === "resolved" && mt("resolved")}
              {activeTab === "all" && <>{mt("allClaims")}</>}
              <Badge variant="count" className="ml-2">{filteredClaims.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MobileTableCards rows={table.getRowModel().rows} onRowClick={(claim) => handleView(claim.id)} />
            <div className="hidden rounded-md border overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} className="whitespace-nowrap text-xs sm:text-sm">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.length ? (
                    table.getRowModel().rows.map((row) => (
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleView(row.original.id)}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="text-xs sm:text-sm whitespace-nowrap" onClick={(e) => cell.column.id === "actions" && e.stopPropagation()}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={columns.length} className="h-24 text-center">{mt("noResults")}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detail Dialog for viewing claim and uploading evidence */}
      <DamageClaimDetailDialog
        claimId={selectedClaimId}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        onClaimUpdated={() => refetch()}
        onSubmit={(id) => submitMutation.mutate(id)}
        onCharge={(id) => chargeMutation.mutate(id)}
        onDownloadInvoice={handleDownloadInvoice}
        isProcessing={isProcessing || downloadingInvoiceId !== null}
      />
    </div>
  );
}

export default DamageClaimQueue;
