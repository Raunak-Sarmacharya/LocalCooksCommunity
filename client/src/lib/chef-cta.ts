import { cn } from "@/lib/utils";

/** Soft elevation — match KitchenPreviewPage primary / outline CTAs. */
const PREMIUM_CTA_SHADOW =
  "shadow-[0_1px_2px_rgba(15,23,42,0.05),0_6px_16px_-4px_rgba(15,23,42,0.12)]";
const PREMIUM_PRIMARY_SHADOW =
  "shadow-[0_2px_6px_-1px_rgba(15,23,42,0.1),0_10px_28px_-8px_rgba(245,16,66,0.38)]";

/** Chef primary CTA — same surface as kitchen preview Apply / Book. */
export function chefPrimaryCtaClass(className?: string) {
  return cn(
    "rounded-xl border-transparent bg-[#F51042] text-white transition-colors hover:bg-[#E00A38] hover:text-white disabled:opacity-100",
    PREMIUM_PRIMARY_SHADOW,
    className
  );
}

/** Chef outline / secondary CTA — same soft elevation as preview tour outline. */
export function chefOutlineCtaClass(className?: string) {
  return cn("rounded-xl transition-colors disabled:opacity-100", PREMIUM_CTA_SHADOW, className);
}
