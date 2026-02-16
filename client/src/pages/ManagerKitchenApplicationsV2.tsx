import { logger } from "@/lib/logger";
"use client"

import { useManagerKitchenApplications } from "@/hooks/use-manager-kitchen-applications";
import { ManagerPageLayout } from "@/components/layout/ManagerPageLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
    CheckCircle,
    XCircle,
    Clock,
    AlertCircle,
    Settings,
    ExternalLink,
    Search,
    Filter,
    Users,
    FileCheck,
    ChefHat
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Sheet,
    SheetContent,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import UnifiedChatView from "@/components/chat/UnifiedChatView";
import { getConversationForApplication, createConversation } from "@/services/chat-service";
import { useLocation } from "wouter";
import { DataTable } from "@/components/ui/data-table";
import { getApplicationColumnsV2 } from "@/components/manager/applications/columns-v2";
import { ApplicationDetailPanel } from "@/components/manager/applications/components/ApplicationDetailPanel";
import { Application } from "@/components/manager/applications/types";
import { cn } from "@/lib/utils";

/**
 * Manager Kitchen Applications Page - Enterprise Edition
 * 
 * A complete redesign featuring:
 * - TanStack Table with sorting, filtering, and column visibility
 * - Sheet-based detail panel (replaces modal for better UX)
 * - Step 1/Step 2 tabbed navigation in detail view
 * - Real-time unread chat indicators
 * - Enterprise-grade styling inspired by Notion
 */
export default function ManagerKitchenApplicationsV2() {
    const [, setLocation] = useLocation();
    return (
        <ManagerPageLayout
            title="Chef Applications"
            description="Review and manage chef applications to your kitchen locations."
            showKitchenSelector={false}
        >
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
    onNavigateToView
}: {
    selectedLocationId: number | null,
    isLayoutLoading: boolean,
    setLocation: (path: string) => void,
    onNavigateToView?: (view: string) => void
}) {
    const {
        applications,
        isLoading,
        updateApplicationStatus,
        revokeAccess
    } = useManagerKitchenApplications();

    const { toast } = useToast();
    
    // State
    const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
    const [showDetailSheet, setShowDetailSheet] = useState(false);
    const [reviewFeedback, setReviewFeedback] = useState("");
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
            if (!currentUser) throw new Error('Not authenticated');
            const token = await currentUser.getIdToken();
            const response = await fetch('/api/firebase/user/me', {
                headers: { Authorization: `Bearer ${token}` },
                credentials: 'include',
            });
            if (!response.ok) throw new Error('Failed to get user info');
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
        enabled: !!selectedApplication?.locationId && showDetailSheet,
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
        setSelectedApplication(application);
        setReviewFeedback(application.feedback || "");
        setShowDetailSheet(true);
    };

    const closeDetailSheet = useCallback(() => {
        setShowDetailSheet(false);
        setSelectedApplication(null);
        setReviewFeedback("");
        
        // Fix for Radix UI bug #1241: pointer-events: none stuck on body after dialog close
        // This ensures the body is clickable again after the sheet closes
        setTimeout(() => {
            document.body.style.pointerEvents = '';
        }, 0);
    }, []);

    // Cleanup effect for Sheet close - ensures pointer-events are restored
    useEffect(() => {
        if (!showDetailSheet) {
            // Additional cleanup after animation completes (300ms is the close animation duration)
            const timer = setTimeout(() => {
                document.body.style.pointerEvents = '';
            }, 350);
            return () => clearTimeout(timer);
        }
    }, [showDetailSheet]);

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
            toast({
                title: "Error",
                description: "Unable to identify manager. Please refresh the page.",
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

    const handleApprove = async () => {
        if (!selectedApplication) return;
        try {
            await updateApplicationStatus.mutateAsync({
                applicationId: selectedApplication.id,
                status: 'approved',
                feedback: reviewFeedback || undefined,
            });
            toast({
                title: "Application Approved",
                description: "Chef's Step 1 application has been approved. They can now submit Step 2 documents.",
            });
            closeDetailSheet();
        } catch (error: any) {
            toast({
                title: "Error",
                description: error.message || "Failed to approve application",
                variant: "destructive",
            });
        }
    };

    const handleApproveTier2 = async () => {
        if (!selectedApplication) return;
        try {
            await updateApplicationStatus.mutateAsync({
                applicationId: selectedApplication.id,
                status: 'approved',
                currentTier: 3,
                feedback: reviewFeedback || undefined,
            });
            toast({
                title: "Step 2 Approved",
                description: "Chef is now fully approved and can book kitchens.",
            });
            closeDetailSheet();
        } catch (error: any) {
            toast({
                title: "Error",
                description: error.message || "Failed to approve Step 2",
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
                status: 'rejected',
                feedback: reviewFeedback,
            });
            toast({
                title: "Application Rejected",
                description: "Chef has been notified.",
            });
            closeDetailSheet();
        } catch (error: any) {
            toast({
                title: "Error",
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

            toast({
                title: "Access Revoked",
                description: "Chef access has been revoked successfully.",
            });
            closeDetailSheet();
        } catch (error: any) {
            toast({
                title: "Error",
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
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Chef Applications</h1>
                    <p className="text-gray-500 text-sm mt-1">
                        Review and manage chef applications to your kitchen locations.
                    </p>
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
                    <Settings className="h-4 w-4" />
                    Configure Requirements
                    <ExternalLink className="h-3 w-3" />
                </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    title="Pending Review"
                    value={stats.pending}
                    icon={Clock}
                    color="amber"
                    onClick={() => setStatusFilter('pending')}
                    active={statusFilter === 'pending'}
                />
                <StatCard
                    title="Awaiting Step 2"
                    value={stats.awaitingStep2}
                    icon={Users}
                    color="blue"
                    subtitle="Chat enabled"
                    onClick={() => setStatusFilter('awaiting-step2')}
                    active={statusFilter === 'awaiting-step2'}
                />
                <StatCard
                    title="Approved"
                    value={stats.approved}
                    icon={CheckCircle}
                    color="emerald"
                    subtitle="Can book kitchens"
                    onClick={() => setStatusFilter('approved')}
                    active={statusFilter === 'approved'}
                />
                <StatCard
                    title="Rejected"
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
                                    placeholder="Search applicants..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-[180px]">
                                    <Filter className="h-4 w-4 mr-2 text-gray-400" />
                                    <SelectValue placeholder="Filter by status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Applications</SelectItem>
                                    <SelectItem value="pending">Pending Review</SelectItem>
                                    <SelectItem value="awaiting-step2">Awaiting Step 2</SelectItem>
                                    <SelectItem value="approved">Approved</SelectItem>
                                    <SelectItem value="rejected">Rejected</SelectItem>
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
                            filterColumn="fullName"
                            filterPlaceholder="Filter by name..."
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                                <ChefHat className="h-8 w-8 text-gray-400" />
                            </div>
                            <h3 className="text-lg font-medium text-gray-900 mb-2">No Applications Found</h3>
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
                                >
                                    Clear Filters
                                </Button>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Detail Sheet - with Radix pointer-events fix */}
            <Sheet 
                open={showDetailSheet} 
                onOpenChange={(open) => {
                    if (!open) {
                        closeDetailSheet();
                    } else {
                        setShowDetailSheet(true);
                    }
                }}
            >
                <SheetContent 
                    side="right" 
                    className="w-full sm:max-w-2xl p-0 overflow-hidden flex flex-col"
                    onCloseAutoFocus={(e) => {
                        // Prevent default focus behavior and ensure body pointer-events are restored
                        e.preventDefault();
                        document.body.style.pointerEvents = '';
                    }}
                    onEscapeKeyDown={() => {
                        // Ensure cleanup on escape key
                        setTimeout(() => {
                            document.body.style.pointerEvents = '';
                        }, 0);
                    }}
                    onPointerDownOutside={() => {
                        // Ensure cleanup on outside click
                        setTimeout(() => {
                            document.body.style.pointerEvents = '';
                        }, 0);
                    }}
                >
                    <VisuallyHidden>
                        <SheetTitle>Application Details</SheetTitle>
                        <SheetDescription>Review chef application</SheetDescription>
                    </VisuallyHidden>
                    {selectedApplication && (
                        <ApplicationDetailPanel
                            application={selectedApplication}
                            locationRequirements={locationRequirements}
                            onApprove={handleApprove}
                            onApproveTier2={handleApproveTier2}
                            onReject={handleReject}
                            onRevokeAccess={handleRevokeAccess}
                            onOpenChat={() => {
                                setShowDetailSheet(false);
                                openChat(selectedApplication);
                            }}
                            onClose={closeDetailSheet}
                            isUpdating={updateApplicationStatus.isPending || revokeAccess.isPending}
                            reviewFeedback={reviewFeedback}
                            onFeedbackChange={setReviewFeedback}
                        />
                    )}
                </SheetContent>
            </Sheet>

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
                <DialogContent 
                    className="max-w-6xl h-[85vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl"
                    onCloseAutoFocus={(e) => {
                        e.preventDefault();
                        document.body.style.pointerEvents = '';
                    }}
                >
                    <VisuallyHidden>
                        <DialogTitle>Chat with Chef</DialogTitle>
                        <DialogDescription>Communication channel</DialogDescription>
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
    color,
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
    const colors = {
        amber: {
            bg: 'bg-amber-50',
            border: 'border-amber-200',
            text: 'text-amber-600',
            value: 'text-amber-700',
            activeBg: 'bg-amber-100',
            activeBorder: 'border-amber-400'
        },
        blue: {
            bg: 'bg-blue-50',
            border: 'border-blue-200',
            text: 'text-blue-600',
            value: 'text-blue-700',
            activeBg: 'bg-blue-100',
            activeBorder: 'border-blue-400'
        },
        emerald: {
            bg: 'bg-emerald-50',
            border: 'border-emerald-200',
            text: 'text-emerald-600',
            value: 'text-emerald-700',
            activeBg: 'bg-emerald-100',
            activeBorder: 'border-emerald-400'
        },
        red: {
            bg: 'bg-red-50',
            border: 'border-red-200',
            text: 'text-red-600',
            value: 'text-red-700',
            activeBg: 'bg-red-100',
            activeBorder: 'border-red-400'
        },
    };

    const c = colors[color];

    return (
        <Card
            className={cn(
                "cursor-pointer transition-all hover:shadow-md border-2",
                active ? `${c.activeBg} ${c.activeBorder}` : `${c.bg} ${c.border} hover:${c.activeBorder}`
            )}
            onClick={onClick}
        >
            <CardContent className="p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{title}</p>
                        <p className={cn("text-3xl font-bold mt-1", c.value)}>{value}</p>
                        {subtitle && (
                            <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
                        )}
                    </div>
                    <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", c.bg)}>
                        <Icon className={cn("h-5 w-5", c.text)} />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
