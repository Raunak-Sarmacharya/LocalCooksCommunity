import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  ChefHat,
  CheckCircle2,
  AlertCircle,
  XCircle,
  LayoutGrid,
  List,
  CalendarDays,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  isSameMonth,
  isSameDay,
  isSameWeek,
  isToday,
  getHours,
  getMinutes,
} from "date-fns";

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKING CALENDAR WIDGET - Premium Design
// Inspired by Untitled UI, Peerspace, and top booking platforms
// Features: Month View, Week View with time slots, Day detail panel
// ═══════════════════════════════════════════════════════════════════════════════

type CalendarView = 'month' | 'week';

interface Booking {
  id: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  chefName?: string;
  portalUserName?: string;
  kitchenName?: string;
  locationName?: string;
  specialNotes?: string;
}

interface BookingCalendarWidgetProps {
  bookings: Booking[];
  isLoading: boolean;
  onNavigateToBookings: () => void;
}

export default function BookingCalendarWidget({
  bookings,
  isLoading,
  onNavigateToBookings,
}: BookingCalendarWidgetProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [view, setView] = useState<CalendarView>('month');

  // Navigate
  const goToPrev = () => {
    if (view === 'month') {
      setCurrentDate(subMonths(currentDate, 1));
    } else {
      setCurrentDate(subWeeks(currentDate, 1));
    }
  };

  const goToNext = () => {
    if (view === 'month') {
      setCurrentDate(addMonths(currentDate, 1));
    } else {
      setCurrentDate(addWeeks(currentDate, 1));
    }
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };

  // Group bookings by date
  const bookingsByDate = useMemo(() => {
    const grouped: Record<string, Booking[]> = {};
    bookings.forEach((booking) => {
      if (!booking.bookingDate) return;
      const dateStr = booking.bookingDate.split('T')[0];
      if (!grouped[dateStr]) {
        grouped[dateStr] = [];
      }
      grouped[dateStr].push(booking);
    });
    // Sort bookings within each day by start time
    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => {
        if (!a.startTime || !b.startTime) return 0;
        return a.startTime.localeCompare(b.startTime);
      });
    });
    return grouped;
  }, [bookings]);

  // Get bookings for a specific date
  const getBookingsForDate = (date: Date): Booking[] => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return bookingsByDate[dateStr] || [];
  };

  // Generate calendar days for month view
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 0 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });

    const days: Date[] = [];
    let day = startDate;
    while (day <= endDate) {
      days.push(day);
      day = addDays(day, 1);
    }
    return days;
  }, [currentDate]);

  // Generate week days for week view
  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      days.push(addDays(weekStart, i));
    }
    return days;
  }, [currentDate]);

  // Get bookings for selected date
  const selectedDateBookings = selectedDate ? getBookingsForDate(selectedDate) : [];

  // Time slots for week view (6 AM to 10 PM)
  const timeSlots = useMemo(() => {
    const slots: number[] = [];
    for (let hour = 6; hour <= 22; hour++) {
      slots.push(hour);
    }
    return slots;
  }, []);

  // Format time helper
  const formatTime = (time: string) => {
    if (!time) return '';
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  // Format hour for time slots
  const formatHour = (hour: number) => {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour} ${ampm}`;
  };

  // Get booking position and height for week view
  const getBookingStyle = (booking: Booking) => {
    if (!booking.startTime || !booking.endTime) return { display: 'none' };
    
    const [startHour, startMin] = booking.startTime.split(':').map(Number);
    const [endHour, endMin] = booking.endTime.split(':').map(Number);
    
    const startOffset = ((startHour - 6) * 60 + startMin) / 60; // hours from 6 AM
    const duration = ((endHour - startHour) * 60 + (endMin - startMin)) / 60; // duration in hours
    
    return {
      top: `${startOffset * 48}px`, // 48px per hour
      height: `${Math.max(duration * 48, 24)}px`, // minimum 24px height
    };
  };

  // Status config
  const statusConfig = {
    confirmed: {
      color: 'bg-emerald-500',
      textColor: 'text-emerald-700',
      bgColor: 'bg-emerald-50',
      borderColor: 'border-emerald-200',
      hoverBg: 'hover:bg-emerald-100',
      icon: CheckCircle2,
      label: 'Confirmed',
    },
    pending: {
      color: 'bg-amber-500',
      textColor: 'text-amber-700',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-200',
      hoverBg: 'hover:bg-amber-100',
      icon: AlertCircle,
      label: 'Pending',
    },
    cancelled: {
      color: 'bg-gray-400',
      textColor: 'text-gray-600',
      bgColor: 'bg-gray-50',
      borderColor: 'border-gray-200',
      hoverBg: 'hover:bg-gray-100',
      icon: XCircle,
      label: 'Cancelled',
    },
  };

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Get date range text
  const getDateRangeText = () => {
    if (view === 'month') {
      return `${format(startOfMonth(currentDate), 'MMM d')} – ${format(endOfMonth(currentDate), 'MMM d, yyyy')}`;
    } else {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
      return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;
    }
  };

  return (
    <Card className="border border-gray-200 shadow-sm bg-white overflow-hidden">
      {/* Calendar Header */}
      <CardHeader className="p-4 pb-3 border-b border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Left: Date Badge & Title */}
          <div className="flex items-center gap-3">
            {/* Date Badge */}
            <div className="flex flex-col items-center justify-center w-14 h-14 bg-gradient-to-br from-rose-500 to-pink-600 rounded-xl text-white shadow-lg shadow-rose-500/20">
              <span className="text-[10px] font-semibold uppercase tracking-wider opacity-90">
                {format(new Date(), 'MMM')}
              </span>
              <span className="text-xl font-bold leading-none">
                {format(new Date(), 'd')}
              </span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {format(currentDate, 'MMMM yyyy')}
              </h3>
              <p className="text-xs text-gray-500">{getDateRangeText()}</p>
            </div>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-2">
            {/* Today Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={goToToday}
              className="text-xs h-8 px-3 border-gray-200 hover:bg-gray-50"
            >
              Today
            </Button>

            {/* View Toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView('month')}
                className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                  view === 'month'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5 mr-1" />
                Month
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView('week')}
                className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                  view === 'week'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <List className="h-3.5 w-3.5 mr-1" />
                Week
              </Button>
            </div>

            {/* Navigation */}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={goToPrev}
                className="h-7 w-7 p-0 hover:bg-white rounded-md"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={goToNext}
                className="h-7 w-7 p-0 hover:bg-white rounded-md"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="flex flex-col lg:flex-row">
          {/* Calendar Grid - Month View */}
          {view === 'month' && (
            <div className="flex-1 p-4">
              {/* Week Days Header */}
              <div className="grid grid-cols-7 mb-2">
                {dayNames.map((day) => (
                  <div
                    key={day}
                    className="text-center text-xs font-medium text-gray-500 py-2"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar Days */}
              <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-lg overflow-hidden">
                {calendarDays.map((day, idx) => {
                  const dayBookings = getBookingsForDate(day);
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const isSelected = selectedDate && isSameDay(day, selectedDate);
                  const isTodayDate = isToday(day);
                  const hasBookings = dayBookings.length > 0;
                  const hasPending = dayBookings.some((b) => b.status === 'pending');
                  const hasConfirmed = dayBookings.some((b) => b.status === 'confirmed');

                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDate(day)}
                      className={`
                        relative min-h-[80px] p-1.5 bg-white transition-all duration-150
                        hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-inset
                        ${!isCurrentMonth ? 'bg-gray-50/50' : ''}
                        ${isSelected ? 'ring-2 ring-rose-500 ring-inset bg-rose-50/50' : ''}
                      `}
                    >
                      {/* Day Number */}
                      <div className="flex items-start justify-between mb-1">
                        <span
                          className={`
                            inline-flex items-center justify-center w-7 h-7 text-sm font-medium rounded-full transition-colors
                            ${isTodayDate ? 'bg-rose-500 text-white' : ''}
                            ${!isTodayDate && isSelected ? 'bg-rose-100 text-rose-700' : ''}
                            ${!isTodayDate && !isSelected && isCurrentMonth ? 'text-gray-900' : ''}
                            ${!isCurrentMonth ? 'text-gray-400' : ''}
                          `}
                        >
                          {format(day, 'd')}
                        </span>
                        {hasBookings && (
                          <div className="flex gap-0.5">
                            {hasConfirmed && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            )}
                            {hasPending && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Booking Previews */}
                      {isCurrentMonth && hasBookings && (
                        <div className="space-y-0.5">
                          {dayBookings.slice(0, 2).map((booking, i) => (
                            <div
                              key={booking.id || i}
                              className={`
                                text-[10px] px-1.5 py-0.5 rounded truncate font-medium text-left
                                ${booking.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : ''}
                                ${booking.status === 'pending' ? 'bg-amber-100 text-amber-700' : ''}
                                ${booking.status === 'cancelled' ? 'bg-gray-100 text-gray-500' : ''}
                              `}
                            >
                              <span className="opacity-70">{formatTime(booking.startTime)}</span>
                              <span className="ml-1">{booking.chefName || booking.portalUserName || 'Chef'}</span>
                            </div>
                          ))}
                          {dayBookings.length > 2 && (
                            <div className="text-[10px] text-gray-500 font-medium px-1.5">
                              +{dayBookings.length - 2} more
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs text-gray-600">Confirmed</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-xs text-gray-600">Pending</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gray-400" />
                  <span className="text-xs text-gray-600">Cancelled</span>
                </div>
              </div>
            </div>
          )}

          {/* Calendar Grid - Week View */}
          {view === 'week' && (
            <div className="flex-1 overflow-hidden">
              {/* Week Header */}
              <div className="grid grid-cols-8 border-b border-gray-100">
                <div className="p-2 text-center text-xs text-gray-400">
                  {/* Empty corner */}
                </div>
                {weekDays.map((day, idx) => {
                  const isTodayDate = isToday(day);
                  const isSelected = selectedDate && isSameDay(day, selectedDate);

                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDate(day)}
                      className={`
                        p-3 text-center transition-colors hover:bg-gray-50
                        ${isSelected ? 'bg-rose-50' : ''}
                      `}
                    >
                      <p className={`text-xs font-medium ${isTodayDate ? 'text-rose-600' : 'text-gray-500'}`}>
                        {dayNames[idx]}
                      </p>
                      <p className={`
                        text-lg font-semibold mt-0.5
                        ${isTodayDate ? 'text-rose-600' : 'text-gray-900'}
                        ${isSelected && !isTodayDate ? 'text-rose-600' : ''}
                      `}>
                        {format(day, 'd')}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Time Grid */}
              <div className="overflow-y-auto max-h-[400px]">
                <div className="grid grid-cols-8 relative">
                  {/* Time Labels */}
                  <div className="border-r border-gray-100">
                    {timeSlots.map((hour) => (
                      <div
                        key={hour}
                        className="h-12 flex items-start justify-end pr-2 text-[10px] text-gray-400 font-medium"
                        style={{ paddingTop: '2px' }}
                      >
                        {formatHour(hour)}
                      </div>
                    ))}
                  </div>

                  {/* Day Columns */}
                  {weekDays.map((day, dayIdx) => {
                    const dayBookings = getBookingsForDate(day);
                    const isTodayDate = isToday(day);

                    return (
                      <div
                        key={dayIdx}
                        className={`
                          relative border-r border-gray-50 last:border-r-0
                          ${isTodayDate ? 'bg-rose-50/30' : ''}
                        `}
                      >
                        {/* Hour Grid Lines */}
                        {timeSlots.map((hour) => (
                          <div
                            key={hour}
                            className="h-12 border-b border-gray-50"
                          />
                        ))}

                        {/* Bookings */}
                        <div className="absolute inset-0 p-0.5">
                          {dayBookings.map((booking, idx) => {
                            const style = getBookingStyle(booking);
                            const config = statusConfig[booking.status];

                            return (
                              <div
                                key={booking.id || idx}
                                className={`
                                  absolute left-0.5 right-0.5 rounded-md px-1.5 py-1 overflow-hidden
                                  cursor-pointer transition-all duration-150
                                  ${config.bgColor} ${config.borderColor} border
                                  ${config.hoverBg}
                                `}
                                style={style}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDate(day);
                                }}
                              >
                                <p className={`text-[10px] font-semibold ${config.textColor} truncate`}>
                                  {booking.chefName || booking.portalUserName || 'Chef'}
                                </p>
                                <p className={`text-[9px] ${config.textColor} opacity-70`}>
                                  {formatTime(booking.startTime)}
                                </p>
                              </div>
                            );
                          })}
                        </div>

                        {/* Current Time Indicator */}
                        {isTodayDate && (
                          <div
                            className="absolute left-0 right-0 z-10 pointer-events-none"
                            style={{
                              top: `${((new Date().getHours() - 6) * 60 + new Date().getMinutes()) / 60 * 48}px`,
                            }}
                          >
                            <div className="flex items-center">
                              <div className="w-2 h-2 bg-rose-500 rounded-full -ml-1" />
                              <div className="flex-1 h-0.5 bg-rose-500" />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Selected Day Detail Panel */}
          <div className="lg:w-72 border-t lg:border-t-0 lg:border-l border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-gray-900 text-sm">
                {selectedDate
                  ? format(selectedDate, 'EEEE, MMMM d, yyyy')
                  : 'Select a date'}
              </h4>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-rose-500" />
              </div>
            ) : selectedDateBookings.length === 0 ? (
              <div className="text-center py-8">
                <CalendarIcon className="h-10 w-10 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No bookings</p>
                <p className="text-xs text-gray-400 mt-1">
                  This day is available for booking
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {selectedDateBookings.map((booking, idx) => {
                  const config = statusConfig[booking.status];
                  const StatusIcon = config.icon;

                  return (
                    <div
                      key={booking.id || idx}
                      className={`
                        p-3 rounded-xl border transition-all duration-200
                        hover:shadow-sm cursor-pointer
                        ${config.bgColor} ${config.borderColor}
                      `}
                      onClick={onNavigateToBookings}
                    >
                      <div className="flex items-start gap-3">
                        {/* Status Indicator */}
                        <div className={`w-1 h-full min-h-[40px] rounded-full ${config.color}`} />
                        
                        <div className="flex-1 min-w-0">
                          {/* Time */}
                          <div className="flex items-center gap-1.5 mb-1">
                            <Clock className={`h-3 w-3 ${config.textColor}`} />
                            <span className={`text-xs font-semibold ${config.textColor}`}>
                              {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                            </span>
                          </div>

                          {/* Chef Name */}
                          <p className="font-medium text-gray-900 text-sm truncate mb-1">
                            {booking.chefName || booking.portalUserName || 'Guest Chef'}
                          </p>

                          {/* Kitchen */}
                          {booking.kitchenName && (
                            <div className="flex items-center gap-1 text-xs text-gray-500">
                              <ChefHat className="h-3 w-3" />
                              <span className="truncate">{booking.kitchenName}</span>
                            </div>
                          )}

                          {/* Status Badge */}
                          <div className="flex items-center gap-1 mt-2">
                            <StatusIcon className={`h-3 w-3 ${config.textColor}`} />
                            <span className={`text-xs font-medium ${config.textColor}`}>
                              {config.label}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* View All Button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onNavigateToBookings}
                  className="w-full text-rose-600 hover:text-rose-700 hover:bg-rose-50 mt-2"
                >
                  View all bookings
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

