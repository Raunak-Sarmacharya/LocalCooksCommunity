import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
"use client"

import { useManagerKitchenApplications } from "@/hooks/use-manager-kitchen-applications";
import { ManagerPageLayout } from "@/components/layout/ManagerPageLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Clock, AlertCircle, Settings, ExternalLink, Search, Filter, Users, FileCheck, Calendar } from "@/components/ui/manager-icons";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import UnifiedChatView from "@/components/chat/UnifiedChatView";
import { getConversationForApplication, createConversation } from "@/services/chat-service";
import { useLocation } from "wouter";
import { DataTable } from "@/components/ui/data-table";
import { getApplicationColumnsV2 } from "@/components/manager/applications/columns-v2";
import { ApplicationDetailPanel } from "@/components/manager/applications/components/ApplicationDetailPanel";
import { KitchenDocumentApprovalDialog, getKitchenDocumentApprovalPlan, type KitchenDocumentField } from "@/components/common/KitchenDocumentApprovalDialog";
import { Application } from "@/components/manager/applications/types";
import { cn } from "@/lib/utils";
import { tt } from "@/i18n/common-ns";

export default function ManagerKitchenApplicationsV2() {
  
    const [, setLocation] = useLocation();
    return (
        <ManagerPageLayout showKitchenSelector={false}>
            {({ selectedLocationId, isLoading: isLayoutLoading }) => (
                <ManagerKitchenApplicationsContent
                    selectedLocationId={selectedLocationId}
                    isLayoutLoading={isLayoutLoading}
                    setLocation={setLocation}
                />
            )}
        </ManagerPageLayout>
    );
}

export function ManagerKitchenApplicationsContent({
    selectedLocationId,
    isLayoutLoading,
    setLocation,
    onNavigateToView,
    onApplicationChange,
    onRegisterListAction
}: {
    selectedLocationId: number | null,
    isLayoutLoading: boolean,
    setLocation: (path: string) => void,
    onNavigateToView?: (view: string) => void,
    onApplicationChange?: (applicationName: string | null) => void,
    onRegisterListAction?: (showList: () => void) => void
}) {
    const {
        applications,
        isLoading,
        updateApplicationStatus,
        verifyDocuments,
        revokeAccess
    } = useManagerKitchenApplications();

    const { toast } = useToast();
    
    // State
    const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
    const [reviewFeedback, setReviewFeedback] = useState("");
    const [approvalIssues, setApprovalIssues] = useState<string[]>([]);
    const [approvalDocuments, setApprovalDocuments] = useState<{ field: KitchenDocumentField; label: string }[]>([]);
    const [showApprovalDialog, setShowApprovalDialog] = useState(false);
    const [isCombinedApproving, setIsCombinedApproving] = useState(false);
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");

    // Chat state
    const [showChatDialog, setShowChatDialog] = useState(false);
    const [chatConversationId, setChatConversationId] = useState<string | null>(null);
    const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>({});

    // Filter applications by location
    const locationFilteredApplications = useMemo(() => {
        return selectedLocationId
            ? applications.filter(a => a.locationId === selectedLocationId)
            : applications;
    }, [applications, selectedLocationId]);

    // Application state helpers
    const isStep2NeedsReview = useCallback(
        (a: Application) => a.status === 'approved' && a.current_tier === 2 && !!a.tier2_completed_at,
        []
    );

    const isStep1ApprovedAwaitingStep2 = useCallback(
        (a: Application) => a.status === 'approved' && (a.current_tier ?? 1) === 1,
        []
    );

    const isFullyApproved = useCallback(
        (a: Application) => a.status === 'approved' && (a.current_tier ?? 1) >= 3,
        []
    );

    // Compute stats
    const stats = useMemo(() => {
        const pending = locationFilteredApplications.filter(
            (a) => a.status === "inReview" || isStep2NeedsReview(a)
        ).length;
        const awaitingStep2 = locationFilteredApplications.filter(a => isStep1ApprovedAwaitingStep2(a)).length;
        const approved = locationFilteredApplications.filter(a => isFullyApproved(a)).length;
        const rejected = locationFilteredApplications.filter(a => a.status === "rejected").length;

        return { pending, awaitingStep2, approved, rejected, total: locationFilteredApplications.length };
    }, [locationFilteredApplications, isStep2NeedsReview, isStep1ApprovedAwaitingStep2, isFullyApproved]);

    // Filter applications based on status filter and search
    const filteredApplications = useMemo(() => {
        let filtered = locationFilteredApplications;

        // Status filter
        if (statusFilter !== "all") {
            filtered = filtered.filter(app => {
                const tier = app.current_tier ?? 1;
                const hasStep2 = !!app.tier2_completed_at;

                switch (statusFilter) {
                    case 'pending':
                        return app.status === 'inReview' || (app.status === 'approved' && tier === 2 && hasStep2);
                    case 'awaiting-step2':
                        return app.status === 'approved' && tier === 1;
                    case 'approved':
                        return app.status === 'approved' && tier >= 3;
                    case 'rejected':
                        return app.status === 'rejected';
                    default:
                        return true;
                }
            });
        }

        // Search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(app =>
                app.fullName?.toLowerCase().includes(query) ||
                app.email?.toLowerCase().includes(query) ||
                app.location?.name?.toLowerCase().includes(query)
            );
        }

        return filtered;
    }, [locationFilteredApplications, statusFilter, searchQuery]);

    // Manager ID for chat - with retry logic
    const { data: managerInfo, refetch: refetchManagerInfo } = useQuery({
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
        retry: 3,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    const managerId = managerInfo?.id || null;

    // Fetch location requirements for selected application
    const { data: locationRequirements } = useQuery({
        queryKey: [`/api/public/locations/${selectedApplication?.locationId}/requirements`],
        queryFn: async () => {
            if (!selectedApplication?.locationId) return null;
            const response = await fetch(`/api/public/locations/${selectedApplication.locationId}/requirements`);
            if (!response.ok) return null;
            return response.json();
        },
        enabled: !!selectedApplication?.locationId,
    });

    // Unread counts tracking
    const applicationIdsKey = useMemo(() => {
        return locationFilteredApplications
            .map(app => `${app.id}:${app.chat_conversation_id || 'none'}`)
            .sort()
            .join(',');
    }, [locationFilteredApplications]);

    const isFetchingRef = useRef(false);
    const lastFetchKeyRef = useRef<string>('');
    const filteredApplicationsRef = useRef(locationFilteredApplications);
    filteredApplicationsRef.current = locationFilteredApplications;

    useEffect(() => {
        if (!managerId) return;
        if (!applicationIdsKey) return;

        const currentKey = `${managerId}:${applicationIdsKey}`;
        if (currentKey === lastFetchKeyRef.current && isFetchingRef.current) {
            return;
        }

        const fetchUnreadCounts = async () => {
            if (isFetchingRef.current) return;
            isFetchingRef.current = true;
            lastFetchKeyRef.current = currentKey;

            try {
                const counts: Record<number, number> = {};
                const currentApps = filteredApplicationsRef.current;
                const appsWithConversations = currentApps.filter(app => app.chat_conversation_id);

                if (appsWithConversations.length === 0) {
                    isFetchingRef.current = false;
                    return;
                }

                const results = await Promise.allSettled(
                    appsWithConversations.map(async (app) => {
                        try {
                            const conversation = await getConversationForApplication(app.id);
                            return { appId: app.id, count: conversation?.unreadManagerCount || 0 };
                        } catch (error) {
                            return { appId: app.id, count: 0 };
                        }
                    })
                );

                results.forEach((result) => {
                    if (result.status === 'fulfilled') {
                        counts[result.value.appId] = result.value.count;
                    }
                });

                setUnreadCounts(prevCounts => {
                    const prevKeys = Object.keys(prevCounts);
                    const newKeys = Object.keys(counts);
                    if (prevKeys.length !== newKeys.length) return counts;
                    const hasChanges = newKeys.some(key => prevCounts[Number(key)] !== counts[Number(key)]);
                    return hasChanges ? counts : prevCounts;
                });
            } finally {
                isFetchingRef.current = false;
            }
        };

        fetchUnreadCounts();
        const interval = setInterval(fetchUnreadCounts, 30000);
        return () => {
            clearInterval(interval);
            isFetchingRef.current = false;
        };
    }, [managerId, applicationIdsKey]);

    // Handlers
    const openDetailSheet = (application: Application) => {
        const url = new URL(window.location.href);
        url.searchParams.set('application', String(application.id));
        window.history.pushState({}, '', url);
        setSelectedApplication(application);
        setReviewFeedback(application.feedback || "");
        onApplicationChange?.(application.fullName);
    };

    const closeDetailSheet = useCallback(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete('application');
        window.history.replaceState({}, '', url);
        setSelectedApplication(null);
        setReviewFeedback("");
        onApplicationChange?.(null);
    }, [onApplicationChange]);

    useEffect(() => {
        onRegisterListAction?.(closeDetailSheet);
    }, [closeDetailSheet, onRegisterListAction]);

    useEffect(() => () => onApplicationChange?.(null), [onApplicationChange]);

    useEffect(() => {
        const syncApplicationFromUrl = () => {
            const id = Number(new URLSearchParams(window.location.search).get('application'));
            const application = id ? applications.find((item) => item.id === id) : null;
            setSelectedApplication(application ?? null);
            onApplicationChange?.(application?.fullName ?? null);
        };
        syncApplicationFromUrl();
        window.addEventListener('popstate', syncApplicationFromUrl);
        return () => window.removeEventListener('popstate', syncApplicationFromUrl);
    }, [applications, onApplicationChange]);

    const openChat = async (application: Application) => {
        let currentManagerId = managerId;
        
        // If managerId is not available, try to refetch
        if (!currentManagerId) {
            try {
                const result = await refetchManagerInfo();
                currentManagerId = result.data?.id || null;
            } catch (e) {
                logger.error('Failed to refetch manager info:', e);
            }
        }
        
        if (!currentManagerId) {
            toast({ title: mt("error"),
                description: mt("unableToIdentifyManagerPleaseRefreshThePage"),
                variant: "destructive",
            });
            return;
        }

        let conversationId = application.chat_conversation_id;

        if (!conversationId) {
            try {
                const existing = await getConversationForApplication(application.id);
                if (existing) {
                    conversationId = existing.id;
                }
            } catch (e) {
                logger.error("Error looking up conversation:", e);
            }
        }

        if (!conversationId) {
            try {
                conversationId = await createConversation(
                    application.id,
                    application.chefId,
                    currentManagerId,
                    application.locationId
                );
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

    const handleApprove = async () => {
        if (!selectedApplication) return;
        try {
            await updateApplicationStatus.mutateAsync({
                applicationId: selectedApplication.id,
                status: 'approved',
                feedback: reviewFeedback || undefined,
            });
            toast({ title: mt("applicationApproved"),
                description: mt("toastChefStep1Approved"),
            });
            closeDetailSheet();
        } catch (error: any) {
            toast({ title: mt("error"),
                description: error.message || "Failed to approve application",
                variant: "destructive",
            });
        }
    };

    const approveTier2 = async (verifyFields?: KitchenDocumentField[]) => {
        if (!selectedApplication) return;
        try {
            await updateApplicationStatus.mutateAsync({
                applicationId: selectedApplication.id,
                status: 'approved',
                currentTier: 3,
                feedback: reviewFeedback || undefined,
                verifyDocuments: verifyFields,
            });
            toast({ title: mt("step2Approved"),
                description: mt("chefIsNowFullyApprovedAndCanBookKitchens"),
            });
            closeDetailSheet();
            setShowApprovalDialog(false);
        } catch (error: any) {
            setApprovalIssues(String(error.message || "Could not approve this application.").split('; ').filter(Boolean));
            setApprovalDocuments([]);
            setShowApprovalDialog(true);
        }
    };

    const handleApproveTier2 = () => {
        if (!selectedApplication) return;
        const plan = getKitchenDocumentApprovalPlan(selectedApplication, locationRequirements);
        if (plan.issues.length || plan.toVerify.length) {
            setApprovalIssues(plan.issues);
            setApprovalDocuments(plan.toVerify);
            setShowApprovalDialog(true);
            return;
        }
        void approveTier2();
    };

    const handleVerifyAndApprove = async () => {
        if (!selectedApplication || !approvalDocuments.length) return;
        setIsCombinedApproving(true);
        try {
            await approveTier2(approvalDocuments.map(({ field }) => field));
        } finally {
            setIsCombinedApproving(false);
        }
    };

    const handleVerifyDocument = async (field: 'foodSafetyLicenseStatus' | 'foodEstablishmentCertStatus', status: 'approved' | 'rejected') => {
        if (!selectedApplication) return;
        try {
            await verifyDocuments.mutateAsync({ applicationId: selectedApplication.id, [field]: status });
            setSelectedApplication({ ...selectedApplication, [field]: status });
            toast({ title: status === 'approved' ? 'Document verified' : 'Document needs a replacement' });
        } catch (error: any) {
            toast({ title: mt('error'), description: error.message || 'Could not review document', variant: 'destructive' });
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
                status: 'rejected',
                feedback: reviewFeedback,
            });
            toast({ title: mt("applicationRejected"),
                description: mt("chefHasBeenNotified"),
            });
            closeDetailSheet();
        } catch (error: any) {
            toast({ title: mt("error"),
                description: error.message || "Failed to reject application",
                variant: "destructive",
            });
        }
    };

    const handleRevokeAccess = async () => {
        if (!selectedApplication) return;
        if (!window.confirm(`Are you sure you want to revoke ${selectedApplication.fullName}'s access?`)) {
            return;
        }

        try {
            await updateApplicationStatus.mutateAsync({
                applicationId: selectedApplication.id,
                status: 'rejected',
                feedback: 'Access revoked by manager',
            });

            await revokeAccess.mutateAsync({
                chefId: selectedApplication.chefId,
                locationId: selectedApplication.locationId,
            });

            toast({ title: mt("accessRevoked"),
                description: mt("chefAccessHasBeenRevokedSuccessfully"),
            });
            closeDetailSheet();
        } catch (error: any) {
            toast({ title: mt("error"),
                description: error.message || "Failed to revoke access",
                variant: "destructive",
            });
        }
    };

    // Table columns
    const columns = useMemo(() => getApplicationColumnsV2({
        onSelect: openDetailSheet,
        onApprove: (app) => {
            openDetailSheet(app);
        },
        onReject: (app) => {
            openDetailSheet(app);
        },
        onChat: openChat,
        onRevoke: (app) => {
            openDetailSheet(app);
        },
        unreadCounts
    }), [unreadCounts]);

    // Loading state
    if (isLoading || isLayoutLoading) {
        return (
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} className="h-24 w-full rounded-xl" />
                    ))}
                </div>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-96 w-full" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {selectedApplication ? (
                <div className="mx-auto max-w-5xl space-y-6">
                    {!onApplicationChange && (
                        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
                            <button type="button" onClick={closeDetailSheet} className="text-muted-foreground hover:text-foreground hover:underline">
                                {mt("chefApplications")}
                            </button>
                            <span aria-hidden="true" className="text-muted-foreground/50">/</span>
                            <span aria-current="page" className="font-medium text-foreground">{selectedApplication.fullName}</span>
                        </nav>
                    )}
                    <div className="bg-background">
                        <ApplicationDetailPanel
                            application={selectedApplication}
                            locationRequirements={locationRequirements}
                            onApprove={handleApprove}
                            onApproveTier2={handleApproveTier2}
                            onVerifyDocument={handleVerifyDocument}
                            onReject={handleReject}
                            onRevokeAccess={handleRevokeAccess}
                            onOpenChat={() => openChat(selectedApplication)}
                            isUpdating={updateApplicationStatus.isPending || verifyDocuments.isPending || revokeAccess.isPending}
                            reviewFeedback={reviewFeedback}
                            onFeedbackChange={setReviewFeedback}
                        />
                    </div>
                </div>
            ) : <>
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{mt("chefApplications")}</h1>
                    <p className="text-gray-500 text-sm mt-1">{mt("reviewAndManageChefApplicationsToYourKitchenLocations")}</p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        // Use direct view navigation if available (when embedded in dashboard)
                        // Otherwise use URL navigation (standalone page)
                        if (onNavigateToView) {
                            onNavigateToView('application-requirements');
                        } else {
                            const locationId = selectedLocationId ?? '';
                            setLocation(`/manager/dashboard?view=application-requirements${locationId ? `&locationId=${locationId}` : ''}`);
                        }
                    }}
                    className="gap-2"
                >
                    <Settings className="h-4 w-4" />{mt("configureRequirements")}<ExternalLink className="h-3 w-3" />
                </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    title={mt("pendingReview")}
                    value={stats.pending}
                    icon={Clock}
                    color="amber"
                    onClick={() => setStatusFilter('pending')}
                    active={statusFilter === 'pending'}
                />
                <StatCard
                    title={mt("awaitingStep2")}
                    value={stats.awaitingStep2}
                    icon={Users}
                    color="blue"
                    subtitle={mt("chatEnabled")}
                    onClick={() => setStatusFilter('awaiting-step2')}
                    active={statusFilter === 'awaiting-step2'}
                />
                <StatCard
                    title={mt("approved")}
                    value={stats.approved}
                    icon={CheckCircle}
                    color="emerald"
                    subtitle={mt("canBookKitchens")}
                    onClick={() => setStatusFilter('approved')}
                    active={statusFilter === 'approved'}
                />
                <StatCard
                    title={mt("rejected")}
                    value={stats.rejected}
                    icon={XCircle}
                    color="red"
                    onClick={() => setStatusFilter('rejected')}
                    active={statusFilter === 'rejected'}
                />
            </div>

            {/* Filters & Table */}
            <Card>
                <CardHeader className="pb-4">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1">
                            <div className="relative flex-1 max-w-sm">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder={mt("searchApplicants")}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-[180px]">
                                    <Filter className="h-4 w-4 mr-2 text-gray-400" />
                                    <SelectValue placeholder={mt("filterByStatus")} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{mt("allApplications")}</SelectItem>
                                    <SelectItem value="pending">{mt("pendingReview")}</SelectItem>
                                    <SelectItem value="awaiting-step2">{mt("awaitingStep2")}</SelectItem>
                                    <SelectItem value="approved">{mt("approved")}</SelectItem>
                                    <SelectItem value="rejected">{mt("rejected")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="text-sm text-gray-500">
                            {filteredApplications.length} of {stats.total} applications
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-0">
                    {filteredApplications.length > 0 ? (
                        <DataTable
                            columns={columns}
                            data={filteredApplications}
                            onRowClick={openDetailSheet}
                            filterColumn="fullName"
                            filterPlaceholder={mt("filterByName")}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                                <Calendar className="h-8 w-8 text-gray-400" />
                            </div>
                            <h3 className="text-lg font-medium text-gray-900 mb-2">{mt("noApplicationsFound")}</h3>
                            <p className="text-sm text-gray-500 max-w-sm">
                                {statusFilter !== 'all'
                                    ? "Try adjusting your filters to see more applications."
                                    : "Chef applications will appear here when chefs apply to your kitchens."}
                            </p>
                            {statusFilter !== 'all' && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setStatusFilter('all')}
                                    className="mt-4"
                                >{mt("clearFilters")}</Button>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            </>}
            <KitchenDocumentApprovalDialog
                open={showApprovalDialog}
                onOpenChange={setShowApprovalDialog}
                issues={approvalIssues}
                toVerify={approvalDocuments}
                onVerifyAndApprove={handleVerifyAndApprove}
                processing={isCombinedApproving || updateApplicationStatus.isPending || verifyDocuments.isPending}
            />
            {/* Chat Dialog - with Radix pointer-events fix */}
            <Dialog 
                open={showChatDialog} 
                onOpenChange={(open) => {
                    setShowChatDialog(open);
                    if (!open) {
                        // Clear conversation when closing
                        setChatConversationId(null);
                        // Fix for Radix UI bug #1241
                        setTimeout(() => {
                            document.body.style.pointerEvents = '';
                        }, 0);
                    }
                }}
            >
                <DialogContent showCloseButton={false}
                    className="max-w-6xl h-[85vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl"
                    onCloseAutoFocus={(e) => {
                        e.preventDefault();
                        document.body.style.pointerEvents = '';
                    }}
                >
                    <VisuallyHidden>
                        <DialogTitle>{mt("chatWithChef")}</DialogTitle>
                        <DialogDescription>{mt("communicationChannel")}</DialogDescription>
                    </VisuallyHidden>
                    {managerId && (
                        <UnifiedChatView
                            userId={managerId}
                            role="manager"
                            initialConversationId={chatConversationId}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

// Stat Card Component
function StatCard({
    title,
    value,
    icon: Icon,
    color, // Kept for prop compatibility
    subtitle,
    onClick,
    active
}: {
    title: string;
    value: number;
    icon: React.ElementType;
    color: 'amber' | 'blue' | 'emerald' | 'red';
    subtitle?: string;
    onClick?: () => void;
    active?: boolean;
}) {
    return (
        <Card
            className={cn(
                "cursor-pointer transition-all hover:shadow-md border",
                active 
                    ? "bg-accent/50 border-primary shadow-sm" 
                    : "bg-card border-border hover:border-primary/50"
            )}
            onClick={onClick}
        >
            <CardContent className="p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
                        <p className="text-3xl font-bold mt-1 text-foreground">{value}</p>
                        {subtitle && (
                            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
                        )}
                    </div>
                    <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                        active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}>
                        <Icon className="h-5 w-5" />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
