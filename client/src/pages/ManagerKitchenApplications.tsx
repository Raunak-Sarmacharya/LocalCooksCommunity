/**
 * Manager Kitchen Applications Page - Enterprise Edition
 * 
 * This file re-exports the V2 implementation with enhanced UI/UX:
 * - TanStack Table with sorting, filtering, and column visibility
 * - Sheet-based detail panel (replaces modal for better UX)
 * - Step 1/Step 2 tabbed navigation in detail view
 * - Real-time unread chat indicators
 * - Enterprise-grade styling inspired by Notion
 * 
 * The V2 implementation is in ManagerKitchenApplicationsV2.tsx
 */

// Re-export the V2 implementation as the default
export { default } from "./ManagerKitchenApplicationsV2";

// Re-export the Content component for use in ManagerBookingDashboard
export { ManagerKitchenApplicationsContent } from "./ManagerKitchenApplicationsV2";

// =============================================================================
// LEGACY CODE BELOW - Kept for reference during transition
// This code is no longer used but preserved for rollback if needed
// =============================================================================

import { useManagerKitchenApplications } from "@/hooks/use-manager-kitchen-applications";
import { ManagerPageLayout } from "@/components/layout/ManagerPageLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  User,
  Check,
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
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Separator } from "@/components/ui/separator";
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
import UnifiedChatView from "@/components/chat/UnifiedChatView";
import { getConversationForApplication, createConversation } from "@/services/chat-service";


import { useLocation } from "wouter";
import { SecureDocumentLink } from "@/components/common/SecureDocumentLink";
import { parseBusinessInfo } from "@/utils/parseBusinessInfo";

/**
 * @deprecated Legacy Manager Kitchen Applications Page - Use default export instead
 * 
 * This page shows chef applications to kitchens that the manager owns.
 * Chefs apply directly to kitchens via the KitchenApplicationForm.
 * Managers can approve/reject applications and view chef documents.
 */
function ManagerKitchenApplicationsLegacy() {
  const [, setLocation] = useLocation();
  return (
    <ManagerPageLayout
      title="Chef Applications"
      description="Review and manage chef applications to your kitchen locations."
      showKitchenSelector={false} // Applications are currently location-based, so kitchen filter is not needed. [BUSINESS LOGIC]
    >
      {({ selectedLocationId, isLoading: isLayoutLoading }) => (
        <ManagerKitchenApplicationsContentLegacy
          selectedLocationId={selectedLocationId}
          isLayoutLoading={isLayoutLoading}
          setLocation={setLocation}
        />
      )}
    </ManagerPageLayout>
  );
}

function ManagerKitchenApplicationsContentLegacy({
  selectedLocationId,
  isLayoutLoading,
  setLocation
}: {
  selectedLocationId: number | null,
  isLayoutLoading: boolean,
  setLocation: (path: string) => void
}) {
  const {
    applications,
    isLoading,
    updateApplicationStatus,
    revokeAccess
  } = useManagerKitchenApplications();

  const { toast } = useToast();
  const [selectedApplication, setSelectedApplication] = useState<any | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState("");

  const [showChatDialog, setShowChatDialog] = useState(false);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>({});

  // Business Logic: Filter applications by location if selected
  // Memoize to prevent unnecessary re-renders and infinite loops
  const filteredApplications = useMemo(() => {
    return selectedLocationId
      ? applications.filter(a => a.locationId === selectedLocationId)
      : applications;
  }, [applications, selectedLocationId]);

  // Re-derive filtered sets for tabs based on location filter
  // Memoize these as well to prevent re-creation on every render
  //
  // Application lifecycle (2 steps):
  // 1. Chef submits application -> status='inReview', current_tier=1
  // 2. Manager approves Step 1 -> status='approved', current_tier=1 (Step 1 Approved, awaiting chef Step 2 submission)
  // 3. Chef submits Step 2 docs -> status='approved', current_tier=2, tier2_completed_at set (Step 2 Needs Review)
  // 4. Manager approves Step 2 -> status='approved', current_tier=3 (Fully Approved, can book)
  //
  const isStep2NeedsReview = useCallback(
    (a: any) => a.status === 'approved' && a.current_tier === 2 && !!a.tier2_completed_at,
    []
  );

  const isStep1ApprovedAwaitingStep2 = useCallback(
    (a: any) => a.status === 'approved' && (a.current_tier ?? 1) === 1,
    []
  );

  const isFullyApproved = useCallback(
    (a: any) => a.status === 'approved' && (a.current_tier ?? 1) >= 3,
    []
  );

  const { pendingApplications, awaitingStep2Applications, fullyApprovedApplications, rejectedApplications } = useMemo(() => {
    // Pending Review: New applications OR Step 2 submitted needing manager review
    const pending = filteredApplications.filter(
      (a) => a.status === "inReview" || isStep2NeedsReview(a)
    );

    // Awaiting Step 2: Manager approved Step 1, waiting for chef to submit Step 2
    const awaitingStep2 = filteredApplications.filter((a) => isStep1ApprovedAwaitingStep2(a));

    // Fully Approved: Both steps complete, can book kitchens
    const fullyApproved = filteredApplications.filter((a) => isFullyApproved(a));

    const rejected = filteredApplications.filter(
      (a) => a.status === "rejected"
    );

    return {
      pendingApplications: pending,
      awaitingStep2Applications: awaitingStep2,
      fullyApprovedApplications: fullyApproved,
      rejectedApplications: rejected,
    };
  }, [filteredApplications, isStep2NeedsReview, isStep1ApprovedAwaitingStep2, isFullyApproved]);

  const pendingCount = pendingApplications.length;
  const awaitingStep2Count = awaitingStep2Applications.length;
  const fullyApprovedCount = fullyApprovedApplications.length;
  const rejectedCount = rejectedApplications.length;

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

  // Create a stable key for applications to prevent infinite re-renders
  // Only re-fetch when the actual application IDs or their conversation IDs change
  const applicationIdsKey = useMemo(() => {
    return filteredApplications
      .map(app => `${app.id}:${app.chat_conversation_id || 'none'}`)
      .sort()
      .join(',');
  }, [filteredApplications]);

  // Track if we're currently fetching to prevent concurrent fetches
  const isFetchingRef = useRef(false);
  const lastFetchKeyRef = useRef<string>('');

  // Use ref to access current filteredApplications without adding to dependencies
  const filteredApplicationsRef = useRef(filteredApplications);
  filteredApplicationsRef.current = filteredApplications;

  // Fetch unread counts for all applications with conversations
  useEffect(() => {
    if (!managerId) return;
    if (!applicationIdsKey) return; // No applications

    // Prevent duplicate fetches for the same data
    const currentKey = `${managerId}:${applicationIdsKey}`;
    if (currentKey === lastFetchKeyRef.current && isFetchingRef.current) {
      return;
    }

    const fetchUnreadCounts = async () => {
      // Prevent concurrent fetches
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      lastFetchKeyRef.current = currentKey;

      try {
        const counts: Record<number, number> = {};

        // Access current applications via ref to avoid dependency issues
        const currentApps = filteredApplicationsRef.current;

        // Only fetch for applications that have conversations
        const appsWithConversations = currentApps.filter(app => app.chat_conversation_id);

        if (appsWithConversations.length === 0) {
          isFetchingRef.current = false;
          return;
        }

        // Use Promise.allSettled for better error handling and parallel fetching
        const results = await Promise.allSettled(
          appsWithConversations.map(async (app) => {
            try {
              const conversation = await getConversationForApplication(app.id);
              return { appId: app.id, count: conversation?.unreadManagerCount || 0 };
            } catch (error) {
              console.error('Error fetching unread count for application', app.id, ':', error);
              return { appId: app.id, count: 0 };
            }
          })
        );

        results.forEach((result) => {
          if (result.status === 'fulfilled') {
            counts[result.value.appId] = result.value.count;
          }
        });

        // Only update state if counts actually changed to prevent unnecessary re-renders
        setUnreadCounts(prevCounts => {
          const prevKeys = Object.keys(prevCounts);
          const newKeys = Object.keys(counts);

          // Check if counts actually changed
          if (prevKeys.length !== newKeys.length) {
            return counts;
          }

          const hasChanges = newKeys.some(
            key => prevCounts[Number(key)] !== counts[Number(key)]
          );

          return hasChanges ? counts : prevCounts;
        });
      } finally {
        isFetchingRef.current = false;
      }
    };

    fetchUnreadCounts();

    // Refresh every 30 seconds
    const interval = setInterval(fetchUnreadCounts, 30000);
    return () => {
      clearInterval(interval);
      isFetchingRef.current = false;
    };
  }, [managerId, applicationIdsKey]); // Only depend on stable values

  const openChat = async (application: any) => {
    if (!managerId) {
      toast({
        title: "Error",
        description: "Unable to identify manager. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }

    // Get or create conversation
    let conversationId = application.chat_conversation_id;

    // Check service if local state is missing it
    if (!conversationId) {
      try {
        const existing = await getConversationForApplication(application.id);
        if (existing) {
          conversationId = existing.id;
        }
      } catch (e) {
        console.error("Error looking up conversation:", e);
      }
    }

    if (!conversationId) {
      try {
        // Create new conversation (now safe/idempotent)
        conversationId = await createConversation(
          application.id,
          application.chefId,
          managerId,
          application.locationId
        );
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

  // Fetch location requirements for the selected application to display custom fields
  const { data: locationRequirements } = useQuery({
    queryKey: [`/api/public/locations/${selectedApplication?.locationId}/requirements`],
    queryFn: async () => {
      if (!selectedApplication?.locationId) return null;
      const response = await fetch(`/api/public/locations/${selectedApplication.locationId}/requirements`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!selectedApplication?.locationId && showReviewDialog,
  });

  // Helper to render custom field value based on type
  const renderCustomFieldValue = (field: any, value: any) => {
    if (value === undefined || value === null || value === '') return <span className="text-gray-400 italic">Not provided</span>;

    if (field.type === 'checkbox') {
      if (Array.isArray(value)) {
        return <span className="font-medium">{value.join(', ')}</span>;
      }
      return <span className="font-medium">{value ? 'Yes' : 'No'}</span>;
    }
    if (field.type === 'date') {
      return <span className="font-medium">{new Date(value).toLocaleDateString()}</span>;
    }
    return <span className="font-medium">{String(value)}</span>;
  };

  if (isLoading || isLayoutLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-48 w-full rounded-xl" />
            ))}
          </div>
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
              setLocation('/manager/dashboard?view=settings&tab=application-requirements');
            }}
            className="flex items-center gap-2"
          >
            <Settings className="h-4 w-4" />
            Configure Application Requirements
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
        <div className="mt-4 p-3 bg-primary/5 border border-primary/10 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-foreground font-medium mb-1">Customize Application Requirements</p>
              <p className="text-xs text-muted-foreground">
                Control which fields are required when chefs apply to your kitchens. You can make fields optional to streamline the application process.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Awaiting Step 2</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{awaitingStep2Count}</div>
            <p className="text-xs text-gray-500 mt-1">Chat enabled</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{fullyApprovedCount}</div>
            <p className="text-xs text-gray-500 mt-1">Can book kitchens</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Rejected</CardTitle>
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
          <TabsTrigger value="awaiting-tier2" className="gap-2">
            <Clock className="h-4 w-4" />
            Awaiting Step 2 ({awaitingStep2Count})
          </TabsTrigger>
          <TabsTrigger value="approved" className="gap-2">
            <CheckCircle className="h-4 w-4" />
            Approved ({fullyApprovedCount})
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
                <p className="text-muted-foreground">No pending applications to review.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="awaiting-tier2">
          {awaitingStep2Applications.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {awaitingStep2Applications.map((application) => (
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
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Applications Awaiting Step 2</h3>
                <p className="text-muted-foreground">Chefs who passed Step 1 and still need to submit Step 2 will appear here.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="approved">
          {fullyApprovedApplications.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {fullyApprovedApplications.map((application) => (
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
                <p className="text-muted-foreground">Fully approved chef applications will appear here.</p>
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
                <p className="text-muted-foreground">Rejected applications will appear here.</p>
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
              <ChefHat className="h-5 w-5 text-primary" />
              Review Chef Application
            </DialogTitle>
            <DialogDescription>
              Review the chef&apos;s application details and documents.
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
                  <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
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

              {/* ========== STEP 1 SECTION ========== */}
              <div className="border-2 border-blue-200 rounded-lg p-4 bg-blue-50/30">
                <div className="flex items-center gap-2 mb-4">
                  <Badge variant="info">
                    Step 1: Initial Application
                  </Badge>
                  {selectedApplication.tier1_completed_at && (
                    <span className="text-xs text-gray-500">
                      Submitted: {new Date(selectedApplication.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {/* Step 1 Documents */}
                <div className="mb-4">
                  <h4 className="font-medium text-gray-800 mb-2 flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Food Safety Documents
                  </h4>
                  <div className="space-y-2">
                    {/* Food Safety License */}
                    <div className={`flex items-center justify-between p-3 rounded-lg border ${selectedApplication.foodSafetyLicenseUrl
                      ? 'bg-green-50 border-green-200'
                      : 'bg-gray-50 border-gray-200'
                      }`}>
                      <div className="flex items-center gap-3">
                        <FileText className={`h-4 w-4 ${selectedApplication.foodSafetyLicenseUrl ? 'text-green-600' : 'text-gray-400'}`} />
                        <div>
                          <p className="font-medium text-gray-900 text-sm">Food Handler Certificate</p>
                          <p className="text-xs text-gray-500">
                            {selectedApplication.foodSafetyLicense === 'yes' ? 'Has certificate' : 'Certificate status: ' + selectedApplication.foodSafetyLicense}
                          </p>
                        </div>
                      </div>
                      {selectedApplication.foodSafetyLicenseUrl && (
                        <SecureDocumentLink
                          url={selectedApplication.foodSafetyLicenseUrl}
                          fileName="Food Handler Certificate"
                          label="Download"
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Step 1 Custom Fields */}
                {locationRequirements?.tier1_custom_fields &&
                  Array.isArray(locationRequirements.tier1_custom_fields) &&
                  locationRequirements.tier1_custom_fields.length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-800 mb-2 flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Additional Step 1 Information
                      </h4>
                      <div className="grid grid-cols-2 gap-3">
                        {locationRequirements.tier1_custom_fields.map((field: any) => {
                          const customData = selectedApplication.customFieldsData || {};
                          const value = customData[field.id];
                          return (
                            <div key={field.id} className="p-3 bg-white rounded-lg border border-gray-200">
                              <div className="text-xs text-gray-500 mb-1">{field.label}</div>
                              {renderCustomFieldValue(field, value)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </div>

              {/* ========== STEP 2 SECTION ========== */}
              {selectedApplication.tier2_completed_at && (
                <div className="border-2 border-orange-200 rounded-lg p-4 bg-orange-50/30">
                  <div className="flex items-center gap-2 mb-4">
                    <Badge variant="warning">
                      Step 2: Kitchen Coordination
                    </Badge>
                    {selectedApplication.current_tier === 2 && (
                      <Badge variant="warning">
                        Awaiting Review
                      </Badge>
                    )}
                    {selectedApplication.current_tier >= 3 && (
                      <Badge variant="success">
                        Approved
                      </Badge>
                    )}
                    <span className="text-xs text-gray-500 ml-auto">
                      Submitted: {new Date(selectedApplication.tier2_completed_at).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Step 2 Documents */}
                  <div className="mb-4">
                    <h4 className="font-medium text-gray-800 mb-2 flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Step 2 Documents
                    </h4>
                    <div className="space-y-2">
                      {/* Insurance Document */}
                      {(() => {
                        const tierData = selectedApplication.tier_data || {};
                        const tierFiles = tierData.tierFiles || {};
                        const insuranceUrl = tierFiles.tier2_insurance_document;

                        return insuranceUrl ? (
                          <div className="flex items-center justify-between p-3 rounded-lg border bg-purple-50 border-purple-200">
                            <div className="flex items-center gap-3">
                              <FileText className="h-4 w-4 text-purple-600" />
                              <div>
                                <p className="font-medium text-gray-900 text-sm">Insurance Document</p>
                                <p className="text-xs text-gray-500">Uploaded with Step 2 submission</p>
                              </div>
                            </div>
                            <SecureDocumentLink
                              url={insuranceUrl}
                              fileName="Insurance Document"
                              label="Download"
                            />
                          </div>
                        ) : locationRequirements?.tier2_insurance_document_required ? (
                          <div className="flex items-center p-3 rounded-lg border bg-red-50 border-red-200">
                            <FileText className="h-4 w-4 text-red-400 mr-3" />
                            <div>
                              <p className="font-medium text-red-900 text-sm">Insurance Document</p>
                              <p className="text-xs text-red-600">Required but not uploaded</p>
                            </div>
                          </div>
                        ) : null;
                      })()}

                      {/* Food Establishment Certificate */}
                      {selectedApplication.foodEstablishmentCertUrl && (
                        <div className="flex items-center justify-between p-3 rounded-lg border bg-blue-50 border-blue-200">
                          <div className="flex items-center gap-3">
                            <FileText className="h-4 w-4 text-blue-600" />
                            <div>
                              <p className="font-medium text-gray-900 text-sm">Food Establishment Certificate</p>
                              <p className="text-xs text-gray-500">
                                {selectedApplication.foodEstablishmentCertExpiry
                                  ? `Expires: ${new Date(selectedApplication.foodEstablishmentCertExpiry).toLocaleDateString()}`
                                  : 'Step 2 requirement'}
                              </p>
                            </div>
                          </div>
                          <SecureDocumentLink
                            url={selectedApplication.foodEstablishmentCertUrl}
                            fileName="Establishment Certificate"
                            label="Download"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Step 2 Custom Fields - from tier_data.tier2_custom_fields_data */}
                  {locationRequirements?.tier2_custom_fields &&
                    Array.isArray(locationRequirements.tier2_custom_fields) &&
                    locationRequirements.tier2_custom_fields.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-800 mb-2 flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          Additional Step 2 Information
                        </h4>
                        <div className="grid grid-cols-2 gap-3">
                          {locationRequirements.tier2_custom_fields.map((field: any) => {
                            // Step 2 custom fields are stored in tier_data.tier2_custom_fields_data
                            const tierData = selectedApplication.tier_data || {};
                            const tier2CustomData = tierData.tier2_custom_fields_data || {};
                            const value = tier2CustomData[field.id];
                            return (
                              <div key={field.id} className="p-3 bg-white rounded-lg border border-gray-200">
                                <div className="text-xs text-gray-500 mb-1">{field.label}</div>
                                {renderCustomFieldValue(field, value)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
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

      {/* Chat Dialog - Enterprise Grade UnifiedChatView */}
      <Dialog open={showChatDialog} onOpenChange={setShowChatDialog}>
        <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl">
          {managerId && (
            <UnifiedChatView
              userId={managerId}
              role="manager"
              initialConversationId={chatConversationId}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );

  return (
    <div className="space-y-6">
      {content}
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
          <Badge variant="warning">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'approved': {
        const tier = application.current_tier ?? 1;

        // Case 1: Step 2 Needs Review (Chef submitted Step 2 docs, manager needs to review)
        // current_tier=2 AND tier2_completed_at is set
        if (tier === 2 && application.tier2_completed_at) {
          return (
            <Badge variant="warning">
              <Clock className="h-3 w-3 mr-1" />
              Step 2 Needs Review
            </Badge>
          );
        }

        // Case 2: Step 1 Approved (Manager approved Step 1, waiting for Chef to submit Step 2)
        // current_tier=1 (Step 1 complete, Step 2 not started)
        if (tier === 1) {
          return (
            <Badge variant="info">
              <Check className="h-3 w-3 mr-1" />
              Step 1 Done
            </Badge>
          );
        }

        // Case 3: Fully Approved (Both steps complete, can book kitchens)
        // current_tier >= 3
        if (tier >= 3) {
          return (
            <Badge variant="success">
              <CheckCircle className="h-3 w-3 mr-1" />
              Fully Approved
            </Badge>
          );
        }

        // Fallback for any edge cases (e.g., tier=2 without tier2_completed_at)
        return (
          <Badge variant="info">
            <Clock className="h-3 w-3 mr-1" />
            In Progress
          </Badge>
        );
      }
      case 'rejected':
        return (
          <Badge variant="outline" className="text-destructive border-destructive/30">
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

