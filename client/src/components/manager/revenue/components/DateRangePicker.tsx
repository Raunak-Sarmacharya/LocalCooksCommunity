/**
 * Date Range Picker Component
 * 
 * Popover-based date range picker with presets (industry standard).
 * Based on shadcn calendar-23 pattern.
 */

import * as React from "react"
import { CalendarIcon, ChevronDown } from "lucide-react"
import { type DateRange } from "react-day-picker"
import { addDays, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, subDays, subMonths } from "date-fns"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/formatters"
import type { DateRangePreset, DateRange as AppDateRange } from "../types"

interface DateRangePickerProps {
    dateRange: AppDateRange
    onDateRangeChange: (range: AppDateRange) => void
    className?: string
}

const presets: { label: string; value: DateRangePreset; getRange: () => { from: Date; to: Date } }[] = [
    {
        label: 'Today',
        value: 'today',
        getRange: () => {
            const today = new Date()
            return { from: today, to: today }
        },
    },
    {
        label: 'Last 7 Days',
        value: 'week',
        getRange: () => ({
            from: subDays(new Date(), 6),
            to: new Date(),
        }),
    },
    {
        label: 'This Month',
        value: 'month',
        getRange: () => ({
            from: startOfMonth(new Date()),
            to: endOfMonth(new Date()),
        }),
    },
    {
        label: 'Last Month',
        value: 'month',
        getRange: () => {
            const lastMonth = subMonths(new Date(), 1)
            return {
                from: startOfMonth(lastMonth),
                to: endOfMonth(lastMonth),
            }
        },
    },
    {
        label: 'This Quarter',
        value: 'quarter',
        getRange: () => ({
            from: startOfQuarter(new Date()),
            to: endOfQuarter(new Date()),
        }),
    },
    {
        label: 'Year to Date',
        value: 'year',
        getRange: () => ({
            from: startOfYear(new Date()),
            to: new Date(),
        }),
    },
]

export function DateRangePicker({
    dateRange,
    onDateRangeChange,
    className,
}: DateRangePickerProps) {
    const [isOpen, setIsOpen] = React.useState(false)
    const [selectedPreset, setSelectedPreset] = React.useState<string>('This Month')

    const handlePresetSelect = (preset: typeof presets[0]) => {
        const range = preset.getRange()
        onDateRangeChange(range)
        setSelectedPreset(preset.label)
    }

    const handleCalendarSelect = (range: DateRange | undefined) => {
        if (range) {
            onDateRangeChange({
                from: range.from,
                to: range.to,
            })
            setSelectedPreset('Custom')
        }
    }

    const displayValue = React.useMemo(() => {
        if (dateRange.from && dateRange.to) {
            if (dateRange.from.toDateString() === dateRange.to.toDateString()) {
                return formatDate(dateRange.from)
            }
            return `${formatDate(dateRange.from)} - ${formatDate(dateRange.to)}`
        }
        return 'Select date range'
    }, [dateRange])

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className={cn(
                        "justify-between font-normal min-w-[240px]",
                        !dateRange.from && "text-muted-foreground",
                        className
                    )}
                >
                    <div className="flex items-center gap-2">
                        <CalendarIcon className="h-4 w-4" />
                        <span>{displayValue}</span>
                    </div>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <div className="flex">
                    {/* Presets Sidebar */}
                    <div className="border-r p-3 w-40">
                        <p className="text-xs font-medium text-muted-foreground mb-2 px-2">
                            Quick Select
                        </p>
                        <div className="space-y-1">
                            {presets.map((preset) => (
                                <Button
                                    key={preset.label}
                                    variant={selectedPreset === preset.label ? "secondary" : "ghost"}
                                    size="sm"
                                    className="w-full justify-start text-sm"
                                    onClick={() => handlePresetSelect(preset)}
                                >
                                    {preset.label}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {/* Calendar */}
                    <div className="p-3">
                        <Calendar
                            mode="range"
                            selected={{
                                from: dateRange.from,
                                to: dateRange.to,
                            }}
                            onSelect={handleCalendarSelect}
                            numberOfMonths={2}
                            defaultMonth={dateRange.from}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="border-t p-3 flex justify-end gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsOpen(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => setIsOpen(false)}
                    >
                        Apply
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    )
}
