"use client"
import { mt } from "@/i18n/manager";

import { useState, useEffect, useRef } from "react"
import { Application } from "../types"
import { Button } from "@/components/ui/button"
import { StatusButton } from "@/components/ui/status-button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { SecureDocumentLink } from "@/components/common/SecureDocumentLink"
import { VerifiedDocumentChip } from "@/components/common/VerifiedDocumentChip"
import {
    DocumentViewerDialog,
    type DocumentVerificationField,
    type DocumentVerificationStatus,
} from "./DocumentViewerDialog"
import { parseBusinessInfo } from "@/utils/parseBusinessInfo"
import { Mail, Phone, Building2, Calendar, FileText, Check, X, Clock, MessageCircle, CheckCircle, Eye } from "@/components/ui/manager-icons"
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
    requireFoodHandlerCert?: boolean;
}

interface ApplicationDetailPanelProps {
    application: Application;
    locationRequirements?: LocationRequirements | null;
    onApprove: () => void;
    onApproveTier2: () => void;
    onVerifyDocument: (field: 'foodSafetyLicenseStatus' | 'foodEstablishmentCertStatus', status: 'approved' | 'rejected') => void;
    onReject: () => void;
    onRevokeAccess: () => void;
    onOpenChat: () => void;
    isUpdating: boolean;
    reviewFeedback: string;
    onFeedbackChange: (value: string) => void;
}

/** State of a document currently open in the viewer modal. */
interface OpenDocument {
    title: string;
    subtitle?: string;
    url: string | null | undefined;
    status?: DocumentVerificationStatus;
    expiry?: string | null;
    reviewNote?: string | null;
    reviewField?: DocumentVerificationField;
}

export function ApplicationDetailPanel({
    application,
    locationRequirements,
    onApprove,
    onApproveTier2,
    onVerifyDocument,
    onReject,
    onRevokeAccess,
    onOpenChat,
    isUpdating,
    reviewFeedback,
    onFeedbackChange
}: ApplicationDetailPanelProps) {

    const [activeAction, setActiveAction] = useState<string | null>(null);
    const [openDocument, setOpenDocument] = useState<OpenDocument | null>(null);

    // Reset activeAction when the operation completes
    useEffect(() => {
        if (!isUpdating) setActiveAction(null);
    }, [isUpdating]);

    // Close the viewer only when a review mutation actually finishes (true → false),
    // so the list reflects the new document state instead of a stale preview.
    const wasUpdatingRef = useRef(false);
    useEffect(() => {
        if (isUpdating) {
            wasUpdatingRef.current = true;
        } else if (wasUpdatingRef.current) {
            wasUpdatingRef.current = false;
            setOpenDocument(null);
        }
    }, [isUpdating]);

    const tier = application.current_tier ?? 1;
    const hasStep2 = !!application.tier2_completed_at;
    const isFullyApproved = application.status === 'approved' && tier >= 3;
    const isStep2NeedsReview = application.status === 'approved' && tier === 2 && hasStep2;
    const isPending = application.status === 'inReview';
    const businessInfo = parseBusinessInfo(application.businessDescription);

    // Stage 2 document data lives on the tier payload.
    const tierData = (application.tier_data || {}) as Record<string, any>;
    const tierFiles = (tierData.tierFiles || {}) as Record<string, any>;
    const insuranceUrl = tierFiles.tier2_insurance_document;
    const insuranceRequired = locationRequirements?.tier2_insurance_document_required;
    const licenseRequired = locationRequirements?.requireFoodHandlerCert;

    const isExpired = (value?: string | null) => {
        if (!value) return false;
        const ts = Date.parse(value);
        return Number.isFinite(ts) && ts < Date.now() - 86_400_000;
    };

    // Human copy for the current verification state of a document.
    const reviewNoteFor = (status: DocumentVerificationStatus, expiry?: string | null): string | null => {
        if (!status) return null;
        if (isExpired(expiry)) return mt("documentExpiredNeedsReplacement");
        if (status === 'approved') return mt("documentVerifiedNote");
        if (status === 'rejected') return mt("documentRejectedNote");
        return mt("documentPendingNote");
    };

    // Helper to render custom field value
    const renderCustomFieldValue = (field: any, value: any) => {
        if (value === undefined || value === null || value === '') {
            return <span className="text-muted-foreground italic text-sm">{mt("notProvided")}</span>;
        }

        if (field.type === 'checkbox') {
            if (Array.isArray(value)) {
                return <span className="text-foreground">{value.join(', ')}</span>;
            }
            return (
                <span className={cn("inline-flex items-center gap-1", value ? "text-primary" : "text-muted-foreground")}>
                    {value ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    {value ? 'Yes' : 'No'}
                </span>
            );
        }

        if (field.type === 'date') {
            return (
                <span className="text-foreground">
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
                        label={mt("viewDocument")}
                    />
                );
            }
            return <span className="text-amber-600 text-sm">{String(value)} {mt("notUploaded")}</span>;
        }

        return <span className="text-foreground">{String(value)}</span>;
    };

    // A compact status keeps the chef and document actions in focus.
    const StatusIndicator = () => {
        const label = isPending ? mt("awaitingAdminApproval")
            : isStep2NeedsReview ? mt("step2AwaitingReview")
            : isFullyApproved ? mt("fullyApproved")
            : application.status === 'approved' && tier === 1 ? mt("awaitingChefSStep2")
            : application.status === 'rejected' ? mt("rejected") : null;
        if (!label) return null;
        return <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-1 text-xs font-medium text-foreground">
            {isFullyApproved ? <CheckCircle className="h-3.5 w-3.5 text-primary" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
            {label}
        </span>;
    };

    // Stage rail marker: complete / active / upcoming for a stacked (non-tabbed) layout.
    const StageMarker = ({ state }: { index: number; state: 'complete' | 'active' | 'upcoming' }) => (
        <span
            className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                state === 'complete' && "bg-primary/10 text-primary",
                state === 'active' && "bg-primary text-primary-foreground",
                state === 'upcoming' && "bg-muted text-muted-foreground",
            )}
        >
            {state === 'complete' ? <Check className="h-3.5 w-3.5" /> : state === 'active' ? <Clock className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
        </span>
    );

    const StageHeading = ({
        index,
        state,
        title,
        caption,
    }: {
        index: number;
        state: 'complete' | 'active' | 'upcoming';
        title: string;
        caption?: string | null;
    }) => (
        <div className="flex items-center gap-3">
            <StageMarker index={index} state={state} />
            <div className="min-w-0">
                <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
                {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
            </div>
        </div>
    );

    const stage1Marker: 'complete' | 'active' | 'upcoming' =
        application.status === 'inReview' ? 'active' : 'complete';
    const stage2Marker: 'complete' | 'active' | 'upcoming' =
        isFullyApproved ? 'complete' : isStep2NeedsReview ? 'active' : 'upcoming';

    return (
        <>
            <div className="flex flex-col">
                {/* Header */}
                <div className="flex-shrink-0 border-b border-border bg-card px-5 py-5 sm:px-6">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">{mt("applicationDetails")}</p>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="text-xl font-semibold tracking-tight text-foreground">{application.fullName}</h2>
                            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                                <Building2 className="h-4 w-4 shrink-0" />
                                <span>{application.location?.name || 'Unknown Location'}</span>
                            </div>
                        </div>
                        <StatusIndicator />
                    </div>

                    {/* Quick Info Grid */}
                    <div className="mt-5 grid gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-2">
                        <div className="flex min-w-0 items-center gap-2 text-sm">
                            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 truncate text-foreground" title={application.email}>{application.email}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span className="text-foreground">{application.phone || '—'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="text-foreground">
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
                            variant="ghost"
                            size="sm"
                            onClick={onOpenChat}
                            className="mt-4 gap-2 border border-border hover:bg-muted"
                        >
                            <MessageCircle className="h-4 w-4" />{mt("openChat")}</Button>
                    )}
                </div>

                {/* Content — both stages stacked, no tabs */}
                <div className="p-5 sm:p-6">
                    <div className="space-y-8">

                        {/* ───────────────────────── Stage 1 ───────────────────────── */}
                        <section className="space-y-5">
                            <StageHeading
                                index={1}
                                state={stage1Marker}
                                title={mt("initialApplication")}
                                caption={mt("stageOneCaption")}
                            />

                            {/* Business Information */}
                            {businessInfo && (
                                <div className="space-y-3">
                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{mt("businessInformation")}</h4>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {businessInfo.businessName && (
                                            <InfoCard label={mt("businessName")} value={businessInfo.businessName} />
                                        )}
                                        {businessInfo.businessType && (
                                            <InfoCard label={mt("type")} value={businessInfo.businessType} className="capitalize" />
                                        )}
                                        {businessInfo.experience && (
                                            <InfoCard label={mt("experience")} value={mt("yearsExperience", { count: businessInfo.experience })} />
                                        )}
                                        {businessInfo.usageFrequency && (
                                            <InfoCard label={mt("usageFrequency")} value={businessInfo.usageFrequency} className="capitalize" />
                                        )}
                                        {businessInfo.sessionDuration && (
                                            <InfoCard label={mt("sessionDuration")} value={mt("hoursSession", { count: businessInfo.sessionDuration })} />
                                        )}
                                    </div>
                                    {businessInfo.description && (
                                        <div className="rounded-xl border border-border bg-card p-4">
                                            <div className="mb-1 text-xs text-muted-foreground">{mt("description")}</div>
                                            <p className="text-sm text-foreground">{businessInfo.description}</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Food Safety Licence — shown once, owned by the initial application */}
                            <div className="space-y-3">
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{mt("foodSafetyDocuments")}</h4>
                                <DocumentCard
                                    title={mt("foodSafetyLicense")}
                                    subtitle={application.foodSafetyLicenseUrl
                                        ? licenseRequired
                                            ? mt("requiredByThisKitchen")
                                            : mt("optionalForThisKitchen")
                                        : mt("noDocument")}
                                    url={application.foodSafetyLicenseUrl}
                                    status={application.foodSafetyLicenseUrl ? 'complete' : licenseRequired ? 'required' : 'optional'}
                                    expiry={application.foodSafetyLicenseExpiry}
                                    verificationStatus={application.foodSafetyLicenseStatus}
                                    onView={() => setOpenDocument({
                                        title: mt("foodSafetyLicense"),
                                        subtitle: mt("foodSafetyLicense"),
                                        url: application.foodSafetyLicenseUrl,
                                        status: application.foodSafetyLicenseStatus,
                                        expiry: application.foodSafetyLicenseExpiry,
                                        reviewNote: reviewNoteFor(application.foodSafetyLicenseStatus, application.foodSafetyLicenseExpiry),
                                        reviewField: isStep2NeedsReview ? 'foodSafetyLicenseStatus' : undefined,
                                    })}
                                />
                            </div>

                            {/* Stage 1 Custom Fields */}
                            {locationRequirements?.tier1_custom_fields &&
                                locationRequirements.tier1_custom_fields.length > 0 && (
                                    <div className="space-y-3">
                                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{mt("additionalInformation")}</h4>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {locationRequirements.tier1_custom_fields.map((field) => {
                                                const customData = (application.customFieldsData || {}) as Record<string, any>;
                                                const value = customData[field.id];
                                                return (
                                                    <div key={field.id} className="rounded-xl border border-border bg-card p-4">
                                                        <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                                                            {field.label}
                                                            {field.required && <span className="text-red-500">*</span>}
                                                        </div>
                                                        {renderCustomFieldValue(field, value)}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                        </section>

                        <Separator />

                        {/* ───────────────────────── Stage 2 ───────────────────────── */}
                        <section className="space-y-5">
                            <StageHeading
                                index={2}
                                state={stage2Marker}
                                title={mt("kitchenCoordination")}
                                caption={hasStep2 && application.tier2_completed_at
                                    ? mt("stageTwoSubmitted", { date: new Date(application.tier2_completed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) })
                                    : mt("stageTwoCaption")}
                            />

                            {!hasStep2 && application.status === 'approved' && tier === 1 ? (
                                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
                                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                                        <Clock className="h-6 w-6 text-primary" />
                                    </div>
                                    <h4 className="mb-2 text-base font-medium text-foreground">{mt("awaitingChefSubmission")}</h4>
                                    <p className="max-w-sm text-sm text-muted-foreground">
                                        {mt("awaitingChefSubmissionDesc")}
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {/* Stage 2 Documents */}
                                    <div className="space-y-3">
                                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{mt("step2Documents")}</h4>

                                        {/* Insurance Document — read-only */}
                                        <DocumentCard
                                            title={mt("insuranceDocument")}
                                            subtitle={mt("commercialLiabilityInsurance")}
                                            url={insuranceUrl}
                                            status={insuranceUrl ? 'complete' : insuranceRequired ? 'required' : 'optional'}
                                            onView={() => setOpenDocument({
                                                title: mt("insuranceDocument"),
                                                subtitle: mt("commercialLiabilityInsurance"),
                                                url: insuranceUrl,
                                            })}
                                        />

                                        {/* Food Establishment Certificate */}
                                        <DocumentCard
                                            title={mt("foodEstablishmentCertificate")}
                                            subtitle={application.foodEstablishmentCertUrl
                                                ? application.foodEstablishmentCertStatus === 'rejected' ? mt("needsAReplacement") : mt("uploadedForThisKitchen")
                                                : locationRequirements?.tier2_food_establishment_cert_required ? mt("coordinateWithChef") : mt("optionalForThisKitchen")}
                                            url={application.foodEstablishmentCertUrl}
                                            status={application.foodEstablishmentCertUrl ? 'complete' : locationRequirements?.tier2_food_establishment_cert_required ? 'required' : 'optional'}
                                            expiry={application.foodEstablishmentCertExpiry}
                                            verificationStatus={application.foodEstablishmentCertStatus}
                                            onView={() => setOpenDocument({
                                                title: mt("foodEstablishmentCertificate"),
                                                subtitle: mt("kitchenCoordination"),
                                                url: application.foodEstablishmentCertUrl,
                                                status: application.foodEstablishmentCertStatus,
                                                expiry: application.foodEstablishmentCertExpiry,
                                                reviewNote: reviewNoteFor(application.foodEstablishmentCertStatus, application.foodEstablishmentCertExpiry),
                                                reviewField: isStep2NeedsReview ? 'foodEstablishmentCertStatus' : undefined,
                                            })}
                                        />
                                    </div>

                                    {/* Stage 2 Custom Fields */}
                                    {locationRequirements?.tier2_custom_fields &&
                                        locationRequirements.tier2_custom_fields.length > 0 && (
                                            <div className="space-y-3">
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{mt("additionalStep2Information")}</h4>
                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    {locationRequirements.tier2_custom_fields.map((field) => {
                                                        const tier2CustomData = tierData.tier2_custom_fields_data || {};
                                                        const value = tier2CustomData[field.id];
                                                        return (
                                                            <div key={field.id} className="rounded-xl border border-border bg-card p-4">
                                                                <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                                                                    {field.label}
                                                                    {field.required && <span className="text-red-500">*</span>}
                                                                </div>
                                                                {renderCustomFieldValue(field, value)}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                </>
                            )}
                        </section>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="flex-shrink-0 border-t border-border bg-card p-5 sm:p-6">
                    {/* Feedback textarea for Stage 2 review / rejection notes */}
                    {isStep2NeedsReview && (
                        <div className="mb-4">
                            <label className="mb-2 block text-sm font-medium text-foreground">
                                {mt("feedbackLabel")} {mt("feedbackOptional")}
                            </label>
                            <Textarea
                                value={reviewFeedback}
                                onChange={(e) => onFeedbackChange(e.target.value)}
                                placeholder={mt("provideFeedbackForTheApplicant")}
                                rows={3}
                                className="resize-none"
                            />
                        </div>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-3">
                        {isPending && (
                            <div className="flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                                {mt("awaitingAdminStep1Review", {
                                    defaultValue:
                                        "Awaiting Local Cooks review of this request to apply. You can review the application once the chef submits Kitchen Coordination documents.",
                                })}
                            </div>
                        )}

                        {isStep2NeedsReview && (
                            <StatusButton
                                onClick={() => { setActiveAction('approveTier2'); onApproveTier2(); }}
                                status={activeAction === 'approveTier2' && isUpdating ? "loading" : "idle"}
                                disabled={isUpdating && activeAction !== 'approveTier2'}
                                className="min-w-44"
                                labels={{ idle: mt("approveStep2"), loading: mt("approving"), success: mt("approvedSuccess") }}
                            />
                        )}

                        {isFullyApproved && (
                            <StatusButton
                                variant="outline"
                                onClick={() => { setActiveAction('revoke'); onRevokeAccess(); }}
                                status={activeAction === 'revoke' && isUpdating ? "loading" : "idle"}
                                className="border-destructive/30 text-destructive hover:bg-destructive/5"
                                labels={{ idle: mt("revokeAccess"), loading: mt("revoking"), success: mt("revokedSuccess") }}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* Document viewer — the single place where a manager reviews a document */}
            <DocumentViewerDialog
                open={openDocument !== null}
                onOpenChange={(next) => { if (!next) setOpenDocument(null); }}
                title={openDocument?.title ?? ''}
                subtitle={openDocument?.subtitle}
                url={openDocument?.url}
                status={openDocument?.status}
                expiry={openDocument?.expiry}
                reviewNote={openDocument?.reviewNote}
                reviewField={openDocument?.reviewField}
                onVerify={onVerifyDocument}
                labels={{
                    verified: mt("verified"),
                    pending: mt("pending"),
                    rejected: mt("rejected"),
                    needsReplacement: mt("needsAReplacement"),
                    expired: mt("licenseExpired"),
                    verify: mt("verifyDocument"),
                    requestReplacement: mt("requestReplacement"),
                    openInNewTab: mt("openInNewTab"),
                    close: mt("close"),
                    loading: mt("loadingDocument"),
                    loadFailed: mt("documentUnavailable"),
                    // `mt` is ICU-backed, so the value round-trips as a literal.
                    // The dialog then fills the `{date}` placeholder with the real date.
                    expires: mt("expiresLabel", { date: "{date}" }),
                    working: mt("saving"),
                }}
            />
        </>
    );
}

// Helper Components

function InfoCard({ label, value, className }: { label: string; value: string; className?: string }) {
    return (
        <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-1 text-xs text-muted-foreground">{label}</div>
            <div className={cn("text-sm font-medium text-foreground", className)}>{value}</div>
        </div>
    );
}

function DocumentCard({
    title,
    subtitle,
    url,
    status,
    expiry,
    verificationStatus,
    onView,
}: {
    title: string;
    subtitle: string;
    url?: string | null;
    status: 'complete' | 'missing' | 'required' | 'optional';
    expiry?: string | null;
    verificationStatus?: 'pending' | 'approved' | 'rejected' | null;
    onView?: () => void;
}) {
    const expired = !!expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) < Date.now() - 86_400_000;
    const stateNote = url && verificationStatus
        ? expired
            ? mt("expiredNeedsReplacement")
            : verificationStatus === 'rejected'
                ? mt("reviewRejected")
                : verificationStatus === 'approved'
                    ? null
                    : mt("reviewPending")
        : null;

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground">{subtitle}</p>
                    {expiry && (
                        <p className="mt-1 text-xs text-muted-foreground">
                            {mt("expiresLabel", { date: new Date(expiry).toLocaleDateString() })}
                        </p>
                    )}
                    {stateNote && (
                        <p className={cn("mt-1 text-xs font-medium", expired || verificationStatus === 'rejected' ? "text-destructive" : "text-muted-foreground")}>
                            {stateNote}
                        </p>
                    )}
                </div>
            </div>
            {url ? (
                <div className="flex shrink-0 flex-col items-end gap-2 self-start">
                    <VerifiedDocumentChip status={verificationStatus} url={url} expiry={expiry} />
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onView}
                        className="gap-2 border border-border hover:bg-muted"
                    >
                        <Eye className="h-3.5 w-3.5" />
                        {mt("view")}
                    </Button>
                </div>
            ) : status === 'required' ? (
                <Badge variant="outline" className="text-xs">{mt("required")}</Badge>
            ) : null}
        </div>
    );
}
