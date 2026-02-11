"use client"

import { useState, useEffect } from "react"
import { Application } from "../types"
import { Button } from "@/components/ui/button"
import { StatusButton } from "@/components/ui/status-button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SecureDocumentLink } from "@/components/common/SecureDocumentLink"
import { parseBusinessInfo } from "@/utils/parseBusinessInfo"
import {
    User,
    Mail,
    Phone,
    Building2,
    Calendar,
    Briefcase,
    Shield,
    FileText,
    Check,
    X,
    Clock,
    Ban,
    MessageCircle,
    ChefHat,
    ExternalLink,
    CheckCircle,
    AlertCircle
} from "lucide-react"
import { cn } from "@/lib/utils"

interface LocationRequirements {
    tier1_custom_fields?: Array<{
        id: string;
        label: string;
        type: string;
        required?: boolean;
        options?: string[];
    }>;
    tier2_custom_fields?: Array<{
        id: string;
        label: string;
        type: string;
        required?: boolean;
        options?: string[];
    }>;
    tier2_insurance_document_required?: boolean;
    tier2_food_establishment_cert_required?: boolean;
}

interface ApplicationDetailPanelProps {
    application: Application;
    locationRequirements?: LocationRequirements | null;
    onApprove: () => void;
    onApproveTier2: () => void;
    onReject: () => void;
    onRevokeAccess: () => void;
    onOpenChat: () => void;
    onClose: () => void;
    isUpdating: boolean;
    reviewFeedback: string;
    onFeedbackChange: (value: string) => void;
}

/**
 * Enterprise-grade Application Detail Panel
 * 
 * Features:
 * - Clean, Notion-like design
 * - Step 1/Step 2 tabbed interface
 * - Document preview with secure links
 * - Custom fields display
 * - Action buttons with loading states
 */
export function ApplicationDetailPanel({
    application,
    locationRequirements,
    onApprove,
    onApproveTier2,
    onReject,
    onRevokeAccess,
    onOpenChat,
    onClose,
    isUpdating,
    reviewFeedback,
    onFeedbackChange
}: ApplicationDetailPanelProps) {
    const [activeAction, setActiveAction] = useState<string | null>(null);

    // Reset activeAction when the operation completes
    useEffect(() => {
        if (!isUpdating) setActiveAction(null);
    }, [isUpdating]);

    const tier = application.current_tier ?? 1;
    const hasStep2 = !!application.tier2_completed_at;
    const isFullyApproved = application.status === 'approved' && tier >= 3;
    const isStep2NeedsReview = application.status === 'approved' && tier === 2 && hasStep2;
    const isPending = application.status === 'inReview';
    const businessInfo = parseBusinessInfo(application.businessDescription);

    // Determine which tab to show by default
    const defaultTab = isStep2NeedsReview ? "step2" : "step1";

    // Helper to render custom field value
    const renderCustomFieldValue = (field: any, value: any) => {
        if (value === undefined || value === null || value === '') {
            return <span className="text-gray-400 italic text-sm">Not provided</span>;
        }

        if (field.type === 'checkbox') {
            if (Array.isArray(value)) {
                return <span className="text-gray-900">{value.join(', ')}</span>;
            }
            return (
                <span className={cn("inline-flex items-center gap-1", value ? "text-emerald-600" : "text-gray-500")}>
                    {value ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    {value ? 'Yes' : 'No'}
                </span>
            );
        }

        if (field.type === 'date') {
            return (
                <span className="text-gray-900">
                    {new Date(value).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric'
                    })}
                </span>
            );
        }

        if (field.type === 'file' || field.type === 'cloudflare_upload') {
            const isUrl = typeof value === 'string' && (value.startsWith('http') || value.startsWith('/'));
            if (isUrl) {
                return (
                    <SecureDocumentLink
                        url={value}
                        fileName={field.label}
                        label="View Document"
                    />
                );
            }
            return <span className="text-amber-600 text-sm">{String(value)} (not uploaded)</span>;
        }

        return <span className="text-gray-900">{String(value)}</span>;
    };

    // Status indicator component
    const StatusIndicator = () => {
        if (isPending) {
            return (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                    <Clock className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-700">Pending Review</span>
                </div>
            );
        }
        if (isStep2NeedsReview) {
            return (
                <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg">
                    <AlertCircle className="h-4 w-4 text-orange-600" />
                    <span className="text-sm font-medium text-orange-700">Step 2 Awaiting Review</span>
                </div>
            );
        }
        if (isFullyApproved) {
            return (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-medium text-emerald-700">Fully Approved</span>
                </div>
            );
        }
        if (application.status === 'approved' && tier === 1) {
            return (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                    <Clock className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-700">Awaiting Chef's Step 2</span>
                </div>
            );
        }
        if (application.status === 'rejected') {
            return (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                    <X className="h-4 w-4 text-red-600" />
                    <span className="text-sm font-medium text-red-700">Rejected</span>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex-shrink-0 p-6 border-b bg-gradient-to-r from-[#208D80]/5 to-transparent">
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-xl bg-[#208D80]/10 flex items-center justify-center">
                            <ChefHat className="h-7 w-7 text-[#208D80]" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900">{application.fullName}</h2>
                            <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                                <Building2 className="h-3.5 w-3.5" />
                                <span>{application.location?.name || 'Unknown Location'}</span>
                            </div>
                        </div>
                    </div>
                    <StatusIndicator />
                </div>

                {/* Quick Info Grid */}
                <div className="grid grid-cols-3 gap-4 mt-4">
                    <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-600 truncate">{application.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-600">{application.phone || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-600">
                            {new Date(application.createdAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                            })}
                        </span>
                    </div>
                </div>

                {/* Chat Button */}
                {(application.status === 'approved' || application.chat_conversation_id) && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onOpenChat}
                        className="mt-4 gap-2"
                    >
                        <MessageCircle className="h-4 w-4" />
                        Open Chat
                    </Button>
                )}
            </div>

            {/* Content Area with Tabs */}
            <ScrollArea className="flex-1">
                <div className="p-6">
                    <Tabs defaultValue={defaultTab} className="w-full">
                        <TabsList className="grid w-full grid-cols-2 mb-6">
                            <TabsTrigger value="step1" className="gap-2">
                                <div className={cn(
                                    "w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium",
                                    application.status !== 'inReview' 
                                        ? "bg-emerald-100 text-emerald-700"
                                        : "bg-amber-100 text-amber-700"
                                )}>
                                    {application.status !== 'inReview' ? <Check className="h-3 w-3" /> : '1'}
                                </div>
                                Initial Application
                            </TabsTrigger>
                            <TabsTrigger 
                                value="step2" 
                                className="gap-2"
                                disabled={application.status === 'inReview'}
                            >
                                <div className={cn(
                                    "w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium",
                                    isFullyApproved
                                        ? "bg-emerald-100 text-emerald-700"
                                        : hasStep2
                                            ? "bg-orange-100 text-orange-700"
                                            : "bg-gray-100 text-gray-500"
                                )}>
                                    {isFullyApproved ? <Check className="h-3 w-3" /> : '2'}
                                </div>
                                Kitchen Coordination
                            </TabsTrigger>
                        </TabsList>

                        {/* STEP 1 CONTENT */}
                        <TabsContent value="step1" className="space-y-6 mt-0">
                            {/* Business Information */}
                            {businessInfo && (
                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                        <Briefcase className="h-4 w-4 text-[#208D80]" />
                                        Business Information
                                    </h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {businessInfo.businessName && (
                                            <InfoCard label="Business Name" value={businessInfo.businessName} />
                                        )}
                                        {businessInfo.businessType && (
                                            <InfoCard label="Type" value={businessInfo.businessType} className="capitalize" />
                                        )}
                                        {businessInfo.experience && (
                                            <InfoCard label="Experience" value={`${businessInfo.experience} years`} />
                                        )}
                                        {businessInfo.usageFrequency && (
                                            <InfoCard label="Usage Frequency" value={businessInfo.usageFrequency} className="capitalize" />
                                        )}
                                        {businessInfo.sessionDuration && (
                                            <InfoCard label="Session Duration" value={`${businessInfo.sessionDuration} hours`} />
                                        )}
                                    </div>
                                    {businessInfo.description && (
                                        <div className="p-3 bg-gray-50 rounded-lg border">
                                            <div className="text-xs text-gray-500 mb-1">Description</div>
                                            <p className="text-sm text-gray-700">{businessInfo.description}</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            <Separator />

                            {/* Food Safety Documents */}
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                    <Shield className="h-4 w-4 text-[#208D80]" />
                                    Food Safety Documents
                                </h3>
                                <DocumentCard
                                    title="Food Handler Certificate"
                                    subtitle={application.foodSafetyLicense === 'yes' ? 'Certificate provided' : 'No certificate'}
                                    url={application.foodSafetyLicenseUrl}
                                    status={application.foodSafetyLicenseUrl ? 'complete' : 'missing'}
                                    expiry={application.foodSafetyLicenseExpiry}
                                />
                            </div>

                            {/* Step 1 Custom Fields */}
                            {locationRequirements?.tier1_custom_fields &&
                                locationRequirements.tier1_custom_fields.length > 0 && (
                                    <>
                                        <Separator />
                                        <div className="space-y-3">
                                            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                                <FileText className="h-4 w-4 text-[#208D80]" />
                                                Additional Information
                                            </h3>
                                            <div className="grid grid-cols-2 gap-3">
                                                {locationRequirements.tier1_custom_fields.map((field) => {
                                                    const customData = (application.customFieldsData || {}) as Record<string, any>;
                                                    const value = customData[field.id];
                                                    return (
                                                        <div key={field.id} className="p-3 bg-gray-50 rounded-lg border">
                                                            <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                                                                {field.label}
                                                                {field.required && <span className="text-red-500">*</span>}
                                                            </div>
                                                            {renderCustomFieldValue(field, value)}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </>
                                )}
                        </TabsContent>

                        {/* STEP 2 CONTENT */}
                        <TabsContent value="step2" className="space-y-6 mt-0">
                            {!hasStep2 && application.status === 'approved' && tier === 1 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-center">
                                    <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
                                        <Clock className="h-8 w-8 text-blue-500" />
                                    </div>
                                    <h3 className="text-lg font-medium text-gray-900 mb-2">Awaiting Chef Submission</h3>
                                    <p className="text-sm text-gray-500 max-w-sm">
                                        The chef has been approved for Step 1 and can now submit their Step 2 documents.
                                        Chat is available to coordinate.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {hasStep2 && (
                                        <div className="text-xs text-gray-500 mb-4">
                                            Submitted: {new Date(application.tier2_completed_at!).toLocaleDateString('en-US', {
                                                month: 'long',
                                                day: 'numeric',
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </div>
                                    )}

                                    {/* Step 2 Documents */}
                                    <div className="space-y-3">
                                        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                            <Shield className="h-4 w-4 text-[#208D80]" />
                                            Step 2 Documents
                                        </h3>

                                        {/* Insurance Document */}
                                        {(() => {
                                            const tierData = (application.tier_data || {}) as Record<string, any>;
                                            const tierFiles = tierData.tierFiles || {};
                                            const insuranceUrl = tierFiles.tier2_insurance_document;
                                            const isRequired = locationRequirements?.tier2_insurance_document_required;

                                            return (
                                                <DocumentCard
                                                    title="Insurance Document"
                                                    subtitle="Commercial liability insurance"
                                                    url={insuranceUrl}
                                                    status={insuranceUrl ? 'complete' : isRequired ? 'required' : 'optional'}
                                                    variant="purple"
                                                />
                                            );
                                        })()}

                                        {/* Food Establishment Certificate */}
                                        <DocumentCard
                                            title="Food Establishment Certificate"
                                            subtitle={application.foodEstablishmentCertExpiry
                                                ? `Expires: ${new Date(application.foodEstablishmentCertExpiry).toLocaleDateString()}`
                                                : 'Step 2 requirement'}
                                            url={application.foodEstablishmentCertUrl}
                                            status={application.foodEstablishmentCertUrl ? 'complete' : 'optional'}
                                            variant="blue"
                                        />
                                    </div>

                                    {/* Step 2 Custom Fields */}
                                    {locationRequirements?.tier2_custom_fields &&
                                        locationRequirements.tier2_custom_fields.length > 0 && (
                                            <>
                                                <Separator />
                                                <div className="space-y-3">
                                                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                                        <FileText className="h-4 w-4 text-[#208D80]" />
                                                        Additional Step 2 Information
                                                    </h3>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        {locationRequirements.tier2_custom_fields.map((field) => {
                                                            const tierData = (application.tier_data || {}) as Record<string, any>;
                                                            const tier2CustomData = tierData.tier2_custom_fields_data || {};
                                                            const value = tier2CustomData[field.id];
                                                            return (
                                                                <div key={field.id} className="p-3 bg-gray-50 rounded-lg border">
                                                                    <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                                                                        {field.label}
                                                                        {field.required && <span className="text-red-500">*</span>}
                                                                    </div>
                                                                    {renderCustomFieldValue(field, value)}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                </>
                            )}
                        </TabsContent>
                    </Tabs>
                </div>
            </ScrollArea>

            {/* Footer Actions */}
            <div className="flex-shrink-0 p-6 border-t bg-gray-50/50">
                {/* Feedback textarea for pending/rejection */}
                {(isPending || isStep2NeedsReview) && (
                    <div className="mb-4">
                        <label className="text-sm font-medium text-gray-700 mb-2 block">
                            Feedback {isPending ? '(Required for rejection)' : '(Optional)'}
                        </label>
                        <Textarea
                            value={reviewFeedback}
                            onChange={(e) => onFeedbackChange(e.target.value)}
                            placeholder="Provide feedback for the applicant..."
                            rows={3}
                            className="resize-none"
                        />
                    </div>
                )}

                <div className="flex gap-3">
                    <Button variant="outline" onClick={onClose} className="flex-1">
                        Close
                    </Button>

                    {isPending && (
                        <>
                            <StatusButton
                                variant="outline"
                                onClick={() => { setActiveAction('reject'); onReject(); }}
                                status={activeAction === 'reject' && isUpdating ? "loading" : "idle"}
                                disabled={isUpdating || !reviewFeedback.trim()}
                                className="flex-1 border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300"
                                labels={{ idle: "Reject", loading: "Rejecting", success: "Rejected" }}
                            />
                            <StatusButton
                                onClick={() => { setActiveAction('approve'); onApprove(); }}
                                status={activeAction === 'approve' && isUpdating ? "loading" : "idle"}
                                disabled={isUpdating && activeAction !== 'approve'}
                                className="flex-1"
                                labels={{ idle: "Approve Step 1", loading: "Approving", success: "Approved" }}
                            />
                        </>
                    )}

                    {isStep2NeedsReview && (
                        <>
                            <StatusButton
                                variant="outline"
                                onClick={() => { setActiveAction('revoke'); onRevokeAccess(); }}
                                status={activeAction === 'revoke' && isUpdating ? "loading" : "idle"}
                                disabled={isUpdating && activeAction !== 'revoke'}
                                className="flex-1 border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300"
                                labels={{ idle: "Revoke Access", loading: "Revoking", success: "Revoked" }}
                            />
                            <StatusButton
                                onClick={() => { setActiveAction('approveTier2'); onApproveTier2(); }}
                                status={activeAction === 'approveTier2' && isUpdating ? "loading" : "idle"}
                                disabled={isUpdating && activeAction !== 'approveTier2'}
                                className="flex-1"
                                labels={{ idle: "Approve Step 2", loading: "Approving", success: "Approved" }}
                            />
                        </>
                    )}

                    {isFullyApproved && (
                        <StatusButton
                            variant="outline"
                            onClick={() => { setActiveAction('revoke'); onRevokeAccess(); }}
                            status={activeAction === 'revoke' && isUpdating ? "loading" : "idle"}
                            className="flex-1 border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300"
                            labels={{ idle: "Revoke Access", loading: "Revoking", success: "Revoked" }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

// Helper Components

function InfoCard({ label, value, className }: { label: string; value: string; className?: string }) {
    return (
        <div className="p-3 bg-gray-50 rounded-lg border">
            <div className="text-xs text-gray-500 mb-1">{label}</div>
            <div className={cn("text-sm font-medium text-gray-900", className)}>{value}</div>
        </div>
    );
}

function DocumentCard({
    title,
    subtitle,
    url,
    status,
    expiry,
    variant = 'green'
}: {
    title: string;
    subtitle: string;
    url?: string | null;
    status: 'complete' | 'missing' | 'required' | 'optional';
    expiry?: string | null;
    variant?: 'green' | 'blue' | 'purple';
}) {
    const colors = {
        green: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-600' },
        blue: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600' },
        purple: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-600' },
    };

    const statusColors = {
        complete: colors[variant],
        missing: { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'text-gray-400' },
        required: { bg: 'bg-red-50', border: 'border-red-200', icon: 'text-red-400' },
        optional: { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'text-gray-400' },
    };

    const c = statusColors[status];

    return (
        <div className={cn("flex items-center justify-between p-3 rounded-lg border", c.bg, c.border)}>
            <div className="flex items-center gap-3">
                <FileText className={cn("h-5 w-5", c.icon)} />
                <div>
                    <p className="font-medium text-gray-900 text-sm">{title}</p>
                    <p className="text-xs text-gray-500">{subtitle}</p>
                    {expiry && (
                        <p className="text-xs text-gray-500 mt-0.5">
                            Expires: {new Date(expiry).toLocaleDateString()}
                        </p>
                    )}
                </div>
            </div>
            {url ? (
                <SecureDocumentLink
                    url={url}
                    fileName={title}
                    label="View"
                />
            ) : status === 'required' ? (
                <Badge variant="destructive" className="text-xs">Required</Badge>
            ) : null}
        </div>
    );
}
