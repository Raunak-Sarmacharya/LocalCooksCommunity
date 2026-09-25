import { logger } from "@/lib/logger";
import { useAdminKitchenApplications } from "@/hooks/use-admin-kitchen-applications";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield } from "lucide-react";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import ChatPanel from "@/components/chat/ChatPanel";
import { getConversationForApplication, createConversation, getLiveChatParticipants } from "@/services/chat-service";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SecureDocumentLink } from "@/components/common/SecureDocumentLink";
import { VerifiedDocumentChip } from "@/components/common/VerifiedDocumentChip";
import { KitchenDocumentApprovalDialog, getKitchenDocumentApprovalPlan, type KitchenDocumentField } from "@/components/common/KitchenDocumentApprovalDialog";

// New Modular Imports
import { ApplicationsTable } from "../../manager/applications";
import { Application } from "../../manager/applications/types";

interface ManagerKitchenApplicationsProps {
  embedded?: boolean;
  locationId?: number;
}

const humanizeKey = (key: string) =>
  key.replace(/^custom_/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/**
 * Which approval the admin is actually being asked for.
 *
 * There are two distinct stages and they are easy to confuse:
 *   step1 — the request to apply itself (tier stays 1, chef can upload documents)
 *   step2 — Kitchen Coordination (tier -> 3, chef can book)
 *
 * Step 2 is only reachable once the chef has submitted their documents
 * (`tier2_completed_at`), because the admin needs something to review. Choosing
 * the stage here keeps it out of the UI, so the admin sees one "Approve" rather
 * than having to reason about tiers.
 */
type ApprovalStage = "step1" | "step2";

function resolveApprovalStage(application: Application | null): ApprovalStage | null {
  if (!application) return null;
  const tier = application.current_tier ?? 1;
  const hasStep2 = !!application.tier2_completed_at;

  // Kitchen Coordination has been submitted and is waiting on the admin.
  if (application.status === "approved" && tier === 2 && hasStep2) return "step2";
  // The request to apply has not been decided yet.
  if (application.status === "inReview") return "step1";
  // Approved at tier 1 but documents not submitted yet — nothing to approve.
  return null;
}

function ApplicationData({ data }: { data: unknown }) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const entries = Object.entries(data as Record<string, unknown>).filter(([, value]) => value !== "" && value != null);
  if (!entries.length) return null;
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0 rounded-lg border bg-background p-3">
          <dt className="text-xs font-medium text-muted-foreground">{humanizeKey(key)}</dt>
          <dd className="mt-1 break-words text-sm text-foreground">
            {Array.isArray(value)
              ? value.join(", ")
              : typeof value === "boolean"
                ? value ? "Yes" : "No"
                : typeof value === "object"
                  ? <ApplicationData data={value} />
                  : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AdminKitchenApplicationsStep1Section({
  embedded = false,
  locationId,
}: ManagerKitchenApplicationsProps) {
  const {
    applications,
    isLoading,
    updateApplicationStatus,
    verifyDocuments,
    refetch,
  } = useAdminKitchenApplications();

  const { toast } = useToast();
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [showDocumentsDialog, setShowDocumentsDialog] = useState(false);
  const [documentsApplication, setDocumentsApplication] = useState<Application | null>(null);
  const [approvalApplication, setApprovalApplication] = useState<Application | null>(null);
  const [approvalIssues, setApprovalIssues] = useState<string[]>([]);
  const [approvalDocuments, setApprovalDocuments] = useState<{ field: KitchenDocumentField; label: string }[]>([]);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [isCombinedApproving, setIsCombinedApproving] = useState(false);

  const [showChatDialog, setShowChatDialog] = useState(false);
  const [chatApplication, setChatApplication] = useState<Application | null>(null);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [chatLocationName, setChatLocationName] = useState<string | null>(null);
  // The manager of the kitchen this thread belongs to.
  //
  // The admin is a *third* participant here, not a party to the conversation.
  // `managerId` below (from /api/firebase/user/me) is the admin's OWN user id —
  // passing that to ChatPanel made every admin reply land in the thread as if
  // the kitchen manager had written it. This holds the real manager so the
  // conversation stays attributed correctly while the panel still labels the
  // admin as "Local Cooks".
  const [chatManagerId, setChatManagerId] = useState<number | null>(null);
  // Whether the thread being opened is dormant because a participant's account
  // was deleted. Admins inherit the same read-only state as everyone else —
  // there is no one on the other end for them to reply to either.
  const [chatUnavailable, setChatUnavailable] = useState(false);
  const [chatUnavailableRole, setChatUnavailableRole] = useState<'chef' | 'manager' | 'admin' | 'user' | undefined>(undefined);

  // Get manager ID from API
  const { data: managerInfo } = useQuery({
    queryKey: ['/api/firebase/user/me'],
    queryFn: async () => {
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/firebase/user/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to get user info');
      return response.json();
    },
  });

  const managerId = managerInfo?.id || null;

  const openChat = async (application: Application) => {
    // Settings the conversation's real manager matters: the manager is the
    // counterpart a chef expects to see, and the person a manager-side reply
    // belongs to. `managerId` (the admin's own id) is only a last-resort
    // fallback so the panel still has *something* to key on.
    const resolvedManagerId = application.location?.managerId ?? managerId;

    setChatApplication(application);
    setChatManagerId(resolvedManagerId ?? null);

    // Fetch location name if not available in application
    let locationName = application.location?.name;
    if (!locationName && application.locationId) {
      try {
        const locationResponse = await fetch(`/api/public/locations/${application.locationId}/details`, {
          credentials: 'include',
        });
        if (locationResponse.ok) {
          const locationData = await locationResponse.json();
          locationName = locationData?.name || null;
          // The public details endpoint also carries the manager id, so a
          // conversation can still be attributed correctly when the admin
          // list payload predates this field.
          if (!application.location?.managerId && locationData?.managerId) {
            setChatManagerId(locationData.managerId);
          }
        }
      } catch (error) {
        logger.error(`Error fetching location ${application.locationId}:`, error);
      }
    }
    setChatLocationName(locationName || null);

    // Get or create conversation
    let conversationId = application.chat_conversation_id;
    // Read alongside the id so the panel knows up-front whether the thread is
    // dormant (participant deleted) and must open read-only.
    let conversationUnavailable = false;
    let conversationUnavailableRole: 'chef' | 'manager' | 'admin' | 'user' | undefined;
    if (!conversationId) {
      try {
        // Try to get existing conversation
        const existing = await getConversationForApplication(application.id);
        if (existing) {
          conversationId = existing.id;
          conversationUnavailable = existing.unavailable === true;
          conversationUnavailableRole = existing.unavailableRole;
        } else {
          if (!resolvedManagerId) {
            // A brand-new conversation is keyed to the manager who owns the
            // kitchen. Creating one without them would mint a thread nobody can
            // legitimately belong to, so fail loudly rather than write it wrong.
            toast({
              title: "Error",
              description: "This kitchen has no manager assigned, so a conversation can't be started yet.",
              variant: "destructive",
            });
            setChatApplication(null);
            setChatManagerId(null);
            return;
          }
          // Create new conversation, keyed to the KITCHEN's manager — not the
          // admin who happens to be opening it.
          conversationId = await createConversation(
            application.id,
            application.chefId,
            resolvedManagerId,
            application.locationId
          );
        }
      } catch (error) {
        logger.error('Error initializing chat:', error);
        toast({
          title: "Error",
          description: "Failed to open chat. Please try again.",
          variant: "destructive",
        });
        return;
      }
    }

    // Reconcile against who actually still has an account. The stored flag only
    // covers deletions after it shipped, so a thread orphaned earlier would
    // otherwise open as if it were live.
    const liveParticipants = await getLiveChatParticipants([application.chefId, resolvedManagerId ?? 0]);
    if (liveParticipants) {
      if (!liveParticipants.has(application.chefId)) {
        conversationUnavailable = true;
        conversationUnavailableRole = 'chef';
      } else if (resolvedManagerId && !liveParticipants.has(resolvedManagerId)) {
        conversationUnavailable = true;
        conversationUnavailableRole = 'manager';
      }
    }

    setChatConversationId(conversationId);
    setChatUnavailable(conversationUnavailable);
    setChatUnavailableRole(conversationUnavailableRole);
    setShowChatDialog(true);
  };

  // Filter by location if provided
  const filteredApplications = applications.filter((a) => !locationId || a.locationId === locationId);

  const handleApprove = async (application: Application | null = selectedApplication, stageOverride?: ApprovalStage, verifyFields?: KitchenDocumentField[]) => {
    if (!application) return;
    const stage = stageOverride ?? resolveApprovalStage(application);
    if (!stage) return;

    if (stage === "step2" && !verifyFields) {
      const requirements = await fetch(`/api/public/locations/${application.locationId}/requirements`).then((response) => response.ok ? response.json() : null).catch(() => null);
      const plan = getKitchenDocumentApprovalPlan(application, requirements);
      if (plan.issues.length || plan.toVerify.length) {
        setApprovalApplication(application);
        setApprovalIssues(plan.issues);
        setApprovalDocuments(plan.toVerify);
        setShowApprovalDialog(true);
        return;
      }
    }

    try {
      if (stage === "step2") {
        // Kitchen Coordination: status stays approved, tier moves to 3 so the
        // chef can book. This is the action that used to live only in the
        // documents modal.
        await updateApplicationStatus.mutateAsync({
          applicationId: application.id,
          status: "approved",
          currentTier: 3,
          feedback: reviewFeedback || undefined,
          verifyDocuments: verifyFields,
        });
        toast({
          title: "Kitchen Coordination approved",
          description: "The chef can now book this kitchen.",
        });
      } else {
        // Step 1 (request-to-apply): set status approved, keep tier at 1.
        // Chef UI unlocks Step 2 when status===approved && current_tier===1.
        await updateApplicationStatus.mutateAsync({
          applicationId: application.id,
          status: "approved",
          feedback: reviewFeedback || undefined,
        });
        toast({
          title: "Request to apply approved",
          description: "Chef can now upload kitchen documents.",
        });
      }

      setShowReviewDialog(false);
      setSelectedApplication(null);
      setShowDocumentsDialog(false);
      setDocumentsApplication(null);
      setShowApprovalDialog(false);
      setApprovalApplication(null);
      setReviewFeedback("");
      refetch();
    } catch (error: any) {
      if (stage === "step2") {
        setApprovalApplication(application);
        setApprovalIssues(String(error.message || "Could not approve this application.").split('; ').filter(Boolean));
        setApprovalDocuments([]);
        setShowApprovalDialog(true);
      } else {
        toast({ title: "Error", description: error.message || "Failed to approve application", variant: "destructive" });
      }
    }
  };

  const handleVerifyAndApprove = async () => {
    if (!approvalApplication || !approvalDocuments.length) return;
    setIsCombinedApproving(true);
    try {
      await handleApprove(approvalApplication, "step2", approvalDocuments.map(({ field }) => field));
    } finally {
      setIsCombinedApproving(false);
    }
  };

  /**
   * Verifies one of the two kitchen documents. Reads its target from the
   * documents dialog when open, otherwise from the review dialog, so the same
   * control works from either surface.
   */
  const reviewKitchenDocument = (field: 'foodSafetyLicenseStatus' | 'foodEstablishmentCertStatus', status: 'approved' | 'rejected') => {
    const target = documentsApplication ?? selectedApplication;
    if (!target) return;
    verifyDocuments.mutate({ applicationId: target.id, [field]: status }, {
      onSuccess: () => {
        // Update whichever state object is currently driving the visible surface.
        if (documentsApplication) setDocumentsApplication({ ...documentsApplication, [field]: status });
        if (selectedApplication && selectedApplication.id === target.id) {
          setSelectedApplication({ ...selectedApplication, [field]: status });
        }
        toast({ title: status === 'approved' ? 'Document verified' : 'Document needs a replacement' });
      },
      onError: (error) => toast({ title: error.message, variant: 'destructive' }),
    });
  };

  /**
   * Row-menu entry point. Confirms first, because approving from a dropdown is
   * easy to hit by accident and Kitchen Coordination immediately lets the chef
   * book and spend money — unlike the dialog path, there is no review step here.
   */
  const handleApproveStageFromRow = (application: Application) => {
    const stage = resolveApprovalStage(application);
    if (!stage) return;

    const label = stage === "step2"
      ? `Approve Kitchen Coordination for ${application.fullName}? They will be able to book this kitchen.`
      : `Approve ${application.fullName}'s request to apply? They will be able to upload kitchen documents.`;
    if (stage === "step1" && !window.confirm(label)) return;

    void handleApprove(application, stage);
  };

  const handleReject = async () => {
    if (!selectedApplication) return;

    if (!reviewFeedback.trim()) {
      toast({
        title: "Feedback Required",
        description: "Please provide feedback when rejecting an application.",
        variant: "destructive",
      });
      return;
    }

    try {
      await updateApplicationStatus.mutateAsync({
        applicationId: selectedApplication.id,
        status: "rejected",
        feedback: reviewFeedback,
      });
      toast({
        title: "Application updated",
        description: "Status successfully updated",
      });
      refetch();
      setShowReviewDialog(false);
      setSelectedApplication(null);
      setReviewFeedback("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to reject application",
        variant: "destructive",
      });
    }
  };

  const openReviewDialog = (application: Application) => {
    if ((application.current_tier ?? 1) === 2 && application.tier2_completed_at) {
      setDocumentsApplication(application);
      setShowDocumentsDialog(true);
      return;
    }
    setSelectedApplication(application);
    setReviewFeedback(application.feedback || "");
    setShowReviewDialog(true);
  };

  const openDocumentsDialog = (application: Application) => {
    setDocumentsApplication(application);
    setShowDocumentsDialog(true);
  };

  function getDocStatusBadge(status: string) {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="text-yellow-600 border-yellow-300">Pending</Badge>;
      case "rejected":
        return <Badge variant="outline" className="text-red-600 border-red-300">Rejected</Badge>;
      default:
        return null;
    }
  }

  /**
   * The two kitchen documents plus their verify actions.
   *
   * Shared by the review dialog and the documents modal so the admin can verify
   * a licence from either entry point without bouncing between them — previously
   * these controls only existed inside the documents modal.
   */
  function renderDocumentReview(application: Application) {
    const busy = verifyDocuments.isPending;

    return (
      <div className="space-y-3">
        {application.foodSafetyLicenseUrl && (
          <div className="rounded-lg border p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600" />
                <span className="font-medium">Food Safety License</span>
              </div>
              <VerifiedDocumentChip status={application.foodSafetyLicenseStatus} url={application.foodSafetyLicenseUrl} expiry={application.foodSafetyLicenseExpiry} />
              {application.foodSafetyLicenseStatus === "approved" && application.foodSafetyLicenseExpiry && Date.parse(application.foodSafetyLicenseExpiry) < Date.now() - 86400000
                ? <Badge variant="outline">Expired</Badge>
                : application.foodSafetyLicenseStatus !== "approved" && getDocStatusBadge(application.foodSafetyLicenseStatus)}
            </div>
            <SecureDocumentLink url={application.foodSafetyLicenseUrl} label="View" showIcon={false} />
            {application.foodSafetyLicenseExpiry && (
              <p className="mt-1 text-xs text-muted-foreground">
                Expires {new Date(application.foodSafetyLicenseExpiry).toLocaleDateString()}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                disabled={busy || application.foodSafetyLicenseStatus === "approved"}
                onClick={() => reviewKitchenDocument("foodSafetyLicenseStatus", "approved")}
              >
                Verify certificate
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || application.foodSafetyLicenseStatus === "rejected"}
                onClick={() => reviewKitchenDocument("foodSafetyLicenseStatus", "rejected")}
              >
                Request replacement
              </Button>
            </div>
          </div>
        )}

        {application.foodEstablishmentCertUrl && (
          <div className="rounded-lg border p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600" />
                <span className="font-medium">Establishment Cert</span>
              </div>
              <VerifiedDocumentChip status={application.foodEstablishmentCertStatus} url={application.foodEstablishmentCertUrl} expiry={application.foodEstablishmentCertExpiry} />
              {application.foodEstablishmentCertStatus === "approved" && application.foodEstablishmentCertExpiry && Date.parse(application.foodEstablishmentCertExpiry) < Date.now() - 86400000
                ? <Badge variant="outline">Expired</Badge>
                : application.foodEstablishmentCertStatus !== "approved" && getDocStatusBadge(application.foodEstablishmentCertStatus)}
            </div>
            <SecureDocumentLink url={application.foodEstablishmentCertUrl} label="View" showIcon={false} />
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                disabled={busy || application.foodEstablishmentCertStatus === "approved"}
                onClick={() => reviewKitchenDocument("foodEstablishmentCertStatus", "approved")}
              >
                Verify licence
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || application.foodEstablishmentCertStatus === "rejected"}
                onClick={() => reviewKitchenDocument("foodEstablishmentCertStatus", "rejected")}
              >
                Request replacement
              </Button>
            </div>
          </div>
        )}

        {!application.foodSafetyLicenseUrl && !application.foodEstablishmentCertUrl && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No documents have been uploaded yet. The chef provides these after the request to apply is approved.
          </p>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <ApplicationsTable
        data={filteredApplications}
        isLoading={isLoading}
        onApprove={openReviewDialog}
        onReject={openReviewDialog}
        onOpenChat={openChat}
        onViewDocuments={openDocumentsDialog}
        onReview={openReviewDialog}
        // Approves the stage the row is actually waiting on (Step 1 or Kitchen
        // Coordination) without opening a dialog first.
        onApproveStage={handleApproveStageFromRow}
      />

      {/* Chat Dialog */}
      <KitchenDocumentApprovalDialog
        open={showApprovalDialog}
        onOpenChange={setShowApprovalDialog}
        issues={approvalIssues}
        toVerify={approvalDocuments}
        onVerifyAndApprove={handleVerifyAndApprove}
        processing={isCombinedApproving || verifyDocuments.isPending || updateApplicationStatus.isPending}
      />
      <Dialog open={showChatDialog} onOpenChange={setShowChatDialog}>
        <DialogContent showCloseButton={false} className="max-w-4xl h-[80vh] flex flex-col p-0">
          {chatApplication && chatConversationId && (
            <ChatPanel
              conversationId={chatConversationId}
              applicationId={chatApplication.id}
              chefId={chatApplication.chefId}
              // The kitchen's real manager, NOT the admin viewing it. The panel
              // needs this identity to distinguish "who else is in this thread"
              // from "who am I". It used to be handed the admin's own user id,
              // which made the admin indistinguishable from the manager and let
              // Local Cooks replies masquerade as the kitchen's.
              managerId={chatManagerId ?? 0}
              locationId={chatApplication.locationId}
              // From Local Cooks' seat the counterpart is the chef, so name them
              // rather than leaving the header on a generic "Chef".
              chefName={chatApplication.fullName || chatApplication.chef?.username || undefined}
              locationName={
                chatApplication.location?.name ||
                chatLocationName ||
                (chatApplication.locationId ? `Location #${chatApplication.locationId}` : "Unknown Location")
              }
              // Identifies this viewer as the Local Cooks team so useChat can
              // attribute sends and mark-as-read correctly. Without it the admin
              // matched neither chefId nor managerId and the panel was inert.
              viewerRole="admin"
              adminName="Local Cooks"
              unavailable={chatUnavailable}
              unavailableRole={chatUnavailableRole}
              onClose={() => {
                setShowChatDialog(false);
                setChatApplication(null);
                setChatConversationId(null);
                setChatLocationName(null);
                setChatManagerId(null);
                setChatUnavailable(false);
                setChatUnavailableRole(undefined);
                refetch();
              }}
              embedded={true}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[90vh] overflow-hidden p-0">
          <div className="border-b px-6 py-5">
          <DialogHeader>
            <DialogTitle>Review Application</DialogTitle>
            <DialogDescription>
              Review {selectedApplication?.fullName}'s application for{" "}
              {selectedApplication?.location?.name}
            </DialogDescription>
          </DialogHeader>
          </div>

          {selectedApplication && (
            <ScrollArea className="max-h-[calc(90vh-190px)]">
            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Email</p><p className="mt-1 break-all text-sm font-medium">{selectedApplication.email}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Phone</p><p className="mt-1 text-sm font-medium">{selectedApplication.phone || "On chef profile"}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Kitchen type</p><p className="mt-1 text-sm font-medium capitalize">{selectedApplication.kitchenPreference}</p></div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Food safety licence</p>
                <p className="mt-1 text-sm font-medium">
                  {selectedApplication.foodSafetyLicense === "yes"
                    ? "Chef says they have a licence"
                    : selectedApplication.foodSafetyLicense === "no"
                      ? "Chef does not have a licence"
                      : "Chef is not sure"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The licence document is collected after the request to apply is approved.
                </p>
              </div>

              {selectedApplication.businessDescription && (
                <div>
                  <p className="mb-2 text-sm font-semibold">Business information</p>
                  {(() => {
                    try { return <ApplicationData data={JSON.parse(selectedApplication.businessDescription)} />; }
                    catch { return <p className="rounded-lg border p-3 text-sm text-muted-foreground">{selectedApplication.businessDescription}</p>; }
                  })()}
                </div>
              )}

              <div>
                <p className="mb-2 text-sm font-semibold">Application answers</p>
                <ApplicationData data={selectedApplication.customFieldsData} />
                {!selectedApplication.customFieldsData && <p className="text-sm text-muted-foreground">No additional answers submitted.</p>}
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Feedback (required for rejection)
                </label>
                <Textarea
                  value={reviewFeedback}
                  onChange={(e) => setReviewFeedback(e.target.value)}
                  placeholder="Enter feedback..."
                  rows={3}
                />
              </div>

              {/* Documents sit here too, so the admin can verify a licence and
                  approve without opening a second dialog. Previously these
                  controls were only reachable from the documents modal. */}
              <div>
                <p className="mb-2 text-sm font-semibold">
                  Documents
                  {resolveApprovalStage(selectedApplication) === "step2" && (
                    <span className="ml-2 font-normal text-muted-foreground">Kitchen Coordination</span>
                  )}
                </p>
                {renderDocumentReview(selectedApplication)}

                {resolveApprovalStage(selectedApplication) === "step2" && (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Approving now moves this chef to Kitchen Coordination and lets them book the kitchen.
                  </p>
                )}
              </div>
            </div>
            </ScrollArea>
          )}

          <DialogFooter className="border-t bg-background px-6 py-4 flex gap-2">
            <Button variant="outline" onClick={() => setShowReviewDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={updateApplicationStatus.isPending}
            >
              {updateApplicationStatus.isPending ? "Processing..." : "Reject"}
            </Button>
            {/* One Approve control for whichever stage is pending — the stage is
                resolved from tier + tier2_completed_at rather than shown as a
                separate "Kitchen Coordination" button the admin has to map to a tier. */}
            {resolveApprovalStage(selectedApplication) && (
              <Button
                variant="default"
                onClick={() => handleApprove()}
                disabled={updateApplicationStatus.isPending}
              >
                {updateApplicationStatus.isPending
                  ? "Processing..."
                  : resolveApprovalStage(selectedApplication) === "step2"
                    ? "Approve Kitchen Coordination"
                    : "Approve"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Documents Dialog */}
      <Dialog open={showDocumentsDialog} onOpenChange={setShowDocumentsDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Application Documents</DialogTitle>
            <DialogDescription>
              Review documents submitted by {documentsApplication?.fullName}
            </DialogDescription>
          </DialogHeader>

          {documentsApplication && (
            <div className="space-y-4">
              {/* Same shared block the review dialog renders, so the two surfaces
                  cannot drift apart. */}
              {renderDocumentReview(documentsApplication)}
              {resolveApprovalStage(documentsApplication) === "step2" && (
                <div className="border-t pt-4">
                  <p className="mb-3 text-sm text-muted-foreground">Once the kitchen documents meet the requirements, approve this step to allow booking.</p>
                  <Button
                    disabled={verifyDocuments.isPending || updateApplicationStatus.isPending}
                    onClick={() => handleApprove(documentsApplication, "step2")}
                  >
                    {updateApplicationStatus.isPending ? "Processing..." : "Approve Kitchen Coordination"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
