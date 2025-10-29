import { Calendar as CalendarIcon, Clock, Save, Settings, Trash2, Plus, X, ChevronLeft, ChevronRight, Copy, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import { useToast } from "@/hooks/use-toast";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";

interface DateAvailability {
  id: number;
  kitchenId: number;
  specificDate: string;
  startTime: string | null;
  endTime: string | null;
  isAvailable: boolean;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = localStorage.getItem('firebaseToken');
  if (token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }
  return {
    'Content-Type': 'application/json',
  };
}

// Helper to get days in month
function getDaysInMonth(year: number, month: number) {
  const date = new Date(year, month, 1);
  const days = [];
  while (date.getMonth() === month) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

// Helper to get calendar grid with previous/next month padding
function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startingDayOfWeek = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  
  const days: (Date | null)[] = [];
  
  // Add empty cells for days before month starts
  for (let i = 0; i < startingDayOfWeek; i++) {
    const prevDate = new Date(year, month, -startingDayOfWeek + i + 1);
    days.push(prevDate);
  }
  
  // Add all days in current month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day));
  }
  
  // Add empty cells for days after month ends
  const remainingCells = 42 - days.length; // 6 rows * 7 days
  for (let i = 1; i <= remainingCells; i++) {
    days.push(new Date(year, month + 1, i));
  }
  
  return days;
}

export default function KitchenAvailabilityManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  
  // Initialize from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const urlLocationId = urlParams.get('location');
  const urlKitchenId = urlParams.get('kitchen');
  
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(
    urlLocationId ? parseInt(urlLocationId) : null
  );
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(
    urlKitchenId ? parseInt(urlKitchenId) : null
  );
  const [kitchens, setKitchens] = useState<any[]>([]);
  
  // Calendar navigation
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    startTime: "09:00",
    endTime: "17:00",
    isAvailable: true,
    reason: "",
  });

  // Load kitchens when location is selected
  useEffect(() => {
    if (selectedLocationId) {
      fetch(`/api/manager/kitchens/${selectedLocationId}`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          setKitchens(data);
          // Auto-select kitchen from URL if provided
          if (urlKitchenId && data.length > 0) {
            const kitchenId = parseInt(urlKitchenId);
            if (!isNaN(kitchenId)) {
              const kitchenExists = data.some((k: any) => k.id === kitchenId);
              if (kitchenExists) {
                setSelectedKitchenId(kitchenId);
              }
            }
          }
        })
        .catch(() => {});
    } else {
      setKitchens([]);
      setSelectedKitchenId(null);
    }
  }, [selectedLocationId, urlKitchenId]);

  // Fetch date availability for selected kitchen
  const { data: dateAvailability = [], isLoading: isLoadingAvailability } = useQuery({
    queryKey: ['dateAvailability', selectedKitchenId],
    queryFn: async () => {
      if (!selectedKitchenId) return [];
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/kitchens/${selectedKitchenId}/date-overrides`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error('Failed to fetch date availability');
      }
      return response.json();
    },
    enabled: !!selectedKitchenId,
  });

  // Create date availability mutation
  const createAvailability = useMutation({
    mutationFn: async (data: any) => {
      if (!selectedKitchenId) throw new Error('No kitchen selected');
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/kitchens/${selectedKitchenId}/date-overrides`, {
        method: 'POST',
        headers,
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create date availability');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dateAvailability', selectedKitchenId] });
      setShowEditModal(false);
      resetForm();
      toast({
        title: "Success",
        description: "Availability saved successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update date availability mutation
  const updateAvailability = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/date-overrides/${id}`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update date availability');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dateAvailability', selectedKitchenId] });
      setShowEditModal(false);
      resetForm();
      toast({
        title: "Success",
        description: "Availability updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete date availability mutation
  const deleteAvailability = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/date-overrides/${id}`, {
        method: 'DELETE',
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete date availability');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dateAvailability', selectedKitchenId] });
      toast({
        title: "Success",
        description: "Availability removed successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      startTime: "09:00",
      endTime: "17:00",
      isAvailable: true,
      reason: "",
    });
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear(currentYear - 1);
      } else {
        setCurrentMonth(currentMonth - 1);
      }
    } else {
      if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear(currentYear + 1);
      } else {
        setCurrentMonth(currentMonth + 1);
      }
    }
  };

  const getAvailabilityForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return dateAvailability.find((avail: DateAvailability) => {
      const availDateStr = new Date(avail.specificDate).toISOString().split('T')[0];
      return availDateStr === dateStr;
    });
  };

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
    const existing = getAvailabilityForDate(date);
    
    if (existing) {
      setFormData({
        startTime: existing.startTime || "09:00",
        endTime: existing.endTime || "17:00",
        isAvailable: existing.isAvailable,
        reason: existing.reason || "",
      });
    } else {
      resetForm();
    }
    
    setShowEditModal(true);
  };

  const handleSaveAvailability = () => {
    if (!selectedDate || !selectedKitchenId) return;

    const dateStr = selectedDate.toISOString().split('T')[0];
    const existing = getAvailabilityForDate(selectedDate);

    if (existing) {
      // Update existing
      updateAvailability.mutate({
        id: existing.id,
        data: {
          startTime: formData.isAvailable ? formData.startTime : undefined,
          endTime: formData.isAvailable ? formData.endTime : undefined,
          isAvailable: formData.isAvailable,
          reason: formData.reason || undefined,
        },
      });
    } else {
      // Create new
      createAvailability.mutate({
        specificDate: dateStr,
        ...formData,
      });
    }
  };

  const handleDeleteAvailability = () => {
    if (!selectedDate) return;
    const existing = getAvailabilityForDate(selectedDate);
    if (existing && window.confirm("Remove availability for this date?")) {
      deleteAvailability.mutate(existing.id);
      setShowEditModal(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getAvailableSlots = (startTime: string, endTime: string) => {
    const start = parseInt(startTime.split(':')[0]);
    const end = parseInt(endTime.split(':')[0]);
    const slots: string[] = [];
    for (let hour = start; hour < end; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
    return slots;
  };

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  
  const calendarDays = selectedKitchenId ? getCalendarDays(currentYear, currentMonth) : [];
  const isCurrentMonth = (date: Date) => date.getMonth() === currentMonth;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <ManagerHeader />
      <main className="flex-1 pt-24 pb-8">
        <div className="container mx-auto px-4 py-6 max-w-7xl">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Kitchen Availability Calendar</h1>
            <p className="text-gray-600 mt-1">Click on any date to set operating hours for your kitchen</p>
          </div>

          {isLoadingLocations ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Loading locations...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Sidebar: Location & Kitchen Selection */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Location</h2>
                  <select
                    value={selectedLocationId || ""}
                    onChange={(e) => {
                      setSelectedLocationId(e.target.value ? parseInt(e.target.value) : null);
                      setSelectedKitchenId(null);
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Choose location...</option>
                    {locations.map((location: any) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedLocationId && (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Kitchen</h2>
                    <select
                      value={selectedKitchenId || ""}
                      onChange={(e) => setSelectedKitchenId(e.target.value ? parseInt(e.target.value) : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Choose kitchen...</option>
                      {kitchens.map((kitchen) => (
                        <option key={kitchen.id} value={kitchen.id}>
                          {kitchen.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {selectedKitchenId && (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Legend</h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-green-100 border border-green-300 rounded"></div>
                        <span>Available</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-red-100 border border-red-300 rounded"></div>
                        <span>Closed</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-white border border-gray-200 rounded"></div>
                        <span>Not set</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Calendar View */}
              <div className="lg:col-span-3 space-y-4">
                {!selectedKitchenId ? (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12">
                    <div className="text-center">
                      <CalendarIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Kitchen</h3>
                      <p className="text-gray-500">Choose a location and kitchen to view and manage its availability calendar</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Calendar Header */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => navigateMonth('prev')}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <ChevronLeft className="h-5 w-5 text-gray-600" />
                        </button>
                        
                        <h2 className="text-xl font-bold text-gray-900">
                          {monthNames[currentMonth]} {currentYear}
                        </h2>
                        
                        <button
                          onClick={() => navigateMonth('next')}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <ChevronRight className="h-5 w-5 text-gray-600" />
                        </button>
                      </div>
                    </div>

                    {/* Calendar Grid */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                      {isLoadingAvailability ? (
                        <div className="text-center py-12">
                          <p className="text-gray-500">Loading calendar...</p>
                        </div>
                      ) : (
                        <div className="calendar-grid">
                          {/* Day headers */}
                          <div className="grid grid-cols-7 gap-2 mb-2">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                              <div key={day} className="text-center text-xs font-semibold text-gray-600 py-2">
                                {day}
                              </div>
                            ))}
                          </div>

                          {/* Calendar days */}
                          <div className="grid grid-cols-7 gap-2">
                            {calendarDays.map((date, index) => {
                              const availability = getAvailabilityForDate(date);
                              const isCurrent = isCurrentMonth(date);
                              const isToday = date.toDateString() === today.toDateString();
                              const isPast = date < today && !isToday;

                              let bgColor = 'bg-white hover:bg-gray-50';
                              let borderColor = 'border-gray-200';
                              let textColor = isCurrent ? 'text-gray-900' : 'text-gray-400';

                              if (availability) {
                                if (availability.isAvailable) {
                                  bgColor = 'bg-green-50 hover:bg-green-100 border-green-300';
                                  borderColor = 'border-green-300';
                                } else {
                                  bgColor = 'bg-red-50 hover:bg-red-100 border-red-300';
                                  borderColor = 'border-red-300';
                                }
                              }

                              if (isToday) {
                                borderColor = 'border-blue-500 border-2';
                              }

                              return (
                                <button
                                  key={index}
                                  onClick={() => !isPast && isCurrent && handleDateClick(date)}
                                  disabled={isPast || !isCurrent}
                                  className={`
                                    aspect-square p-2 rounded-lg border transition-all
                                    ${bgColor} ${borderColor} ${textColor}
                                    ${isPast || !isCurrent ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                                    relative
                                  `}
                                >
                                  <div className="text-sm font-medium">
                                    {date.getDate()}
                                  </div>
                                  {availability && isCurrent && (
                                    <div className="text-xs mt-1 truncate">
                                      {availability.isAvailable && availability.startTime && availability.endTime ? (
                                        <span className="text-green-700 font-medium">
                                          {availability.startTime.slice(0, 5)}
                                        </span>
                                      ) : (
                                        <span className="text-red-700 font-medium">Closed</span>
                                      )}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Edit Modal */}
                    {showEditModal && selectedDate && (
                      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full">
                          {/* Modal Header */}
                          <div className="flex items-center justify-between p-6 border-b border-gray-200">
                            <div>
                              <h2 className="text-xl font-bold text-gray-900">
                                {selectedDate.toLocaleDateString('en-US', { 
                                  weekday: 'long', 
                                  month: 'long', 
                                  day: 'numeric', 
                                  year: 'numeric' 
                                })}
                              </h2>
                              <p className="text-sm text-gray-500 mt-1">Set availability for this date</p>
                            </div>
                            <button
                              onClick={() => setShowEditModal(false)}
                              className="text-gray-400 hover:text-gray-600 transition-colors"
                            >
                              <X className="h-6 w-6" />
                            </button>
                          </div>

                          {/* Modal Body */}
                          <div className="p-6 space-y-5">
                            {/* Available Toggle */}
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                              <div>
                                <p className="font-medium text-gray-900">Kitchen Status</p>
                                <p className="text-sm text-gray-500">Is the kitchen open on this date?</p>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={formData.isAvailable}
                                  onChange={(e) => setFormData({ ...formData, isAvailable: e.target.checked })}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                              </label>
                            </div>

                            {/* Operating Hours */}
                            {formData.isAvailable ? (
                              <>
                                <div className="space-y-4">
                                  <label className="block text-sm font-medium text-gray-900">
                                    Operating Hours
                                  </label>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-2">From</label>
                                      <input
                                        type="time"
                                        value={formData.startTime}
                                        onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-2">To</label>
                                      <input
                                        type="time"
                                        value={formData.endTime}
                                        onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* Time Slots Preview */}
                                {formData.startTime && formData.endTime && (
                                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                    <p className="text-xs font-semibold text-blue-900 mb-3 flex items-center gap-2">
                                      <Clock className="h-3.5 w-3.5" />
                                      Available Booking Slots
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                      {getAvailableSlots(formData.startTime, formData.endTime).map((slot, idx) => (
                                        <span
                                          key={idx}
                                          className="px-3 py-1.5 bg-white text-blue-700 text-sm font-medium rounded-md border border-blue-200"
                                        >
                                          {slot}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
                                <p className="text-sm font-medium text-red-800">
                                  Kitchen will be closed on this date
                                </p>
                              </div>
                            )}

                            {/* Reason */}
                            <div>
                              <label className="block text-sm font-medium text-gray-900 mb-2">
                                Note (Optional)
                              </label>
                              <input
                                type="text"
                                value={formData.reason}
                                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                                placeholder="e.g., Holiday, Special Event, Maintenance"
                                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                          </div>

                          {/* Modal Footer */}
                          <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
                            <button
                              onClick={handleDeleteAvailability}
                              disabled={!getAvailabilityForDate(selectedDate)}
                              className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Trash2 className="h-4 w-4" />
                              Remove
                            </button>
                            
                            <div className="flex gap-3">
                              <button
                                onClick={() => setShowEditModal(false)}
                                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-white transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleSaveAvailability}
                                disabled={createAvailability.isPending || updateAvailability.isPending}
                                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                Save
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

