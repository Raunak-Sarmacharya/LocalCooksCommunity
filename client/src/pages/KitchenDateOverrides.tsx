import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar as CalendarIcon, X, Plus, Trash2, Edit2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";

interface DateOverride {
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

export default function KitchenDateOverrides() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, kitchens: allKitchens, getKitchensForLocation } = useManagerDashboard();
  
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);
  const [selectedKitchen, setSelectedKitchen] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingOverride, setEditingOverride] = useState<DateOverride | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    specificDate: "",
    startTime: "",
    endTime: "",
    isAvailable: false,
    reason: "",
  });

  // Get kitchens for selected location
  const kitchens = selectedLocation ? getKitchensForLocation(selectedLocation) : [];

  // Fetch date overrides for selected kitchen
  const { data: dateOverrides = [], isLoading: isLoadingOverrides } = useQuery({
    queryKey: ['dateOverrides', selectedKitchen],
    queryFn: async () => {
      if (!selectedKitchen) return [];
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/kitchens/${selectedKitchen}/date-overrides`, {
        headers,
      });
      if (!response.ok) {
        throw new Error('Failed to fetch date overrides');
      }
      return response.json();
    },
    enabled: !!selectedKitchen,
  });

  // Create date override mutation
  const createOverride = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!selectedKitchen) throw new Error('No kitchen selected');
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/kitchens/${selectedKitchen}/date-overrides`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create date override');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dateOverrides', selectedKitchen] });
      setShowAddForm(false);
      resetForm();
      toast({
        title: "Success",
        description: "Date override created successfully",
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

  // Update date override mutation
  const updateOverride = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof formData> }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/date-overrides/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update date override');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dateOverrides', selectedKitchen] });
      setEditingOverride(null);
      toast({
        title: "Success",
        description: "Date override updated successfully",
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

  // Delete date override mutation
  const deleteOverride = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/date-overrides/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete date override');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dateOverrides', selectedKitchen] });
      toast({
        title: "Success",
        description: "Date override deleted successfully",
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
      startTime: "",
      endTime: "",
      isAvailable: false,
      reason: "",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingOverride) {
      updateOverride.mutate({
        id: editingOverride.id,
        data: {
          startTime: formData.startTime || undefined,
          endTime: formData.endTime || undefined,
          isAvailable: formData.isAvailable,
          reason: formData.reason || undefined,
        },
      });
    } else {
      createOverride.mutate(formData);
    }
  };

  const handleEdit = (override: DateOverride) => {
    setEditingOverride(override);
    setFormData({
      specificDate: new Date(override.specificDate).toISOString().split('T')[0],
      startTime: override.startTime || "",
      endTime: override.endTime || "",
      isAvailable: override.isAvailable,
      reason: override.reason || "",
    });
    setShowAddForm(true);
  };

  const handleDelete = (id: number) => {
    if (window.confirm("Are you sure you want to delete this date override?")) {
      deleteOverride.mutate(id);
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

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-20 sm:pt-24 lg:pt-28">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Kitchen Date Overrides</h1>
            <p className="text-gray-600 mt-2">
              Set specific dates when a kitchen is closed or has different operating hours
            </p>
          </div>

          {/* Location and Kitchen Selection */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Select Location & Kitchen</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                <select
                  value={selectedLocation || ""}
                  onChange={(e) => {
                    setSelectedLocation(e.target.value ? parseInt(e.target.value) : null);
                    setSelectedKitchen(null);
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="">Select a location</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Kitchen</label>
                <select
                  value={selectedKitchen || ""}
                  onChange={(e) => setSelectedKitchen(e.target.value ? parseInt(e.target.value) : null)}
                  disabled={!selectedLocation}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 disabled:bg-gray-100"
                >
                  <option value="">Select a kitchen</option>
                  {kitchens.map((kitchen) => (
                    <option key={kitchen.id} value={kitchen.id}>
                      {kitchen.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedKitchen && (
              <button
                onClick={() => {
                  resetForm();
                  setEditingOverride(null);
                  setShowAddForm(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Add Date Override
              </button>
            )}
          </div>

          {/* Add/Edit Form */}
          {showAddForm && (
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingOverride ? 'Edit' : 'Add'} Date Override
                </h2>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setEditingOverride(null);
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
                    disabled={!!editingOverride}
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
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    placeholder="e.g., Holiday, Maintenance"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={createOverride.isPending || updateOverride.isPending}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {editingOverride ? 'Update' : 'Create'} Override
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false);
                      setEditingOverride(null);
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

          {/* Date Overrides List */}
          {selectedKitchen && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Date Overrides</h2>
              
              {isLoadingOverrides ? (
                <p className="text-gray-500">Loading overrides...</p>
              ) : dateOverrides.length === 0 ? (
                <p className="text-gray-500">No date overrides set for this kitchen</p>
              ) : (
                <div className="space-y-3">
                  {dateOverrides
                    .sort((a: DateOverride, b: DateOverride) => 
                      new Date(a.specificDate).getTime() - new Date(b.specificDate).getTime()
                    )
                    .map((override: DateOverride) => (
                      <div
                        key={override.id}
                        className="p-4 border border-gray-200 rounded-lg flex items-center justify-between"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <CalendarIcon className="h-4 w-4 text-gray-600" />
                            <span className="font-semibold text-gray-900">
                              {formatDate(override.specificDate)}
                            </span>
                            <span
                              className={`px-2 py-1 text-xs rounded-full ${
                                override.isAvailable
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {override.isAvailable ? "Custom Hours" : "Closed"}
                            </span>
                          </div>
                          {override.isAvailable && override.startTime && override.endTime && (
                            <p className="text-sm text-gray-600">
                              Hours: {override.startTime} - {override.endTime}
                            </p>
                          )}
                          {override.reason && (
                            <p className="text-sm text-gray-600">Reason: {override.reason}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEdit(override)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(override.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

