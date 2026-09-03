import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { 
  Package, Plus, Check, Loader2, Pencil, Trash2, Search,
  Thermometer, Snowflake, Grid3X3, DollarSign, PlusCircle, SearchX,
  AlertTriangle
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import {
  STORAGE_CATEGORIES,
  StorageTemplate,
  StorageTypeId,
  ACCESS_TYPE_LABELS,
  getDefaultTemperatureRange,
} from "@/lib/storage-templates";
import { cn } from "@/lib/utils";

const StorageCategoryIcon = ({ iconName, className }: { iconName: string; className?: string }) => {
  const icons: Record<string, React.ComponentType<{ className?: string }>> = {
    Package, Thermometer, Snowflake
  };
  const Icon = icons[iconName] || Package;
  return <Icon className={className} />;
};

// Storage type icon for edit dialog header
const StorageTypeIcon = ({ type, className }: { type: string; className?: string }) => {
  switch (type) {
    case 'cold':
      return <Thermometer className={className} />;
    case 'freezer':
      return <Snowflake className={className} />;
    default:
      return <Package className={className} />;
  }
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
  // Overstay penalty configuration
  overstayGracePeriodDays?: number;
  overstayPenaltyRate?: string;
  overstayMaxPenaltyDays?: number;
  overstayPolicyText?: string;
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
  // Overstay penalty configuration
  overstayGracePeriodDays: number;
  overstayPenaltyRate: string;
  overstayMaxPenaltyDays: number;
}

interface LocationDefaults {
  gracePeriodDays: number | null;
  penaltyRate: number | null;
  maxPenaltyDays: number | null;
  policyText: string | null;
}

export default function StorageListingManagement() {
  
  return (
    <ManagerPageLayout
      title={mt("storageManagement")}
      description={mt("manageYourKitchenStorageListings")}
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
  
  // Location overstay penalty defaults
  const [locationDefaults, setLocationDefaults] = useState<LocationDefaults | null>(null);
  
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
  const [activeSavingAction, setActiveSavingAction] = useState<'custom' | 'bulk' | 'edit' | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  // Custom storage state for intuitive "not found" flow
  const [customStorage, setCustomStorage] = useState(() => ({
    name: '',
    storageType: 'dry' as StorageTypeId,
    description: '',
    dailyRate: 0,
    totalVolume: 0,
    accessType: 'shelving-unit',
    temperatureRange: '',
    minimumBookingDuration: 1,
    // Overstay penalty configuration - will be updated when location defaults are fetched
    overstayGracePeriodDays: 3,
    overstayPenaltyRate: '0.10',
    overstayMaxPenaltyDays: 30,
  }));

  const selectedStorageCount = Object.keys(selectedStorage).length;

  useEffect(() => {
    if (selectedLocationId) {
      loadKitchens();
      loadLocationDefaults();
    } else {
      setKitchens([]);
    }
  }, [selectedLocationId]);

  useEffect(() => {
    if (selectedKitchenId) loadListings();
    else setListings([]);
  }, [selectedKitchenId]);

  // Update customStorage overstay defaults when locationDefaults are loaded
  useEffect(() => {
    if (locationDefaults) {
      setCustomStorage(prev => ({
        ...prev,
        overstayGracePeriodDays: locationDefaults.gracePeriodDays ?? 3,
        overstayPenaltyRate: (locationDefaults.penaltyRate ?? 0.10).toString(),
        overstayMaxPenaltyDays: locationDefaults.maxPenaltyDays ?? 30,
      }));
    }
  }, [locationDefaults]);

  const loadKitchens = async () => {
    if (!selectedLocationId) return;
    try {
      const data = await apiGet(`/manager/kitchens/${selectedLocationId}`);
      setKitchens(data);
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || "Failed to load kitchens", variant: "destructive" });
    }
  };

  const loadLocationDefaults = async () => {
    if (!selectedLocationId) return;
    try {
      const data = await apiGet(`/manager/locations/${selectedLocationId}/overstay-penalty-defaults`);
      setLocationDefaults(data.locationDefaults);
    } catch (error: any) {
      logger.error('Failed to load location defaults:', error);
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
      toast({ title: mt("error"), description: error.message || "Failed to load storage listings", variant: "destructive" });
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
      toast({ title: mt("error"), description: mt("pleaseEnterAStorageName"), variant: "destructive" });
      return;
    }
    if (!customStorage.dailyRate || customStorage.dailyRate <= 0) {
      toast({ title: mt("error"), description: mt("pleaseEnterADailyRate"), variant: "destructive" });
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
        // Overstay penalty configuration
        overstayGracePeriodDays: customStorage.overstayGracePeriodDays,
        overstayPenaltyRate: customStorage.overstayPenaltyRate,
        overstayMaxPenaltyDays: customStorage.overstayMaxPenaltyDays,
      });
      toast({ title: mt("storageAdded"), description: `Successfully added "${storageName}"` });
      setCustomStorage({ 
        name: '', 
        storageType: 'dry' as StorageTypeId, 
        description: '', 
        dailyRate: 0, 
        totalVolume: 0, 
        accessType: 'shelving-unit', 
        temperatureRange: '', 
        minimumBookingDuration: 1, 
        overstayGracePeriodDays: locationDefaults?.gracePeriodDays ?? 3, 
        overstayPenaltyRate: (locationDefaults?.penaltyRate ?? 0.10).toString(), 
        overstayMaxPenaltyDays: locationDefaults?.maxPenaltyDays ?? 30 
      });
      setSearchQuery('');
      setActiveTab('list');
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/storage-listings`] });
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || "Failed to add storage", variant: "destructive" });
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
          // Use location defaults if available, otherwise platform defaults
          overstayGracePeriodDays: locationDefaults?.gracePeriodDays ?? 3,
          overstayPenaltyRate: (locationDefaults?.penaltyRate ?? 0.10).toString(),
          overstayMaxPenaltyDays: locationDefaults?.maxPenaltyDays ?? 30,
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
          // Overstay penalty configuration
          overstayGracePeriodDays: storage.overstayGracePeriodDays,
          overstayPenaltyRate: storage.overstayPenaltyRate,
          overstayMaxPenaltyDays: storage.overstayMaxPenaltyDays,
        });
        successCount++;
      } catch (error) {
        logger.error('Error creating storage listing:', error);
      }
    }
    setIsSaving(false);
    if (successCount > 0) {
      toast({ title: mt("storageAdded"), description: `Successfully added ${successCount} storage listing${successCount > 1 ? 's' : ''}.` });
      setSelectedStorage({});
      setActiveTab('list');
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/storage-listings`] });
    } else {
      toast({ title: mt("error"), description: mt("failedToAddStorageListings"), variant: "destructive" });
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
      toast({ title: mt("success"), description: mt("storageListingUpdatedSuccessfully") });
      setEditDialogOpen(false);
      setEditingListing(null);
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/storage-listings`] });
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || "Failed to update listing", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await apiDelete(`/manager/storage-listings/${pendingDeleteId}`);
      toast({ title: mt("success"), description: mt("storageListingDeletedSuccessfully") });
      setDeleteDialogOpen(false);
      setPendingDeleteId(null);
      loadListings();
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || "Failed to delete listing", variant: "destructive" });
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
      toast({ title: mt("statusUpdated"), description: `Storage listing is now ${isActive ? 'active' : 'inactive'}` });
      setToggleDialogOpen(false);
      setPendingToggle(null);
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || "Failed to update status", variant: "destructive" });
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
          <h3 className="text-lg font-medium text-foreground mb-1">{mt("noKitchenSelected")}</h3>
          <p>{mt("selectALocationAndKitchenFromTheSidebarToManageStorage")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'list' | 'add')}>
        <div className="flex items-center justify-between mb-4">
          <TabsList className="grid w-[300px] grid-cols-2">
            <TabsTrigger value="list" className="flex items-center gap-2"><Package className="h-4 w-4" />{mt("myStorage")}</TabsTrigger>
            <TabsTrigger value="add" className="flex items-center gap-2"><Plus className="h-4 w-4" />{mt("addStorage")}</TabsTrigger>
          </TabsList>
          {selectedKitchen && <Badge variant="outline" className="text-sm">{selectedKitchen.name}</Badge>}
        </div>

        <TabsContent value="list" className="mt-0">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{mt("storageInventory")}</CardTitle>
              <CardDescription>{listings.length} storage listing{listings.length !== 1 ? 's' : ''} for this kitchen</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
              ) : listings.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p className="font-medium">{mt("noStorageListedYet")}</p>
                  <p className="text-sm mt-1">Click "Add Storage" to get started</p>
                  <Button className="mt-4" onClick={() => setActiveTab('add')}><Plus className="h-4 w-4 mr-2" />{mt("addStorage")}</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {listings.map((listing) => (
                    <div key={listing.id} className={cn("p-4 border rounded-lg transition-colors", listing.isActive === false && "bg-muted/50 opacity-75")}>
                      {/* Main Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium truncate">{listing.name}</h4>
                            <Badge variant={listing.isActive !== false ? "success" : "outline"} className="text-xs">{listing.isActive !== false ? 'Active' : 'Inactive'}</Badge>
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
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(listing)} title={mt("editStorageDetails")}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => { setPendingDeleteId(listing.id!); setDeleteDialogOpen(true); }} title={mt("deleteStorage")}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                      
                      {/* Penalty Configuration Row */}
                      <div className="mt-3 pt-3 border-t flex items-center justify-between">
                        <div className="flex items-center gap-3 text-sm">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className={cn("h-4 w-4", listing.overstayGracePeriodDays !== undefined ? "text-orange-500" : "text-gray-300")} />
                            <span className="text-muted-foreground">{mt("overstayPenalties2")}</span>
                          </div>
                          {listing.overstayGracePeriodDays !== undefined ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs font-normal">
                                {listing.overstayGracePeriodDays}d grace
                              </Badge>
                              <Badge variant="outline" className="text-xs font-normal">
                                {Math.round((parseFloat(listing.overstayPenaltyRate || '0.1')) * 100)}% / day
                              </Badge>
                              <span className="text-xs text-muted-foreground">max {listing.overstayMaxPenaltyDays || 30} days</span>
                            </div>
                          ) : (
                            <span className="text-xs text-orange-600 italic">{mt("notConfiguredUsingDefaults")}</span>
                          )}
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-xs h-7 px-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                          onClick={() => handleEdit(listing)}
                        >{mt("configure")}</Button>
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
            <Input placeholder={mt("searchStorageTypes")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2"><Grid3X3 className="h-5 w-5" />{mt("selectStorageType")}</CardTitle>
                  <CardDescription>{mt("chooseFromPreDefinedStorageOptionsOrAddCustom")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px] pr-4">
                    <div className="space-y-2">
                      {filteredCategories.map((category) => (
                        <Collapsible key={category.id} open={expandedCategories.includes(category.id)} onOpenChange={() => toggleCategory(category.id)}>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" className="w-full justify-between p-3 h-auto font-medium hover:bg-muted/50">
                              <span className="flex items-center gap-2"><StorageCategoryIcon iconName={category.iconName} className="h-4 w-4 text-muted-foreground" />{category.name}<Badge variant="count" className="ml-2">{category.items.length}</Badge></span>
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
                                          {isAlreadyListed && <Badge variant="secondary" className="text-xs">{mt("listed")}</Badge>}
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
                              <SearchX className="h-4 w-4" />{mt("noMatchingStorageFound")}</CardTitle>
                            <CardDescription>Add "{searchQuery}" as custom storage</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">{mt("storageType")}</Label>
                                <Select value={customStorage.storageType} onValueChange={(v: StorageTypeId) => {
                                  setCustomStorage({ ...customStorage, storageType: v, temperatureRange: getDefaultTemperatureRange(v) || '' });
                                }}>
                                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="dry">{mt("dryStorage")}</SelectItem>
                                    <SelectItem value="cold">{mt("coldStorage")}</SelectItem>
                                    <SelectItem value="freezer">{mt("freezer")}</SelectItem>
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
                                <Label className="text-xs">{mt("sizeCubicFeet")}</Label>
                                <Input type="number" min="0" value={customStorage.totalVolume || ''} onChange={(e) => setCustomStorage({ ...customStorage, totalVolume: parseFloat(e.target.value) || 0 })} placeholder="50" className="h-9" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">{mt("accessType")}</Label>
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
                              <Label className="text-xs">{mt("minimumBookingDays")}</Label>
                              <Input type="number" min="1" value={customStorage.minimumBookingDuration || 1} onChange={(e) => setCustomStorage({ ...customStorage, minimumBookingDuration: parseInt(e.target.value) || 1 })} placeholder="1" className="h-9" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">{mt("description")}</Label>
                              <Textarea value={customStorage.description} onChange={(e) => setCustomStorage({ ...customStorage, description: e.target.value })} placeholder={mt("describeTheStorageSpace")} rows={2} className="text-sm" />
                            </div>
                            
                            {/* Overstay Penalty Configuration */}
                            <div className="border-t pt-3 mt-3">
                              <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                                <AlertTriangle className="h-3 w-3 text-orange-500" />{mt("navOverstayPenalties")}</h4>
                              <div className="grid grid-cols-3 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">{mt("graceDays")}</Label>
                                  <Input type="number" min="0" max="14" value={customStorage.overstayGracePeriodDays} onChange={(e) => setCustomStorage({ ...customStorage, overstayGracePeriodDays: parseInt(e.target.value) || 0 })} className="h-8 text-xs" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">{mt("rate2")}</Label>
                                  <Input type="number" min="0" max="50" value={Math.round(parseFloat(customStorage.overstayPenaltyRate) * 100)} onChange={(e) => setCustomStorage({ ...customStorage, overstayPenaltyRate: ((parseInt(e.target.value) || 0) / 100).toString() })} className="h-8 text-xs" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">{mt("maxDays")}</Label>
                                  <Input type="number" min="1" max="90" value={customStorage.overstayMaxPenaltyDays} onChange={(e) => setCustomStorage({ ...customStorage, overstayMaxPenaltyDays: parseInt(e.target.value) || 1 })} className="h-8 text-xs" />
                                </div>
                              </div>
                            </div>
                            <StatusButton
                              onClick={() => { setActiveSavingAction('custom'); saveCustomStorage(); }}
                              status={activeSavingAction === 'custom' && isSaving ? "loading" : "idle"}
                              disabled={(isSaving && activeSavingAction !== 'custom') || !customStorage.dailyRate}
                              className="w-full"
                              labels={{ idle: `Add Custom Storage`, loading: "Adding", success: "Added" }}
                            />
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
                  <CardTitle className="text-lg flex items-center gap-2"><DollarSign className="h-5 w-5" />{mt("configure")}</CardTitle>
                  <CardDescription>{selectedStorageCount} storage{selectedStorageCount !== 1 ? 's' : ''} selected</CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedStorageCount === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Package className="h-8 w-8 mx-auto mb-2 opacity-20" />
                      <p className="text-sm">{mt("selectStorageFromTheListToConfigure")}</p>
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
                                <Label className="text-xs">{mt("sizeCubicFeet")}</Label>
                                <Input type="number" min="0" value={storage.totalVolume || ''} onChange={(e) => updateSelectedStorage(storage.templateId, { totalVolume: parseFloat(e.target.value) || 0 })} placeholder={mt("enterSize")} className="h-8" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">{mt("accessType")}</Label>
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
                                  <Label className="text-xs">{mt("temperatureRange")}</Label>
                                  <Input value={storage.temperatureRange} onChange={(e) => updateSelectedStorage(storage.templateId, { temperatureRange: e.target.value })} placeholder={mt("eG3540F")} className="h-8" />
                                </div>
                              )}
                              <div className="space-y-1">
                                <Label className="text-xs">{mt("minimumBookingDays")}</Label>
                                <Input type="number" min="1" value={storage.minimumBookingDuration || 1} onChange={(e) => updateSelectedStorage(storage.templateId, { minimumBookingDuration: parseInt(e.target.value) || 1 })} className="h-8" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">{mt("description")}</Label>
                                <Textarea value={storage.description} onChange={(e) => updateSelectedStorage(storage.templateId, { description: e.target.value })} rows={2} className="text-sm" />
                              </div>
                              
                              {/* Overstay Penalty Configuration */}
                              <div className="border-t pt-2 mt-2">
                                <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3 text-orange-500" />{mt("navOverstayPenalties")}</h4>
                                <div className="grid grid-cols-3 gap-1.5">
                                  <div className="space-y-0.5">
                                    <Label className="text-[10px]">{mt("graceD")}</Label>
                                    <Input type="number" min="0" max="14" value={storage.overstayGracePeriodDays} onChange={(e) => updateSelectedStorage(storage.templateId, { overstayGracePeriodDays: parseInt(e.target.value) || 0 })} className="h-7 text-xs" />
                                  </div>
                                  <div className="space-y-0.5">
                                    <Label className="text-[10px]">{mt("rate2")}</Label>
                                    <Input type="number" min="0" max="50" value={Math.round(parseFloat(storage.overstayPenaltyRate) * 100)} onChange={(e) => updateSelectedStorage(storage.templateId, { overstayPenaltyRate: ((parseInt(e.target.value) || 0) / 100).toString() })} className="h-7 text-xs" />
                                  </div>
                                  <div className="space-y-0.5">
                                    <Label className="text-[10px]">Max</Label>
                                    <Input type="number" min="1" max="90" value={storage.overstayMaxPenaltyDays} onChange={(e) => updateSelectedStorage(storage.templateId, { overstayMaxPenaltyDays: parseInt(e.target.value) || 1 })} className="h-7 text-xs" />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                  {selectedStorageCount > 0 && (
                    <StatusButton
                      onClick={() => { setActiveSavingAction('bulk'); saveSelectedStorage(); }}
                      status={activeSavingAction === 'bulk' && isSaving ? "loading" : "idle"}
                      disabled={isSaving && activeSavingAction !== 'bulk'}
                      className="w-full mt-4"
                      labels={{ idle: `Add ${selectedStorageCount} Storage${selectedStorageCount > 1 ? 's' : ''}`, loading: "Adding", success: "Added" }}
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Sheet */}
      <Sheet open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
          <SheetHeader className="p-6 pb-4 border-b">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#FFE8DD] to-[#FFD4C4] flex items-center justify-center">
                {editingListing && <StorageTypeIcon type={editingListing.storageType} className="w-5 h-5 text-[#F51042]" />}
              </div>
              <div>
                <SheetTitle className="text-lg">{mt("editStorageListing")}</SheetTitle>
                <SheetDescription>{mt("updateYourStorageDetailsAndPenaltySettings")}</SheetDescription>
              </div>
            </div>
          </SheetHeader>
          
          {editingListing && (
            <div className="flex-1 overflow-y-auto p-6">
              <Tabs defaultValue="basic" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="basic">{mt("basicInfo")}</TabsTrigger>
                  <TabsTrigger value="penalties" className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />{mt("penalties")}</TabsTrigger>
                </TabsList>

                {/* Basic Info Tab */}
                <TabsContent value="basic" className="space-y-4 mt-0">
                  {/* Name Field */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{mt("storageName")}</Label>
                    <div className="relative">
                      <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input 
                        value={editingListing.name} 
                        onChange={(e) => setEditingListing({ ...editingListing, name: e.target.value })}
                        className="pl-10"
                        placeholder={mt("eGWalkInCoolerA")}
                      />
                    </div>
                  </div>

                  {/* Storage Type & Access Type Row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{mt("storageType")}</Label>
                      <Select 
                        value={editingListing.storageType} 
                        onValueChange={(v: 'dry' | 'cold' | 'freezer') => setEditingListing({ ...editingListing, storageType: v })}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dry">{mt("dryStorage")}</SelectItem>
                          <SelectItem value="cold">{mt("coldStorage")}</SelectItem>
                          <SelectItem value="freezer">{mt("freezer")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{mt("accessType")}</Label>
                      <Select 
                        value={editingListing.accessType || ''} 
                        onValueChange={(v) => setEditingListing({ ...editingListing, accessType: v })}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder={mt("selectAccessType")} />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(ACCESS_TYPE_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Daily Rate & Size Row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Daily Rate ($)</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input 
                          type="number" 
                          step="0.01" 
                          min="0" 
                          value={editingListing.basePrice || ''} 
                          onChange={(e) => setEditingListing({ ...editingListing, basePrice: parseFloat(e.target.value) || 0 })}
                          className="pl-10"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{mt("sizeCubicFeet")}</Label>
                      <div className="relative">
                        <Grid3X3 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input 
                          type="number" 
                          min="0" 
                          value={editingListing.totalVolume || ''} 
                          onChange={(e) => setEditingListing({ ...editingListing, totalVolume: parseFloat(e.target.value) || undefined })}
                          className="pl-10"
                          placeholder={mt("eG50")}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Minimum Booking & Temperature Row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{mt("minimumBookingDays")}</Label>
                      <Input 
                        type="number" 
                        min="1" 
                        value={editingListing.minimumBookingDuration || 1} 
                        onChange={(e) => setEditingListing({ ...editingListing, minimumBookingDuration: parseInt(e.target.value) || 1 })}
                        className="h-10"
                      />
                    </div>
                    {(editingListing.storageType === 'cold' || editingListing.storageType === 'freezer') && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">{mt("temperatureRange")}</Label>
                        <div className="relative">
                          <Thermometer className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <Input 
                            value={editingListing.temperatureRange || ''} 
                            onChange={(e) => setEditingListing({ ...editingListing, temperatureRange: e.target.value })}
                            className="pl-10"
                            placeholder={mt("eG3540F")}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{mt("description")}</Label>
                    <Textarea 
                      value={editingListing.description || ''} 
                      onChange={(e) => setEditingListing({ ...editingListing, description: e.target.value })}
                      placeholder={mt("optionalDescriptionOfTheStorageSpace")}
                      rows={3}
                      className="min-h-[80px] resize-none"
                    />
                  </div>
                </TabsContent>

                {/* Penalties Tab */}
                <TabsContent value="penalties" className="space-y-4 mt-0">
                  <div className="bg-orange-50 border-l-4 border-orange-400 p-4 rounded-r-lg">
                    <div className="flex gap-2">
                      <AlertTriangle className="h-4 w-4 text-orange-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-gray-700">
                        Configure penalties for chefs who stay past their booked storage period. 
                        Charges are calculated as a percentage of the daily rate.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{mt("gracePeriodDays2")}</Label>
                      <Input 
                        type="number" 
                        min="0" 
                        max="14" 
                        value={editingListing.overstayGracePeriodDays ?? 3} 
                        onChange={(e) => setEditingListing({ ...editingListing, overstayGracePeriodDays: parseInt(e.target.value) || 0 })}
                        className="h-10"
                      />
                      <p className="text-xs text-muted-foreground">{mt("daysBeforePenaltiesApply")}</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{mt("penaltyRate2")}</Label>
                      <Input 
                        type="number" 
                        min="0" 
                        max="50" 
                        step="1"
                        value={editingListing.overstayPenaltyRate ? Math.round(parseFloat(editingListing.overstayPenaltyRate) * 100) : 10} 
                        onChange={(e) => setEditingListing({ ...editingListing, overstayPenaltyRate: ((parseInt(e.target.value) || 0) / 100).toString() })}
                        className="h-10"
                      />
                      <p className="text-xs text-muted-foreground">% of daily rate per day</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{mt("maxPenaltyDays")}</Label>
                      <Input 
                        type="number" 
                        min="1" 
                        max="90" 
                        value={editingListing.overstayMaxPenaltyDays ?? 30} 
                        onChange={(e) => setEditingListing({ ...editingListing, overstayMaxPenaltyDays: parseInt(e.target.value) || 1 })}
                        className="h-10"
                      />
                      <p className="text-xs text-muted-foreground">{mt("maximumDaysToCharge")}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{mt("policyTextOptional2")}</Label>
                    <Textarea 
                      value={editingListing.overstayPolicyText || ''} 
                      onChange={(e) => setEditingListing({ ...editingListing, overstayPolicyText: e.target.value })}
                      placeholder={mt("customOverstayPolicyMessageShownToChefs")}
                      rows={3}
                      className="min-h-[80px] resize-none"
                    />
                    <p className="text-xs text-muted-foreground">{mt("thisMessageWillBeDisplayedToChefsWhenTheyBookThisStorage")}</p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
          
          <SheetFooter className="p-6 pt-4 border-t gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{mt("cancel")}</Button>
            <StatusButton 
              onClick={() => { setActiveSavingAction('edit'); saveEditedListing(); }} 
              status={activeSavingAction === 'edit' && isSaving ? "loading" : "idle"}
              labels={{ idle: "Save Changes", loading: "Saving", success: "Saved" }}
            />
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mt("deleteStorageListing")}</DialogTitle>
            <DialogDescription>{mt("thisActionCannotBeUndoneTheStorageListingWillBePermanentlyDe")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>{mt("cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete}>{mt("delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toggle Confirmation Dialog */}
      <Dialog open={toggleDialogOpen} onOpenChange={setToggleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mt("deactivateStorageListing")}</DialogTitle>
            <DialogDescription>{mt("thisStorageListingWillNoLongerBeAvailableForBookingYouCanRea")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setToggleDialogOpen(false); setPendingToggle(null); }} disabled={isToggling}>{mt("cancel")}</Button>
            <StatusButton
              variant="destructive"
              onClick={() => pendingToggle && doToggleActive(pendingToggle.id, pendingToggle.isActive)}
              status={isToggling ? "loading" : "idle"}
              labels={{ idle: "Deactivate", loading: "Deactivating", success: "Deactivated" }}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
