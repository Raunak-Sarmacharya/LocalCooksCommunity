import { useState, type ReactNode } from "react";
import { Check, FileText, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";

/**
 * The one document-upload control for the kitchen-application flow.
 *
 * Replaces the bare `<input type="file">` (which renders the browser's default
 * "Choose File / No file chosen" chrome) with the dashed drop-target this app
 * already uses elsewhere. Kept deliberately small: no drag events, no progress
 * bar, no async — the caller owns upload + validation, this owns the look.
 *
 * ONE ROW PER DOCUMENT
 *
 * Follows Carbon's file-uploader anatomy: the uploaded file is a single element
 * that owns its own actions, and the drop zone is removed once a file is present
 * ("once uploaded, the drop zone area will be removed to show that you have
 * successfully uploaded a single file"). So this renders ONE of two things:
 *
 *   - nothing on file   -> the drop zone
 *   - something on file -> the stored-document row, with its actions inside it
 *
 * The action lives IN the row rather than beside it on purpose. Rendered as a
 * sibling, the Replace button floated in the gap between two document cards and
 * read as belonging to neither.
 *
 * `existingName` is the ONE signal that a document is on file — it is truthy only
 * when the server holds one. There is deliberately no second flag that could imply
 * existence; an earlier version had one and it put Replace on empty uploads.
 */
export interface DocumentUploadFieldProps {
  id: string;
  accept: string;
  /** Currently selected file (not yet uploaded), if any. */
  file: File | null;
  /** Name of a document already stored server-side. Renders the stored row. */
  existingName?: string | null;
  label: string;
  hint: string;
  /** Shown in place of `hint` inside the drop zone when a document is already on file. */
  existingHint?: string;
  /** One line of context on the stored row — provenance or state. Falls back to `existingHint`. */
  existingNote?: string;
  /** The stored document's expiry. Shown on the stored row, and never asked for while it is set. */
  existingExpiry?: string | null;
  /** The stored document's URL, if it can be opened. */
  existingUrl?: string | null;
  /** Trailing content on the stored row's title line — e.g. a verification chip. */
  existingTrailing?: ReactNode;
  /**
   * Whether the stored document is currently verified.
   *
   * Replacing resets the verification status to `pending` server-side, so a verified
   * document that gets replaced must be verified again — while the chef's booking
   * access is untouched, because a document update changes neither the application
   * status nor its tier. The row says so, and says it differently when there was no
   * verification to lose.
   */
  existingVerified?: boolean;
  chooseLabel: string;
  changeLabel: string;
  /** Action on the stored row. Falls back to a translated "Replace". */
  replaceLabel?: string;
  /** Abandons a replacement and returns to the stored row. Falls back to a translated "Cancel". */
  cancelLabel?: string;
  disabled?: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}

export function DocumentUploadField({
  id,
  accept,
  file,
  existingName,
  label,
  hint,
  existingHint,
  existingNote,
  existingExpiry,
  existingUrl,
  existingTrailing,
  existingVerified,
  chooseLabel,
  changeLabel,
  replaceLabel,
  cancelLabel,
  disabled,
  onChange,
  onRemove,
  removeLabel,
  className,
}: DocumentUploadFieldProps) {
  const hasFile = Boolean(file);
  const [isReplacing, setIsReplacing] = useState(false);
  const { t } = useTranslation("kitchen");
  const document = usePresignedDocumentUrl(existingUrl);

  // Owned here rather than passed in: every call site wants the same two words, and
  // six copies of the same prop pair is six chances for them to drift apart.
  const replaceText = replaceLabel ?? t("replace", { defaultValue: "Replace" });
  const cancelText = cancelLabel ?? t("cancel", { defaultValue: "Cancel" });

  // A document is on file ONLY when we were given its name. Nothing else may imply it.
  const hasStoredDocument = Boolean(existingName);
  const showStoredRow = hasStoredDocument && !hasFile && !isReplacing;

  const expiryText =
    existingExpiry && Number.isFinite(Date.parse(existingExpiry))
      ? t("expiresOn", { defaultValue: "Expires {date}", date: new Date(existingExpiry).toLocaleDateString() })
      : null;

  if (showStoredRow) {
    return (
      <div className={cn("min-w-0", className)}>
        <div
          data-testid="stored-document-row"
          className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-card p-3"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center pt-0.5 text-primary">
            <Check className="h-5 w-5" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="min-w-0 truncate text-sm font-medium" title={existingName ?? undefined}>
              {existingName}
            </p>

            {existingNote ?? existingHint ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{existingNote ?? existingHint}</p>
            ) : null}
            {expiryText ? <p className="text-xs text-muted-foreground">{expiryText}</p> : null}
            {existingUrl ? (
              <a
                href={document.url ?? undefined}
                aria-disabled={!document.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs text-primary hover:underline"
              >
                {document.error
                  ? t("documentLoadFailed", { defaultValue: "Could not load document. Please try again." })
                  : document.isLoading ? t("loading", { defaultValue: "Loading…" })
                  : t("viewDocument", { defaultValue: "View document" })}
              </a>
            ) : null}

            {/* What replacing actually does, stated plainly rather than left to be
                discovered after the chef has already replaced something verified. */}
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {existingVerified
                ? t("replaceVerifiedNotice", {
                    defaultValue:
                      "Replacing it will require verification again. Your booking access stays the same.",
                  })
                : t("replaceUnverifiedNotice", {
                    defaultValue: "Replacing it will send the new document for review.",
                  })}
            </p>
          </div>

          {/*
            Trailing column: the verification chip, then the action beneath it.
            The two are stacked rather than sitting side by side so the button reads
            as the next step for THIS document — on the name's own line it competed
            with the chip and looked like a second badge.
          */}
          <div className="flex shrink-0 flex-col items-end gap-2">
            {existingTrailing}
            <button
              type="button"
              onClick={() => setIsReplacing(true)}
              disabled={disabled}
              className="rounded-lg border bg-background px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {replaceText}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <input
        type="file"
        id={id}
        accept={accept}
        onChange={onChange}
        disabled={disabled}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-3 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30",
          disabled && "cursor-not-allowed opacity-60",
          hasFile
            ? "border-primary/30 bg-primary/[0.03]"
            : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/40",
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            hasFile ? "bg-primary/10" : "bg-muted/60",
          )}
        >
          {hasFile ? (
            <FileText className="h-4 w-4 text-primary" />
          ) : (
            <Upload className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" title={file?.name ?? existingName ?? undefined}>
            {hasFile ? file!.name : existingName || label}
          </span>
          <span className="block text-xs text-muted-foreground">
            {hasFile ? `${(file!.size / 1024 / 1024).toFixed(2)} MB` : existingName ? existingHint : hint}
          </span>
        </span>
        {hasFile ? (
          <span className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary">{changeLabel}</span>
        ) : (
          <span className="shrink-0 rounded-lg border bg-background px-3 py-2 text-xs font-medium shadow-sm">
            {existingName ? changeLabel : chooseLabel}
          </span>
        )}
      </label>
      {hasStoredDocument && !hasFile ? (
        <button
          type="button"
          onClick={() => setIsReplacing(false)}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {cancelText}
        </button>
      ) : null}
      {hasFile && onRemove && removeLabel ? (
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
        >
          {removeLabel}
        </button>
      ) : null}
    </div>
  );
}

export default DocumentUploadField;
