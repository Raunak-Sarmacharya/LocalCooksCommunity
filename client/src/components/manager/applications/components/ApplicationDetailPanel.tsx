"use client"
/**
 * One access request, as the kitchen reviews it (rebuilt Oct 24, owner).
 *
 * Leads with what the kitchen has to decide: where the request stands, the one next action, then the booking
 * requirements checklist (every document the kitchen asks for, including its own, and every answer). The request
 * to apply the customer sent comes after, with readable values. Local Cooks' first-step review is never mentioned.
 */
import { accessDocumentStage, customDocumentFields, isKitchenDocument } from "@shared/location-booking-eligibility";
import { fromCalendarDate } from "@/lib/calendar-date";
import { formatPreferredSchedule } from "@/lib/preferred-schedule";
import { mt } from "@/i18n/manager";
import i18n from "@/i18n";
import { useState, useEffect, useRef, type ReactNode } from "react"
import { Link } from "wouter"
import { Application } from "../types"
import { Button } from "@/components/ui/button"
import { StatusButton } from "@/components/ui/status-button"
import { Textarea } from "@/components/ui/textarea"
import { DocumentViewerDialog, type DocumentVerificationField, type DocumentVerificationStatus } from "./DocumentViewerDialog"
import { DocumentRenewalReview } from "./DocumentRenewalReview"
import { Checkbox } from "@/components/ui/checkbox"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { parseBusinessInfo } from "@/utils/parseBusinessInfo"
import { REQUEST_TO_APPLY_BUSINESS_TYPES, REQUEST_TO_APPLY_FREQUENCIES } from "@/components/kitchen-application/request-to-apply-fields"
import { customerHref } from "@/components/manager/customers/customer-format"
import { Mail, Phone, MessageCircle, Check } from "@/components/ui/manager-icons"
import { cn } from "@/lib/utils"
import { accessRequestTab } from "../AccessRequestsList"

interface RequirementField {
    id: string;
    label: string;
    type: string;
    required?: boolean;
    options?: string[];
    description?: string;
    document?: boolean;
    expires?: boolean;
}

interface LocationRequirements {
    tier1_custom_fields?: RequirementField[];
    tier2_custom_fields?: RequirementField[];
    tier2_insurance_document_required?: boolean;
    tier2_food_establishment_cert_required?: boolean;
    tier2_kitchen_experience_required?: boolean;
    food_handler_cert_tracked?: boolean;
    food_establishment_cert_tracked?: boolean;
    insurance_tracked?: boolean;
    /** The admin's request-phase question flag (not used for tier-2 gating). */
    requireFoodHandlerCert?: boolean;
    /** The kitchen's tier-2 upload flag, served by the public requirements endpoint. */
    requireFoodSafetyUpload?: boolean;
}

interface ApplicationDetailPanelProps {
    application: Application;
    locationRequirements?: LocationRequirements | null;
    onApprove: () => void;
    onApproveTier2: () => void;
    onVerifyDocument: (field: DocumentVerificationField, status: 'approved' | 'rejected') => void;
    onReviewRenewal?: (field: DocumentVerificationField, decision: 'approved' | 'rejected', reason?: string) => void | Promise<void>;
    /** Approve for booking without the booking requirements (the kitchen confirmed it takes responsibility). */
    onApproveWithoutDocuments?: () => void | Promise<void>;
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

type DocMode = 'required' | 'track' | 'none';
const dateLong = (value: string) => fromCalendarDate(value).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', year: 'numeric' });
const dayOf = (value?: string | null) => value ? new Date(value).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
const kitchenLabel = (key: string, fallback: string) => i18n.t(key, { ns: 'kitchen', defaultValue: fallback });

export function ApplicationDetailPanel({
    application,
    locationRequirements,
    onApproveTier2,
    onVerifyDocument,
    onReviewRenewal,
    onReject,
    onRevokeAccess,
    onOpenChat,
    isUpdating,
    reviewFeedback,
    onFeedbackChange,
    onApproveWithoutDocuments,
}: ApplicationDetailPanelProps) {
    const [waiverOpen, setWaiverOpen] = useState(false);
    const [waiverConfirmed, setWaiverConfirmed] = useState(false);
    const [declineOpen, setDeclineOpen] = useState(false);
    const [activeAction, setActiveAction] = useState<string | null>(null);
    const [openDocument, setOpenDocument] = useState<OpenDocument | null>(null);

    useEffect(() => { if (!isUpdating) setActiveAction(null); }, [isUpdating]);

    // Close the viewer only when a review mutation actually finishes (true → false),
    // so the list reflects the new document state instead of a stale preview.
    const wasUpdatingRef = useRef(false);
    useEffect(() => {
        if (isUpdating) wasUpdatingRef.current = true;
        else if (wasUpdatingRef.current) { wasUpdatingRef.current = false; setOpenDocument(null); }
    }, [isUpdating]);

    const tier = application.current_tier ?? 1;
    const tab = accessRequestTab(application);
    const isApproved = application.status === 'approved' && tier >= 3;
    const isStep2NeedsReview = application.status === 'approved' && tier === 2 && !!application.tier2_completed_at;
    const documentsWaived = !!application.documentsWaivedAt;
    const canWaive = !!onApproveWithoutDocuments && application.status === 'approved' && tier < 3 && !documentsWaived;
    const firstName = application.fullName.split(/\s+/)[0] || application.fullName;
    const reviewable = isStep2NeedsReview || isApproved;
    const sent = !!application.tier2_completed_at;

    const businessInfo = parseBusinessInfo(application.businessDescription);
    const preferredDays = formatPreferredSchedule(businessInfo?.preferredSchedule, i18n.language, mt("fullDay"));
    const tierData = (application.tier_data || {}) as Record<string, any>;
    const tierFiles = (tierData.tierFiles || {}) as Record<string, any>;
    const answers = (tierData.tier2_custom_fields_data || {}) as Record<string, any>;
    const insuranceUrl = application.insuranceUrl || tierFiles.tier2_insurance_document;
    const r = locationRequirements;
    const modeOf = (required?: boolean, tracked?: boolean): DocMode => required ? 'required' : tracked ? 'track' : 'none';

    const isExpired = (value?: string | null) => accessDocumentStage(value) === 'expired';
    const reviewNoteFor = (status: DocumentVerificationStatus, expiry?: string | null, verifiedBy?: string): string | null => {
        if (!status) return null;
        if (isExpired(expiry)) return mt("documentExpiredNeedsReplacement");
        if (status === 'approved' && accessDocumentStage(expiry)) return mt('accessDocumentExpiringSoon');
        if (status === 'approved') return verifiedBy === 'manager' ? mt("documentVerifiedNote") : mt("documentVerifiedGeneric");
        if (status === 'rejected') return mt("documentRejectedNote");
        return mt("documentPendingNote");
    };
    const renewalReview = (key: string, title: string, field: DocumentVerificationField) => {
        const renewal = (application.documentRenewals || []).find(item => item.key === key && item.status === 'pending');
        if (!renewal || !onReviewRenewal) return null;
        return <DocumentRenewalReview renewal={renewal} document={title} busy={isUpdating}
            onView={() => setOpenDocument({ title, subtitle: mt("renewalSubmittedTitle", { document: title }), url: renewal.url, status: 'pending', expiry: renewal.expiry })}
            onReview={(decision, reason) => onReviewRenewal(field, decision, reason)} />;
    };

    // Every document this kitchen asks for, built-in first, then its own dated documents.
    type DocRow = { key: string; title: string; mode: DocMode; url?: string | null; status?: DocumentVerificationStatus; expiry?: string | null; field?: DocumentVerificationField; verifiedBy?: string; renewal?: ReactNode };
    const docs: DocRow[] = [];
    const foodSafetyMode = modeOf(r?.requireFoodSafetyUpload, r?.food_handler_cert_tracked);
    if (foodSafetyMode !== 'none' || application.foodSafetyLicenseUrl) docs.push({ key: 'foodSafety', title: mt("arDocFoodSafety"), mode: foodSafetyMode, url: application.foodSafetyLicenseUrl, status: application.foodSafetyLicenseStatus, expiry: application.foodSafetyLicenseExpiry, field: 'foodSafetyLicenseStatus', verifiedBy: tierData.documentVerification?.foodSafetyLicense, renewal: renewalReview('foodSafetyLicense', mt("arDocFoodSafety"), 'foodSafetyLicenseStatus') });
    const establishmentMode = modeOf(r?.tier2_food_establishment_cert_required, r?.food_establishment_cert_tracked);
    if (establishmentMode !== 'none' || application.foodEstablishmentCertUrl) docs.push({ key: 'establishment', title: mt("arDocEstablishment"), mode: establishmentMode, url: application.foodEstablishmentCertUrl, status: application.foodEstablishmentCertStatus, expiry: application.foodEstablishmentCertExpiry, field: 'foodEstablishmentCertStatus', verifiedBy: tierData.documentVerification?.foodEstablishmentCert, renewal: renewalReview('foodEstablishmentCert', mt("arDocEstablishment"), 'foodEstablishmentCertStatus') });
    const insuranceMode = modeOf(r?.tier2_insurance_document_required, r?.insurance_tracked);
    if (insuranceMode !== 'none' || insuranceUrl) docs.push({ key: 'insurance', title: mt("arDocInsurance"), mode: insuranceMode, url: insuranceUrl, status: application.insuranceStatus, expiry: application.insuranceExpiry, field: application.insuranceUrl ? 'insuranceStatus' : undefined, verifiedBy: tierData.documentVerification?.insurance, renewal: renewalReview('insurance', mt("arDocInsurance"), 'insuranceStatus') });
    for (const field of (r?.tier2_custom_fields || []).filter(isKitchenDocument)) {
        const own = customDocumentFields(application, field.id);
        docs.push({ key: field.id, title: field.label, mode: field.required ? 'required' : 'track', url: own.url, expiry: own.expiry,
            status: own.status as DocumentVerificationStatus, field: `custom:${field.id}`, verifiedBy: tierData.documentVerification?.[`custom:${field.id}`],
            renewal: renewalReview(`custom:${field.id}`, field.label, `custom:${field.id}`) });
    }
    const questions = (r?.tier2_custom_fields || []).filter(f => !isKitchenDocument(f));
    const experience = tierData.kitchen_experience_description as string | undefined;

    const docStatus = (doc: DocRow): { label: string; tone: 'muted' | 'amber' | 'green' | 'red' } => {
        if (!doc.url) return { label: documentsWaived ? mt("arStatusWaived") : mt("arStatusNotSent"), tone: 'muted' };
        if (isExpired(doc.expiry)) return { label: mt("arStatusExpired"), tone: 'red' };
        if (!doc.field) return { label: mt("arStatusSent"), tone: 'muted' };
        if (doc.status === 'approved') return { label: mt("arStatusVerified"), tone: 'green' };
        if (doc.status === 'rejected') return { label: mt("arStatusReplace"), tone: 'red' };
        return { label: mt("arStatusToCheck"), tone: 'amber' };
    };
    const openDoc = (doc: DocRow) => setOpenDocument({
        title: doc.title, url: doc.url, status: doc.status, expiry: doc.expiry,
        reviewNote: doc.field ? reviewNoteFor(doc.status, doc.expiry, doc.verifiedBy) : null,
        reviewField: doc.field && reviewable ? doc.field : undefined,
    });

    const answerOf = (field: RequirementField, value: unknown): ReactNode => {
        if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return <span className="text-muted-foreground">{sent ? mt("arNoAnswer") : mt("arStatusNotSent")}</span>;
        if (field.type === 'checkbox') return Array.isArray(value) ? value.join(', ') : value ? <span className="inline-flex items-center gap-1"><Check className="h-4 w-4 text-emerald-700" />{mt("arAgreed")}</span> : mt("arNoAnswer");
        if (field.type === 'date' && typeof value === 'string') return dateLong(value);
        if ((field.type === 'file' || field.type === 'cloudflare_upload') && typeof value === 'string' && (value.startsWith('http') || value.startsWith('/')))
            return <Button type="button" size="sm" variant="outline" className="mt-1" onClick={() => setOpenDocument({ title: field.label, url: value })}>{mt("view")}</Button>;
        return String(value);
    };

    // Readable request-to-apply values (the stored ones are ids like "few-times-month").
    const businessType = REQUEST_TO_APPLY_BUSINESS_TYPES.find(o => o.value === businessInfo?.businessType);
    const frequency = REQUEST_TO_APPLY_FREQUENCIES.find(o => o.value === businessInfo?.usageFrequency);
    const requestRows: [string, ReactNode][] = [
        [mt("businessName"), businessInfo?.businessName],
        [mt("arBusinessType"), businessType ? kitchenLabel(businessType.key, businessType.fallback) : businessInfo?.businessType],
        [mt("arHowOften"), frequency ? kitchenLabel(frequency.key, frequency.fallback) : businessInfo?.usageFrequency],
        [mt("sessionDuration"), businessInfo?.sessionDuration ? mt("hoursSession", { count: businessInfo.sessionDuration }) : null],
        [mt("arExperience"), businessInfo?.experience ? mt("yearsExperience", { count: businessInfo.experience }) : null],
        [mt("preferredDays"), preferredDays],
        [mt("arFoodSafetyAnswer"), application.foodSafetyLicense === 'yes' ? mt("arYes") : application.foodSafetyLicense === 'no' ? mt("arNo") : mt("arNotSure")],
        ...((r?.tier1_custom_fields || []).map(field => [field.label, answerOf(field, (application.customFieldsData || {})[field.id])] as [string, ReactNode])),
    ];

    // Where the request stands, in the customer's journey.
    const stages = [
        { title: mt("arStageRequest"), note: mt("arStageApproved", { date: dayOf(application.tier1_completed_at || application.reviewedAt) || '' }), state: 'done' as const },
        { title: mt("step2"), note: documentsWaived ? mt("arStageWaived") : sent ? mt("arStageSent", { date: dayOf(application.tier2_completed_at) }) : mt("arStageWaiting"), state: (isApproved ? 'done' : 'current') as 'done' | 'current' },
        { title: mt("arStageCanBook"), note: isApproved ? mt("arStageCanBookNote") : null, state: (isApproved ? 'done' : 'next') as 'done' | 'next' },
    ];

    const statusPill = application.status === 'rejected' ? mt("arTabDeclined") : isApproved ? (documentsWaived ? mt("arPillApprovedWaived") : mt("approved")) : tab === 'review' ? mt("arPillToReview") : mt("arTabWaiting");

    return (
        <>
            <div className="space-y-6">
                {/* Who, where, and how to reach them */}
                <header className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{application.fullName}</h1>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {[businessInfo?.businessName, application.location?.name].filter(Boolean).join(' · ')}
                            </p>
                        </div>
                        <span className={cn("rounded-full px-3 py-1 text-xs font-medium",
                            tab === 'review' ? "bg-amber-100 text-amber-900" : application.status === 'rejected' ? "bg-muted text-muted-foreground" : isApproved ? "bg-emerald-50 text-emerald-800" : "bg-muted text-foreground")}>
                            {statusPill}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                        <a href={`mailto:${application.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-foreground hover:underline"><Mail className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{application.email}</span></a>
                        {application.phone && <a href={`tel:${application.phone}`} className="inline-flex items-center gap-1.5 text-foreground hover:underline"><Phone className="h-4 w-4 text-muted-foreground" />{application.phone}</a>}
                        {/* While waiting, the next-step card below carries Message. */}
                        {application.status === 'approved' && tab !== 'waiting' && (
                            <Button type="button" variant="outline" size="sm" onClick={onOpenChat} className="gap-1.5"><MessageCircle className="h-4 w-4" />{mt("arMessage", { name: firstName })}</Button>
                        )}
                    </div>
                </header>

                {/* Journey */}
                <ol className="grid gap-3 sm:grid-cols-3">
                    {stages.map((stage, index) => (
                        <li key={stage.title} className={cn("rounded-xl border p-3", stage.state === 'current' && "border-foreground/30 bg-muted/30")}>
                            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                                <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]",
                                    stage.state === 'done' ? "bg-emerald-600 text-white" : stage.state === 'current' ? "bg-foreground text-background" : "border text-muted-foreground")}>
                                    {stage.state === 'done' ? <Check className="h-3 w-3" /> : index + 1}
                                </span>
                                {stage.title}
                            </p>
                            {stage.note && <p className="mt-1 pl-7 text-xs text-muted-foreground">{stage.note}</p>}
                        </li>
                    ))}
                </ol>

                {/* The one next step */}
                {application.status === 'rejected' ? (
                    <section className="rounded-xl border p-4">
                        <h2 className="text-sm font-semibold text-foreground">{mt("arDeclinedTitle", { date: dayOf(application.reviewedAt || application.updatedAt) })}</h2>
                        {application.feedback && <p className="mt-1 text-sm text-muted-foreground">“{application.feedback}”</p>}
                    </section>
                ) : isApproved ? (
                    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                        <div className="min-w-0">
                            <h2 className="text-sm font-semibold text-foreground">{mt("arApprovedTitle", { name: firstName })}</h2>
                            <p className="mt-0.5 text-sm text-muted-foreground">{documentsWaived ? mt("documentsWaivedNote") : mt("arApprovedBody")}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <StatusButton variant="outline" onClick={() => { setActiveAction('revoke'); onRevokeAccess(); }}
                                status={activeAction === 'revoke' && isUpdating ? "loading" : "idle"}
                                className="text-destructive hover:bg-destructive/5"
                                labels={{ idle: mt("revokeAccess"), loading: mt("revoking"), success: mt("revokedSuccess") }} />
                            <Button asChild><Link href={customerHref(application.chefId, application.locationId)}>{mt("arOpenCustomer")}</Link></Button>
                        </div>
                    </section>
                ) : (
                    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-foreground/15 bg-card p-4 sm:p-5">
                        <div className="min-w-0 max-w-xl">
                            <h2 className="text-base font-semibold text-foreground">{isStep2NeedsReview ? mt("arNextReviewTitle") : mt("arNextWaitingTitle", { name: firstName })}</h2>
                            <p className="mt-1 text-sm text-muted-foreground">{isStep2NeedsReview ? mt("arNextReviewBody") : mt("arNextWaitingBody")}</p>
                        </div>
                        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:flex-wrap [&>*]:w-full sm:[&>*]:w-auto">
                            {canWaive && (
                                <Button type="button" variant="ghost" onClick={() => { setWaiverConfirmed(false); setWaiverOpen(true); }} disabled={isUpdating} data-testid="approve-without-documents">
                                    {mt("approveWithoutDocuments")}
                                </Button>
                            )}
                            {isStep2NeedsReview ? (
                                <>
                                    <Button type="button" variant="outline" onClick={() => setDeclineOpen(true)} disabled={isUpdating}>{mt("arDecline")}</Button>
                                    <StatusButton onClick={() => { setActiveAction('approveTier2'); onApproveTier2(); }}
                                        status={activeAction === 'approveTier2' && isUpdating ? "loading" : "idle"}
                                        disabled={isUpdating && activeAction !== 'approveTier2'}
                                        className="w-full sm:w-auto"
                                        labels={{ idle: mt("arApproveForBooking"), loading: mt("approving"), success: mt("approvedSuccess") }} />
                                </>
                            ) : (
                                <Button type="button" onClick={onOpenChat} className="gap-1.5"><MessageCircle className="h-4 w-4" />{mt("arMessage", { name: firstName })}</Button>
                            )}
                        </div>
                    </section>
                )}

                {/* Booking requirements: every document and answer */}
                <section className="rounded-xl border bg-card">
                    <div className="border-b px-4 py-3 sm:px-5">
                        <h2 className="text-base font-semibold text-foreground">{mt("step2")}</h2>
                        <p className="text-sm text-muted-foreground">{sent ? mt("arStageSent", { date: dayOf(application.tier2_completed_at) }) : documentsWaived ? mt("arStageWaived") : mt("arNotSentYet", { name: firstName })}</p>
                    </div>
                    {documentsWaived && (
                        <p className="border-b bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground sm:px-5" data-testid="documents-waived-note">{mt("documentsWaivedNote")}</p>
                    )}
                    {docs.length > 0 && (
                        <div className="px-4 py-3 sm:px-5">
                            <h3 className="text-xs font-medium text-muted-foreground">{mt("qbDocumentsTitle")}</h3>
                            <ul className="mt-1 divide-y">
                                {docs.map(doc => {
                                    const status = docStatus(doc);
                                    return (
                                        <li key={doc.key} className="py-3">
                                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-foreground">{doc.title}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {doc.mode === 'required' ? mt("docModeRequired") : doc.mode === 'track' ? mt("docModeTrack") : mt("arOnFile")}
                                                        {doc.expiry ? ` · ${isExpired(doc.expiry) ? mt("arExpired", { date: dateLong(doc.expiry) }) : mt("arExpires", { date: dateLong(doc.expiry) })}` : ''}
                                                    </p>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-3">
                                                    <span className={cn("text-xs font-medium",
                                                        status.tone === 'green' && "text-emerald-700", status.tone === 'amber' && "text-amber-800",
                                                        status.tone === 'red' && "text-red-700", status.tone === 'muted' && "text-muted-foreground")}>{status.label}</span>
                                                    {doc.url && (
                                                        <Button type="button" size="sm" variant={status.tone === 'amber' && reviewable ? 'default' : 'outline'} onClick={() => openDoc(doc)}>
                                                            {status.tone === 'amber' && reviewable ? mt("arCheck") : mt("view")}
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                            {doc.renewal && <div className="mt-3">{doc.renewal}</div>}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                    {(questions.length > 0 || r?.tier2_kitchen_experience_required || experience) && (
                        <div className="border-t px-4 py-3 sm:px-5">
                            <h3 className="text-xs font-medium text-muted-foreground">{mt("customQuestionsForKitchenApplications")}</h3>
                            <dl className="mt-1 divide-y">
                                {(r?.tier2_kitchen_experience_required || experience) && (
                                    <div className="py-3"><dt className="text-sm text-muted-foreground">{mt("arKitchenExperience")}</dt><dd className="mt-0.5 whitespace-pre-line text-sm text-foreground">{experience || <span className="text-muted-foreground">{sent ? mt("arNoAnswer") : mt("arStatusNotSent")}</span>}</dd></div>
                                )}
                                {questions.map(field => (
                                    <div key={field.id} className="py-3">
                                        <dt className="text-sm text-muted-foreground">{field.label}</dt>
                                        <dd className="mt-0.5 whitespace-pre-line text-sm text-foreground">{answerOf(field, answers[field.id])}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    )}
                    {!docs.length && !questions.length && !r?.tier2_kitchen_experience_required && (
                        <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">{mt("arNoRequirements")}</p>
                    )}
                </section>

                {/* What the customer sent with their request to apply */}
                <section className="rounded-xl border bg-card">
                    <div className="border-b px-4 py-3 sm:px-5">
                        <h2 className="text-base font-semibold text-foreground">{mt("arStageRequest")}</h2>
                        <p className="text-sm text-muted-foreground">{mt("arRequestSent", { date: dayOf(application.createdAt) })}</p>
                    </div>
                    <dl className="grid gap-x-6 px-4 py-2 sm:grid-cols-2 sm:px-5">
                        {requestRows.filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) => (
                            <div key={label} className="border-b py-3 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                                <dt className="text-sm text-muted-foreground">{label}</dt>
                                <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
                            </div>
                        ))}
                    </dl>
                    {businessInfo?.description && (
                        <div className="border-t px-4 py-3 sm:px-5">
                            <p className="text-sm text-muted-foreground">{mt("arAboutBusiness")}</p>
                            <p className="mt-0.5 whitespace-pre-line text-sm text-foreground">{businessInfo.description}</p>
                        </div>
                    )}
                </section>
            </div>

            {/* Decline asks for the note the customer will see. */}
            <AlertDialog open={declineOpen} onOpenChange={setDeclineOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{mt("arDeclineTitle", { name: firstName })}</AlertDialogTitle>
                        <AlertDialogDescription>{mt("arDeclineBody")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <Textarea value={reviewFeedback} onChange={(e) => onFeedbackChange(e.target.value)} placeholder={mt("arDeclinePlaceholder")} rows={4} className="resize-none" aria-label={mt("arDeclineTitle", { name: firstName })} />
                    <AlertDialogFooter>
                        <AlertDialogCancel>{mt("cancel")}</AlertDialogCancel>
                        <Button variant="destructive" disabled={!reviewFeedback.trim() || isUpdating} onClick={() => { setActiveAction('reject'); onReject(); setDeclineOpen(false); }}>
                            {mt("arDecline")}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* "Approve without booking requirements": who, what it skips, and the kitchen's responsibility, before it happens. */}
            <AlertDialog open={waiverOpen} onOpenChange={setWaiverOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{mt("waiverTitle", { name: application.fullName })}</AlertDialogTitle>
                        <AlertDialogDescription>{mt("waiverBody")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                        <Checkbox checked={waiverConfirmed} onCheckedChange={(checked) => setWaiverConfirmed(checked === true)} className="mt-0.5" aria-label={mt("waiverConfirm")} />
                        <span>{mt("waiverConfirm")}</span>
                    </label>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{mt("cancel")}</AlertDialogCancel>
                        <Button disabled={!waiverConfirmed || isUpdating} onClick={async () => { setActiveAction('waive'); await onApproveWithoutDocuments?.(); setWaiverOpen(false); }}>
                            {mt("waiverApprove")}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Document viewer — the single place where a manager reviews a document */}
            <DocumentViewerDialog
                applicationId={application.id}
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
