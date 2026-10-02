import { cn } from "@/lib/utils";

/** Soft elevation — match KitchenPreviewPage primary / outline CTAs. */
const PREMIUM_PRIMARY_SHADOW =
  "shadow-[0_2px_6px_-1px_rgba(15,23,42,0.1),0_10px_28px_-8px_rgba(245,16,66,0.38)]";
const PREMIUM_PRIMARY_HOVER_SHADOW =
  "hover:shadow-[0_4px_12px_-2px_rgba(15,23,42,0.1),0_14px_32px_-8px_rgba(245,16,66,0.5)]";

const CTA_FEEDBACK = "transition-[background-color,color,border-color,box-shadow] duration-150 motion-reduce:transition-none";

/** Chef primary CTA — same surface as kitchen preview Apply / Book. */
export function chefPrimaryCtaClass(className?: string) {
  return cn(
    "rounded-full border-transparent bg-[#F51042] text-white hover:bg-[#E00A38] hover:text-white disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-[#F51042]",
    PREMIUM_PRIMARY_SHADOW,
    PREMIUM_PRIMARY_HOVER_SHADOW,
    CTA_FEEDBACK,
    className
  );
}

/** Outline buttons share a quiet surface hover throughout the app. */
export function chefOutlineCtaClass(className?: string) {
  return cn(
    "rounded-full shadow-none hover:shadow-none hover:border-foreground/20 hover:bg-muted active:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-55",
    "transition-[background-color,border-color] duration-200 ease-out motion-reduce:transition-none",
    className
  );
}
