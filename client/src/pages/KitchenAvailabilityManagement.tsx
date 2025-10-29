import { Calendar as CalendarIcon, Clock, Save, Settings, Trash2, Plus, X } from "lucide-react";
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
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAvailability, setEditingAvailability] = useState<DateAvailability | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    specificDate: "",
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
    mutationFn: async (data: typeof formData) => {
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
      setShowAddForm(false);
      resetForm();
      toast({
        title: "Success",
        description: "Date availability saved successfully",
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
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof formData> }) => {
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
      setEditingAvailability(null);
      setShowAddForm(false);
      resetForm();
      toast({
        title: "Success",
        description: "Date availability updated successfully",
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
        description: "Date availability deleted successfully",
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
      specificDate: "",
      startTime: "09:00",
      endTime: "17:00",
      isAvailable: true,
      reason: "",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingAvailability) {
      updateAvailability.mutate({
        id: editingAvailability.id,
        data: {
          startTime: formData.isAvailable ? formData.startTime : undefined,
          endTime: formData.isAvailable ? formData.endTime : undefined,
          isAvailable: formData.isAvailable,
          reason: formData.reason || undefined,
        },
      });
    } else {
      createAvailability.mutate(formData);
    }
  };

  const handleEdit = (availability: DateAvailability) => {
    setEditingAvailability(availability);
    setFormData({
      specificDate: new Date(availability.specificDate).toISOString().split('T')[0],
      startTime: availability.startTime || "09:00",
      endTime: availability.endTime || "17:00",
      isAvailable: availability.isAvailable,
      reason: availability.reason || "",
    });
    setShowAddForm(true);
  };

  const handleDelete = (id: number) => {
    if (window.confirm("Are you sure you want to delete this date availability?")) {
      deleteAvailability.mutate(id);
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

  return (
    <div className="min-h-screen flex flex-col">
      <ManagerHeader />
      <main className="flex-1 pt-24 pb-8">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Set Kitchen Availability</h1>
            <p className="text-gray-600 mt-2">Set specific dates when your kitchen is available for booking. Chefs will only see time slots you configure.</p>
          </div>

          {isLoadingLocations ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Loading locations...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Location & Kitchen Selection */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Select Location</h2>
                <div className="space-y-2">
                  {locations.map((location: any) => (
                    <button
                      key={location.id}
                      onClick={() => setSelectedLocationId(location.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedLocationId === location.id
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <p className="font-medium">{location.name}</p>
                      <p className="text-sm text-gray-600">{location.address}</p>
                    </button>
                  ))}
                </div>

                {selectedLocationId && (
                  <div className="mt-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Kitchen</h3>
                    <div className="space-y-2">
                      {kitchens.map((kitchen) => (
                        <button
                          key={kitchen.id}
                          onClick={() => setSelectedKitchenId(kitchen.id)}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            selectedKitchenId === kitchen.id
                              ? "border-green-500 bg-green-50"
                              : "border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <p className="font-medium">{kitchen.name}</p>
                          {kitchen.description && (
                            <p className="text-sm text-gray-600">{kitchen.description}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedKitchenId && !showAddForm && (
                  <button
                    onClick={() => {
                      resetForm();
                      setEditingAvailability(null);
                      setShowAddForm(true);
                    }}
                    className="w-full mt-6 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    <Plus className="h-4 w-4" />
                    Add Date
                  </button>
                )}
              </div>

              {/* Date Availability Form & List */}
              <div className="lg:col-span-2 space-y-6">
                {!selectedKitchenId ? (
                  <div className="bg-white rounded-lg shadow p-6">
                    <div className="text-center py-12">
                      <Settings className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">Please select a location and kitchen</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Add/Edit Form */}
                    {showAddForm && (
                      <div className="bg-white rounded-lg shadow p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h2 className="text-xl font-semibold text-gray-900">
                            {editingAvailability ? 'Edit' : 'Add'} Date Availability
                          </h2>
                          <button
                            onClick={() => {
                              setShowAddForm(false);
                              setEditingAvailability(null);
                              resetForm();
                            }}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Date
                            </label>
                            <input
                              type="date"
                              value={formData.specificDate}
                              onChange={(e) => setFormData({ ...formData, specificDate: e.target.value })}
                              disabled={!!editingAvailability}
                              required
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 disabled:bg-gray-100"
                            />
                          </div>

                          <div>
                            <label className="flex items-center gap-2 mb-2">
                              <input
                                type="checkbox"
                                checked={formData.isAvailable}
                                onChange={(e) => setFormData({ ...formData, isAvailable: e.target.checked })}
                                className="rounded"
                              />
                              <span className="text-sm font-medium text-gray-700">
                                Kitchen is available (uncheck for closed)
                              </span>
                            </label>
                          </div>

                          {formData.isAvailable && (
                            <>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Start Time
                                  </label>
                                  <input
                                    type="time"
                                    value={formData.startTime}
                                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                                    required={formData.isAvailable}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">
                                    End Time
                                  </label>
                                  <input
                                    type="time"
                                    value={formData.endTime}
                                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                                    required={formData.isAvailable}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                                  />
                                </div>
                              </div>

                              {/* Preview slots */}
                              {formData.startTime && formData.endTime && (
                                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                                  <p className="text-xs font-medium text-gray-600 mb-2">
                                    Chefs will see these booking slots:
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {getAvailableSlots(formData.startTime, formData.endTime).map((slot, idx) => (
                                      <span
                                        key={idx}
                                        className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded"
                                      >
                                        {slot}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Reason (Optional)
                            </label>
                            <input
                              type="text"
                              value={formData.reason}
                              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                              placeholder="e.g., Holiday, Maintenance, Special Event"
                              className="w-full border border-gray-300 rounded-lg px-3 py-2"
                            />
                          </div>

                          <div className="flex gap-3">
                            <button
                              type="submit"
                              disabled={createAvailability.isPending || updateAvailability.isPending}
                              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            >
                              <Save className="h-4 w-4" />
                              {editingAvailability ? 'Update' : 'Save'} Availability
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowAddForm(false);
                                setEditingAvailability(null);
                                resetForm();
                              }}
                              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                    {/* Date Availability List */}
                    <div className="bg-white rounded-lg shadow p-6">
                      <h2 className="text-xl font-semibold text-gray-900 mb-4">Scheduled Dates</h2>
                      
                      {isLoadingAvailability ? (
                        <p className="text-gray-500">Loading availability...</p>
                      ) : dateAvailability.length === 0 ? (
                        <div className="text-center py-8">
                          <CalendarIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                          <p className="text-gray-500">No dates configured yet</p>
                          <p className="text-sm text-gray-400 mt-1">Add dates to make your kitchen available for booking</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {dateAvailability
                            .sort((a: DateAvailability, b: DateAvailability) => 
                              new Date(a.specificDate).getTime() - new Date(b.specificDate).getTime()
                            )
                            .map((availability: DateAvailability) => (
                              <div
                                key={availability.id}
                                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <CalendarIcon className="h-4 w-4 text-gray-600" />
                                      <span className="font-semibold text-gray-900">
                                        {formatDate(availability.specificDate)}
                                      </span>
                                      <span
                                        className={`px-2 py-1 text-xs rounded-full ${
                                          availability.isAvailable
                                            ? "bg-green-100 text-green-800"
                                            : "bg-red-100 text-red-800"
                                        }`}
                                      >
                                        {availability.isAvailable ? "Available" : "Closed"}
                                      </span>
                                    </div>
                                    {availability.isAvailable && availability.startTime && availability.endTime && (
                                      <div className="flex items-center gap-2 text-sm text-gray-600 ml-6">
                                        <Clock className="h-3 w-3" />
                                        {availability.startTime} - {availability.endTime}
                                      </div>
                                    )}
                                    {availability.reason && (
                                      <p className="text-sm text-gray-600 ml-6 mt-1">
                                        {availability.reason}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex gap-2 ml-4">
                                    <button
                                      onClick={() => handleEdit(availability)}
                                      className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                      title="Edit"
                                    >
                                      <Settings className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={() => handleDelete(availability.id)}
                                      className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                                      title="Delete"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
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

