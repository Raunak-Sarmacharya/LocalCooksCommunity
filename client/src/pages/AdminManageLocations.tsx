import { Plus, Users, Edit, Trash2, Loader2, MapPin, ChefHat, Building2, Mail, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AdminLayout } from "@/components/admin/layout/AdminLayout";
import type { AdminSection } from "@/components/admin/layout/AdminSidebar";
import { auth } from "@/lib/firebase";


export default function AdminManageLocations() {
  const [, navigate] = useLocation();
  const { logout } = useFirebaseAuth();

  const handleSectionChange = (section: AdminSection) => {
    if (section === "kitchen-management") return;
    navigate(`/admin?section=${section}`);
  };

  const handleLogout = async () => {
    try {
      await logout();
      queryClient.clear();
      navigate('/admin');
    } catch (error) {
      console.error('Logout error:', error);
      navigate('/admin');
    }
  };

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
        toast.error("Error", {
          description: `Failed to load locations: ${response.status} ${response.statusText}`
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
          toast.error("Error", {
            description: "Invalid response format from server"
          });
          return;
        }
      }

      console.log('📍 Raw locations response:', data);
      console.log('📍 Response is array?', Array.isArray(data));
      console.log('📍 Response length:', data?.length);

      if (!Array.isArray(data)) {
        console.error('📍 Response is not an array! Got:', typeof data, data);
        toast.error("Error", {
          description: "Server returned invalid data format"
        });
        return;
      }

      console.log(`✅ Loaded ${data.length} locations`);
      setLocations(data);
    } catch (error: any) {
      console.error("❌ Error loading locations:", error);
      toast.error("Error", {
        description: error.message || "Failed to load locations"
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
        toast.error("Error", {
          description: `Failed to load managers: ${response.status} ${response.statusText}`
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
      toast.error("Error", {
        description: error.message || "Failed to load managers"
      });
    }
  };

  const loadKitchens = async (locationId?: number | null) => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const url = locationId ? `/api/admin/kitchens/${locationId}` : '/api/admin/kitchens';
      const response = await fetch(url, {
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
      toast.error("Error", { description: "Failed to load kitchens" });
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
        toast.success("Success", { description: "Location created successfully" });
        setShowLocationForm(false);
        setLocationForm({ name: "", address: "", managerId: "" });
        loadLocations();
      } else {
        const error = await response.json();
        toast.error("Error", { description: error.error || "Failed to create location" });
      }
    } catch (error) {
      toast.error("Error", { description: "Failed to create location" });
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
        toast.success("Success", { description: "Location updated successfully" });
        setShowLocationForm(false);
        setEditingLocation(null);
        setLocationForm({ name: "", address: "", managerId: "" });

        // Reload both locations and managers to reflect any manager assignment changes
        await Promise.all([loadLocations(), loadManagers()]);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        console.error('❌ Failed to update location:', errorData);
        toast.error("Error", { description: errorData.error || "Failed to update location" });
      }
    } catch (error: any) {
      console.error('❌ Error updating location:', error);
      toast.error("Error", { description: error.message || "Failed to update location" });
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
        toast.success("Success", { description: "Location deleted successfully" });
        setDeletingItem(null);
        loadLocations();
        if (selectedLocationId === deletingItem.id) {
          setSelectedLocationId(null);
          setKitchens([]);
        }
      } else {
        const error = await response.json();
        toast.error("Error", { description: error.error || "Failed to delete location" });
      }
    } catch (error) {
      toast.error("Error", { description: "Failed to delete location" });
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
        toast.success("Success", { description: "Kitchen created successfully" });
        setShowKitchenForm(false);
        setKitchenForm({ locationId: "", name: "", description: "", isActive: true, taxRatePercent: "" });
        if (kitchenForm.locationId) {
          loadKitchens(parseInt(kitchenForm.locationId));
        }
      } else {
        const error = await response.json();
        toast.error("Error", { description: error.error || "Failed to create kitchen" });
      }
    } catch (error) {
      toast.error("Error", { description: "Failed to create kitchen" });
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
        toast.success("Success", { description: "Kitchen updated successfully" });
        setShowKitchenForm(false);
        setEditingKitchen(null);
        setKitchenForm({ locationId: "", name: "", description: "", isActive: true, taxRatePercent: "" });
        if (kitchenForm.locationId) {
          loadKitchens(parseInt(kitchenForm.locationId));
        }
      } else {
        const error = await response.json();
        toast.error("Error", { description: error.error || "Failed to update kitchen" });
      }
    } catch (error) {
      toast.error("Error", { description: "Failed to update kitchen" });
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
        toast.success("Success", { description: "Kitchen deleted successfully" });
        setDeletingItem(null);
        if (selectedLocationId) {
          loadKitchens(selectedLocationId);
        }
      } else {
        const error = await response.json();
        toast.error("Error", { description: error.error || "Failed to delete kitchen" });
      }
    } catch (error) {
      toast.error("Error", { description: "Failed to delete kitchen" });
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
        toast.success("Success", { description: "Manager created successfully" });
        setShowManagerForm(false);
        setManagerForm({ username: "", password: "", email: "", name: "", locationNotificationEmails: [] });
        loadManagers();
      } else {
        const error = await response.json();
        toast.error("Error", { description: error.error || "Failed to create manager" });
      }
    } catch (error) {
      toast.error("Error", { description: "Failed to create manager" });
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
        toast.success("Success", { description: "Manager updated successfully" });
        setShowManagerForm(false);
        setEditingManager(null);
        setManagerForm({ username: "", password: "", email: "", name: "", locationNotificationEmails: [] });

        // Reload both managers and locations to reflect notification email updates
        await Promise.all([loadManagers(), loadLocations()]);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        console.error('❌ Failed to update manager:', errorData);
        toast.error("Error", { description: errorData.error || "Failed to update manager" });
      }
    } catch (error: any) {
      console.error('❌ Error updating manager:', error);
      toast.error("Error", { description: error.message || "Failed to update manager" });
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
        toast.success("Success", { description: "Manager deleted successfully" });
        setDeletingItem(null);
        loadManagers();
        loadLocations(); // Reload locations in case manager was assigned
      } else {
        const error = await response.json();
        toast.error("Error", { description: error.error || "Failed to delete manager" });
      }
    } catch (error) {
      toast.error("Error", { description: "Failed to delete manager" });
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
    loadKitchens(); // Load all kitchens by default
  }, []);

  return (
    <AdminLayout
      activeSection="kitchen-management"
      onSectionChange={handleSectionChange}
      onLogout={handleLogout}
    >
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Locations</p>
                <p className="text-2xl font-bold mt-1">{locations.length}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <MapPin className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Kitchens</p>
                <p className="text-2xl font-bold mt-1">{kitchens.length}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
                <ChefHat className="h-5 w-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Managers</p>
                <p className="text-2xl font-bold mt-1">{managers.length}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                <Users className="h-5 w-5 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="locations" className="space-y-4">
        <TabsList>
          <TabsTrigger value="locations">
            <MapPin className="h-4 w-4 mr-1.5" />
            Locations ({locations.length})
          </TabsTrigger>
          <TabsTrigger value="kitchens">
            <ChefHat className="h-4 w-4 mr-1.5" />
            Kitchens
          </TabsTrigger>
          <TabsTrigger value="managers">
            <Users className="h-4 w-4 mr-1.5" />
            Managers ({managers.length})
          </TabsTrigger>
        </TabsList>

        {/* ── LOCATIONS TAB ── */}
        <TabsContent value="locations">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>All Locations</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Commercial kitchen locations and their assigned managers</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingLocation(null);
                    setLocationForm({ name: "", address: "", managerId: "" });
                    setShowLocationForm(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add Location
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : locations.length === 0 ? (
                <div className="text-center py-12">
                  <MapPin className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No locations yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Create your first location to get started</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Location</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Manager</TableHead>
                        <TableHead>Notification Email</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {locations.map((location) => {
                        const manager = managers.find(m => m.id === location.managerId || m.id === location.manager_id);
                        return (
                          <TableRow key={location.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 flex-shrink-0">
                                  <Building2 className="h-4 w-4 text-primary" />
                                </div>
                                <span className="font-medium text-sm">{location.name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                              {location.address}
                            </TableCell>
                            <TableCell>
                              {manager ? (
                                <div>
                                  <p className="text-sm font-medium">{manager.displayName || manager.username}</p>
                                  {manager.displayName && manager.displayName !== manager.username && (
                                    <p className="text-xs text-muted-foreground">{manager.username}</p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">Unassigned</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {(location.notificationEmail || location.notification_email) ? (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Mail className="h-3 w-3" />
                                  {location.notificationEmail || location.notification_email}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">Not set</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleEditLocation(location)}>
                                    <Edit className="h-4 w-4 mr-2" /> Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="text-destructive" onClick={() => setDeletingItem({ type: 'location', id: location.id, name: location.name })}>
                                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── KITCHENS TAB ── */}
        <TabsContent value="kitchens">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle>Kitchens</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Kitchen facilities within each location</p>
                </div>
                <div className="flex items-center gap-3">
                  {locations.length > 0 && (
                    <Select
                      value={selectedLocationId?.toString() || "all"}
                      onValueChange={(value) => {
                        const locationId = value === "all" ? null : parseInt(value);
                        setSelectedLocationId(locationId);
                        loadKitchens(locationId);
                      }}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select Location" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Locations</SelectItem>
                        {locations.map((location) => (
                          <SelectItem key={location.id} value={location.id.toString()}>
                            {location.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingKitchen(null);
                      setKitchenForm({ locationId: selectedLocationId?.toString() || "", name: "", description: "", isActive: true, taxRatePercent: "" });
                      setShowKitchenForm(true);
                    }}
                    disabled={locations.length === 0}
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add Kitchen
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : kitchens.length === 0 ? (
                <div className="text-center py-12">
                  <ChefHat className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No kitchens found</p>
                  <p className="text-sm text-muted-foreground mt-1">Add a kitchen to this location</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kitchen Name</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Tax Rate</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kitchens.map((kitchen) => {
                        const isActive = kitchen.isActive !== undefined ? kitchen.isActive : kitchen.is_active;
                        const taxRate = kitchen.taxRatePercent ?? kitchen.tax_rate_percent;
                        const locationName = kitchen.locationName || kitchen.location_name || locations.find(l => l.id === (kitchen.locationId || kitchen.location_id))?.name;
                        return (
                          <TableRow key={kitchen.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-100 flex-shrink-0">
                                  <ChefHat className="h-4 w-4 text-amber-600" />
                                </div>
                                <span className="font-medium text-sm">{kitchen.name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {locationName ? (
                                <Badge variant="outline" className="text-xs">
                                  <MapPin className="h-3 w-3 mr-1" />
                                  {locationName}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">Unknown</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                              {kitchen.description || <span className="italic">No description</span>}
                            </TableCell>
                            <TableCell className="text-sm">
                              {taxRate ? `${taxRate}%` : <span className="text-muted-foreground italic">Not set</span>}
                            </TableCell>
                            <TableCell>
                              <Badge variant={isActive ? "default" : "destructive"}>
                                {isActive ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleEditKitchen(kitchen)}>
                                    <Edit className="h-4 w-4 mr-2" /> Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="text-destructive" onClick={() => setDeletingItem({ type: 'kitchen', id: kitchen.id, name: kitchen.name })}>
                                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── MANAGERS TAB ── */}
        <TabsContent value="managers">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>All Managers</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Manager accounts and their location assignments</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingManager(null);
                    setManagerForm({ username: "", password: "", email: "", name: "", locationNotificationEmails: [] });
                    setShowManagerForm(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add Manager
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : managers.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No managers yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Create a manager account to assign to locations</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Manager</TableHead>
                        <TableHead>Locations</TableHead>
                        <TableHead>Notification Emails</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {managers.map((manager: any) => {
                        const managerLocations = manager.locations || [];
                        return (
                          <TableRow key={manager.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 flex-shrink-0">
                                  <Users className="h-4 w-4 text-emerald-600" />
                                </div>
                                <div>
                                  <p className="font-medium text-sm">{manager.displayName || manager.username}</p>
                                  {manager.displayName && manager.displayName !== manager.username && (
                                    <p className="text-xs text-muted-foreground">{manager.username}</p>
                                  )}
                                  {(!manager.displayName || manager.displayName === manager.username) && (
                                    <p className="text-xs text-muted-foreground">ID: {manager.id}</p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              {managerLocations.length > 0 ? (
                                <div className="space-y-1">
                                  {managerLocations.map((loc: any) => (
                                    <Badge key={loc.locationId} variant="outline" className="text-xs mr-1">
                                      {loc.locationName || 'Unnamed'}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">No locations</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {managerLocations.length > 0 ? (
                                <div className="space-y-1">
                                  {managerLocations.map((loc: any) => (
                                    <div key={loc.locationId} className="text-xs text-muted-foreground">
                                      {loc.notificationEmail ? (
                                        <div className="flex items-center gap-1">
                                          <Mail className="h-3 w-3" />
                                          {loc.notificationEmail}
                                        </div>
                                      ) : (
                                        <span className="italic">Not set</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs capitalize">
                                {manager.role || 'manager'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleEditManager(manager)}>
                                    <Edit className="h-4 w-4 mr-2" /> Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="text-destructive" onClick={() => setDeletingItem({ type: 'manager', id: manager.id, name: manager.username })}>
                                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Location Form Dialog */}
      <Dialog open={showLocationForm} onOpenChange={(open) => { if (!open) { setShowLocationForm(false); setEditingLocation(null); setLocationForm({ name: "", address: "", managerId: "" }); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingLocation ? "Edit Location" : "Create New Location"}</DialogTitle>
            <DialogDescription>Fill in the details below.</DialogDescription>
          </DialogHeader>
          <form onSubmit={editingLocation ? handleUpdateLocation : handleCreateLocation} className="space-y-4">
            <div className="space-y-2">
              <Label>Location Name *</Label>
              <Input value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Address *</Label>
              <Input value={locationForm.address} onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Manager (Optional)</Label>
              <Select value={locationForm.managerId || "none"} onValueChange={(value) => setLocationForm({ ...locationForm, managerId: value === "none" ? "" : value })}>
                <SelectTrigger><SelectValue placeholder="No Manager" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Manager</SelectItem>
                  {managers.map((manager) => (
                    <SelectItem key={manager.id} value={manager.id.toString()}>
                      {manager.username} (ID: {manager.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => { setShowLocationForm(false); setEditingLocation(null); setLocationForm({ name: "", address: "", managerId: "" }); }}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? "Saving..." : editingLocation ? "Update" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Kitchen Form Dialog */}
      <Dialog open={showKitchenForm} onOpenChange={(open) => { if (!open) { setShowKitchenForm(false); setEditingKitchen(null); setKitchenForm({ locationId: "", name: "", description: "", isActive: true, taxRatePercent: "" }); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingKitchen ? "Edit Kitchen" : "Create New Kitchen"}</DialogTitle>
            <DialogDescription>Fill in the details below.</DialogDescription>
          </DialogHeader>
          <form onSubmit={editingKitchen ? handleUpdateKitchen : handleCreateKitchen} className="space-y-4">
            <div className="space-y-2">
              <Label>Location *</Label>
              <Select value={kitchenForm.locationId || ""} onValueChange={(value) => setKitchenForm({ ...kitchenForm, locationId: value })}>
                <SelectTrigger><SelectValue placeholder="Select a location" /></SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id.toString()}>{location.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Kitchen Name *</Label>
              <Input value={kitchenForm.name} onChange={(e) => setKitchenForm({ ...kitchenForm, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={kitchenForm.description} onChange={(e) => setKitchenForm({ ...kitchenForm, description: e.target.value })} rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Tax Rate (%)</Label>
              <Input type="number" step="0.01" min="0" max="100" value={kitchenForm.taxRatePercent} onChange={(e) => setKitchenForm({ ...kitchenForm, taxRatePercent: e.target.value })} placeholder="e.g. 13" />
            </div>
            {editingKitchen && (
              <div className="flex items-center gap-3">
                <Switch checked={kitchenForm.isActive} onCheckedChange={(checked) => setKitchenForm({ ...kitchenForm, isActive: checked })} />
                <Label>Active</Label>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => { setShowKitchenForm(false); setEditingKitchen(null); setKitchenForm({ locationId: "", name: "", description: "", isActive: true, taxRatePercent: "" }); }}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? "Saving..." : editingKitchen ? "Update" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manager Form Dialog */}
      <Dialog open={showManagerForm} onOpenChange={(open) => { if (!open) { setShowManagerForm(false); setEditingManager(null); setManagerForm({ username: "", password: "", email: "", name: "", locationNotificationEmails: [] }); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingManager ? "Edit Manager" : "Create Manager Account"}</DialogTitle>
            <DialogDescription>{editingManager ? "Update manager details." : "Fill in the details to create a new manager."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={editingManager ? handleUpdateManager : handleCreateManager} className="space-y-4">
            {!editingManager && (
              <>
                <div className="space-y-2">
                  <Label>Full Name *</Label>
                  <Input value={managerForm.name} onChange={(e) => setManagerForm({ ...managerForm, name: e.target.value })} required={!editingManager} />
                </div>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input type="email" value={managerForm.email} onChange={(e) => setManagerForm({ ...managerForm, email: e.target.value })} required={!editingManager} />
                </div>
                <div className="space-y-2">
                  <Label>Password *</Label>
                  <Input type="password" value={managerForm.password} onChange={(e) => setManagerForm({ ...managerForm, password: e.target.value })} required={!editingManager} />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Username *</Label>
              <Input value={managerForm.username} onChange={(e) => setManagerForm({ ...managerForm, username: e.target.value })} required />
            </div>
            {editingManager && (
              <div className="space-y-3 pt-2">
                <Separator />
                <Label>Notification Emails by Location</Label>
                {(() => {
                  const locationsArray = Array.isArray(editingManager.locations) ? editingManager.locations : [];
                  if (locationsArray.length === 0) {
                    return (
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">No locations assigned to this manager.</p>
                        <p className="text-xs text-muted-foreground mt-1">Assign a location first, then set notification emails.</p>
                      </div>
                    );
                  }
                  return locationsArray.map((loc: any) => {
                    const locId = loc.locationId || loc.id;
                    if (!locId || locId === 0) return null;
                    const emailEntry = managerForm.locationNotificationEmails.find(
                      (e: any) => e.locationId === locId || e.locationId?.toString() === locId?.toString()
                    );
                    const currentEmail = emailEntry?.notificationEmail || "";
                    const locationName = loc.locationName || loc.name || `Location ${locId}`;
                    return (
                      <div key={locId} className="space-y-1.5">
                        <Label className="text-xs">{locationName}</Label>
                        <Input
                          type="email"
                          value={currentEmail}
                          onChange={(e) => {
                            const newEmails = [...managerForm.locationNotificationEmails];
                            const newEmailValue = e.target.value;
                            const existingIndex = newEmails.findIndex(
                              (entry: any) => entry.locationId === locId || entry.locationId?.toString() === locId?.toString()
                            );
                            if (existingIndex >= 0) {
                              newEmails[existingIndex].notificationEmail = newEmailValue;
                            } else {
                              newEmails.push({ locationId: locId, notificationEmail: newEmailValue });
                            }
                            setManagerForm({ ...managerForm, locationNotificationEmails: newEmails });
                          }}
                          placeholder="notification@example.com"
                          className="text-sm"
                        />
                        <p className="text-xs text-muted-foreground">{currentEmail ? `Current: ${currentEmail}` : "No notification email set"}</p>
                      </div>
                    );
                  }).filter(Boolean);
                })()}
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => { setShowManagerForm(false); setEditingManager(null); setManagerForm({ username: "", password: "", email: "", name: "", locationNotificationEmails: [] }); }}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? "Saving..." : editingManager ? "Update" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingItem} onOpenChange={(open) => { if (!open) setDeletingItem(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Delete</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deletingItem?.name}</strong>? This action cannot be undone.
              {deletingItem?.type === 'location' && (
                <span className="block mt-2 text-amber-600">Warning: This location must not have any kitchens assigned to it.</span>
              )}
              {deletingItem?.type === 'kitchen' && (
                <span className="block mt-2 text-amber-600">Warning: This kitchen must not have any bookings.</span>
              )}
              {deletingItem?.type === 'manager' && (
                <span className="block mt-2 text-amber-600">Warning: All locations managed by this manager will have their manager assignment removed.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deletingItem?.type === 'location') handleDeleteLocation();
                else if (deletingItem?.type === 'kitchen') handleDeleteKitchen();
                else handleDeleteManager();
              }}
            >
              {loading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </AdminLayout>
  );
}
