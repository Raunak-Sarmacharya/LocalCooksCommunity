import { cn } from "@/lib/utils";

export function journeyCalendarClassNames(wide: boolean) {
  return {
    months: wide ? "flex w-full flex-col gap-5 sm:flex-row" : "flex w-full flex-col space-y-0",
    month: "w-full space-y-2",
    caption: "relative flex w-full items-center justify-center pt-0.5",
    caption_label: "text-xs font-medium",
    nav_button: "inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent p-0 opacity-50 shadow-none hover:opacity-100",
    nav_button_previous: "absolute left-0",
    nav_button_next: "absolute right-0",
    table: "w-full table-fixed border-collapse",
    head_cell: "w-[14.28%] pb-0.5 text-center text-[0.65rem] font-normal text-muted-foreground",
    row: "mt-0.5",
    cell: cn("relative z-0 h-8 p-0 text-center text-xs", "[&:has([aria-selected])]:before:absolute [&:has([aria-selected])]:before:left-1/2 [&:has([aria-selected])]:before:top-1/2 [&:has([aria-selected])]:before:h-8 [&:has([aria-selected])]:before:w-8 [&:has([aria-selected])]:before:-translate-x-1/2 [&:has([aria-selected])]:before:-translate-y-1/2 [&:has([aria-selected])]:before:-z-10 [&:has([aria-selected])]:before:rounded-full [&:has([aria-selected])]:before:border-2 [&:has([aria-selected])]:before:border-primary"),
    day: "mx-auto flex h-8 w-8 max-w-[32px] items-center justify-center rounded-full p-0 text-xs font-normal text-foreground transition-colors hover:bg-muted aria-selected:opacity-100",
    day_disabled: "pointer-events-none text-muted-foreground opacity-40 line-through",
  };
}

export const journeyCalendarContainer = "w-full max-w-[680px] rounded-xl border border-border/70 bg-muted/30 p-2";
