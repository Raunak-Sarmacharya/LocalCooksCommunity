import { Clock, Save, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useManagerDashboard } from "../hooks/use-manager-dashboard区域";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export default function KitchenAvailabilityManagement() {
  const { locations, isLoadingLocations, setKitchenAvailability } = useManagerDashboard();
  
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
  const [availability, setAvailability] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>("");

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

  useEffect(() => {
    if (selectedKitchenId) {
      fetch(`/api/manager/availability/${selectedKitchenId}`, { credentials: "include" })
        .then(res => res.json())
        .then(data => setAvailability(data))
        .catch(() => {});
    } else {
      setAvailability([]);
    }
  }, [selectedKitchenId]);

  const handleSaveAvailability = async (dayOfWeek: number, startTime: string, endTime: string, isAvailable: boolean) => {
    if (!selectedKitchenId) return;

    setIsSaving(true);
    setSaveStatus("");
    try {
      await setKitchenAvailability(selectedKitchenId, dayOfWeek, startTime, endTime, isAvailable);
      setSaveStatus("Saved successfully! Chefs can now book this kitchen during these hours.");
      setTimeout(() => setSaveStatus(""), 5000);
      
      // Refresh availability to show updated data
      const response = await fetch(`/api/manager/availability/${selectedKitchenId}`, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        setAvailability(data);
      }
    } catch (error) {
      setSaveStatus("Error saving availability");
    } finally {
      setIsSaving(false);
    }
  };

  const getAvailabilityForDay = (dayOfWeek: number) => {
    return availability.find(a => a.dayOfWeek === dayOfWeek);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <ManagerHeader />
      <main className="flex-1 pt-24 pb-8">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Manage Kitchen Booking Slots</h1>
            <p className="text-gray-600 mt-2">Set availability schedules and time slots that chefs can book. You control when kitchens are available for booking.</p>
          </div>

      {isLoadingLocations ? (
        <div className="text-center py-12">
          <p className="text-gray-500">Loading locations...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Location Selection */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Select Location</h2>
            <div className="space-y-2">
              {locations.map((location) => (
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
          </div>

          {/* Availability Schedule */}
          <div className="lg:col-span-2 bg-white rounded-lg shadow p-6">
            {!selectedKitchenId ? (
              <div className="text-center py-12">
                <Settings className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">Please select a location and kitchen</p>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <h2 className="text-xl font-semibold text-gray-900">Weekly Booking Schedule</h2>
                  <p className="text-sm text-gray-600 mt-1">Configure when chefs can book this kitchen. Only available time slots will be shown to chefs.</p>
                </div>
                {saveStatus && (
                  <div
                    className={`mb-4 p-3 rounded ${
                      saveStatus.includes("Error")
                        ? "bg-red-100 text-red-800"
                        : "bg-green-100 text-green-800"
                    }`}
                  >
                    {saveStatus}
                  </div>
                )}
                <div className="space-y-4">
                  {DAYS_OF_WEEK.map((day) => {
                    const dayAvailability = getAvailabilityForDay(day.value);
                    return (
                      <DaySchedule
                        key={day.value}
                        day={day}
                        availability={dayAvailability}
                        onSave={(startTime, endTime, isAvailable) =>
                          handleSaveAvailability(day.value, startTime, endTime, isAvailable)
                        }
                        isSaving={isSaving}
                      />
                    );
                  })}
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

function DaySchedule({
  day,
  availability,
  onSave,
  isSaving,
}: {
  day: { value: number; label: string };
  availability: any;
  onSave: (startTime: string, endTime: string, isAvailable: boolean) => void;
  isSaving: boolean;
}) {
  const [startTime, setStartTime] = useState(availability?.startTime || "09:00");
  const [endTime, setEndTime] = useState(availability?.endTime || "17:00");
  const [isAvailable, setIsAvailable] = useState(availability?.isAvailable ?? true);

  // Calculate preview slots that chefs will see
  const getAvailableSlots = () => {
    if (!isAvailable) return [];
    const start = parseInt(startTime.split(':')[0]);
    const end = parseInt(endTime.split(':')[0]);
    const slots: string[] = [];
    for (let hour = start; hour < end; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
    return slots;
  };

  const previewSlots = getAvailableSlots();

  // Update state when availability prop changes
  useEffect(() => {
    if (availability) {
      setStartTime(availability.startTime || "09:00");
      setEndTime(availability.endTime || "17:00");
      setIsAvailable(availability.isAvailable ?? true);
    }
  }, [availability]);

  const handleSave = () => {
    onSave(startTime, endTime, isAvailable);
  };

  return (
    <div className={`border rounded-lg p-4 ${isAvailable ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-gray-50'}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <Clock className="h-5 w-5 text-gray-400 mr-2" />
          <h3 className="font-semibold text-gray-900">{day.label}</h3>
        </div>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={isAvailable}
            onChange={(e) => setIsAvailable(e.target.checked)}
            className="mr-2"
          />
          <span className="text-sm font-medium text-gray-700">Available for Booking</span>
        </label>
      </div>
      {isAvailable ? (
        <>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Time
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Time
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
          </div>
          {previewSlots.length > 0 && (
            <div className="mb-4 p-3 bg-white rounded-lg border border-blue-200">
              <p className="text-xs font-medium text-gray-600 mb-2">Chefs will see these booking slots:</p>
              <div className="flex flex-wrap gap-2">
                {previewSlots.map((slot, idx) => (
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
      ) : (
        <div className="mb-4 p-3 bg-gray-100 rounded-lg">
          <p className="text-sm text-gray-600">Kitchen unavailable - chefs cannot book this day</p>
        </div>
      )}
      <button
        onClick={handleSave}
        disabled={isSaving}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
      >
        <Save className="h-4 w-4" />
        {isSaving ? "Saving..." : "Save Schedule"}
      </button>
    </div>
  );
}
