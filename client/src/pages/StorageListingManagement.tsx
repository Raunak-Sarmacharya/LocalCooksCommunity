import { 
  Package, Plus, Check, Loader2, Pencil, Trash2, Search,
  Thermometer, Snowflake, Grid3X3, DollarSign, PlusCircle, SearchX
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ManagerPageLayout } from "@/components/layout/ManagerPageLayout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  STORAGE_CATEGORIES,
  StorageTemplate,
  StorageTypeId,
  ACCESS_TYPE_LABELS,
  getDefaultTemperatureRange,
} from "@/lib/storage-templates";

// Category icon component for dynamic rendering
const StorageCategoryIcon = ({ iconName, className }: { iconName: string; className?: string }) => {
  const icons: Record<string, React.ComponentType<{ className?: string }>> = {
    Package, Thermometer, Snowflake
  };
  const Icon = icons[iconName] || Package;
  return <Icon className={className} />;
};

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  locationId: number;
}

interface StorageListing {
  id?: number;
  kitchenId: number;
  storageType: 'dry' | 'cold' | 'freezer';
  name: string;
  description?: string;
  basePrice: number; // Daily rate in dollars (converted from cents)
  totalVolume?: number; // Cubic feet
  accessType?: string;
  temperatureRange?: string;
  isActive?: boolean;
  minimumBookingDuration?: number; // Minimum days for booking
}

interface SelectedStorage {
  templateId: string;
  name: string;
  storageType: StorageTypeId;
  description: string;
  dailyRate: number;
  totalVolume: number;
  accessType: string;
  temperatureRange: string;
  minimumBookingDuration: number; // Minimum days for booking
}

export default function StorageListingManagement() {
  return (
    <ManagerPageLayout
      title="Storage Management"
      description="Manage your kitchen storage listings"
      showKitchenSelector={true}
    >
      {({ selectedLocationId, selectedKitchenId, isLoading }) => {
        if (isLoading) {
          return (
            <div className="space-y-6">
              <Skeleton className="h-[200px] w-full" />
              <Skeleton className="h-[400px] w-full" />
            </div>
          );
        }
        return (
          <StorageListingContent
            selectedLocationId={selectedLocationId}
            selectedKitchenId={selectedKitchenId}
          />
        );
      }}
    </ManagerPageLayout>
  );
}

function StorageListingContent({
  selectedLocationId,
  selectedKitchenId
}: {
  selectedLocationId: number | null,
  selectedKitchenId: number | null
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [listings, setListings] = useState<StorageListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'list' | 'add'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['dry', 'cold', 'freezer']);
  const [selectedStorage, setSelectedStorage] = useState<Record<string, SelectedStorage>>({});
  
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingListing, setEditingListing] = useState<StorageListing | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [toggleDialogOpen, setToggleDialogOpen] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<{ id: number; isActive: boolean } | null>(null);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  // Custom storage state for intuitive "not found" flow
  const [customStorage, setCustomStorage] = useState({
    name: '',
    storageType: 'dry' as StorageTypeId,
    description: '',
    dailyRate: 0,
    totalVolume: 0,
    accessType: 'shelving-unit',
    temperatureRange: '',
    minimumBookingDuration: 1,
  });

  const selectedStorageCount = Object.keys(selectedStorage).length;

  useEffect(() => {
    if (selectedLocationId) loadKitchens();
    else setKitchens([]);
  }, [selectedLocationId]);

  useEffect(() => {
    if (selectedKitchenId) loadListings();
    else setListings([]);
  }, [selectedKitchenId]);

  const loadKitchens = async () => {
    if (!selectedLocationId) return;
    try {
      const data = await apiGet(`/manager/kitchens/${selectedLocationId}`);
      setKitchens(data);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to load kitchens", variant: "destructive" });
    }
  };

  const loadListings = async () => {
    if (!selectedKitchenId) return;
    setIsLoading(true);
    try {
      const data = await apiGet(`/manager/kitchens/${selectedKitchenId}/storage-listings`);
      // Convert cents to dollars for UI
      const mappedData = Array.isArray(data) ? data.map((item: any) => ({
        ...item,
        basePrice: item.basePrice ? item.basePrice / 100 : 0,
      })) : [];
      setListings(mappedData);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to load storage listings", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return STORAGE_CATEGORIES;
    const query = searchQuery.toLowerCase();
    return STORAGE_CATEGORIES.map(cat => ({
      ...cat,
      items: cat.items.filter(item => item.name.toLowerCase().includes(query) || cat.name.toLowerCase().includes(query))
    })).filter(cat => cat.items.length > 0);
  }, [searchQuery]);

  const totalFilteredItems = filteredCategories.reduce((sum, cat) => sum + cat.items.length, 0);
  const showNoResultsCustomOption = searchQuery.trim().length > 0 && totalFilteredItems === 0;

  const saveCustomStorage = async () => {
    // Use searchQuery as fallback if customStorage.name is empty (intuitive flow)
    const storageName = (customStorage.name.trim() || searchQuery.trim());
    if (!selectedKitchenId || !storageName) {
      toast({ title: "Error", description: "Please enter a storage name", variant: "destructive" });
      return;
    }
    if (!customStorage.dailyRate || customStorage.dailyRate <= 0) {
      toast({ title: "Error", description: "Please enter a daily rate", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await apiPost('/manager/storage-listings', {
        kitchenId: selectedKitchenId,
        name: storageName,
        storageType: customStorage.storageType,
        description: customStorage.description || undefined,
        basePrice: Math.round(customStorage.dailyRate * 100), // Convert to cents
        totalVolume: customStorage.totalVolume || undefined,
        accessType: customStorage.accessType || undefined,
        temperatureRange: customStorage.temperatureRange || getDefaultTemperatureRange(customStorage.storageType) || undefined,
        pricingModel: 'daily',
        minimumBookingDuration: customStorage.minimumBookingDuration || 1,
        bookingDurationUnit: 'daily',
        currency: 'CAD',
        isActive: true,
      });
      toast({ title: "Storage Added", description: `Successfully added "${storageName}"` });
      setCustomStorage({ name: '', storageType: 'dry', description: '', dailyRate: 0, totalVolume: 0, accessType: 'shelving-unit', temperatureRange: '', minimumBookingDuration: 1 });
      setSearchQuery('');
      setActiveTab('list');
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/storage-listings`] });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to add storage", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => prev.includes(categoryId) ? prev.filter(id => id !== categoryId) : [...prev, categoryId]);
  };

  const handleTemplateSelect = (template: StorageTemplate) => {
    setSelectedStorage(prev => {
      const newState = { ...prev };
      if (newState[template.id]) {
        delete newState[template.id];
      } else {
        newState[template.id] = {
          templateId: template.id,
          name: template.name,
          storageType: template.storageType,
          description: template.description,
          dailyRate: template.suggestedDailyRate,
          totalVolume: 0,
          accessType: template.accessTypes[0] || 'walk-in',
          temperatureRange: template.temperatureRange || getDefaultTemperatureRange(template.storageType) || '',
          minimumBookingDuration: 1,
        };
      }
      return newState;
    });
  };

  const updateSelectedStorage = (templateId: string, updates: Partial<SelectedStorage>) => {
    setSelectedStorage(prev => {
      if (!prev[templateId]) return prev;
      return { ...prev, [templateId]: { ...prev[templateId], ...updates } };
    });
  };

  const saveSelectedStorage = async () => {
    if (!selectedKitchenId || selectedStorageCount === 0) return;
    setIsSaving(true);
    let successCount = 0;
    for (const storage of Object.values(selectedStorage)) {
      try {
        await apiPost('/manager/storage-listings', {
          kitchenId: selectedKitchenId,
          name: storage.name,
          storageType: storage.storageType,
          description: storage.description || undefined,
          basePrice: Math.round(storage.dailyRate * 100), // Convert to cents
          totalVolume: storage.totalVolume || undefined,
          accessType: storage.accessType || undefined,
          temperatureRange: storage.temperatureRange || undefined,
          pricingModel: 'daily',
          minimumBookingDuration: storage.minimumBookingDuration || 1,
          bookingDurationUnit: 'daily',
          currency: 'CAD',
          isActive: true,
        });
        successCount++;
      } catch (error) {
        console.error('Error creating storage listing:', error);
      }
    }
    setIsSaving(false);
    if (successCount > 0) {
      toast({ title: "Storage Added", description: `Successfully added ${successCount} storage listing${successCount > 1 ? 's' : ''}.` });
      setSelectedStorage({});
      setActiveTab('list');
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/storage-listings`] });
    } else {
      toast({ title: "Error", description: "Failed to add storage listings.", variant: "destructive" });
    }
  };

  const handleEdit = (listing: StorageListing) => {
    setEditingListing(listing);
    setEditDialogOpen(true);
  };

  const saveEditedListing = async () => {
    if (!editingListing?.id) return;
    setIsSaving(true);
    try {
      await apiPut(`/manager/storage-listings/${editingListing.id}`, {
        ...editingListing,
        basePrice: Math.round((editingListing.basePrice || 0) * 100), // Convert to cents
      });
      toast({ title: "Success", description: "Storage listing updated successfully" });
      setEditDialogOpen(false);
      setEditingListing(null);
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/storage-listings`] });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update listing", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await apiDelete(`/manager/storage-listings/${pendingDeleteId}`);
      toast({ title: "Success", description: "Storage listing deleted successfully" });
      setDeleteDialogOpen(false);
      setPendingDeleteId(null);
      loadListings();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to delete listing", variant: "destructive" });
    }
  };

  const handleToggleActive = (listingId: number, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    if (!newStatus) {
      setPendingToggle({ id: listingId, isActive: newStatus });
      setToggleDialogOpen(true);
    } else {
      doToggleActive(listingId, newStatus);
    }
  };

  const doToggleActive = async (id: number, isActive: boolean) => {
    setIsToggling(true);
    try {
      await apiPut(`/manager/storage-listings/${id}`, { isActive });
      queryClient.invalidateQueries({ queryKey: [`/api/manager/storage-listings`] });
      loadListings();
      toast({ title: "Status Updated", description: `Storage listing is now ${isActive ? 'active' : 'inactive'}` });
      setToggleDialogOpen(false);
      setPendingToggle(null);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update status", variant: "destructive" });
    } finally {
      setIsToggling(false);
    }
  };

  const selectedKitchen = kitchens.find(k => k.id === selectedKitchenId);

  if (!selectedKitchenId) {
    return (
      <Card className="border-dashed h-full">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground h-full">
          <Package className="h-12 w-12 mb-4 opacity-20" />
          <h3 className="text-lg font-medium text-foreground mb-1">No Kitchen Selected</h3>
          <p>Select a location and kitchen from the sidebar to manage storage.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'list' | 'add')}>
        <div className="flex items-center justify-between mb-4">
          <TabsList className="grid w-[300px] grid-cols-2">
            <TabsTrigger value="list" className="flex items-center gap-2"><Package className="h-4 w-4" />My Storage</TabsTrigger>
            <TabsTrigger value="add" className="flex items-center gap-2"><Plus className="h-4 w-4" />Add Storage</TabsTrigger>
          </TabsList>
          {selectedKitchen && <Badge variant="outline" className="text-sm">{selectedKitchen.name}</Badge>}
        </div>

        <TabsContent value="list" className="mt-0">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Storage Inventory</CardTitle>
              <CardDescription>{listings.length} storage listing{listings.length !== 1 ? 's' : ''} for this kitchen</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
              ) : listings.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p className="font-medium">No storage listed yet</p>
                  <p className="text-sm mt-1">Click "Add Storage" to get started</p>
                  <Button className="mt-4" onClick={() => setActiveTab('add')}><Plus className="h-4 w-4 mr-2" />Add Storage</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {listings.map((listing) => (
                    <div key={listing.id} className={cn("flex items-center justify-between p-4 border rounded-lg transition-colors", listing.isActive === false && "bg-muted/50 opacity-75")}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium truncate">{listing.name}</h4>
                          <Badge variant={listing.isActive !== false ? "default" : "secondary"} className="text-xs">{listing.isActive !== false ? 'Active' : 'Inactive'}</Badge>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="capitalize">{listing.storageType}</span>
                          {listing.totalVolume && <><span>•</span><span>{listing.totalVolume} cu ft</span></>}
                          <span>•</span>
                          <span className="font-medium text-blue-600">${(listing.basePrice || 0).toFixed(2)}/day</span>
                          {listing.minimumBookingDuration && listing.minimumBookingDuration > 1 && <><span>•</span><span>Min {listing.minimumBookingDuration} days</span></>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Switch checked={listing.isActive !== false} onCheckedChange={() => handleToggleActive(listing.id!, listing.isActive !== false)} disabled={isToggling} />
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(listing)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => { setPendingDeleteId(listing.id!); setDeleteDialogOpen(true); }}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="add" className="mt-0 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search storage types..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2"><Grid3X3 className="h-5 w-5" />Select Storage Type</CardTitle>
                  <CardDescription>Choose from pre-defined storage options or add custom</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px] pr-4">
                    <div className="space-y-2">
                      {filteredCategories.map((category) => (
                        <Collapsible key={category.id} open={expandedCategories.includes(category.id)} onOpenChange={() => toggleCategory(category.id)}>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" className="w-full justify-between p-3 h-auto font-medium hover:bg-muted/50">
                              <span className="flex items-center gap-2"><StorageCategoryIcon iconName={category.iconName} className="h-4 w-4 text-muted-foreground" />{category.name}<Badge variant="secondary" className="ml-2">{category.items.length}</Badge></span>
                              {expandedCategories.includes(category.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="p-2 pl-4 space-y-2">
                              {/* Category description */}
                              <p className="text-xs text-muted-foreground mb-3">{category.description}{category.temperatureRange && ` • ${category.temperatureRange}`}</p>
                              <div className="grid grid-cols-1 gap-2">
                                {category.items.map((template) => {
                                  const isSelected = !!selectedStorage[template.id];
                                  const isAlreadyListed = listings.some(l => l.name.toLowerCase() === template.name.toLowerCase());
                                  return (
                                    <button key={template.id} onClick={() => !isAlreadyListed && handleTemplateSelect(template)} disabled={isAlreadyListed}
                                      className={cn("flex items-start gap-3 p-3 rounded-lg border text-left transition-all", isSelected && "border-primary bg-primary/5 ring-1 ring-primary", isAlreadyListed && "opacity-50 cursor-not-allowed bg-muted", !isSelected && !isAlreadyListed && "hover:border-primary/50 hover:bg-muted/50")}>
                                      <div className={cn("flex items-center justify-center w-5 h-5 rounded border mt-0.5", isSelected ? "bg-primary border-primary" : "border-muted-foreground/30")}>
                                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <p className="text-sm font-medium">{template.name}</p>
                                          {isAlreadyListed && <Badge variant="secondary" className="text-xs">Listed</Badge>}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
                                        <p className="text-xs text-blue-600 mt-1">~${template.suggestedDailyRate}/day</p>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                      
                      {/* Intuitive custom storage option when search has no results */}
                      {showNoResultsCustomOption && (
                        <Card className="border-dashed border-primary/50 bg-primary/5">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                              <SearchX className="h-4 w-4" />
                              No matching storage found
                            </CardTitle>
                            <CardDescription>Add "{searchQuery}" as custom storage</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Storage Type</Label>
                                <Select value={customStorage.storageType} onValueChange={(v: StorageTypeId) => {
                                  setCustomStorage({ ...customStorage, storageType: v, temperatureRange: getDefaultTemperatureRange(v) || '' });
                                }}>
                                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="dry">Dry Storage</SelectItem>
                                    <SelectItem value="cold">Cold Storage</SelectItem>
                                    <SelectItem value="freezer">Freezer</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Daily Rate ($) *</Label>
                                <Input type="number" step="0.01" min="0" value={customStorage.dailyRate || ''} onChange={(e) => setCustomStorage({ ...customStorage, dailyRate: parseFloat(e.target.value) || 0 })} placeholder="15.00" className="h-9" />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Size (cubic feet)</Label>
                                <Input type="number" min="0" value={customStorage.totalVolume || ''} onChange={(e) => setCustomStorage({ ...customStorage, totalVolume: parseFloat(e.target.value) || 0 })} placeholder="50" className="h-9" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Access Type</Label>
                                <Select value={customStorage.accessType} onValueChange={(v) => setCustomStorage({ ...customStorage, accessType: v })}>
                                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(ACCESS_TYPE_LABELS).map(([value, label]) => (
                                      <SelectItem key={value} value={value}>{label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Minimum Booking (days)</Label>
                              <Input type="number" min="1" value={customStorage.minimumBookingDuration || 1} onChange={(e) => setCustomStorage({ ...customStorage, minimumBookingDuration: parseInt(e.target.value) || 1 })} placeholder="1" className="h-9" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Description</Label>
                              <Textarea value={customStorage.description} onChange={(e) => setCustomStorage({ ...customStorage, description: e.target.value })} placeholder="Describe the storage space..." rows={2} className="text-sm" />
                            </div>
                            <Button onClick={saveCustomStorage} disabled={isSaving || !customStorage.dailyRate} className="w-full">
                              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlusCircle className="h-4 w-4 mr-2" />}
                              Add "{searchQuery}" Storage
                            </Button>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* Configure Panel */}
            <div className="lg:col-span-1">
              <Card className="sticky top-4">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2"><DollarSign className="h-5 w-5" />Configure</CardTitle>
                  <CardDescription>{selectedStorageCount} storage{selectedStorageCount !== 1 ? 's' : ''} selected</CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedStorageCount === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Package className="h-8 w-8 mx-auto mb-2 opacity-20" />
                      <p className="text-sm">Select storage from the list to configure</p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px] pr-2">
                      <div className="space-y-4">
                        {Object.values(selectedStorage).map((storage) => (
                          <div key={storage.templateId} className="p-3 border rounded-lg space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="font-medium text-sm">{storage.name}</h4>
                              <Badge variant="outline" className="text-xs capitalize">{storage.storageType}</Badge>
                            </div>
                            <div className="space-y-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Daily Rate ($)</Label>
                                <Input type="number" step="0.01" min="0" value={storage.dailyRate} onChange={(e) => updateSelectedStorage(storage.templateId, { dailyRate: parseFloat(e.target.value) || 0 })} className="h-8" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Size (cubic feet)</Label>
                                <Input type="number" min="0" value={storage.totalVolume || ''} onChange={(e) => updateSelectedStorage(storage.templateId, { totalVolume: parseFloat(e.target.value) || 0 })} placeholder="Enter size" className="h-8" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Access Type</Label>
                                <Select value={storage.accessType} onValueChange={(v) => updateSelectedStorage(storage.templateId, { accessType: v })}>
                                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(ACCESS_TYPE_LABELS).map(([value, label]) => (
                                      <SelectItem key={value} value={value}>{label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              {(storage.storageType === 'cold' || storage.storageType === 'freezer') && (
                                <div className="space-y-1">
                                  <Label className="text-xs">Temperature Range</Label>
                                  <Input value={storage.temperatureRange} onChange={(e) => updateSelectedStorage(storage.templateId, { temperatureRange: e.target.value })} placeholder="e.g., 35-40°F" className="h-8" />
                                </div>
                              )}
                              <div className="space-y-1">
                                <Label className="text-xs">Minimum Booking (days)</Label>
                                <Input type="number" min="1" value={storage.minimumBookingDuration || 1} onChange={(e) => updateSelectedStorage(storage.templateId, { minimumBookingDuration: parseInt(e.target.value) || 1 })} className="h-8" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Description</Label>
                                <Textarea value={storage.description} onChange={(e) => updateSelectedStorage(storage.templateId, { description: e.target.value })} rows={2} className="text-sm" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                  {selectedStorageCount > 0 && (
                    <Button onClick={saveSelectedStorage} disabled={isSaving} className="w-full mt-4">
                      {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                      Add {selectedStorageCount} Storage{selectedStorageCount > 1 ? 's' : ''}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Storage Listing</DialogTitle>
            <DialogDescription>Update the storage listing details</DialogDescription>
          </DialogHeader>
          {editingListing && (
            <div className="space-y-4 py-4">
              <div className="space-y-2"><Label>Name</Label><Input value={editingListing.name} onChange={(e) => setEditingListing({ ...editingListing, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Storage Type</Label>
                <Select value={editingListing.storageType} onValueChange={(v: 'dry' | 'cold' | 'freezer') => setEditingListing({ ...editingListing, storageType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dry">Dry Storage</SelectItem>
                    <SelectItem value="cold">Cold Storage</SelectItem>
                    <SelectItem value="freezer">Freezer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Daily Rate ($)</Label><Input type="number" step="0.01" min="0" value={editingListing.basePrice || ''} onChange={(e) => setEditingListing({ ...editingListing, basePrice: parseFloat(e.target.value) || 0 })} /></div>
              <div className="space-y-2"><Label>Size (cubic feet)</Label><Input type="number" min="0" value={editingListing.totalVolume || ''} onChange={(e) => setEditingListing({ ...editingListing, totalVolume: parseFloat(e.target.value) || undefined })} /></div>
              <div className="space-y-2"><Label>Access Type</Label>
                <Select value={editingListing.accessType || ''} onValueChange={(v) => setEditingListing({ ...editingListing, accessType: v })}>
                  <SelectTrigger><SelectValue placeholder="Select access type" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACCESS_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(editingListing.storageType === 'cold' || editingListing.storageType === 'freezer') && (
                <div className="space-y-2"><Label>Temperature Range</Label><Input value={editingListing.temperatureRange || ''} onChange={(e) => setEditingListing({ ...editingListing, temperatureRange: e.target.value })} placeholder="e.g., 35-40°F" /></div>
              )}
              <div className="space-y-2"><Label>Minimum Booking (days)</Label><Input type="number" min="1" value={editingListing.minimumBookingDuration || 1} onChange={(e) => setEditingListing({ ...editingListing, minimumBookingDuration: parseInt(e.target.value) || 1 })} /></div>
              <div className="space-y-2"><Label>Description</Label><Textarea value={editingListing.description || ''} onChange={(e) => setEditingListing({ ...editingListing, description: e.target.value })} placeholder="Optional description..." rows={3} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveEditedListing} disabled={isSaving}>{isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Storage Listing?</DialogTitle>
            <DialogDescription>This action cannot be undone. The storage listing will be permanently deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toggle Confirmation Dialog */}
      <Dialog open={toggleDialogOpen} onOpenChange={setToggleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate Storage Listing?</DialogTitle>
            <DialogDescription>This storage listing will no longer be available for booking. You can reactivate it at any time.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setToggleDialogOpen(false); setPendingToggle(null); }} disabled={isToggling}>Cancel</Button>
            <Button variant="destructive" onClick={() => pendingToggle && doToggleActive(pendingToggle.id, pendingToggle.isActive)} disabled={isToggling}>
              {isToggling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
