import { Clock, Save, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
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
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(null);
  const [kitchens, setKitchens] = useState<any[]>([]);
  const [availability, setAvailability] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>("");

  useEffect(() => {
    if (selectedLocationId) {
      fetch(`/api/manager/kitchens/${selectedLocationId}`, { credentials: "include" })
        .then(res => res.json())
        .then(data => setKitchens(data))
        .catch(err => console.error("Error fetching kitchens:", err));
    }
  }, [selectedLocationId]);

  useEffect(() => {
    if (selectedKitchenId) {
      fetch(`/api/manager/availability/${selectedKitchenId}`, { credentials: "include" })
        .then(res => res.json())
        .then(data => setAvailability(data))
        .catch(err => console.error("Error fetching availability:", err));
    }
  }, [selectedKitchenId]);

  const handleSaveAvailability = async (dayOfWeek: number, startTime: string, endTime: string, isAvailable: boolean) => {
    if (!selectedKitchenId) return;

    setIsSaving(true);
    setSaveStatus("");
    try {
      await setKitchenAvailability(selectedKitchenId, dayOfWeek, startTime, endTime, isAvailable);
      setSaveStatus("Saved successfully!");
      setTimeout(() => setSaveStatus(""), 3000);
    } catch (error) {
      setSaveStatus("Error saving availability");
      console.error("Error:", error);
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
            <h1 className="text-3xl font-bold text-gray-900">Manage Kitchen Availability</h1>
            <p className="text-gray-600 mt-2">Set up weekly schedules for each kitchen</p>
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
                <h2 className="text-xl font-semibold text-gray-900 mb-4">
                  Weekly Schedule
                </h2>
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

  const handleSave = () => {
    onSave(startTime, endTime, isAvailable);
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4">
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
          <span className="text-sm text-gray-700">Available</span>
        </label>
      </div>
      {isAvailable && (
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
      )}
      <button
        onClick={handleSave}
        disabled={isSaving || !isAvailable}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
      >
        <Save className="h-4 w-4" />
        {isSaving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
