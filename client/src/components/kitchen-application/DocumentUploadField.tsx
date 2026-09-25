import { FileText, Upload } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one document-upload control for the kitchen-application flow.
 *
 * Replaces the bare `<input type="file">` (which renders the browser's default
 * "Choose File / No file chosen" chrome) with the dashed drop-target this app
 * already uses elsewhere. Kept deliberately small: no drag events, no progress
 * bar, no async — the caller owns upload + validation, this owns the look.
 *
 * `existingName` is for re-submits: the server already holds a document, so the
 * row explains it stays on file unless replaced rather than looking empty.
 */
export interface DocumentUploadFieldProps {
  id: string;
  accept: string;
  /** Currently selected file (not yet uploaded), if any. */
  file: File | null;
  /** Name of a document already stored server-side. */
  existingName?: string | null;
  label: string;
  hint: string;
  /** Shown in place of `hint` when `existingName` is set. */
  existingHint?: string;
  chooseLabel: string;
  changeLabel: string;
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
  chooseLabel,
  changeLabel,
  disabled,
  onChange,
  onRemove,
  removeLabel,
  className,
}: DocumentUploadFieldProps) {
  const hasFile = Boolean(file);

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
