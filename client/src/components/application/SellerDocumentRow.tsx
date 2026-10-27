import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { cn } from "@/lib/utils";
import type { SellerDocument } from "@shared/seller-application";

export const APPROVED_COURSES_URL = "https://www.gov.nl.ca/hcs/publichealth/envhealth/foodsafetytraining/";
export const HOME_REGISTRATION_URL = "https://www.gov.nl.ca/dgsnl/licences/env-health/food/premises/";

/** The document's name and one line on what it is, with the official page where it helps. */
export function DocumentName({ kind, recommended }: { kind: SellerDocument["kind"]; recommended?: boolean }) {
  const { t: typedT } = useTranslation("chef");
  const t = typedT as unknown as (key: string) => string;
  const link = kind === "foodSafetyTraining" ? { href: APPROVED_COURSES_URL, label: t("sell_docApprovedCourses") }
    : kind === "homeRegistration" ? { href: HOME_REGISTRATION_URL, label: t("sell_docServiceNl") } : null;
  return (
    <div className="min-w-0">
      <p className="font-semibold">{t(`sell_doc_${kind}`)}</p>
      <p className="text-sm text-muted-foreground">
        {recommended ? t("sell_docRecommendedHome") : t(`sell_docNote_${kind}`)}
        {link && <>{" "}<a href={link.href} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-4">{link.label}</a></>}
      </p>
    </div>
  );
}

/** Upload (or replace) one document: a real progress bar, PDF or photo, 4.5 MB. */
export function UploadDocumentButton({ onUploaded, replace, label, variant = "outline", className }: {
  onUploaded: (url: string, fileName: string) => void | Promise<void>; replace?: boolean; label?: string; variant?: "outline" | "default"; className?: string;
}) {
  const { t } = useTranslation("chef");
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const { uploadFile, uploadProgress, isUploading } = useFileUpload({
    maxSize: 4.5 * 1024 * 1024,
    allowedTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    onError: (error) => toast({ title: t("sell_uploadFailed"), description: error, variant: "destructive" }),
  });
  return (
    <>
      <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const result = await uploadFile(file);
          if (result?.success && result.url?.trim()) await onUploaded(result.url.trim(), file.name);
        }} />
      {isUploading ? (
        <span role="progressbar" aria-label={t("sell_uploading")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploadProgress)}
          className={cn("relative inline-flex h-9 w-28 items-center overflow-hidden rounded-xl bg-muted text-xs font-medium", className)}>
          <span className="absolute inset-y-0 left-0 bg-primary/15 transition-[width]" style={{ width: `${uploadProgress}%` }} />
          <span className="relative w-full text-center">{Math.round(uploadProgress)}%</span>
        </span>
      ) : replace ? (
        <button type="button" onClick={() => input.current?.click()} className={cn("text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground", className)}>{t("sell_replace")}</button>
      ) : (
        <Button type="button" size="sm" variant={variant} className={cn("rounded-xl", className)} onClick={() => input.current?.click()}>
          <Icon icon="mdi:tray-arrow-up" className="size-4" aria-hidden />
          {label ?? t("sell_upload")}
        </Button>
      )}
    </>
  );
}

/** One row of the application's Documents step: upload it, or say you don't have it yet. */
export function ApplyDocumentRow({ doc, fileName, missing, onUploaded, onRemove, onMissing, invalid }: {
  doc: Pick<SellerDocument, "kind" | "recommended">; fileName?: string; missing: boolean; invalid?: boolean;
  onUploaded: (url: string, fileName: string) => void; onRemove: () => void; onMissing: (missing: boolean) => void;
}) {
  const { t } = useTranslation("chef");
  const id = `missing-${doc.kind}`;
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6 sm:px-5">
      <DocumentName kind={doc.kind} recommended={doc.recommended} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:flex-col sm:items-end">
        {fileName ? (
          <>
            <span className="inline-flex max-w-[16rem] items-center gap-2 text-sm font-semibold"><Icon icon="mdi:check" className="size-4 shrink-0 text-success" aria-hidden /><span className="truncate">{fileName}</span></span>
            <span className="flex gap-3"><UploadDocumentButton replace onUploaded={onUploaded} /><button type="button" onClick={onRemove} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">{t("sell_remove")}</button></span>
          </>
        ) : (
          <>
            <UploadDocumentButton onUploaded={onUploaded} />
            <label htmlFor={id} className={cn("flex cursor-pointer items-center gap-2 text-sm", invalid ? "text-destructive" : "text-muted-foreground")}>
              <Checkbox id={id} checked={missing} onCheckedChange={(checked) => onMissing(checked === true)} />
              {t("sell_dontHaveYet")}
            </label>
          </>
        )}
      </div>
    </div>
  );
}
