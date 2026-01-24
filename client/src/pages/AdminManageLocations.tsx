import { Building, Plus, Settings, Users, Edit, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "../hooks/use-toast";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Switch } from "@/components/ui/switch";
import { auth } from "@/lib/firebase";

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
  });

  const [kitchenForm, setKitchenForm] = useState({
    locationId: "",
    name: "",
    description: "",
    isActive: true,
    taxRatePercent: "",
  });

  const [managerForm, setManagerForm] = useState({
    username: "",
    password: "",
    email: "",
    name: "",
    locationNotificationEmails: [] as Array<{ locationId: number; notificationEmail: string }>,
  });

  // Helper to get Firebase token
  const getAuthHeaders = async (): Promise<HeadersInit> => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const currentFirebaseUser = auth.currentUser;
    if (currentFirebaseUser) {
      try {
        const token = await currentFirebaseUser.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      } catch (error) {
        console.error('Error getting Firebase token:', error);
      }
    }

    return headers;
  };

  const loadLocations = async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/locations", {
        credentials: "include",
        headers,
      });

      console.log('📍 Locations API response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Failed to load locations:", response.status, response.statusText, errorText);
        toast({
          title: "Error",
          description: `Failed to load locations: ${response.status} ${response.statusText}`,
          variant: "destructive"
        });
        return;
      }

      const contentType = response.headers.get('content-type');
      let data;

      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.warn('📍 Response was not JSON, got text:', text.substring(0, 200));
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error('📍 Failed to parse response as JSON:', e);
          toast({
            title: "Error",
            description: "Invalid response format from server",
            variant: "destructive"
          });
          return;
        }
      }

      console.log('📍 Raw locations response:', data);
      console.log('📍 Response is array?', Array.isArray(data));
      console.log('📍 Response length:', data?.length);

      if (!Array.isArray(data)) {
        console.error('📍 Response is not an array! Got:', typeof data, data);
        toast({
          title: "Error",
          description: "Server returned invalid data format",
          variant: "destructive"
        });
        return;
      }

      console.log(`✅ Loaded ${data.length} locations`);
      setLocations(data);
    } catch (error: any) {
      console.error("❌ Error loading locations:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to load locations",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadManagers = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/managers", {
        credentials: "include",
        headers,
      });

      console.log('👥 Managers API response status:', response.status);

      if (!response.ok) {
        console.error("❌ Failed to load managers:", response.status, response.statusText);
        const errorText = await response.text();
        console.error("❌ Error response:", errorText);
        toast({
          title: "Error",
          description: `Failed to load managers: ${response.status} ${response.statusText}`,
          variant: "destructive"
        });
        return;
      }

      if (response.ok) {
        // Check response content type
        const contentType = response.headers.get('content-type');
        console.log('👥 Response content-type:', contentType);

        let data;
        if (contentType?.includes('application/json')) {
          data = await response.json();
        } else {
          // Try to parse as text first, then JSON
          const text = await response.text();
          console.warn('👥 Response was not JSON, got text:', text.substring(0, 200));
          try {
            data = JSON.parse(text);
          } catch (e) {
            console.error('👥 Failed to parse response as JSON:', e);
            return;
          }
        }

        console.log('👥 Raw response data:', data);
        console.log('👥 Response is array?', Array.isArray(data));
        console.log('👥 Response length:', data?.length);

        if (!Array.isArray(data)) {
          console.error('👥 Response is not an array! Got:', typeof data);
          return;
        }

        if (data.length > 0) {
          console.log('👥 First manager from API:', JSON.stringify(data[0], null, 2));
          console.log('👥 First manager has locations property?', 'locations' in data[0]);
          console.log('👥 First manager.locations value:', data[0].locations);
          console.log('👥 First manager.locations type:', typeof data[0].locations);
          console.log('👥 First manager.locations is array?', Array.isArray(data[0].locations));
          if (data[0].locations) {
            console.log('👥 First manager.locations length:', data[0].locations.length);
            console.log('👥 First manager.locations content:', JSON.stringify(data[0].locations, null, 2));
          }
        }

        // CRITICAL: Ensure every manager has a locations array, even if empty
        const managersWithLocations = data.map((manager: any, index: number) => {
          // Extensive validation and logging
          console.log(`👥 Processing manager ${index}:`, {
            id: manager.id,
            username: manager.username,
            hasLocationsKey: 'locations' in manager,
            locationsValue: manager.locations,
            locationsType: typeof manager.locations,
            locationsIsArray: Array.isArray(manager.locations)
          });

          // Normalize locations
          let normalizedLocations = [];
          if (manager.locations) {
            if (Array.isArray(manager.locations)) {
              normalizedLocations = manager.locations;
            } else if (typeof manager.locations === 'string') {
              try {
                normalizedLocations = JSON.parse(manager.locations);
                if (!Array.isArray(normalizedLocations)) {
                  normalizedLocations = [];
                }
              } catch (e) {
                console.warn(`👥 Manager ${manager.id}: Failed to parse locations string:`, e);
                normalizedLocations = [];
              }
            } else {
              console.warn(`👥 Manager ${manager.id}: locations is not array or string, got:`, typeof manager.locations);
              normalizedLocations = [];
            }
          }

          const normalized = {
            ...manager,
            locations: normalizedLocations
          };

          console.log(`👥 Manager ${index} normalized:`, {
            id: normalized.id,
            username: normalized.username,
            locationsCount: normalized.locations.length,
            locations: normalized.locations
          });

          return normalized;
        });

        console.log('👥 FINAL: All managers processed, setting state with:', managersWithLocations.length, 'managers');
        if (managersWithLocations.length > 0) {
          console.log('👥 FINAL: First manager final structure:', JSON.stringify(managersWithLocations[0], null, 2));
        }

        console.log(`✅ Loaded ${managersWithLocations.length} managers`);
        setManagers(managersWithLocations);
      }
    } catch (error: any) {
      console.error("❌ Error loading managers:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to load managers",
        variant: "destructive"
      });
    }
  };

  const loadKitchens = async (locationId: number) => {
    if (!locationId) return;
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/kitchens/${locationId}`, {
        credentials: "include",
        headers,
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
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/locations", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          name: locationForm.name,
          address: locationForm.address,
          managerId: locationForm.managerId || undefined,
        }),
      });
      if (response.ok) {
        toast({ title: "Success", description: "Location created successfully" });
        setShowLocationForm(false);
        setLocationForm({ name: "", address: "", managerId: "" });
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
      console.log('📍 Updating location:', editingLocation.id, {
        name: locationForm.name,
        address: locationForm.address,
        managerId: locationForm.managerId || null,
      });

      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/locations/${editingLocation.id}`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({
          name: locationForm.name,
          address: locationForm.address,
          managerId: locationForm.managerId || null,
        }),
      });

      if (response.ok) {
        const updatedLocation = await response.json();
        console.log('✅ Location updated successfully:', updatedLocation);
        toast({ title: "Success", description: "Location updated successfully" });
        setShowLocationForm(false);
        setEditingLocation(null);
        setLocationForm({ name: "", address: "", managerId: "" });

        // Reload both locations and managers to reflect any manager assignment changes
        await Promise.all([loadLocations(), loadManagers()]);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        console.error('❌ Failed to update location:', errorData);
        toast({ title: "Error", description: errorData.error || "Failed to update location" });
      }
    } catch (error: any) {
      console.error('❌ Error updating location:', error);
      toast({ title: "Error", description: error.message || "Failed to update location" });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLocation = async () => {
    if (!deletingItem) return;

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/locations/${deletingItem.id}`, {
        method: "DELETE",
        credentials: "include",
        headers,
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
    });
    setShowLocationForm(true);
  };

  const handleCreateKitchen = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/kitchens", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          locationId: parseInt(kitchenForm.locationId),
          name: kitchenForm.name,
          description: kitchenForm.description,
          taxRatePercent: kitchenForm.taxRatePercent,
        }),
      });
      if (response.ok) {
        toast({ title: "Success", description: "Kitchen created successfully" });
        setShowKitchenForm(false);
        setKitchenForm({ locationId: "", name: "", description: "", isActive: true, taxRatePercent: "" });
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
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/kitchens/${editingKitchen.id}`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({
          name: kitchenForm.name,
          isActive: kitchenForm.isActive,
          locationId: parseInt(kitchenForm.locationId),
          taxRatePercent: kitchenForm.taxRatePercent,
        }),
      });
      if (response.ok) {
        toast({ title: "Success", description: "Kitchen updated successfully" });
        setShowKitchenForm(false);
        setEditingKitchen(null);
        setKitchenForm({ locationId: "", name: "", description: "", isActive: true, taxRatePercent: "" });
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
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/kitchens/${deletingItem.id}`, {
        method: "DELETE",
        credentials: "include",
        headers,
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
      taxRatePercent: kitchen.taxRatePercent !== undefined && kitchen.taxRatePercent !== null ? kitchen.taxRatePercent.toString() : "",
    });
    setShowKitchenForm(true);
  };

  const handleCreateManager = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/managers", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(managerForm),
      });
      if (response.ok) {
        toast({ title: "Success", description: "Manager created successfully" });
        setShowManagerForm(false);
        setManagerForm({ username: "", password: "", email: "", name: "", locationNotificationEmails: [] });
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
      console.log('👤 Updating manager:', editingManager.id, {
        username: managerForm.username,
        locationNotificationEmails: managerForm.locationNotificationEmails,
      });

      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/managers/${editingManager.id}`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({
          username: managerForm.username,
          locationNotificationEmails: managerForm.locationNotificationEmails,
        }),
      });

      if (response.ok) {
        const updatedManager = await response.json();
        console.log('✅ Manager updated successfully:', updatedManager);
        toast({ title: "Success", description: "Manager updated successfully" });
        setShowManagerForm(false);
        setEditingManager(null);
        setManagerForm({ username: "", password: "", email: "", name: "", locationNotificationEmails: [] });

        // Reload both managers and locations to reflect notification email updates
        await Promise.all([loadManagers(), loadLocations()]);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        console.error('❌ Failed to update manager:', errorData);
        toast({ title: "Error", description: errorData.error || "Failed to update manager" });
      }
    } catch (error: any) {
      console.error('❌ Error updating manager:', error);
      toast({ title: "Error", description: error.message || "Failed to update manager" });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteManager = async () => {
    if (!deletingItem) return;

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/managers/${deletingItem.id}`, {
        method: "DELETE",
        credentials: "include",
        headers,
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

  const handleEditManager = async (manager: any) => {
    console.log('📝 Editing manager:', manager.id, manager.username);

    // CRITICAL: Always fetch locations directly from API to ensure we get the latest notification emails
    // Don't rely on manager.locations or local state - always fetch fresh from database
    let managerLocations: any[] = [];

    try {
      console.log('🔍 Fetching locations for manager from API...');
      const headers = await getAuthHeaders();
      const locationsResponse = await fetch('/api/admin/locations', {
        credentials: 'include',
        headers,
      });
      if (locationsResponse.ok) {
        const allLocations = await locationsResponse.json();
        console.log(`📊 Fetched ${allLocations.length} total locations from API`);

        // Filter locations assigned to this manager
        const managerLocs = allLocations.filter((loc: any) => {
          const locManagerId = loc.managerId || loc.manager_id;
          const matches = locManagerId === manager.id || locManagerId === manager.id?.toString();
          if (matches) {
            console.log(`✅ Found location: ${loc.name} (ID: ${loc.id}), email: ${loc.notificationEmail || loc.notification_email || 'none'}`);
          }
          return matches;
        });

        console.log(`🔍 Found ${managerLocs.length} location(s) for manager ${manager.id}`);

        // Map to consistent structure, ensuring we extract notification emails
        managerLocations = managerLocs.map((loc: any) => {
          const locationId = loc.id;
          const locationName = loc.name;
          // Extract notification email from all possible field variations
          const notificationEmail = loc.notificationEmail || loc.notification_email || null;

          console.log(`📍 Mapping location ${locationId} (${locationName}): email = "${notificationEmail}"`);

          return {
            locationId: locationId,
            locationName: locationName,
            notificationEmail: notificationEmail
          };
        });

        console.log('✅ Final manager locations with emails:', JSON.stringify(managerLocations, null, 2));
      } else {
        console.error('❌ Failed to fetch locations:', locationsResponse.status, locationsResponse.statusText);
      }
    } catch (error) {
      console.error('❌ Error fetching locations for manager:', error);
    }

    // Set the manager with locations (even if empty array)
    const managerWithLocations = {
      ...manager,
      locations: managerLocations
    };

    setEditingManager(managerWithLocations);

    // Pre-populate location notification emails - this is what will be displayed in the form
    const locationEmails = managerLocations.map((loc: any) => {
      const email = loc.notificationEmail || "";
      const locationId = loc.locationId || loc.id;

      console.log(`📧 Pre-populating email for location ${locationId}: "${email}"`);

      return {
        locationId: locationId,
        notificationEmail: email,
      };
    });

    console.log('📧 Final location notification emails array:', JSON.stringify(locationEmails, null, 2));

    setManagerForm({
      username: manager.username || "",
      password: "", // Don't pre-fill password
      email: manager.email || manager.username || "",
      name: manager.name || "",
      locationNotificationEmails: locationEmails,
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
      <main className="flex-1 pt-20 sm:pt-24 pb-6 sm:pb-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Manage Locations & Kitchens</h1>
            <p className="text-gray-600 mt-2">Create, edit, and manage commercial kitchen locations, kitchens, and managers</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            {/* Locations Section */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Locations</h2>
                <button
                  onClick={() => {
                    setEditingLocation(null);
                    setLocationForm({ name: "", address: "", managerId: "" });
                    setShowLocationForm(true);
                  }}
                  className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 min-h-[44px] text-sm sm:text-base mobile-touch-target"
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
                    setKitchenForm({ locationId: selectedLocationId?.toString() || "", name: "", description: "", isActive: true, taxRatePercent: "" });
                    setShowKitchenForm(true);
                  }}
                  className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 min-h-[44px] text-sm sm:text-base mobile-touch-target"
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
                    setManagerForm({ username: "", password: "", email: "", name: "", locationNotificationEmails: [] });
                    setShowManagerForm(true);
                  }}
                  className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 min-h-[44px] text-sm sm:text-base mobile-touch-target"
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
                  {managers.map((manager: any) => {
                    const managerLocations = manager.locations || [];

                    return (
                      <div key={manager.id} className="p-3 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="font-medium text-gray-900">{manager.username}</h3>
                            <p className="text-xs text-gray-500 mt-1">ID: {manager.id}</p>
                            {managerLocations.length > 0 && (
                              <div className="mt-2 space-y-1">
                                <p className="text-xs text-gray-500">
                                  Manages {managerLocations.length} location{managerLocations.length !== 1 ? 's' : ''}:
                                </p>
                                {managerLocations.map((loc: any) => (
                                  <div key={loc.locationId} className="text-xs pl-2 border-l-2 border-purple-200">
                                    <span className="font-medium">{loc.locationName || 'Unnamed Location'}</span>
                                    {loc.notificationEmail ? (
                                      <p className="text-purple-600 mt-0.5">📧 {loc.notificationEmail}</p>
                                    ) : (
                                      <p className="text-gray-400 mt-0.5 italic">No notification email set</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {manager.primaryNotificationEmail && (
                              <p className="text-xs text-purple-600 mt-2 font-medium">
                                Primary: {manager.primaryNotificationEmail}
                              </p>
                            )}
                            <span className="inline-block mt-2 px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded">
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
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 sm:p-6">
              <div className="bg-white rounded-lg sm:rounded-xl p-4 sm:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto mobile-momentum-scroll">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <h2 className="text-xl sm:text-2xl font-bold">
                    {editingLocation ? "Edit Location" : "Create New Location"}
                  </h2>
                  <button
                    onClick={() => {
                      setShowLocationForm(false);
                      setEditingLocation(null);
                      setLocationForm({ name: "", address: "", managerId: "" });
                    }}
                    className="text-gray-400 hover:text-gray-600 mobile-touch-target p-1"
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
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 min-h-[44px] text-base sm:text-sm"
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
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 min-h-[44px] text-base sm:text-sm"
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
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 min-h-[44px] text-base sm:text-sm"
                    >
                      <option value="">No Manager</option>
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.username} (ID: {manager.id})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 px-4 py-2.5 sm:py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 min-h-[44px] text-sm sm:text-base"
                    >
                      {loading ? "Saving..." : editingLocation ? "Update Location" : "Create Location"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowLocationForm(false);
                        setEditingLocation(null);
                        setLocationForm({ name: "", address: "", managerId: "" });
                      }}
                      className="flex-1 px-4 py-2.5 sm:py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 min-h-[44px] text-sm sm:text-base"
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
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 sm:p-6">
              <div className="bg-white rounded-lg sm:rounded-xl p-4 sm:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto mobile-momentum-scroll">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <h2 className="text-xl sm:text-2xl font-bold">
                    {editingKitchen ? "Edit Kitchen" : "Create New Kitchen"}
                  </h2>
                  <button
                    onClick={() => {
                      setShowKitchenForm(false);
                      setEditingKitchen(null);
                      setKitchenForm({ locationId: "", name: "", description: "", isActive: true, taxRatePercent: "" });
                    }}
                    className="text-gray-400 hover:text-gray-600 mobile-touch-target p-1"
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
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 min-h-[44px] text-base sm:text-sm"
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
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 min-h-[44px] text-base sm:text-sm"
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
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 min-h-[44px] text-base sm:text-sm"
                      rows={3}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tax Rate (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={kitchenForm.taxRatePercent}
                      onChange={(e) => setKitchenForm({ ...kitchenForm, taxRatePercent: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 min-h-[44px] text-base sm:text-sm"
                      placeholder="e.g. 13"
                    />
                  </div>
                  {editingKitchen && (
                    <div>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={kitchenForm.isActive}
                          onCheckedChange={(checked) => setKitchenForm({ ...kitchenForm, isActive: checked })}
                        />
                        <span className="text-sm font-medium text-gray-700">Active</span>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 px-4 py-2.5 sm:py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 min-h-[44px] text-sm sm:text-base"
                    >
                      {loading ? "Saving..." : editingKitchen ? "Update Kitchen" : "Create Kitchen"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowKitchenForm(false);
                        setEditingKitchen(null);
                        setKitchenForm({ locationId: "", name: "", description: "", isActive: true, taxRatePercent: "" });
                      }}
                      className="flex-1 px-4 py-2.5 sm:py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 min-h-[44px] text-sm sm:text-base"
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
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 sm:p-6">
              <div className="bg-white rounded-lg sm:rounded-xl p-4 sm:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto mobile-momentum-scroll">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <h2 className="text-xl sm:text-2xl font-bold">
                    {editingManager ? "Edit Manager" : "Create Manager Account"}
                  </h2>
                  <button
                    onClick={() => {
                      setShowManagerForm(false);
                      setEditingManager(null);
                      setManagerForm({ username: "", password: "", email: "", name: "", locationNotificationEmails: [] });
                    }}
                    className="text-gray-400 hover:text-gray-600 mobile-touch-target p-1"
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
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 min-h-[44px] text-base sm:text-sm"
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
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 min-h-[44px] text-base sm:text-sm"
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
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 min-h-[44px] text-base sm:text-sm"
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
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 min-h-[44px] text-base sm:text-sm"
                      required
                    />
                  </div>
                  {editingManager && (
                    <div className="space-y-3 pt-2 border-t">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Notification Emails by Location
                      </label>
                      {(() => {
                        // Use locations from editingManager which are fetched fresh from API
                        const locationsArray = Array.isArray(editingManager.locations) ? editingManager.locations : [];

                        console.log('🔍 Modal render - editingManager.locations:', locationsArray);
                        console.log('🔍 Modal render - managerForm.locationNotificationEmails:', managerForm.locationNotificationEmails);

                        // If no locations found, show message
                        if (locationsArray.length === 0) {
                          return (
                            <div className="space-y-1 p-3 bg-gray-50 rounded-lg">
                              <p className="text-sm text-gray-600">
                                This manager currently has no locations assigned.
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                Assign a location to this manager first, then you can set notification emails.
                              </p>
                            </div>
                          );
                        }

                        // Map through locations and show input for each
                        // Use managerForm.locationNotificationEmails as the source of truth for email values
                        return locationsArray.map((loc: any) => {
                          const locId = loc.locationId || loc.id;
                          if (!locId || locId === 0) {
                            console.warn('⚠️ Location missing valid ID:', loc);
                            return null;
                          }

                          // Find corresponding email in form state - this is populated from database
                          const emailEntry = managerForm.locationNotificationEmails.find(
                            (e: any) => e.locationId === locId || e.locationId?.toString() === locId?.toString()
                          );

                          // Use email from form state (which we populated from database), or empty string
                          const currentEmail = emailEntry?.notificationEmail || "";

                          const locationName = loc.locationName || loc.name || `Location ${locId}`;

                          console.log(`📍 Rendering location ${locId} (${locationName}): email = "${currentEmail}"`);

                          return (
                            <div key={locId} className="space-y-1">
                              <label className="text-xs font-medium text-gray-600">
                                {locationName}
                              </label>
                              <input
                                type="email"
                                value={currentEmail}
                                onChange={(e) => {
                                  const newEmails = [...managerForm.locationNotificationEmails];
                                  const newEmailValue = e.target.value;
                                  const existingIndex = newEmails.findIndex(
                                    (e: any) => e.locationId === locId || e.locationId?.toString() === locId?.toString()
                                  );

                                  if (existingIndex >= 0) {
                                    // Update existing entry
                                    newEmails[existingIndex].notificationEmail = newEmailValue;
                                  } else {
                                    // Add new entry
                                    newEmails.push({
                                      locationId: locId,
                                      notificationEmail: newEmailValue,
                                    });
                                  }
                                  setManagerForm({ ...managerForm, locationNotificationEmails: newEmails });
                                }}
                                placeholder="notification@example.com"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                              />
                              {currentEmail && (
                                <p className="text-xs text-gray-500 mt-1">Current: {currentEmail}</p>
                              )}
                              {!currentEmail && (
                                <p className="text-xs text-gray-400 mt-1">No notification email set</p>
                              )}
                            </div>
                          );
                        }).filter(Boolean); // Remove any null entries
                      })()}
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 px-4 py-2.5 sm:py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 min-h-[44px] text-sm sm:text-base"
                    >
                      {loading ? "Saving..." : editingManager ? "Update Manager" : "Create Manager"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowManagerForm(false);
                        setEditingManager(null);
                        setManagerForm({ username: "", password: "", email: "", name: "", locationNotificationEmails: [] });
                      }}
                      className="flex-1 px-4 py-2.5 sm:py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 min-h-[44px] text-sm sm:text-base"
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
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 sm:p-6">
              <div className="bg-white rounded-lg sm:rounded-xl p-4 sm:p-6 max-w-md w-full">
                <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4 text-red-600">Confirm Delete</h2>
                <p className="text-sm sm:text-base text-gray-700 mb-4 sm:mb-6">
                  Are you sure you want to delete <strong>{deletingItem.name}</strong>? This action cannot be undone.
                </p>
                {deletingItem.type === 'location' && (
                  <p className="text-xs sm:text-sm text-yellow-600 mb-3 sm:mb-4">
                    ⚠️ Warning: This location must not have any kitchens assigned to it. Please delete or reassign all kitchens first.
                  </p>
                )}
                {deletingItem.type === 'kitchen' && (
                  <p className="text-xs sm:text-sm text-yellow-600 mb-3 sm:mb-4">
                    ⚠️ Warning: This kitchen must not have any bookings. Please cancel all bookings first.
                  </p>
                )}
                {deletingItem.type === 'manager' && (
                  <p className="text-xs sm:text-sm text-yellow-600 mb-3 sm:mb-4">
                    ⚠️ Warning: All locations managed by this manager will have their manager assignment removed.
                  </p>
                )}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
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
                    className="flex-1 px-4 py-2.5 sm:py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 min-h-[44px] text-sm sm:text-base"
                  >
                    {loading ? "Deleting..." : "Delete"}
                  </button>
                  <button
                    onClick={() => setDeletingItem(null)}
                    disabled={loading}
                    className="flex-1 px-4 py-2.5 sm:py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 min-h-[44px] text-sm sm:text-base"
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
