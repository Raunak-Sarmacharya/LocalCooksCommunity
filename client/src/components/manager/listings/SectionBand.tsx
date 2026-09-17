import type { ReactNode } from "react";

/**
 * Section heading inside a listing form.
 *
 * A muted band rather than a heading with a rule under it, so a long form reads
 * as a handful of short groups instead of one undifferentiated column of rows.
 * Shared by the storage and equipment forms — they are separate pages but the
 * same shape, and two copies of this styling would drift.
 */
export function SectionBand({
  label,
  hint,
  icon,
}: {
  label: string;
  hint?: string;
  /** Optional leading glyph, used by the equipment page's two inventory sections. */
  icon?: ReactNode;
}) {
  return (
    <div className="bg-muted/40 px-4 py-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </div>
      {hint ? <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
