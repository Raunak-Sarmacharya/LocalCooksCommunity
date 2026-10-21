/**
 * The dashboard home's look (approved mock v2): warm stone neutrals, one radius scale, one primary action per screen.
 * Plain class strings so the overview, calendar and payouts cards stay in step without a new component layer.
 */
export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
export const card = "min-w-0 rounded-xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(28,25,23,.04)]";
export const cardHead = "flex min-h-[52px] items-center justify-between gap-3 px-4 pt-3.5 sm:min-h-[60px] sm:px-5 sm:pt-4";
export const cardTitle = "text-[15px] font-semibold leading-[22px] tracking-[-0.01em] text-stone-900";
export const cardMeta = "ml-2 font-normal text-stone-500";
export const cardBody = "px-4 pb-4 pt-3 sm:px-5 sm:pb-5";
export const btnPrimary = `inline-flex h-11 w-full items-center justify-center whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(225,9,57,.24),inset_0_1px_0_rgba(255,255,255,.16)] transition-colors hover:bg-[#c80833] sm:h-9 sm:w-auto ${focusRing}`;
export const btnSecondary = `inline-flex h-10 flex-1 items-center justify-center whitespace-nowrap rounded-lg bg-white px-3 text-[13px] font-medium text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,.06)] ring-1 ring-inset ring-stone-300 transition-colors hover:bg-stone-50 hover:ring-stone-400 sm:h-8 sm:flex-none ${focusRing}`;
export const linkTertiary = `inline-flex items-center gap-1 rounded text-[13px] font-medium text-stone-600 hover:text-stone-900 ${focusRing}`;
export const groupLabel = "text-[13px] font-semibold leading-[18px] text-stone-900";
export const groupCount = "ml-1.5 font-medium text-stone-500";
export const sub = "text-[13px] leading-[18px] text-stone-600";

const badgeBase = "inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-xs font-medium ring-1 ring-inset";
export const badge = {
  neutral: `${badgeBase} bg-stone-100 text-stone-600 ring-stone-200`,
  positive: `${badgeBase} bg-emerald-50 text-emerald-700 ring-emerald-200`,
  attention: `${badgeBase} bg-amber-50 text-amber-800 ring-amber-200`,
  brand: `${badgeBase} bg-[#fef3f5] text-[#8f0a2b] ring-[#fbcbd6]`,
} as const;
export type BadgeTone = keyof typeof badge;
