import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SmartImage } from "@/components/ui/smart-image";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import type { StorageVisitRecord as Record } from "@/lib/storage-board";

/**
 * One end of a storage rental as it was recorded: the tasks the customer ticked, the photos the
 * kitchen asked for, and the photos taken. Kitchen and customer read the same record (owner Oct 29).
 */
export function StorageVisitRecord({ title, at, record, photos }: {
  title: string; at?: string | null; record?: Record; photos: string[];
}) {
  const { t } = useTranslation("storage");
  const tasks = record?.tasks ?? [];
  return (
    <section className="min-w-0 space-y-3 rounded-xl bg-muted/40 p-4" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {at && <span className="text-sm tabular-nums text-muted-foreground">{at}</span>}
      </div>
      {!at && !tasks.length && !photos.length ? <p className="text-sm text-muted-foreground">{t("stRecordNotYet")}</p> : <>
        {tasks.length > 0 && <ul className="space-y-1.5 text-sm">
          {tasks.map((task, index) => <li key={`${task.label}-${index}`} className="flex items-start gap-2">
            {task.checked
              ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label={t("stTaskDone")} />
              : <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label={t("stTaskNotDone")} />}
            <span className="min-w-0 break-words">{task.label}</span>
          </li>)}
        </ul>}
        {!!record?.photosAsked.length && <p className="text-xs text-muted-foreground">{t("stPhotosAsked", { list: record.photosAsked.join(" · ") })}</p>}
        {photos.length > 0 && <div className="grid grid-cols-3 gap-2">
          {photos.map((url, index) => <a key={`${url}-${index}`} href={getR2ProxyUrl(url)} target="_blank" rel="noopener noreferrer"
            className="group relative aspect-square overflow-hidden rounded-lg bg-background">
            <SmartImage src={getR2ProxyUrl(url)} alt={`${title} ${index + 1}`} hideOnError
              className="h-full w-full object-cover motion-safe:transition-transform group-hover:scale-[1.02]" />
          </a>)}
        </div>}
      </>}
    </section>
  );
}
