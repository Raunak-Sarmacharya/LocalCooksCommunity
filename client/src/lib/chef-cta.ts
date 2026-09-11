import { cn } from "@/lib/utils";

/** Soft elevation — match KitchenPreviewPage primary / outline CTAs. */
const PREMIUM_CTA_SHADOW =
  "shadow-[0_1px_2px_rgba(15,23,42,0.05),0_6px_16px_-4px_rgba(15,23,42,0.12)]";
const PREMIUM_PRIMARY_SHADOW =
  "shadow-[0_2px_6px_-1px_rgba(15,23,42,0.1),0_10px_28px_-8px_rgba(245,16,66,0.38)]";
const PREMIUM_PRIMARY_HOVER_SHADOW =
  "hover:shadow-[0_4px_12px_-2px_rgba(15,23,42,0.1),0_14px_32px_-8px_rgba(245,16,66,0.5)]";
const PREMIUM_CTA_HOVER_SHADOW =
  "hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_8px_20px_-4px_rgba(15,23,42,0.15)]";

const CTA_3D_EFFECT = "transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:hover:translate-y-0";

/** Chef primary CTA — same surface as kitchen preview Apply / Book. */
export function chefPrimaryCtaClass(className?: string) {
  return cn(
    "rounded-full border-transparent bg-[#F51042] text-white hover:bg-[#E00A38] hover:text-white disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-[#F51042]",
    PREMIUM_PRIMARY_SHADOW,
    PREMIUM_PRIMARY_HOVER_SHADOW,
    CTA_3D_EFFECT,
    className
  );
}

/** Chef outline / secondary CTA — same soft elevation as preview tour outline. */
export function chefOutlineCtaClass(className?: string) {
  return cn(
    "rounded-full disabled:cursor-not-allowed disabled:opacity-55",
    PREMIUM_CTA_SHADOW,
    PREMIUM_CTA_HOVER_SHADOW,
    CTA_3D_EFFECT,
    className
  );
}
