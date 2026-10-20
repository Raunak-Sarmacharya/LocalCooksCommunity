import { cn } from '@/lib/utils';

/** Shared by the chef booking flow and the change dialog, so a dated booking's calendar looks and reads the same in both. */
export const DATE_REASON_KEYS = { booked: 'mdReasonBooked', held: 'mdReasonBooked', closed: 'mdReasonClosed',
  notice: 'mdReasonNotice', beyond_advance_window: 'mdReasonAdvance', weekly_limit: 'mdReasonWeekly', buffer: 'mdReasonBuffer',
  clock_change: 'mdReasonClock', not_open_to_you: 'mdReasonAccess', maintenance: 'mdReasonMaintenance' } as const;
export const dateReasonKey = (reason?: string | null) => DATE_REASON_KEYS[reason as keyof typeof DATE_REASON_KEYS] ?? 'mdReasonUnavailable';

/** Matches kitchen preview / prefs panel — fixed 32px cells → true circular selection. */
export const BOOKING_CALENDAR_CLASS_NAMES = {
  months: "flex w-full flex-col space-y-0",
  month: "w-full space-y-2",
  caption: "relative flex w-full items-center justify-center pt-0.5",
  caption_label: "text-sm font-medium",
  nav_button:
    "inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent p-0 opacity-50 shadow-none hover:opacity-100",
  nav_button_previous: "absolute left-0",
  nav_button_next: "absolute right-0",
  table: "w-full table-fixed border-collapse",
  head_cell:
    "w-[14.28%] pb-0.5 text-center text-sm font-normal text-muted-foreground",
  row: "mt-0.5",
  cell: cn(
    "relative z-0 h-8 p-0 text-center text-sm",
    "[&:has([aria-selected])]:before:absolute [&:has([aria-selected])]:before:left-1/2 [&:has([aria-selected])]:before:top-1/2 [&:has([aria-selected])]:before:h-8 [&:has([aria-selected])]:before:w-8 [&:has([aria-selected])]:before:-translate-x-1/2 [&:has([aria-selected])]:before:-translate-y-1/2 [&:has([aria-selected])]:before:-z-10 [&:has([aria-selected])]:before:rounded-full [&:has([aria-selected])]:before:bg-[#E10939]"
  ),
  day: "mx-auto flex h-8 w-8 max-w-[32px] items-center justify-center rounded-full bg-transparent p-0 text-sm font-normal text-gray-900 transition-colors hover:bg-gray-100 aria-selected:opacity-100",
  day_selected:
    "bg-transparent font-semibold text-white hover:bg-transparent hover:text-white focus:bg-transparent",
  day_disabled:
    "pointer-events-none text-gray-300 opacity-40 line-through decoration-gray-300/80",
};

/** Two-month booking picker — side-by-side from sm up. */
export const BOOKING_CALENDAR_TWO_MONTH_CLASS_NAMES = {
  ...BOOKING_CALENDAR_CLASS_NAMES,
  months: "flex w-full flex-col gap-4 sm:flex-row sm:gap-6 sm:space-y-0",
  month: "w-full min-w-0 flex-1 space-y-2",
};
