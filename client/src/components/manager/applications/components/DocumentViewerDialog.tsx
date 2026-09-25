"use client"

import { useEffect, useMemo, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";
import {
    AlertTriangle,
    Check,
    Clock,
    ExternalLink,
    FileText,
    Loader2,
    X,
} from "@/components/ui/manager-icons";
import { cn } from "@/lib/utils";

export type DocumentVerificationField = "foodSafetyLicenseStatus" | "foodEstablishmentCertStatus";
export type DocumentVerificationStatus = "pending" | "approved" | "rejected" | null | undefined;

type PendingAction = "approve" | "reject" | null;

interface DocumentViewerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    subtitle?: string;
    /** Raw (private R2) document URL. The dialog resolves a presigned URL itself. */
    url: string | null | undefined;
    status?: DocumentVerificationStatus;
    expiry?: string | null;
    /** Review outcome copy for the current status, when actionable. */
    reviewNote?: string | null;
    /**
     * When provided, the dialog lets a manager verify the document or request a
     * replacement. Omit it for read-only documents (e.g. insurance certificate).
     */
    reviewField?: DocumentVerificationField;
    onVerify?: (field: DocumentVerificationField, status: "approved" | "rejected") => void;
    labels: {
        verified: string;
        pending: string;
        rejected: string;
        needsReplacement: string;
        expired: string;
        verify: string;
        requestReplacement: string;
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

function isExpired(expiry?: string | null): boolean {
    if (!expiry) return false;
    const ts = Date.parse(expiry);
    return Number.isFinite(ts) && ts < Date.now() - 86_400_000;
}

function resolveKind(url: string | null | undefined): "image" | "pdf" | "other" | "none" {
    if (!url) return "none";
    const path = url.split("#")[0].split("?")[0];
    if (IMAGE_EXT.test(path)) return "image";
    if (/\.pdf$/i.test(path)) return "pdf";
    return "other";
}

export function DocumentViewerDialog({
    open,
    onOpenChange,
    title,
    subtitle,
    url,
    status,
    expiry,
    reviewNote,
    reviewField,
    onVerify,
    labels,
}: DocumentViewerDialogProps) {
    const { url: signedUrl, isLoading, error } = usePresignedDocumentUrl(url);
    const [assetFailed, setAssetFailed] = useState(false);
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);

    // Clear transient state whenever the dialog is (re)opened for a new document.
    useEffect(() => {
        if (!open) setPendingAction(null);
        setAssetFailed(false);
    }, [open, url]);

    const kind = useMemo(() => resolveKind(url), [url]);
    const expired = isExpired(expiry);
    const canReview = Boolean(reviewField && onVerify);
    const isBusy = pendingAction !== null;

    const statusChip = (() => {
        if (expired) return { label: labels.expired, tone: "danger" as const };
        if (status === "approved") return { label: labels.verified, tone: "success" as const };
        if (status === "rejected") return { label: labels.rejected, tone: "danger" as const };
        if (status === "pending") return { label: labels.pending, tone: "pending" as const };
        return null;
    })();

    const handleReview = (next: "approved" | "rejected") => {
        if (!reviewField || !onVerify) return;
        setPendingAction(next === "approved" ? "approve" : "reject");
        onVerify(reviewField, next);
    };

    const openInNewTab = () => {
        const href = signedUrl || url;
        if (href) window.open(href, "_blank", "noopener,noreferrer");
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex max-h-[92vh] w-[96vw] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:w-full"
                overlayClassName="bg-black/70"
                aria-describedby={undefined}
            >
                {/* Header */}
                <DialogHeader className="flex-shrink-0 space-y-0 border-b border-border px-5 py-4 text-left sm:px-6">
                    <div className="flex items-start justify-between gap-4 pr-9">
                        <div className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60">
                                <FileText className="h-5 w-5 text-muted-foreground" />
                            </span>
                            <div className="min-w-0">
                                <DialogTitle className="truncate text-base font-semibold tracking-tight text-foreground">
                                    {title}
                                </DialogTitle>
                                {subtitle ? (
                                    <DialogDescription className="mt-0.5 truncate text-xs text-muted-foreground">
                                        {subtitle}
                                    </DialogDescription>
                                ) : null}
                                {expiry ? (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {labels.expires.replace("{date}", new Date(expiry).toLocaleDateString())}
                                    </p>
                                ) : null}
                            </div>
                        </div>

                        {statusChip ? (
                            <span
                                className={cn(
                                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none",
                                    statusChip.tone === "success" && "border-primary/20 bg-primary/10 text-primary",
                                    statusChip.tone === "danger" && "border-destructive/25 bg-destructive/10 text-destructive",
                                    statusChip.tone === "pending" && "border-border bg-muted/60 text-muted-foreground",
                                )}
                            >
                                {statusChip.tone === "success" ? (
                                    <Check className="h-3.5 w-3.5" />
                                ) : statusChip.tone === "danger" ? (
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                ) : (
                                    <Clock className="h-3.5 w-3.5" />
                                )}
                                {statusChip.label}
                            </span>
                        ) : null}
                    </div>
                </DialogHeader>

                {/* Preview */}
                <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-4 sm:p-5 mobile-momentum-scroll">
                    {!url ? (
                        <Placeholder
                            icon={<FileText className="h-6 w-6 text-muted-foreground" />}
                            text={labels.loadFailed}
                        />
                    ) : isLoading ? (
                        <Placeholder
                            icon={<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                            text={labels.loading}
                        />
                    ) : error || assetFailed ? (
                        <Placeholder
                            icon={<AlertTriangle className="h-6 w-6 text-destructive" />}
                            text={labels.loadFailed}
                            action={
                                <Button variant="ghost" size="sm" onClick={openInNewTab} className="gap-2 border border-border hover:bg-muted">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    {labels.openInNewTab}
                                </Button>
                            }
                        />
                    ) : kind === "image" ? (
                        <img
                            src={signedUrl || url}
                            alt={title}
                            onError={() => setAssetFailed(true)}
                            className="mx-auto max-h-[62vh] w-auto max-w-full rounded-xl border border-border bg-card object-contain shadow-sm"
                        />
                    ) : kind === "pdf" ? (
                        <object
                            data={signedUrl || url}
                            type="application/pdf"
                            className="h-[62vh] w-full rounded-xl border border-border bg-card shadow-sm"
                            aria-label={title}
                        >
                            <Placeholder
                                icon={<FileText className="h-6 w-6 text-muted-foreground" />}
                                text={labels.loadFailed}
                                action={
                                    <Button variant="ghost" size="sm" onClick={openInNewTab} className="gap-2 border border-border hover:bg-muted">
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        {labels.openInNewTab}
                                    </Button>
                                }
                            />
                        </object>
                    ) : (
                        <Placeholder
                            icon={<FileText className="h-6 w-6 text-muted-foreground" />}
                            text={subtitle || title}
                            action={
                                <Button variant="ghost" size="sm" onClick={openInNewTab} className="gap-2 border border-border hover:bg-muted">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    {labels.openInNewTab}
                                </Button>
                            }
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 border-t border-border bg-card px-5 py-4 sm:px-6">
                    {reviewNote ? (
                        <p className="mb-3 text-xs text-muted-foreground">{reviewNote}</p>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {url && !assetFailed ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={openInNewTab}
                                disabled={isBusy}
                                className="mr-auto gap-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {labels.openInNewTab}
                            </Button>
                        ) : null}

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenChange(false)}
                            disabled={isBusy}
                            className="hover:bg-muted"
                        >
                            {labels.close}
                        </Button>

                        {canReview ? (
                            <>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleReview("rejected")}
                                    disabled={isBusy || status === "rejected"}
                                    className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                >
                                    {pendingAction === "reject" ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <X className="h-3.5 w-3.5" />
                                    )}
                                    {labels.requestReplacement}
                                </Button>

                                {expired ? (
                                    <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-destructive/25 bg-destructive/10 px-3 text-xs font-medium text-destructive">
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                        {labels.needsReplacement}
                                    </span>
                                ) : (
                                    <StatusButton
                                        size="sm"
                                        onClick={() => handleReview("approved")}
                                        status={pendingAction === "approve" ? "loading" : "idle"}
                                        disabled={isBusy || status === "approved"}
                                        labels={{
                                            idle: labels.verify,
                                            loading: labels.working || labels.verify,
                                            success: labels.verified,
                                        }}
                                    />
                                )}
                            </>
                        ) : null}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function Placeholder({
    icon,
    text,
    action,
}: {
    icon: React.ReactNode;
    text: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex min-h-[38vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/60 px-6 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">{icon}</span>
            <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
            {action}
        </div>
    );
}

DocumentViewerDialog.displayName = "DocumentViewerDialog";
