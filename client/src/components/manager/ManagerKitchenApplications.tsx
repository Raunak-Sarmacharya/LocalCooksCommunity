import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { useManagerKitchenApplications } from "@/hooks/use-manager-kitchen-applications";
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

// New Modular Imports
import { ApplicationsTable } from "./applications";
import { Application } from "./applications/types";
import { tt } from "@/i18n/common-ns";

interface ManagerKitchenApplicationsProps {
  embedded?: boolean;
  locationId?: number;
}

export default function ManagerKitchenApplications({
  embedded = false,
  locationId,
}: ManagerKitchenApplicationsProps) {
  
  const {
    applications,
    isLoading,
    updateApplicationStatus,
    refetch,
  } = useManagerKitchenApplications();

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
      if (!currentUser) throw new Error(tt("notAuthenticated"));
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/firebase/user/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!response.ok) throw new Error(tt("failedToGetUserInfo"));
      return response.json();
    },
  });

  const managerId = managerInfo?.id || null;

  const openChat = async (application: Application) => {
    if (!managerId) {
      toast({ title: mt("error"),
        description: mt("unableToIdentifyManagerPleaseRefreshThePage"),
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
        toast({ title: mt("error"),
          description: mt("failedToOpenChatPleaseTryAgain"),
          variant: "destructive",
        });
        return;
      }
    }

    setChatConversationId(conversationId);
    setShowChatDialog(true);
  };

  // Filter by location if provided
  const filteredApplications = locationId
    ? applications.filter((a) => a.locationId === locationId)
    : applications;

  const handleApprove = async () => {
    if (!selectedApplication) return;

    try {
      const currentTier = selectedApplication.current_tier ?? 1;
      const nextTier = currentTier + 1;
      const isFinalTier = nextTier > 4;

      if (isFinalTier) {
        await updateApplicationStatus.mutateAsync({
          applicationId: selectedApplication.id,
          status: "approved",
          feedback: reviewFeedback || undefined,
        });
        toast({ title: mt("applicationFullyApproved"),
          description: mt("toastChefApplicationFullyApproved"),
        });
      } else {
        await updateApplicationStatus.mutateAsync({
          applicationId: selectedApplication.id,
          status: "inReview",
          feedback: reviewFeedback || undefined,
          currentTier: nextTier,
        });
        toast({
          title: `Tier ${currentTier} Approved!`,
          description: `Application progressed to Tier ${nextTier}.`,
        });
      }

      setShowReviewDialog(false);
      setSelectedApplication(null);
      setReviewFeedback("");
    } catch (error: any) {
      toast({ title: mt("error"),
        description: error.message || "Failed to approve application",
        variant: "destructive",
      });
    }
  };

  const handleReject = async () => {
    if (!selectedApplication) return;

    if (!reviewFeedback.trim()) {
      toast({ title: mt("feedbackRequired"),
        description: mt("pleaseProvideFeedbackWhenRejectingAnApplication"),
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
      toast({ title: mt("applicationRejected"),
        description: mt("chefHasBeenNotified"),
      });
      setShowReviewDialog(false);
      setSelectedApplication(null);
      setReviewFeedback("");
    } catch (error: any) {
      toast({ title: mt("error"),
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
        return <Badge variant="outline" className="text-yellow-600 border-yellow-300">{mt("pending")}</Badge>;
      case "approved":
        return <Badge variant="outline" className="text-green-600 border-green-300">{mt("verified")}</Badge>;
      case "rejected":
        return <Badge variant="outline" className="text-red-600 border-red-300">{mt("rejected")}</Badge>;
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{mt("reviewApplication")}</DialogTitle>
            <DialogDescription>
              Review {selectedApplication?.fullName}'s application for{" "}
              {selectedApplication?.location?.name}
            </DialogDescription>
          </DialogHeader>

          {selectedApplication && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">{mt("email2")}</span>
                  <span>{selectedApplication.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{mt("phone2")}</span>
                  <span>{selectedApplication.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{mt("kitchenType")}</span>
                  <span className="capitalize">{selectedApplication.kitchenPreference}</span>
                </div>
              </div>

              {selectedApplication.businessDescription && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">{mt("businessDescription")}</p>
                  <p className="text-sm text-gray-600 p-3 bg-gray-50 rounded-lg">
                    {selectedApplication.businessDescription}
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">{mt("feedbackRequiredForRejection")}</label>
                <Textarea
                  value={reviewFeedback}
                  onChange={(e) => setReviewFeedback(e.target.value)}
                  placeholder={mt("enterFeedback")}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex flex-col items-stretch sm:flex-row sm:items-center gap-2">
            {selectedApplication?.current_tier === 1 ? (
              <div className="flex flex-1 items-center justify-between">
                <Badge variant="outline" className="bg-yellow-100 text-yellow-800">{mt("awaitingAdminApproval")}</Badge>
                <Button variant="outline" onClick={() => setShowReviewDialog(false)}>{mt("close")}</Button>
              </div>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowReviewDialog(false)}>{mt("cancel")}</Button>
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
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Documents Dialog */}
      <Dialog open={showDocumentsDialog} onOpenChange={setShowDocumentsDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{mt("applicationDocuments")}</DialogTitle>
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
                      <span className="font-medium">{mt("foodSafetyLicense")}</span>
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
                        <ExternalLink className="h-4 w-4 mr-1" />{mt("view")}</Button>
                    </a>
                  </div>
                </div>
              )}
              {documentsApplication.foodEstablishmentCertUrl && (
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-blue-600" />
                      <span className="font-medium">{mt("establishmentCert")}</span>
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
                        <ExternalLink className="h-4 w-4 mr-1" />{mt("view")}</Button>
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
