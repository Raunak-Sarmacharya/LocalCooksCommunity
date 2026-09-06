import {
  cloneElement,
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Info,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/components/chef/applications/status";
import type { StatusVariant } from "@/components/chef/dashboard/types";

/** Badge / status visual keys that InfoChip can map to a tone. */
export type InfoChipVariant = StatusVariant | "info" | "count";

/**
 * Discover kitchen card chip surface — exact reference for chef/booking info chips.
 * White background, pill shape, compact type, light shadow (no filled color backgrounds).
 */
export const infoChipClassName =
  "inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[#1A1A1A] shadow-sm";

/** Icon color by semantic tone — green / yellow / red from theme tokens. */
export function infoChipIconClass(tone: StatusTone): string {
  switch (tone) {
    case "success":
    case "neutral":
      return "text-success";
    case "warning":
    case "progress":
      return "text-warning";
    case "danger":
      return "text-destructive";
    default:
      return "text-success";
  }
}

const DEFAULT_ICONS: Record<StatusTone, LucideIcon> = {
  success: Check,
  warning: AlertTriangle,
  danger: XCircle,
  progress: Clock,
  neutral: Info,
};

export function defaultInfoChipIcon(tone: StatusTone): LucideIcon {
  return DEFAULT_ICONS[tone] ?? Info;
}

/** Map shadcn Badge variants used for status → InfoChip tone. */
export function statusVariantToTone(variant: InfoChipVariant | null | undefined): StatusTone {
  switch (variant) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "destructive":
      return "danger";
    case "info":
      return "neutral";
    case "outline":
    case "secondary":
    case "default":
    case "count":
    default:
      return "neutral";
  }
}

/** Drop caller size/color classes so the chip can enforce tone + 12px. */
export function sanitizeInfoChipIconClass(className: string | undefined): string {
  if (!className) return "";
  return className
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      if (/^(h|w|size)-\d+(\.\d+)?$/.test(token)) return false;
      if (
        /^(text-(?:success|warning|destructive|muted-foreground|primary|foreground|gray-\d+)|text-\[[^\]]+\])$/.test(
          token
        )
      ) {
        return false;
      }
      return true;
    })
    .join(" ");
}

/**
 * Force custom icons to 12×12 + tone color.
 * Callers often pass h-3 w-3 text-* that would otherwise bypass the chip.
 */
export function prepareInfoChipIcon(icon: ReactNode, tone: StatusTone): ReactNode {
  if (!isValidElement(icon)) return icon;
  const el = icon as ReactElement<{ className?: string; size?: number | string; "aria-hidden"?: boolean }>;
  return cloneElement(el, {
    className: cn("size-3 shrink-0", infoChipIconClass(tone), sanitizeInfoChipIconClass(el.props.className)),
    // PreviewIcon / Iconify accept size; Lucide ignores unknown numeric size safely via DOM
    size: 12,
    "aria-hidden": true,
  });
}

/**
 * Icon shell: size + tone via currentColor stroke only.
 * Do not force fill — Lucide stays outline; Iconify/MDI keep their own fill.
 */
export const infoChipIconShellClass =
  "inline-flex size-3 shrink-0 items-center justify-center [&_svg]:!size-full [&_svg]:!h-full [&_svg]:!w-full [&_svg]:!stroke-current";

export type InfoChipProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  tone?: StatusTone;
  /** When set, maps to tone (ignored if `tone` is passed). */
  variant?: InfoChipVariant | null;
  /**
   * Optional custom leading icon. Always shows an icon — omit to use the tone default.
   * Color and 12px size are enforced even when a custom icon is passed.
   */
  icon?: ReactNode;
  children: ReactNode;
};

/**
 * Informational status chip for chef pages + booking flow.
 * Does not replace action buttons, tab counts, or interactive selectors.
 */
export function InfoChip({
  tone: toneProp,
  variant,
  icon,
  children,
  className,
  ...props
}: InfoChipProps) {
  const tone = toneProp ?? statusVariantToTone(variant);
  const Icon = defaultInfoChipIcon(tone);
  const leading =
    icon !== undefined && icon !== null
      ? prepareInfoChipIcon(icon, tone)
      : (
          <Icon
            className={cn("size-3 shrink-0", infoChipIconClass(tone))}
            aria-hidden
          />
        );

  return (
    <span className={cn(infoChipClassName, className)} {...props}>
      <span
        className={cn(infoChipIconShellClass, infoChipIconClass(tone))}
        aria-hidden
      >
        {leading}
      </span>
      {children}
    </span>
  );
}
