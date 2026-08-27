import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

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
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse table-fixed",
        head_row: "",
        head_cell:
          "text-muted-foreground font-normal text-[0.8rem] text-center pb-2 w-[14.28%]",
        row: "mt-1",
        cell: cn(
          "text-center text-sm p-0 relative h-10 z-0",
          // The background / top-bottom borders
          "[&:has([aria-selected])]:before:absolute [&:has([aria-selected])]:before:inset-y-[1px] [&:has([aria-selected])]:before:inset-x-0 [&:has([aria-selected])]:before:border-y-2 [&:has([aria-selected])]:before:border-[#F51042] [&:has([aria-selected])]:before:-z-10",
          // Left border & radius for start of range OR start of week
          "first:[&:has([aria-selected])]:before:border-l-2 first:[&:has([aria-selected])]:before:rounded-l-full",
          "[&:has([aria-selected].day-range-start)]:before:border-l-2 [&:has([aria-selected].day-range-start)]:before:rounded-l-full",
          // Right border & radius for end of range OR end of week
          "last:[&:has([aria-selected])]:before:border-r-2 last:[&:has([aria-selected])]:before:rounded-r-full",
          "[&:has([aria-selected].day-range-end)]:before:border-r-2 [&:has([aria-selected].day-range-end)]:before:rounded-r-full",
          // Full circle for single selected day
          "[&:has([aria-selected].day-range-start.day-range-end)]:before:border-x-2 [&:has([aria-selected].day-range-start.day-range-end)]:before:rounded-full"
        ),
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-full w-full max-w-[40px] mx-auto p-0 font-normal aria-selected:opacity-100 rounded-full hover:bg-gray-100 transition-colors flex items-center justify-center text-gray-900"
        ),
        day_range_start: "day-range-start aria-selected:text-[#F51042] aria-selected:bg-transparent font-medium",
        day_range_end: "day-range-end aria-selected:text-[#F51042] aria-selected:bg-transparent font-medium",
        day_selected:
          "text-[#F51042] aria-selected:bg-transparent hover:bg-transparent focus:bg-transparent",
        day_today: "font-semibold text-gray-900 rounded-full",
        day_outside:
          "day-outside text-muted-foreground aria-selected:text-[#F51042] opacity-50",
        day_disabled: "text-gray-400 opacity-60 line-through decoration-gray-500 decoration-1",
        day_range_middle:
          "aria-selected:bg-transparent aria-selected:text-[#F51042]",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ className, ...props }) => (
          <ChevronLeft className={cn("h-4 w-4", className)} {...props} />
        ),
        IconRight: ({ className, ...props }) => (
          <ChevronRight className={cn("h-4 w-4", className)} {...props} />
        ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
