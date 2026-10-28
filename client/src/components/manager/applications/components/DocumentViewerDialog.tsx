"use client"

/**
 * One document, as the kitchen checks it (owner-approved mocks k1 and k3, Oct 27): what it is and who sent it, the facts
 * to compare (Expires · Sent · Your setting, one date format), the file, then Verify or Ask for a new copy. Asking needs a
 * note; the customer reads it on their documents page and in the email.
 */
import { useEffect, useMemo, useState } from "react";
import { fromCalendarDate } from "@/lib/calendar-date";
import { accessDocumentStage } from "@shared/location-booking-eligibility";
import { mt } from "@/i18n/manager";
import i18n from "@/i18n";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusButton } from "@/components/ui/status-button";
import { Textarea } from "@/components/ui/textarea";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";
import { auth } from "@/lib/firebase";
import { AlertTriangle, ExternalLink, FileText } from "@/components/ui/manager-icons";
import { cn } from "@/lib/utils";

/** A built-in document's status column, or one of the kitchen's own documents ("custom:<field id>"). */
export type DocumentVerificationField = "foodSafetyLicenseStatus" | "foodEstablishmentCertStatus" | "insuranceStatus" | `custom:${string}`;
export type DocumentVerificationStatus = "pending" | "approved" | "rejected" | null | undefined;

type PendingAction = "approve" | "reject" | null;

interface DocumentViewerDialogProps {
    applicationId: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    /** "From {name}", or what this file is (a renewal). */
    subtitle?: string;
    /** Raw (private R2) document URL. The dialog resolves a presigned URL itself. */
    url: string | null | undefined;
    status?: DocumentVerificationStatus;
    /** The copy's expiry; null = no expiry; undefined = not a dated document (no facts row entry). */
    expiry?: string | null;
    /** When this copy was sent, and the kitchen's own setting for it ("Required to book"). */
    sentAt?: string | null;
    setting?: string | null;
    /** Review outcome copy for the current status, when actionable. */
    reviewNote?: string | null;
    /** The customer's first name, for "What should {name} fix?". */
    customerName?: string;
    /** "1 more document from {name} is waiting after this one." */
    waitingNote?: string | null;
    /** Under the note box: asking keeps new bookings paused (only when this document pauses them). */
    pausedNote?: string | null;
    /** When provided, the kitchen can verify the document or ask for a new copy with a note. */
    reviewField?: DocumentVerificationField;
    onVerify?: (field: DocumentVerificationField, status: "approved" | "rejected", note?: string) => void;
    labels: {
        verified: string;
        pending: string;
        rejected: string;
        needsReplacement: string;
        expired: string;
        verify: string;
        openInNewTab: string;
        close: string;
        loading: string;
        loadFailed: string;
        expires: string;
        /** Optional heading shown while a review mutation is in flight. */
        working?: string;
    };
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?.*)?$/i;

function resolveKind(url: string | null | undefined): "image" | "pdf" | "other" | "none" {
    if (!url) return "none";
    const path = url.split("#")[0].split("?")[0];
    if (IMAGE_EXT.test(path)) return "image";
    if (/\.pdf$/i.test(path)) return "pdf";
    return "other";
}

/** "Oct 27, 2027": one date format everywhere in the dialog. Expiry is a calendar date; sent is a moment. */
const shortDate = (value: string, calendar: boolean) =>
    (calendar ? fromCalendarDate(value) : new Date(value)).toLocaleDateString(i18n.language, { month: "short", day: "numeric", year: "numeric" });

export function DocumentViewerDialog({
    applicationId,
    open,
    onOpenChange,
    title,
    subtitle,
    url,
    status,
    expiry,
    sentAt,
    setting,
    reviewNote,
    customerName,
    waitingNote,
    pausedNote,
    reviewField,
    onVerify,
    labels,
}: DocumentViewerDialogProps) {
    const { url: signedUrl } = usePresignedDocumentUrl(url);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState(false);
    const [assetFailed, setAssetFailed] = useState(false);
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);
    const [asking, setAsking] = useState(false);
    const [note, setNote] = useState("");

    // Clear transient state whenever the dialog is (re)opened for a new document.
    useEffect(() => {
        if (!open) setPendingAction(null);
        setAssetFailed(false);
        setAsking(false);
        setNote("");
    }, [open, url]);

    useEffect(() => {
        if (!open || !url) return;
        let cancelled = false;
        let objectUrl: string | null = null;
        setPreviewUrl(null);
        setPreviewError(false);
        setPreviewLoading(true);
        (async () => {
            try {
                const token = await auth.currentUser?.getIdToken();
                if (!token) throw new Error("Not authenticated");
                const response = await fetch(`/api/files/kitchen-application/${applicationId}/preview?url=${encodeURIComponent(url)}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    credentials: "include",
                });
                if (!response.ok) throw new Error("Preview unavailable");
                objectUrl = URL.createObjectURL(await response.blob());
                if (!cancelled) setPreviewUrl(objectUrl);
            } catch {
                if (!cancelled) setPreviewError(true);
            } finally {
                if (!cancelled) setPreviewLoading(false);
            }
        })();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [open, url, applicationId]);

    const kind = useMemo(() => resolveKind(url), [url]);
    const expired = accessDocumentStage(expiry) === "expired";
    const canReview = Boolean(reviewField && onVerify);
    const isBusy = pendingAction !== null;

    const statusChip = (() => {
        if (asking) return { label: mt("dvAsking"), tone: "red" as const };
        if (expired) return { label: labels.expired, tone: "red" as const };
        if (status === "approved") return { label: labels.verified, tone: "green" as const };
        if (status === "rejected") return { label: mt("arStatusReplace"), tone: "red" as const };
        if (status === "pending") return { label: canReview ? mt("arStatusToCheck") : labels.pending, tone: "amber" as const };
        return null;
    })();

    const review = (decision: "approved" | "rejected") => {
        if (!reviewField || !onVerify) return;
        setPendingAction(decision === "approved" ? "approve" : "reject");
        onVerify(reviewField, decision, decision === "rejected" ? note.trim() : undefined);
    };

    const openInNewTab = () => {
        const href = signedUrl || url;
        if (href) window.open(href, "_blank", "noopener,noreferrer");
    };
    const facts: [string, string][] = [];
    if (expiry !== undefined) facts.push([mt("dvExpires"), expiry ? shortDate(expiry, true) : mt("dvNoExpiry")]);
    if (sentAt) facts.push([mt("dvSent"), shortDate(sentAt, false)]);
    if (setting) facts.push([mt("dvYourSetting"), setting]);
    const noteId = `ask-note-${applicationId}`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[92vh] sm:w-[96vw] sm:rounded-2xl"
                overlayClassName="bg-black/40"
                aria-describedby={undefined}
            >
                {/* What it is, who sent it, where it stands */}
                <DialogHeader className="flex-shrink-0 space-y-0 border-b border-border px-5 py-4 text-left sm:px-6">
                    <div className="flex items-start justify-between gap-3 pr-9">
                        <div className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                <FileText className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                                <DialogTitle className="text-base font-semibold tracking-tight text-foreground">{title}</DialogTitle>
                                {subtitle ? <DialogDescription className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</DialogDescription> : null}
                            </div>
                        </div>
                        {statusChip ? (
                            <span className={cn("inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium",
                                statusChip.tone === "green" && "bg-emerald-50 text-emerald-800",
                                statusChip.tone === "red" && "bg-red-50 text-red-800",
                                statusChip.tone === "amber" && "bg-amber-50 text-amber-900")} data-testid="document-status">
                                {statusChip.label}
                            </span>
                        ) : null}
                    </div>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto mobile-momentum-scroll">
                    {facts.length > 0 && (
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-3 sm:px-6">
                            {facts.map(([term, value]) => <div key={term}><dt className="text-[13px] text-muted-foreground">{term}</dt><dd className="font-medium tabular-nums text-foreground">{value}</dd></div>)}
                        </dl>
                    )}
                    <div className="bg-muted/50 px-4 py-5 sm:px-6">
                        {!url ? (
                            <Placeholder icon={<FileText className="h-6 w-6 text-muted-foreground" />} text={labels.loadFailed} />
                        ) : previewLoading ? (
                            <div role="status" aria-label={labels.loading}><Skeleton className="mx-auto h-[360px] w-full max-w-[520px] rounded-md" /></div>
                        ) : previewError || assetFailed || !previewUrl ? (
                            <Placeholder icon={<AlertTriangle className="h-6 w-6 text-destructive" />} text={labels.loadFailed} />
                        ) : kind === "image" ? (
                            <img src={previewUrl} alt={title} onError={() => setAssetFailed(true)}
                                className="mx-auto max-h-[56vh] w-auto max-w-full bg-card object-contain shadow-[0_1px_4px_rgba(0,0,0,0.12)]" />
                        ) : kind === "pdf" ? (
                            <iframe src={previewUrl} title={title} className="h-[56vh] w-full bg-card shadow-[0_1px_4px_rgba(0,0,0,0.12)]" />
                        ) : (
                            <Placeholder icon={<FileText className="h-6 w-6 text-muted-foreground" />} text={subtitle || title} />
                        )}
                        {url ? (
                            <p className="mt-3 text-center">
                                <button type="button" onClick={openInNewTab} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground hover:underline">
                                    <ExternalLink className="h-4 w-4" />{labels.openInNewTab}
                                </button>
                            </p>
                        ) : null}
                    </div>
                </div>

                <div className="flex-shrink-0 border-t border-border bg-card px-5 py-4 sm:px-6">
                    {asking ? (
                        <div>
                            <label htmlFor={noteId} className="block text-sm font-medium text-foreground">{mt("dvAskLabel", { name: customerName || mt("dvTheCustomer") })}</label>
                            <p className="mt-0.5 text-[13px] text-muted-foreground">{mt("dvAskHelp")}</p>
                            <Textarea id={noteId} value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={3} autoFocus disabled={isBusy} className="mt-2 min-h-[88px] resize-none" />
                            {pausedNote ? <p className="mt-2 text-[13px] text-muted-foreground">{pausedNote}</p> : null}
                            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end max-sm:[&>*]:w-full">
                                <Button type="button" variant="ghost" onClick={() => { setAsking(false); setNote(""); }} disabled={isBusy}>{mt("dvBack")}</Button>
                                <StatusButton className="w-full sm:w-auto" onClick={() => review("rejected")} status={pendingAction === "reject" ? "loading" : "idle"} disabled={isBusy || !note.trim()}
                                    labels={{ idle: mt("dvSendRequest"), loading: labels.working || mt("dvSendRequest"), success: mt("dvSendRequest") }} />
                            </div>
                        </div>
                    ) : canReview ? (
                        <>
                            {(reviewNote || waitingNote) ? <p className="mb-3 text-[13px] text-muted-foreground">{[reviewNote, waitingNote].filter(Boolean).join(" ")}</p> : null}
                            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end max-sm:[&>*]:w-full">
                                {status !== "rejected" && <Button type="button" variant="outline" onClick={() => setAsking(true)} disabled={isBusy}>{mt("dvAskNewCopy")}</Button>}
                                {expired ? (
                                    <span className="inline-flex h-10 items-center justify-center rounded-full bg-red-50 px-4 text-sm font-medium text-red-800">{labels.needsReplacement}</span>
                                ) : (
                                    <StatusButton className="w-full sm:w-auto" onClick={() => review("approved")} status={pendingAction === "approve" ? "loading" : "idle"} disabled={isBusy || status === "approved"}
                                        labels={{ idle: labels.verify, loading: labels.working || labels.verify, success: labels.verified }} />
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            {reviewNote ? <p className="mb-3 text-[13px] text-muted-foreground">{reviewNote}</p> : null}
                            <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="hover:bg-muted">{labels.close}</Button></div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function Placeholder({ icon, text }: { icon: React.ReactNode; text: string }) {
    return (
        <div className="flex min-h-[38vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/60 px-6 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">{icon}</span>
            <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
        </div>
    );
}

DocumentViewerDialog.displayName = "DocumentViewerDialog";
