import { useManagerKitchenApplications } from "@/hooks/use-manager-kitchen-applications";
import ManagerHeader from "@/components/layout/ManagerHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  User,
  MapPin,
  CheckCircle,
  XCircle,
  Clock,
  Mail,
  Phone,
  Building2,
  AlertCircle,
  Loader2,
  FileText,
  Eye,
  Download,
  ChefHat,
  Briefcase,
  Calendar,
  Shield,
  Ban,
  Settings,
  ExternalLink,
  MessageCircle
} from "lucide-react";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ChatPanel from "@/components/chat/ChatPanel";
import { getConversationForApplication, createConversation } from "@/services/chat-service";

interface ManagerKitchenApplicationsProps {
  embedded?: boolean;
}

/**
 * Manager Kitchen Applications Page
 * 
 * This page shows chef applications to kitchens that the manager owns.
 * Chefs apply directly to kitchens via the KitchenApplicationForm.
 * Managers can approve/reject applications and view chef documents.
 */
export default function ManagerKitchenApplications({ embedded = false }: ManagerKitchenApplicationsProps) {
  const {
    applications,
    pendingApplications,
    approvedApplications,
    rejectedApplications,
    pendingCount,
    approvedCount,
    rejectedCount,
    isLoading,
    updateApplicationStatus,
    verifyDocuments,
    revokeAccess
  } = useManagerKitchenApplications();
  const { toast } = useToast();
  const [selectedApplication, setSelectedApplication] = useState<any | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [presignedUrls, setPresignedUrls] = useState<Record<string, string>>({});
  const [loadingUrls, setLoadingUrls] = useState<Set<string>>(new Set());
  const [showChatDialog, setShowChatDialog] = useState(false);
  const [chatApplication, setChatApplication] = useState<any | null>(null);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>({});
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

  // Fetch unread counts for all applications with conversations
  useEffect(() => {
    if (!managerId) return;

    // Combine all applications from different tabs
    const allApplications = [
      ...pendingApplications,
      ...approvedApplications,
      ...rejectedApplications,
    ];

    if (allApplications.length === 0) return;

    const fetchUnreadCounts = async () => {
      const counts: Record<number, number> = {};
      for (const app of allApplications) {
        if (app.chat_conversation_id) {
          try {
            // Get conversation and check unread count
            const conversation = await getConversationForApplication(app.id);
            if (conversation) {
              counts[app.id] = conversation.unreadManagerCount || 0;
            }
          } catch (error) {
            console.error('Error fetching unread count for application', app.id, ':', error);
          }
        }
      }
      setUnreadCounts(counts);
    };

    fetchUnreadCounts();
    // Refresh every 30 seconds
    const interval = setInterval(fetchUnreadCounts, 30000);
    return () => clearInterval(interval);
  }, [pendingApplications, approvedApplications, rejectedApplications, managerId]);

  const openChat = async (application: any) => {
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
        console.error(`Error fetching location ${application.locationId}:`, error);
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
        console.error('Error initializing chat:', error);
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

  // Function to get presigned URL for R2 files
  const getPresignedUrl = async (fileUrl: string): Promise<string> => {
    // Check if we already have a presigned URL cached
    if (presignedUrls[fileUrl]) {
      return presignedUrls[fileUrl];
    }

    // Check if URL is already being loaded
    if (loadingUrls.has(fileUrl)) {
      // Wait a bit and try again
      await new Promise(resolve => setTimeout(resolve, 100));
      return getPresignedUrl(fileUrl);
    }

    // Check if it's a public R2 URL - these don't need presigning
    if (fileUrl.includes('.r2.dev/')) {
      return fileUrl;
    }

    // Check if it's a private R2 URL (needs presigning)
    const isR2Url = fileUrl.includes('r2.cloudflarestorage.com') ||
      fileUrl.includes('files.localcooks.ca');

    if (!isR2Url) {
      // Not an R2 URL, return as-is
      return fileUrl;
    }

    try {
      setLoadingUrls(prev => new Set(prev).add(fileUrl));

      // Get auth token
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      const token = currentUser ? await currentUser.getIdToken() : null;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }



      const response = await fetch(`/api/files/r2-presigned?url=${encodeURIComponent(fileUrl)}`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to get presigned URL: ${response.statusText}`);
      }

      const data = await response.json();
      const presignedUrl = data.url || fileUrl;

      // Cache the presigned URL
      setPresignedUrls(prev => ({ ...prev, [fileUrl]: presignedUrl }));
      return presignedUrl;
    } catch (error) {
      console.error('Error getting presigned URL:', error);
      // Fallback to original URL
      return fileUrl;
    } finally {
      setLoadingUrls(prev => {
        const next = new Set(prev);
        next.delete(fileUrl);
        return next;
      });
    }
  };

  const handleApprove = async (applicationId: number) => {
    try {
      await updateApplicationStatus.mutateAsync({
        applicationId,
        status: 'approved',
        feedback: reviewFeedback || undefined,
      });
      toast({
        title: "Application Approved",
        description: "Chef's application is approved. They can book kitchens once they complete all application tiers.",
      });
      setShowReviewDialog(false);
      setSelectedApplication(null);
      setReviewFeedback("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to approve application",
        variant: "destructive",
      });
    }
  };

  const handleApproveTier2 = async (applicationId: number) => {
    try {
      await updateApplicationStatus.mutateAsync({
        applicationId,
        status: 'approved',
        currentTier: 3,
        feedback: reviewFeedback || undefined,
      });
      toast({
        title: "Step 2 Approved",
        description: "Chef has been advanced to Step 3.",
      });
      setShowReviewDialog(false);
      setSelectedApplication(null);
      setReviewFeedback("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to approve Step 2",
        variant: "destructive",
      });
    }
  };

  const handleReject = async (applicationId: number) => {
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
        applicationId,
        status: 'rejected',
        feedback: reviewFeedback,
      });
      toast({
        title: "Application Rejected",
        description: "Chef has been notified.",
      });
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

  const handleRevokeAccess = async (application: any) => {
    if (!window.confirm(`Are you sure you want to revoke ${application.fullName}'s access to ${application.location?.name || 'this location'}? They will no longer be able to complete their application tiers.`)) {
      return;
    }

    try {
      // Update the application status to rejected
      await updateApplicationStatus.mutateAsync({
        applicationId: application.id,
        status: 'rejected',
        feedback: 'Access revoked by manager',
      });

      // Also revoke the location access
      await revokeAccess.mutateAsync({
        chefId: application.chefId,
        locationId: application.locationId,
      });

      toast({
        title: "Access Revoked",
        description: "Chef access has been revoked successfully.",
      });
      setShowReviewDialog(false);
      setSelectedApplication(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to revoke access",
        variant: "destructive",
      });
    }
  };

  const openReviewDialog = (application: any) => {
    setSelectedApplication(application);
    setShowReviewDialog(true);
    setReviewFeedback(application.feedback || "");
  };

  // Parse business description JSON
  const parseBusinessInfo = (description: string | null | undefined) => {
    if (!description) return null;
    try {
      return JSON.parse(description);
    } catch {
      return { description };
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#208D80] mx-auto mb-4" />
          <p className="text-gray-600">Loading applications...</p>
        </div>
      </div>
    );
  }

  const content = (
    <>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Chef Applications</h1>
            <p className="text-gray-600">
              Review and manage chef applications to your kitchen locations.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              // Navigate to settings with application requirements tab
              const url = new URL(window.location.href);
              url.pathname = '/manager/booking-dashboard';
              url.searchParams.set('view', 'settings');
              url.searchParams.set('tab', 'application-requirements');
              window.location.href = url.toString();
            }}
            className="flex items-center gap-2"
          >
            <Settings className="h-4 w-4" />
            Configure Application Requirements
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-blue-900 font-medium mb-1">Customize Application Requirements</p>
              <p className="text-xs text-blue-700">
                Control which fields are required when chefs apply to your kitchens. You can make fields optional to streamline the application process.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Pending Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{approvedCount}</div>
            <p className="text-xs text-gray-500 mt-1">Can book kitchens</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Rejected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{rejectedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabbed Application Views */}
      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="h-4 w-4" />
            Pending ({pendingCount})
          </TabsTrigger>
          <TabsTrigger value="approved" className="gap-2">
            <CheckCircle className="h-4 w-4" />
            Approved ({approvedCount})
          </TabsTrigger>
          <TabsTrigger value="rejected" className="gap-2">
            <XCircle className="h-4 w-4" />
            Rejected ({rejectedCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {pendingApplications.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingApplications.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  onReview={() => openReviewDialog(application)}
                  onOpenChat={() => openChat(application)}
                  unreadCount={unreadCounts[application.id] || 0}
                  parseBusinessInfo={parseBusinessInfo}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">All Caught Up!</h3>
                <p className="text-gray-600">No pending applications to review.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="approved">
          {approvedApplications.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {approvedApplications.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  onReview={() => openReviewDialog(application)}
                  onOpenChat={() => openChat(application)}
                  unreadCount={unreadCounts[application.id] || 0}
                  parseBusinessInfo={parseBusinessInfo}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Approved Applications</h3>
                <p className="text-gray-600">Approved chef applications will appear here.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="rejected">
          {rejectedApplications.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rejectedApplications.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  onReview={() => openReviewDialog(application)}
                  onOpenChat={() => openChat(application)}
                  unreadCount={unreadCounts[application.id] || 0}
                  parseBusinessInfo={parseBusinessInfo}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Rejected Applications</h3>
                <p className="text-gray-600">Rejected applications will appear here.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChefHat className="h-5 w-5 text-[#208D80]" />
              Review Chef Application
            </DialogTitle>
            <DialogDescription>
              Review the chef's application details and documents.
            </DialogDescription>
          </DialogHeader>

          {selectedApplication && (
            <div className="space-y-6">
              {/* Location */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Building2 className="h-4 w-4" />
                  <span className="font-medium">Applying to:</span>
                  <span>{selectedApplication.location?.name || 'Unknown Location'}</span>
                </div>
              </div>

              {/* Personal Info */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Personal Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <div className="text-xs text-gray-500 mb-1">Full Name</div>
                    <div className="font-medium">{selectedApplication.fullName}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <div className="text-xs text-gray-500 mb-1">Email</div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-3 w-3 text-gray-400" />
                      <span className="font-medium text-sm">{selectedApplication.email}</span>
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <div className="text-xs text-gray-500 mb-1">Phone</div>
                    <div className="flex items-center gap-2">
                      <Phone className="h-3 w-3 text-gray-400" />
                      <span className="font-medium">{selectedApplication.phone}</span>
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <div className="text-xs text-gray-500 mb-1">Applied</div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3 w-3 text-gray-400" />
                      <span className="font-medium">{new Date(selectedApplication.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Business Info */}
              {selectedApplication.businessDescription && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Briefcase className="h-4 w-4" />
                    Business Information
                  </h3>
                  <div className="p-4 bg-[#208D80]/5 rounded-lg border border-[#208D80]/20">
                    {(() => {
                      const info = parseBusinessInfo(selectedApplication.businessDescription);
                      if (!info) return <p className="text-gray-600">No business information provided.</p>;

                      return (
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          {info.businessName && (
                            <div>
                              <span className="text-gray-500">Business:</span>
                              <span className="ml-2 font-medium">{info.businessName}</span>
                            </div>
                          )}
                          {info.businessType && (
                            <div>
                              <span className="text-gray-500">Type:</span>
                              <span className="ml-2 font-medium capitalize">{info.businessType}</span>
                            </div>
                          )}
                          {info.experience && (
                            <div>
                              <span className="text-gray-500">Experience:</span>
                              <span className="ml-2 font-medium">{info.experience} years</span>
                            </div>
                          )}
                          {info.usageFrequency && (
                            <div>
                              <span className="text-gray-500">Frequency:</span>
                              <span className="ml-2 font-medium capitalize">{info.usageFrequency}</span>
                            </div>
                          )}
                          {info.sessionDuration && (
                            <div>
                              <span className="text-gray-500">Session Length:</span>
                              <span className="ml-2 font-medium">{info.sessionDuration} hours</span>
                            </div>
                          )}
                          {info.description && (
                            <div className="col-span-2 pt-2 border-t">
                              <span className="text-gray-500">Description:</span>
                              <p className="mt-1 text-gray-700">{info.description}</p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Documents */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Food Safety Documents
                </h3>
                <div className="space-y-3">
                  {/* Food Safety License */}
                  <div className={`flex items-center justify-between p-4 rounded-lg border ${selectedApplication.foodSafetyLicenseUrl
                    ? 'bg-green-50 border-green-200'
                    : 'bg-gray-50 border-gray-200'
                    }`}>
                    <div className="flex items-center gap-3">
                      <FileText className={`h-5 w-5 ${selectedApplication.foodSafetyLicenseUrl ? 'text-green-600' : 'text-gray-400'}`} />
                      <div>
                        <p className="font-medium text-gray-900">Food Handler Certificate</p>
                        <p className="text-xs text-gray-500">
                          {selectedApplication.foodSafetyLicense === 'yes' ? 'Has certificate' : 'Certificate status: ' + selectedApplication.foodSafetyLicense}
                        </p>
                      </div>
                    </div>
                    {selectedApplication.foodSafetyLicenseUrl && (
                      <div className="flex gap-2">
                        <a
                          href={presignedUrls[selectedApplication.foodSafetyLicenseUrl] ||
                            ((selectedApplication.foodSafetyLicenseUrl?.includes('r2.cloudflarestorage.com') || selectedApplication.foodSafetyLicenseUrl?.includes('files.localcooks.ca'))
                              ? `/api/files/r2-proxy?url=${encodeURIComponent(selectedApplication.foodSafetyLicenseUrl)}`
                              : selectedApplication.foodSafetyLicenseUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 hover:bg-green-100 rounded-lg transition-colors"
                          title="View document"
                          onClick={async (e) => {
                            e.preventDefault();
                            const url = selectedApplication.foodSafetyLicenseUrl;
                            if (!url) return;

                            // Open window immediately to prevent popup blocker
                            const newWindow = window.open('', '_blank');

                            try {
                              // If it's a local file URL, add token
                              if (url.startsWith('/api/files/documents/') && !presignedUrls[url]) {
                                const { getAuthenticatedFileUrl } = await import('@/utils/r2-url-helper');
                                const authenticatedUrl = await getAuthenticatedFileUrl(url);
                                if (newWindow) newWindow.location.href = authenticatedUrl;
                                return;
                              }

                              // If it's an R2 URL, get presigned URL
                              if (!presignedUrls[url] && (url.includes('r2.cloudflarestorage.com') || url.includes('files.localcooks.ca'))) {
                                const presignedUrl = await getPresignedUrl(url);
                                if (newWindow) newWindow.location.href = presignedUrl;
                                return;
                              }

                              // Fallback
                              if (newWindow) {
                                newWindow.location.href = presignedUrls[url] ||
                                  ((url.includes('r2.cloudflarestorage.com') || url.includes('files.localcooks.ca'))
                                    ? `/api/files/r2-proxy?url=${encodeURIComponent(url)}`
                                    : url);
                              }
                            } catch (error) {
                              console.error('Error opening document:', error);
                              if (newWindow) newWindow.close();
                              toast({
                                title: "Error",
                                description: "Failed to open document",
                                variant: "destructive"
                              });
                            }
                          }}
                        >
                          {loadingUrls.has(selectedApplication.foodSafetyLicenseUrl) ? (
                            <Loader2 className="h-4 w-4 text-green-600 animate-spin" />
                          ) : (
                            <Eye className="h-4 w-4 text-green-600" />
                          )}
                        </a>
                        <a
                          href={presignedUrls[selectedApplication.foodSafetyLicenseUrl] ||
                            ((selectedApplication.foodSafetyLicenseUrl?.includes('r2.cloudflarestorage.com') || selectedApplication.foodSafetyLicenseUrl?.includes('files.localcooks.ca'))
                              ? `/api/files/r2-proxy?url=${encodeURIComponent(selectedApplication.foodSafetyLicenseUrl)}`
                              : selectedApplication.foodSafetyLicenseUrl)}
                          download
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Download document"
                          onClick={async (e) => {
                            e.preventDefault();
                            const url = selectedApplication.foodSafetyLicenseUrl;
                            if (!url) return;

                            // Open window immediately
                            const a = document.createElement('a');

                            try {
                              // If it's a local file URL, add token
                              if (url.startsWith('/api/files/documents/') && !presignedUrls[url]) {
                                const { getAuthenticatedFileUrl } = await import('@/utils/r2-url-helper');
                                const authenticatedUrl = await getAuthenticatedFileUrl(url);
                                a.href = authenticatedUrl;
                                a.download = '';
                                a.click();
                                return;
                              }

                              // If it's an R2 URL, get presigned URL
                              if (!presignedUrls[url] && (url.includes('r2.cloudflarestorage.com') || url.includes('files.localcooks.ca'))) {
                                const presignedUrl = await getPresignedUrl(url);
                                a.href = presignedUrl;
                                a.download = '';
                                a.click();
                                return;
                              }

                              // Fallback
                              a.href = presignedUrls[url] ||
                                ((url.includes('r2.cloudflarestorage.com') || url.includes('files.localcooks.ca'))
                                  ? `/api/files/r2-proxy?url=${encodeURIComponent(url)}`
                                  : url);
                              a.download = '';
                              a.click();
                            } catch (error) {
                              console.error('Error downloading document:', error);
                              toast({
                                title: "Error",
                                description: "Failed to download document",
                                variant: "destructive"
                              });
                            }
                          }}
                        >
                          {loadingUrls.has(selectedApplication.foodSafetyLicenseUrl) ? (
                            <Loader2 className="h-4 w-4 text-gray-600 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4 text-gray-600" />
                          )}
                        </a>
                      </div>
                    )}
                  </div>


                </div>
              </div>

              {/* Tier 2 Documents Section - Show when Tier 2 is completed */}
              {selectedApplication.tier2_completed_at && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Step 2 Documents
                    {selectedApplication.current_tier === 2 && (
                      <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300 ml-2">
                        Awaiting Review
                      </Badge>
                    )}
                    {selectedApplication.current_tier >= 3 && (
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 ml-2">
                        Approved
                      </Badge>
                    )}
                  </h3>
                  <div className="space-y-3">
                    <div className="text-xs text-gray-500 mb-2">
                      Submitted: {new Date(selectedApplication.tier2_completed_at).toLocaleDateString()}
                    </div>

                    {/* Insurance Document */}
                    {(() => {
                      const tierData = selectedApplication.tier_data || {};
                      const tierFiles = tierData.tierFiles || {};
                      const insuranceUrl = tierFiles.tier2_insurance_document;

                      return insuranceUrl ? (
                        <div className="flex items-center justify-between p-4 rounded-lg border bg-purple-50 border-purple-200">
                          <div className="flex items-center gap-3">
                            <FileText className="h-5 w-5 text-purple-600" />
                            <div>
                              <p className="font-medium text-gray-900">Insurance Document</p>
                              <p className="text-xs text-gray-500">Uploaded with Step 2 submission</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <a
                              href={presignedUrls[insuranceUrl] ||
                                ((insuranceUrl.includes('r2.cloudflarestorage.com') || insuranceUrl.includes('files.localcooks.ca'))
                                  ? `/api/files/r2-proxy?url=${encodeURIComponent(insuranceUrl)}`
                                  : insuranceUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 hover:bg-purple-100 rounded-lg transition-colors"
                              title="View document"
                              onClick={async (e) => {
                                const url = insuranceUrl;
                                if (!url) return;

                                // If it's a local file URL, add token
                                if (url.startsWith('/api/files/documents/') && !presignedUrls[url]) {
                                  e.preventDefault();
                                  const { getAuthenticatedFileUrl } = await import('@/utils/r2-url-helper');
                                  const authenticatedUrl = await getAuthenticatedFileUrl(url);
                                  window.open(authenticatedUrl, '_blank');
                                  return;
                                }

                                // If it's an R2 URL, get presigned URL
                                if (!presignedUrls[url] && (url.includes('r2.cloudflarestorage.com') || url.includes('files.localcooks.ca'))) {
                                  e.preventDefault();
                                  const presignedUrl = await getPresignedUrl(url);
                                  window.open(presignedUrl, '_blank');
                                }
                              }}
                            >
                              {loadingUrls.has(insuranceUrl) ? (
                                <Loader2 className="h-4 w-4 text-purple-600 animate-spin" />
                              ) : (
                                <Eye className="h-4 w-4 text-purple-600" />
                              )}
                            </a>
                            <a
                              href={presignedUrls[insuranceUrl] ||
                                ((insuranceUrl.includes('r2.cloudflarestorage.com') || insuranceUrl.includes('files.localcooks.ca'))
                                  ? `/api/files/r2-proxy?url=${encodeURIComponent(insuranceUrl)}`
                                  : insuranceUrl)}
                              download
                              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                              title="Download document"
                              onClick={async (e) => {
                                const url = insuranceUrl;
                                if (!url) return;

                                // If it's a local file URL, add token
                                if (url.startsWith('/api/files/documents/') && !presignedUrls[url]) {
                                  e.preventDefault();
                                  const { getAuthenticatedFileUrl } = await import('@/utils/r2-url-helper');
                                  const authenticatedUrl = await getAuthenticatedFileUrl(url);
                                  const a = document.createElement('a');
                                  a.href = authenticatedUrl;
                                  a.download = '';
                                  a.click();
                                  return;
                                }

                                // If it's an R2 URL, get presigned URL
                                if (!presignedUrls[url] && (url.includes('r2.cloudflarestorage.com') || url.includes('files.localcooks.ca'))) {
                                  e.preventDefault();
                                  const presignedUrl = await getPresignedUrl(url);
                                  const a = document.createElement('a');
                                  a.href = presignedUrl;
                                  a.download = '';
                                  a.click();
                                }
                              }}
                            >
                              {loadingUrls.has(insuranceUrl) ? (
                                <Loader2 className="h-4 w-4 text-gray-600 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4 text-gray-600" />
                              )}
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center p-4 rounded-lg border bg-gray-50 border-gray-200">
                          <FileText className="h-5 w-5 text-gray-400 mr-3" />
                          <div>
                            <p className="font-medium text-gray-900">Insurance Document</p>
                            <p className="text-xs text-gray-500">Not uploaded</p>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Food Establishment Certificate from Tier 2 (if different from Tier 1) */}
                    {selectedApplication.foodEstablishmentCertUrl && selectedApplication.current_tier >= 2 && (
                      <div className="flex items-center justify-between p-4 rounded-lg border bg-blue-50 border-blue-200">
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-blue-600" />
                          <div>
                            <p className="font-medium text-gray-900">Food Establishment Certificate</p>
                            <p className="text-xs text-gray-500">
                              {selectedApplication.foodEstablishmentCertExpiry
                                ? `Expires: ${new Date(selectedApplication.foodEstablishmentCertExpiry).toLocaleDateString()}`
                                : 'Step 2 requirement'}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <a
                            href={presignedUrls[selectedApplication.foodEstablishmentCertUrl] ||
                              ((selectedApplication.foodEstablishmentCertUrl.includes('r2.cloudflarestorage.com') || selectedApplication.foodEstablishmentCertUrl.includes('files.localcooks.ca'))
                                ? `/api/files/r2-proxy?url=${encodeURIComponent(selectedApplication.foodEstablishmentCertUrl)}`
                                : selectedApplication.foodEstablishmentCertUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                            title="View document"
                            onClick={async (e) => {
                              const url = selectedApplication.foodEstablishmentCertUrl;
                              if (!url) return;

                              // If it's a local file URL, add token
                              if (url.startsWith('/api/files/documents/') && !presignedUrls[url]) {
                                e.preventDefault();
                                const { getAuthenticatedFileUrl } = await import('@/utils/r2-url-helper');
                                const authenticatedUrl = await getAuthenticatedFileUrl(url);
                                window.open(authenticatedUrl, '_blank');
                                return;
                              }

                              // If it's an R2 URL, get presigned URL
                              if (!presignedUrls[url] && (url.includes('r2.cloudflarestorage.com') || url.includes('files.localcooks.ca'))) {
                                e.preventDefault();
                                const presignedUrl = await getPresignedUrl(url);
                                window.open(presignedUrl, '_blank');
                              }
                            }}
                          >
                            {loadingUrls.has(selectedApplication.foodEstablishmentCertUrl) ? (
                              <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                            ) : (
                              <Eye className="h-4 w-4 text-blue-600" />
                            )}
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Feedback */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Feedback {selectedApplication.status === 'inReview' ? '(Required for rejection)' : '(Optional)'}
                </label>
                <Textarea
                  value={reviewFeedback}
                  onChange={(e) => setReviewFeedback(e.target.value)}
                  placeholder="Provide feedback for the applicant..."
                  rows={4}
                  className="w-full"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowReviewDialog(false);
                    setSelectedApplication(null);
                    setReviewFeedback("");
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                {selectedApplication.status === 'inReview' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleReject(selectedApplication.id)}
                      disabled={updateApplicationStatus.isPending || !reviewFeedback.trim()}
                      className="flex-1 border-red-300 text-red-700 hover:bg-red-50"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Reject
                    </Button>
                    <Button
                      onClick={() => handleApprove(selectedApplication.id)}
                      disabled={updateApplicationStatus.isPending}
                      className="flex-1 bg-[#208D80] hover:bg-[#1A7470]"
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Approve
                    </Button>
                  </>
                )}
                {selectedApplication.status === 'approved' && (
                  <Button
                    variant="outline"
                    onClick={() => handleRevokeAccess(selectedApplication)}
                    disabled={updateApplicationStatus.isPending || revokeAccess.isPending}
                    className="flex-1 border-red-300 text-red-700 hover:bg-red-50"
                  >
                    <Ban className="mr-2 h-4 w-4" />
                    Revoke Access
                  </Button>
                )}
                {selectedApplication.status === 'approved' && selectedApplication.current_tier === 2 && selectedApplication.tier2_completed_at && (
                  <Button
                    onClick={() => handleApproveTier2(selectedApplication.id)}
                    disabled={updateApplicationStatus.isPending}
                    className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Approve Step 2
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Chat Dialog */}
      <Dialog open={showChatDialog} onOpenChange={setShowChatDialog}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
          {chatApplication && chatConversationId && managerId && (
            <ChatPanel
              conversationId={chatConversationId}
              applicationId={chatApplication.id}
              chefId={chatApplication.chefId}
              managerId={managerId}
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
              }}
              embedded={true}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <ManagerHeader />
      <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          {content}
        </div>
      </main>
    </div>
  );
}

// Application Card Component
function ApplicationCard({
  application,
  onReview,
  onOpenChat,
  unreadCount = 0,
  parseBusinessInfo
}: {
  application: any;
  onReview: () => void;
  onOpenChat?: () => void;
  unreadCount?: number;
  parseBusinessInfo: (desc: string | null | undefined) => any;
}) {
  const businessInfo = parseBusinessInfo(application.businessDescription);

  const getStatusBadge = () => {
    switch (application.status) {
      case 'inReview':
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'approved':
        // Check if Tier 2 is awaiting review (chef submitted but current_tier still 2)
        if (application.current_tier === 2 && application.tier2_completed_at) {
          return (
            <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300">
              <Clock className="h-3 w-3 mr-1" />
              Step 2 Pending
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
            <CheckCircle className="h-3 w-3 mr-1" />
            Approved
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#208D80]/10 flex items-center justify-center">
              <ChefHat className="h-5 w-5 text-[#208D80]" />
            </div>
            <div>
              <CardTitle className="text-base">{application.fullName}</CardTitle>
              {businessInfo?.businessName && (
                <CardDescription className="text-xs">{businessInfo.businessName}</CardDescription>
              )}
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {application.location && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Building2 className="h-4 w-4" />
            <span>{application.location.name}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Mail className="h-4 w-4" />
          <span className="truncate">{application.email}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Phone className="h-4 w-4" />
          <span>{application.phone}</span>
        </div>

        {/* Document Indicators */}
        <div className="flex items-center gap-2 pt-2">
          {application.foodSafetyLicenseUrl && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded text-xs">
              <FileText className="h-3 w-3" />
              Certificate
            </span>
          )}
          {application.foodEstablishmentCertUrl && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">
              <FileText className="h-3 w-3" />
              License
            </span>
          )}
        </div>

        <div className="text-xs text-gray-500 pt-2 border-t">
          Applied: {new Date(application.createdAt).toLocaleDateString()}
        </div>

        <div className="flex gap-2 mt-2">
          <Button
            onClick={onReview}
            className={`flex-1 ${application.status === 'inReview'
              ? 'bg-[#208D80] hover:bg-[#1A7470]'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            variant={application.status === 'inReview' ? 'default' : 'outline'}
          >
            {application.status === 'inReview' ? 'Review Application' : 'View Details'}
          </Button>
          {(application.status === 'approved' || application.status === 'inReview') && (application.chat_conversation_id || onOpenChat) && (
            <Button
              onClick={onOpenChat}
              variant="outline"
              className="relative"
              title="Open Chat"
            >
              <MessageCircle className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

