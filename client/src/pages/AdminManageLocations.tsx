import { Building, Plus, Settings, Users, Edit, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "../hooks/use-toast";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export default function AdminManageLocations() {
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [showKitchenForm, setShowKitchenForm] = useState(false);
  const [showManagerForm, setShowManagerForm] = useState(false);
  const [editingLocation, setEditingLocation] = useState<any | null>(null);
  const [editingKitchen, setEditingKitchen] = useState<any | null>(null);
  const [editingManager, setEditingManager] = useState<any | null>(null);
  const [deletingItem, setDeletingItem] = useState<{ type: 'location' | 'kitchen' | 'manager', id: number, name: string } | null>(null);
  
  const [locations, setLocations] = useState<any[]>([]);
  const [kitchens, setKitchens] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const [locationForm, setLocationForm] = useState({
    name: "",
    address: "",
    managerId: "",
    notificationEmail: "",
  });

  const [kitchenForm, setKitchenForm] = useState({
    locationId: "",
    name: "",
    description: "",
    isActive: true,
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

  const loadManagers = async () => {
    try {
      const response = await fetch("/api/admin/managers", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        setManagers(data);
      }
    } catch (error) {
      console.error("Error loading managers:", error);
    }
  };

  const loadKitchens = async (locationId: number) => {
    if (!locationId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/kitchens/${locationId}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch kitchens: ${response.status}`);
      }
      const data = await response.json();
      setKitchens(data);
    } catch (error) {
      console.error("Error loading kitchens:", error);
      toast({ title: "Error", description: "Failed to load kitchens" });
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
          notificationEmail: locationForm.notificationEmail || undefined,
        }),
      });
      if (response.ok) {
        toast({ title: "Success", description: "Location created successfully" });
        setShowLocationForm(false);
        setLocationForm({ name: "", address: "", managerId: "", notificationEmail: "" });
        loadLocations();
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error || "Failed to create location" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to create location" });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLocation) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/locations/${editingLocation.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: locationForm.name,
          address: locationForm.address,
          managerId: locationForm.managerId || null,
          notificationEmail: locationForm.notificationEmail || null,
        }),
      });
      if (response.ok) {
        toast({ title: "Success", description: "Location updated successfully" });
        setShowLocationForm(false);
        setEditingLocation(null);
        setLocationForm({ name: "", address: "", managerId: "", notificationEmail: "" });
        loadLocations();
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error || "Failed to update location" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to update location" });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLocation = async () => {
    if (!deletingItem) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/locations/${deletingItem.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (response.ok) {
        toast({ title: "Success", description: "Location deleted successfully" });
        setDeletingItem(null);
        loadLocations();
        if (selectedLocationId === deletingItem.id) {
          setSelectedLocationId(null);
          setKitchens([]);
        }
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error || "Failed to delete location" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete location" });
    } finally {
      setLoading(false);
    }
  };

  const handleEditLocation = (location: any) => {
    setEditingLocation(location);
    setLocationForm({
      name: location.name || "",
      address: location.address || "",
      managerId: location.managerId ? location.managerId.toString() : "",
      notificationEmail: location.notificationEmail || location.notification_email || "",
    });
    setShowLocationForm(true);
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
        toast({ title: "Success", description: "Kitchen created successfully" });
        setShowKitchenForm(false);
        setKitchenForm({ locationId: "", name: "", description: "", isActive: true });
        if (kitchenForm.locationId) {
          loadKitchens(parseInt(kitchenForm.locationId));
        }
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error || "Failed to create kitchen" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to create kitchen" });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateKitchen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKitchen) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/kitchens/${editingKitchen.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: kitchenForm.name,
          description: kitchenForm.description,
          isActive: kitchenForm.isActive,
          locationId: parseInt(kitchenForm.locationId),
        }),
      });
      if (response.ok) {
        toast({ title: "Success", description: "Kitchen updated successfully" });
        setShowKitchenForm(false);
        setEditingKitchen(null);
        setKitchenForm({ locationId: "", name: "", description: "", isActive: true });
        if (kitchenForm.locationId) {
          loadKitchens(parseInt(kitchenForm.locationId));
        }
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error || "Failed to update kitchen" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to update kitchen" });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteKitchen = async () => {
    if (!deletingItem) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/kitchens/${deletingItem.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (response.ok) {
        toast({ title: "Success", description: "Kitchen deleted successfully" });
        setDeletingItem(null);
        if (selectedLocationId) {
          loadKitchens(selectedLocationId);
        }
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error || "Failed to delete kitchen" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete kitchen" });
    } finally {
      setLoading(false);
    }
  };

  const handleEditKitchen = (kitchen: any) => {
    setEditingKitchen(kitchen);
    setKitchenForm({
      locationId: (kitchen.locationId || kitchen.location_id || selectedLocationId)?.toString() || "",
      name: kitchen.name || "",
      description: kitchen.description || "",
      isActive: kitchen.isActive !== undefined ? kitchen.isActive : kitchen.is_active !== undefined ? kitchen.is_active : true,
    });
    setShowKitchenForm(true);
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
        toast({ title: "Success", description: "Manager created successfully" });
        setShowManagerForm(false);
        setManagerForm({ username: "", password: "", email: "", name: "" });
        loadManagers();
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error || "Failed to create manager" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to create manager" });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateManager = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingManager) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/managers/${editingManager.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: managerForm.username,
        }),
      });
      if (response.ok) {
        toast({ title: "Success", description: "Manager updated successfully" });
        setShowManagerForm(false);
        setEditingManager(null);
        setManagerForm({ username: "", password: "", email: "", name: "" });
        loadManagers();
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error || "Failed to update manager" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to update manager" });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteManager = async () => {
    if (!deletingItem) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/managers/${deletingItem.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (response.ok) {
        toast({ title: "Success", description: "Manager deleted successfully" });
        setDeletingItem(null);
        loadManagers();
        loadLocations(); // Reload locations in case manager was assigned
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error || "Failed to delete manager" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete manager" });
    } finally {
      setLoading(false);
    }
  };

  const handleEditManager = (manager: any) => {
    setEditingManager(manager);
    setManagerForm({
      username: manager.username || "",
      password: "", // Don't pre-fill password
      email: manager.email || manager.username || "",
      name: manager.name || "",
    });
    setShowManagerForm(true);
  };

  useEffect(() => {
    loadLocations();
    loadManagers();
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-24 pb-8">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Manage Locations & Kitchens</h1>
            <p className="text-gray-600 mt-2">Create, edit, and manage commercial kitchen locations, kitchens, and managers</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Locations Section */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Locations</h2>
                <button
                  onClick={() => {
                    setEditingLocation(null);
                    setLocationForm({ name: "", address: "", managerId: "", notificationEmail: "" });
                    setShowLocationForm(true);
                  }}
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
                  {locations.map((location) => {
                    const manager = managers.find(m => m.id === location.managerId || m.id === location.manager_id);
                    return (
                      <div key={location.id} className="p-3 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="font-medium text-gray-900">{location.name}</h3>
                            <p className="text-sm text-gray-600 mt-1">{location.address}</p>
                            {manager && (
                              <p className="text-xs text-gray-500 mt-1">Manager: {manager.username}</p>
                            )}
                            {(location.notificationEmail || location.notification_email) && (
                              <p className="text-xs text-gray-500 mt-1">Email: {location.notificationEmail || location.notification_email}</p>
                            )}
                          </div>
                          <div className="flex gap-2 ml-2">
                            <button
                              onClick={() => handleEditLocation(location)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title="Edit location"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDeletingItem({ type: 'location', id: location.id, name: location.name })}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Delete location"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Kitchens Section */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Kitchens</h2>
                <button
                  onClick={() => {
                    setEditingKitchen(null);
                    setKitchenForm({ locationId: selectedLocationId?.toString() || "", name: "", description: "", isActive: true });
                    setShowKitchenForm(true);
                  }}
                  className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  disabled={locations.length === 0}
                >
                  <Plus className="h-4 w-4" />
                  Add Kitchen
                </button>
              </div>
              {locations.length > 0 && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Location
                  </label>
                  <select
                    value={selectedLocationId || ""}
                    onChange={(e) => {
                      const locationId = e.target.value ? parseInt(e.target.value) : null;
                      setSelectedLocationId(locationId);
                      if (locationId) {
                        loadKitchens(locationId);
                      } else {
                        setKitchens([]);
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="">All Locations</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {loading ? (
                <p className="text-gray-500">Loading...</p>
              ) : !selectedLocationId ? (
                <p className="text-gray-500">Select a location to view kitchens</p>
              ) : kitchens.length === 0 ? (
                <p className="text-gray-500">No kitchens found for this location</p>
              ) : (
                <div className="space-y-2">
                  {kitchens.map((kitchen) => (
                    <div key={kitchen.id} className="p-3 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-medium text-gray-900">{kitchen.name}</h3>
                          {kitchen.description && (
                            <p className="text-sm text-gray-600 mt-1">{kitchen.description}</p>
                          )}
                          <p className={`text-xs mt-1 ${(kitchen.isActive !== undefined ? kitchen.isActive : kitchen.is_active) ? 'text-green-600' : 'text-red-600'}`}>
                            Status: {(kitchen.isActive !== undefined ? kitchen.isActive : kitchen.is_active) ? "Active" : "Inactive"}
                          </p>
                        </div>
                        <div className="flex gap-2 ml-2">
                          <button
                            onClick={() => handleEditKitchen(kitchen)}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Edit kitchen"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeletingItem({ type: 'kitchen', id: kitchen.id, name: kitchen.name })}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Delete kitchen"
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

            {/* Managers Section */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Managers</h2>
                <button
                  onClick={() => {
                    setEditingManager(null);
                    setManagerForm({ username: "", password: "", email: "", name: "" });
                    setShowManagerForm(true);
                  }}
                  className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                >
                  <Plus className="h-4 w-4" />
                  Add Manager
                </button>
              </div>
              {loading ? (
                <p className="text-gray-500">Loading...</p>
              ) : managers.length === 0 ? (
                <p className="text-gray-500">No managers available</p>
              ) : (
                <div className="space-y-2">
                  {managers.map((manager) => {
                    const managedLocations = locations.filter(l => (l.managerId || l.manager_id) === manager.id);
                    return (
                      <div key={manager.id} className="p-3 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="font-medium text-gray-900">{manager.username}</h3>
                            <p className="text-xs text-gray-500 mt-1">ID: {manager.id}</p>
                            {managedLocations.length > 0 && (
                              <p className="text-xs text-gray-500 mt-1">
                                Manages {managedLocations.length} location{managedLocations.length !== 1 ? 's' : ''}
                              </p>
                            )}
                            <span className="inline-block mt-1 px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded">
                              {manager.role || 'manager'}
                            </span>
                          </div>
                          <div className="flex gap-2 ml-2">
                            <button
                              onClick={() => handleEditManager(manager)}
                              className="p-1.5 text-purple-600 hover:bg-purple-50 rounded transition-colors"
                              title="Edit manager"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDeletingItem({ type: 'manager', id: manager.id, name: manager.username })}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Delete manager"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Location Form Modal */}
          {showLocationForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold">
                    {editingLocation ? "Edit Location" : "Create New Location"}
                  </h2>
                  <button
                    onClick={() => {
                      setShowLocationForm(false);
                      setEditingLocation(null);
                      setLocationForm({ name: "", address: "", managerId: "", notificationEmail: "" });
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <form onSubmit={editingLocation ? handleUpdateLocation : handleCreateLocation} className="space-y-4">
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
                      onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Manager (Optional)
                    </label>
                    <select
                      value={locationForm.managerId || ""}
                      onChange={(e) => setLocationForm({ ...locationForm, managerId: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="">No Manager</option>
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.username} (ID: {manager.id})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Notification Email (Optional)
                    </label>
                    <input
                      type="email"
                      value={locationForm.notificationEmail}
                      onChange={(e) => setLocationForm({ ...locationForm, notificationEmail: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      placeholder="email@example.com"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
                    >
                      {loading ? "Saving..." : editingLocation ? "Update Location" : "Create Location"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowLocationForm(false);
                        setEditingLocation(null);
                        setLocationForm({ name: "", address: "", managerId: "", notificationEmail: "" });
                      }}
                      className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Kitchen Form Modal */}
          {showKitchenForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold">
                    {editingKitchen ? "Edit Kitchen" : "Create New Kitchen"}
                  </h2>
                  <button
                    onClick={() => {
                      setShowKitchenForm(false);
                      setEditingKitchen(null);
                      setKitchenForm({ locationId: "", name: "", description: "", isActive: true });
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <form onSubmit={editingKitchen ? handleUpdateKitchen : handleCreateKitchen} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Location *
                    </label>
                    <select
                      value={kitchenForm.locationId}
                      onChange={(e) => {
                        setKitchenForm({ ...kitchenForm, locationId: e.target.value });
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
                      onChange={(e) => setKitchenForm({ ...kitchenForm, description: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      rows={3}
                    />
                  </div>
                  {editingKitchen && (
                    <div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={kitchenForm.isActive}
                          onChange={(e) => setKitchenForm({ ...kitchenForm, isActive: e.target.checked })}
                          className="rounded"
                        />
                        <span className="text-sm font-medium text-gray-700">Active</span>
                      </label>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                    >
                      {loading ? "Saving..." : editingKitchen ? "Update Kitchen" : "Create Kitchen"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowKitchenForm(false);
                        setEditingKitchen(null);
                        setKitchenForm({ locationId: "", name: "", description: "", isActive: true });
                      }}
                      className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Manager Form Modal */}
          {showManagerForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold">
                    {editingManager ? "Edit Manager" : "Create Manager Account"}
                  </h2>
                  <button
                    onClick={() => {
                      setShowManagerForm(false);
                      setEditingManager(null);
                      setManagerForm({ username: "", password: "", email: "", name: "" });
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <form onSubmit={editingManager ? handleUpdateManager : handleCreateManager} className="space-y-4">
                  {!editingManager && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Full Name *
                        </label>
                        <input
                          type="text"
                          value={managerForm.name}
                          onChange={(e) => setManagerForm({ ...managerForm, name: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2"
                          required={!editingManager}
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
                          required={!editingManager}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Password *
                        </label>
                        <input
                          type="password"
                          value={managerForm.password}
                          onChange={(e) => setManagerForm({ ...managerForm, password: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2"
                          required={!editingManager}
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Username *
                    </label>
                    <input
                      type="text"
                      value={managerForm.username}
                      onChange={(e) => setManagerForm({ ...managerForm, username: e.target.value })}
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
                      {loading ? "Saving..." : editingManager ? "Update Manager" : "Create Manager"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowManagerForm(false);
                        setEditingManager(null);
                        setManagerForm({ username: "", password: "", email: "", name: "" });
                      }}
                      className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Delete Confirmation Modal */}
          {deletingItem && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg p-6 max-w-md w-full">
                <h2 className="text-2xl font-bold mb-4 text-red-600">Confirm Delete</h2>
                <p className="text-gray-700 mb-6">
                  Are you sure you want to delete <strong>{deletingItem.name}</strong>? This action cannot be undone.
                </p>
                {deletingItem.type === 'location' && (
                  <p className="text-sm text-yellow-600 mb-4">
                    ⚠️ Warning: This location must not have any kitchens assigned to it. Please delete or reassign all kitchens first.
                  </p>
                )}
                {deletingItem.type === 'kitchen' && (
                  <p className="text-sm text-yellow-600 mb-4">
                    ⚠️ Warning: This kitchen must not have any bookings. Please cancel all bookings first.
                  </p>
                )}
                {deletingItem.type === 'manager' && (
                  <p className="text-sm text-yellow-600 mb-4">
                    ⚠️ Warning: All locations managed by this manager will have their manager assignment removed.
                  </p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      if (deletingItem.type === 'location') {
                        handleDeleteLocation();
                      } else if (deletingItem.type === 'kitchen') {
                        handleDeleteKitchen();
                      } else {
                        handleDeleteManager();
                      }
                    }}
                    disabled={loading}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400"
                  >
                    {loading ? "Deleting..." : "Delete"}
                  </button>
                  <button
                    onClick={() => setDeletingItem(null)}
                    disabled={loading}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
