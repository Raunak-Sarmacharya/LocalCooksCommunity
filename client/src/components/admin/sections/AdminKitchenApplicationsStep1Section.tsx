import { logger } from "@/lib/logger";
import { useAdminKitchenApplications } from "@/hooks/use-admin-kitchen-applications";
import { useToast } from "@/hooks/use-toast";
import {
  ExternalLink,
  Loader2,
  Shield,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import ChatPanel from "@/components/chat/ChatPanel";
import { getConversationForApplication, createConversation } from "@/services/chat-service";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

// New Modular Imports
import { ApplicationsTable } from "../../manager/applications";
import { Application } from "../../manager/applications/types";

interface ManagerKitchenApplicationsProps {
  embedded?: boolean;
  locationId?: number;
}

const humanizeKey = (key: string) =>
  key.replace(/^custom_/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

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
    refetch,
  } = useAdminKitchenApplications();

  const { toast } = useToast();
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [showDocumentsDialog, setShowDocumentsDialog] = useState(false);
  const [documentsApplication, setDocumentsApplication] = useState<Application | null>(null);

  const [showChatDialog, setShowChatDialog] = useState(false);
  const [chatApplication, setChatApplication] = useState<Application | null>(null);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [chatLocationName, setChatLocationName] = useState<string | null>(null);

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
    if (!managerId) {
      toast({
        title: "Error",
        description: "Unable to identify manager. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }

    setChatApplication(application);

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
        }
      } catch (error) {
        logger.error(`Error fetching location ${application.locationId}:`, error);
      }
    }
    setChatLocationName(locationName || null);

    // Get or create conversation
    let conversationId = application.chat_conversation_id;
    if (!conversationId) {
      try {
        // Try to get existing conversation
        const existing = await getConversationForApplication(application.id);
        if (existing) {
          conversationId = existing.id;
        } else {
          // Create new conversation
          conversationId = await createConversation(
            application.id,
            application.chefId,
            managerId,
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

    setChatConversationId(conversationId);
    setShowChatDialog(true);
  };

  // Filter by location if provided
  const filteredApplications = applications.filter((a) => !locationId || a.locationId === locationId);

  const handleApprove = async () => {
    if (!selectedApplication) return;

    try {
      // Step 1 (request-to-apply) approval: set status approved, keep tier at 1.
      // Chef UI unlocks Step 2 when status===approved && current_tier===1.
      // Managers then approve Step 2 (tier → 3) so the chef can book.
      await updateApplicationStatus.mutateAsync({
        applicationId: selectedApplication.id,
        status: "approved",
        feedback: reviewFeedback || undefined,
      });
      toast({
        title: "Request to apply approved",
        description: "Chef can now upload kitchen documents.",
      });

      setShowReviewDialog(false);
      setSelectedApplication(null);
      setReviewFeedback("");
      refetch();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to approve application",
        variant: "destructive",
      });
    }
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
      case "approved":
        return <Badge variant="outline" className="text-green-600 border-green-300">Verified</Badge>;
      case "rejected":
        return <Badge variant="outline" className="text-red-600 border-red-300">Rejected</Badge>;
      default:
        return null;
    }
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
      />

      {/* Chat Dialog */}
      <Dialog open={showChatDialog} onOpenChange={setShowChatDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
          {chatApplication && chatConversationId && (
            <ChatPanel
              conversationId={chatConversationId}
              applicationId={chatApplication.id}
              chefId={chatApplication.chefId}
              managerId={managerId!}
              locationId={chatApplication.locationId}
              locationName={
                chatApplication.location?.name ||
                chatLocationName ||
                (chatApplication.locationId ? `Location #${chatApplication.locationId}` : "Unknown Location")
              }
              onClose={() => {
                setShowChatDialog(false);
                setChatApplication(null);
                setChatConversationId(null);
                setChatLocationName(null);
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
            <Button
              variant="success"
              onClick={handleApprove}
              disabled={updateApplicationStatus.isPending}
            >
              {updateApplicationStatus.isPending ? "Processing..." : "Approve"}
            </Button>
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
              {documentsApplication.foodSafetyLicenseUrl && (
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-blue-600" />
                      <span className="font-medium">Food Safety License</span>
                    </div>
                    {getDocStatusBadge(documentsApplication.foodSafetyLicenseStatus)}
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={documentsApplication.foodSafetyLicenseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm">
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    </a>
                  </div>
                </div>
              )}
              {documentsApplication.foodEstablishmentCertUrl && (
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-blue-600" />
                      <span className="font-medium">Establishment Cert</span>
                    </div>
                    {getDocStatusBadge(documentsApplication.foodEstablishmentCertStatus)}
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={documentsApplication.foodEstablishmentCertUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm">
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
