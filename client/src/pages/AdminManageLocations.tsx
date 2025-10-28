import { Building, Plus, Settings, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "../hooks/use-toast";

export default function AdminManageLocations() {
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [showKitchenForm, setShowKitchenForm] = useState(false);
  const [showManagerForm, setShowManagerForm] = useState(false);
  const [locations, setLocations] = useState<any[]>([]);
  const [kitchens, setKitchens] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [locationForm, setLocationForm] = useState({
    name: "",
    address: "",
    managerId: "",
  });

  const [kitchenForm, setKitchenForm] = useState({
    locationId: "",
    name: "",
    description: "",
  });

  const [managerForm, setManagerForm] = useState({
    username: "",
    password: "",
    email: "",
    name: "",
  });

  const loadLocations = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/locations", { credentials: "include" });
      const data = await response.json();
      setLocations(data);
    } catch (error) {
      console.error("Error loading locations:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadKitchens = async (locationId: number) => {
    if (!locationId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/manager/kitchens/${locationId}`, {
        credentials: "include",
      });
      const data = await response.json();
      setKitchens(data);
    } catch (error) {
      console.error("Error loading kitchens:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/admin/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: locationForm.name,
          address: locationForm.address,
          managerId: locationForm.managerId || undefined,
        }),
      });
      if (response.ok) {
        toast({ title: "Location created successfully" });
        setShowLocationForm(false);
        setLocationForm({ name: "", address: "", managerId: "" });
        loadLocations();
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error });
      }
    } catch (error) {
      toast({ title: "Error creating location" });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateKitchen = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/admin/kitchens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          locationId: parseInt(kitchenForm.locationId),
          name: kitchenForm.name,
          description: kitchenForm.description,
        }),
      });
      if (response.ok) {
        toast({ title: "Kitchen created successfully" });
        setShowKitchenForm(false);
        setKitchenForm({ locationId: "", name: "", description: "" });
        if (kitchenForm.locationId) {
          loadKitchens(parseInt(kitchenForm.locationId));
        }
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error });
      }
    } catch (error) {
      toast({ title: "Error creating kitchen" });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateManager = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/admin/managers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(managerForm),
      });
      if (response.ok) {
        toast({ title: "Manager created successfully" });
        setShowManagerForm(false);
        setManagerForm({ username: "", password: "", email: "", name: "" });
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error });
      }
    } catch (error) {
      toast({ title: "Error creating manager" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLocations();
  }, []);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Manage Locations & Kitchens</h1>
        <p className="text-gray-600 mt-2">Create and manage commercial kitchen locations</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Locations</h2>
            <button
              onClick={() => setShowLocationForm(true)}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add Location
            </button>
          </div>
          {loading ? (
            <p className="text-gray-500">Loading...</p>
          ) : locations.length === 0 ? (
            <p className="text-gray-500">No locations yet</p>
          ) : (
            <div className="space-y-2">
              {locations.map((location) => (
                <div key={location.id} className="p-3 border border-gray-200 rounded-lg">
                  <h3 className="font-medium">{location.name}</h3>
                  <p className="text-sm text-gray-600">{location.address}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Kitchens</h2>
            <button
              onClick={() => setShowKitchenForm(true)}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              <Plus className="h-4 w-4" />
              Add Kitchen
            </button>
          </div>
          {loading ? (
            <p className="text-gray-500">Loading...</p>
          ) : kitchens.length === 0 ? (
            <p className="text-gray-500">Select a location to view kitchens</p>
          ) : (
            <div className="space-y-2">
              {kitchens.map((kitchen) => (
                <div key={kitchen.id} className="p-3 border border-gray-200 rounded-lg">
                  <h3 className="font-medium">{kitchen.name}</h3>
                  {kitchen.description && (
                    <p className="text-sm text-gray-600">{kitchen.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Managers</h2>
            <button
              onClick={() => setShowManagerForm(true)}
              className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
            >
              <Plus className="h-4 w-4" />
              Add Manager
            </button>
          </div>
        </div>
      </div>

      {/* Create Location Modal */}
      {showLocationForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold mb-4">Create New Location</h2>
            <form onSubmit={handleCreateLocation} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Location Name *
                </label>
                <input
                  type="text"
                  value={locationForm.name}
                  onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Address *
                </label>
                <input
                  type="text"
                  value={locationForm.address}
                  onChange={(e) =>
                    setLocationForm({ ...locationForm, address: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Manager ID (Optional)
                </label>
                <input
                  type="number"
                  value={locationForm.managerId}
                  onChange={(e) =>
                    setLocationForm({ ...locationForm, managerId: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {loading ? "Creating..." : "Create Location"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowLocationForm(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Kitchen Modal */}
      {showKitchenForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold mb-4">Create New Kitchen</h2>
            <form onSubmit={handleCreateKitchen} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Location *
                </label>
                <select
                  value={kitchenForm.locationId}
                  onChange={(e) => {
                    setKitchenForm({ ...kitchenForm, locationId: e.target.value });
                    loadKitchens(parseInt(e.target.value));
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Kitchen Name *
                </label>
                <input
                  type="text"
                  value={kitchenForm.name}
                  onChange={(e) => setKitchenForm({ ...kitchenForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={kitchenForm.description}
                  onChange={(e) =>
                    setKitchenForm({ ...kitchenForm, description: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                >
                  {loading ? "Creating..." : "Create Kitchen"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowKitchenForm(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Manager Modal */}
      {showManagerForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold mb-4">Create Manager Account</h2>
            <form onSubmit={handleCreateManager} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={managerForm.name}
                  onChange={(e) => setManagerForm({ ...managerForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  value={managerForm.email}
                  onChange={(e) => setManagerForm({ ...managerForm, email: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Username *
                </label>
                <input
                  type="text"
                  value={managerForm.username}
                  onChange={(e) =>
                    setManagerForm({ ...managerForm, username: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Password *
                </label>
                <input
                  type="password"
                  value={managerForm.password}
                  onChange={(e) =>
                    setManagerForm({ ...managerForm, password: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400"
                >
                  {loading ? "Creating..." : "Create Manager"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowManagerForm(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

