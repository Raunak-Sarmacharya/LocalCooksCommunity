import * as React from "react"
import { Icon } from "@iconify/react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import "@/lib/kitchen-inventory-icons"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

/**
 * Turo-style range pill: one continuous outer border + soft fill.
 * No separate start/end circles (those create vertical “inside lines”).
 */
export const calendarRangeCellClass = cn(
  "relative z-0 h-9 p-0 text-center text-sm",
  "[&:has([aria-selected])]:before:absolute [&:has([aria-selected])]:before:inset-y-0 [&:has([aria-selected])]:before:inset-x-0 [&:has([aria-selected])]:before:-z-10 [&:has([aria-selected])]:before:border-y-2 [&:has([aria-selected])]:before:border-[#F51042] [&:has([aria-selected])]:before:bg-[#FFF0F3]",
  // Start of range or start of week row
  "first:[&:has([aria-selected])]:before:rounded-l-full first:[&:has([aria-selected])]:before:border-l-2",
  "[&:has([aria-selected].day-range-start)]:before:rounded-l-full [&:has([aria-selected].day-range-start)]:before:border-l-2",
  // End of range or end of week row
  "last:[&:has([aria-selected])]:before:rounded-r-full last:[&:has([aria-selected])]:before:border-r-2",
  "[&:has([aria-selected].day-range-end)]:before:rounded-r-full [&:has([aria-selected].day-range-end)]:before:border-r-2",
  // Single-day selection → full circle pill
  "[&:has([aria-selected].day-range-start.day-range-end)]:before:rounded-full [&:has([aria-selected].day-range-start.day-range-end)]:before:border-x-2"
)

export const calendarRangeDayClass =
  "relative z-10 mx-auto flex h-9 w-9 max-w-[36px] items-center justify-center rounded-full bg-transparent p-0 text-sm font-normal text-gray-900 transition-colors hover:bg-gray-100 aria-selected:opacity-100"

export const calendarRangeDayModifiers = {
  day_selected:
    "bg-transparent text-gray-900 hover:bg-transparent focus:bg-transparent",
  day_range_middle:
    "day-range-middle !rounded-none !bg-transparent !text-gray-900 aria-selected:!text-gray-900",
  day_range_start:
    "day-range-start !bg-transparent !text-gray-900",
  day_range_end:
    "day-range-end !bg-transparent !text-gray-900",
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 w-full", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0 w-full",
        month: "space-y-4 w-full",
        caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute left-0",
        nav_button_next: "absolute right-0",
        table: "w-full border-collapse table-fixed",
        head_row: "",
        head_cell:
          "text-muted-foreground font-normal text-[0.8rem] text-center pb-2 w-[14.28%]",
        row: "mt-1",
        cell: "relative z-0 h-9 p-0 text-center text-sm",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "mx-auto flex h-9 w-9 max-w-[36px] items-center justify-center rounded-full p-0 font-normal text-gray-900 transition-colors hover:bg-gray-100 aria-selected:opacity-100"
        ),
        // Transparent by default so callers that draw selection via cell ::before
        // (booking step 1 outline circle) are not overridden by a solid fill.
        day_selected:
          "bg-transparent text-[#F51042] hover:bg-transparent focus:bg-transparent",
        day_today: "font-semibold text-gray-900",
        day_outside:
          "day-outside text-muted-foreground aria-selected:text-[#F51042] opacity-50",
        day_disabled: "text-gray-300 opacity-40 font-normal line-through decoration-gray-300/80",
        day_range_middle:
          "aria-selected:bg-transparent aria-selected:text-gray-900",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ className }) => (
          <Icon icon="mdi:chevron-left" className={cn("h-4 w-4", className)} aria-hidden />
        ),
        IconRight: ({ className }) => (
          <Icon icon="mdi:chevron-right" className={cn("h-4 w-4", className)} aria-hidden />
        ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
