import React, { useState, useMemo } from "react";
import { Info, Plus, CheckCircle, Loader2, Search, Package, Thermometer, Snowflake, Check, PlusCircle, SearchX, ChevronDown, ChevronUp, X, DollarSign, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
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

interface SelectedStorage {
  templateId: string;
  name: string;
  storageType: StorageTypeId;
  description: string;
  dailyRate: number;
  totalVolume: number;
  accessType: string;
  temperatureRange: string;
  minimumBookingDuration: number;
  // Overstay penalty configuration
  overstayGracePeriodDays: number;
  overstayPenaltyRate: string;
  overstayMaxPenaltyDays: number;
}

export default function StorageListingsStep() {
  const {
    kitchens,
    selectedKitchenId,
    setSelectedKitchenId,
    storageForm: { listings, isLoading, refresh: refreshListings },
    handleNext,
    handleBack
  } = useManagerOnboarding();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['dry', 'cold', 'freezer']);
  const [selectedStorage, setSelectedStorage] = useState<Record<string, SelectedStorage>>({});
  const [isCreating, setIsCreating] = useState(false);

  const selectedStorageCount = Object.keys(selectedStorage).length;

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
    // Overstay penalty configuration
    overstayGracePeriodDays: 3,
    overstayPenaltyRate: '0.10',
    overstayMaxPenaltyDays: 30,
  });

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

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => prev.includes(categoryId) ? prev.filter(id => id !== categoryId) : [...prev, categoryId]);
  };

  // Save custom storage (for intuitive "not found" flow)
  const saveCustomStorage = async () => {
    const storageName = (customStorage.name.trim() || searchQuery.trim());
    if (!selectedKitchenId || !storageName) {
      toast({ title: "Error", description: "Please enter a storage name", variant: "destructive" });
      return;
    }
    if (!customStorage.dailyRate || customStorage.dailyRate <= 0) {
      toast({ title: "Error", description: "Please enter a daily rate", variant: "destructive" });
      return;
    }
    setIsCreating(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/manager/storage-listings`, {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          kitchenId: selectedKitchenId,
          name: storageName,
          storageType: customStorage.storageType,
          description: customStorage.description || undefined,
          basePrice: Math.round(customStorage.dailyRate * 100),
          totalVolume: customStorage.totalVolume || undefined,
          accessType: customStorage.accessType || undefined,
          temperatureRange: getDefaultTemperatureRange(customStorage.storageType) || undefined,
          pricingModel: 'daily',
          minimumBookingDuration: customStorage.minimumBookingDuration || 1,
          bookingDurationUnit: 'daily',
          currency: "CAD",
          isActive: true,
          // Overstay penalty configuration
          overstayGracePeriodDays: customStorage.overstayGracePeriodDays,
          overstayPenaltyRate: customStorage.overstayPenaltyRate,
          overstayMaxPenaltyDays: customStorage.overstayMaxPenaltyDays,
        }),
      });
      if (!response.ok) throw new Error("Failed to create storage listing");
      toast({ title: "Storage Added", description: `Successfully added "${storageName}"` });
      setCustomStorage({ name: '', storageType: 'dry' as StorageTypeId, description: '', dailyRate: 0, totalVolume: 0, accessType: 'shelving-unit', temperatureRange: '', minimumBookingDuration: 1, overstayGracePeriodDays: 3, overstayPenaltyRate: '0.10', overstayMaxPenaltyDays: 30 });
      setSearchQuery('');
      // Refresh listings to show the new one immediately
      await refreshListings();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  // Handle storage template selection (toggle)
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
          // Default overstay penalty values
          overstayGracePeriodDays: 3,
          overstayPenaltyRate: '0.10',
          overstayMaxPenaltyDays: 30,
        };
      }
      return newState;
    });
  };

  // Update selected storage details
  const updateSelectedStorage = (templateId: string, updates: Partial<SelectedStorage>) => {
    setSelectedStorage(prev => {
      if (!prev[templateId]) return prev;
      return { ...prev, [templateId]: { ...prev[templateId], ...updates } };
    });
  };

  // Save all selected storage
  const saveSelectedStorage = async () => {
    if (!selectedKitchenId || selectedStorageCount === 0) return;
    setIsCreating(true);
    let successCount = 0;
    let errorCount = 0;

    for (const storage of Object.values(selectedStorage)) {
      try {
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch(`/api/manager/storage-listings`, {
          method: "POST",
          headers: {
            'Authorization': `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            kitchenId: selectedKitchenId,
            name: storage.name,
            storageType: storage.storageType,
            description: storage.description || undefined,
            basePrice: Math.round(storage.dailyRate * 100),
            totalVolume: storage.totalVolume || undefined,
            accessType: storage.accessType || undefined,
            temperatureRange: storage.temperatureRange || undefined,
            pricingModel: 'daily',
            minimumBookingDuration: storage.minimumBookingDuration || 1,
            bookingDurationUnit: 'daily',
            currency: "CAD",
            isActive: true,
            // Overstay penalty configuration
            overstayGracePeriodDays: storage.overstayGracePeriodDays,
            overstayPenaltyRate: storage.overstayPenaltyRate,
            overstayMaxPenaltyDays: storage.overstayMaxPenaltyDays,
          }),
        });
        if (!response.ok) throw new Error("Failed to create storage listing");
        successCount++;
      } catch (error) {
        console.error('Error creating storage listing:', error);
        errorCount++;
      }
    }

    setIsCreating(false);

    if (successCount > 0) {
      toast({
        title: "Storage Added",
        description: `Successfully added ${successCount} storage listing${successCount > 1 ? 's' : ''}.${errorCount > 0 ? ` ${errorCount} failed.` : ''}`,
      });
      setSelectedStorage({});
      // Refresh listings to show the new ones immediately
      await refreshListings();
    } else {
      toast({
        title: "Error",
        description: "Failed to add storage listings. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {kitchens.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800">No kitchens found. Please create a kitchen first.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Label>Select Kitchen</Label>
            <Select
              value={selectedKitchenId?.toString() || ""}
              onValueChange={(val) => setSelectedKitchenId(parseInt(val))}
            >
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select Kitchen" /></SelectTrigger>
              <SelectContent>
                {kitchens.map(k => <SelectItem key={k.id} value={k.id.toString()}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {selectedKitchenId && (
            <>
              {isLoading ? (
                <div className="flex justify-center p-4"><Loader2 className="animate-spin text-gray-400" /></div>
              ) : listings.length > 0 ? (
                <div className="border rounded-lg p-4 bg-green-50 border-green-200 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <h4 className="font-semibold text-gray-900">Active Listings ({listings.length})</h4>
                  </div>
                  {listings.map(l => (
                    <div key={l.id} className="bg-white rounded p-3 border border-green-200">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-gray-600">{l.storageType} • ${(Number(l.basePrice || 0) / 100).toFixed(2)}/day</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search storage types..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
              </div>

              {/* Storage Templates - 2-column layout matching listing page */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* Storage Selection */}
                <div className="lg:col-span-3">
                  <div className="border rounded-lg bg-gray-50">
                    <ScrollArea className="h-[350px]">
                      <div className="p-2 space-y-1">
                        {filteredCategories.map((category) => (
                          <Collapsible key={category.id} open={expandedCategories.includes(category.id)} onOpenChange={() => toggleCategory(category.id)}>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm" className="w-full justify-between p-2 h-auto font-medium hover:bg-white">
                                <span className="flex items-center gap-2 text-sm">
                                  <StorageCategoryIcon iconName={category.iconName} className="h-4 w-4 text-muted-foreground" />
                                  {category.name}
                                  <Badge variant="secondary" className="text-xs">{category.items.length}</Badge>
                                </span>
                                {expandedCategories.includes(category.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="p-1.5 pl-6 space-y-1">
                                <p className="text-xs text-muted-foreground mb-2">{category.description}</p>
                                {category.items.map((template) => {
                                  const isSelected = !!selectedStorage[template.id];
                                  const isAlreadyListed = listings.some(l => l.name.toLowerCase() === template.name.toLowerCase());
                                  
                                  return (
                                    <button
                                      key={template.id}
                                      onClick={() => !isAlreadyListed && handleTemplateSelect(template)}
                                      disabled={isAlreadyListed}
                                      className={cn(
                                        "flex items-start gap-2 p-2 rounded-md border text-left transition-all text-xs w-full",
                                        isSelected && "border-primary bg-primary/5 ring-1 ring-primary",
                                        isAlreadyListed && "opacity-50 cursor-not-allowed bg-gray-100",
                                        !isSelected && !isAlreadyListed && "bg-white hover:border-primary/50"
                                      )}
                                    >
                                      <div className={cn(
                                        "flex items-center justify-center w-4 h-4 rounded border flex-shrink-0 mt-0.5",
                                        isSelected ? "bg-primary border-primary" : "border-gray-300"
                                      )}>
                                        {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium">{template.name}</span>
                                          {isAlreadyListed && <Badge variant="secondary" className="text-[10px]">Listed</Badge>}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">{template.description}</p>
                                        <p className="text-[10px] text-blue-600 mt-0.5">~${template.suggestedDailyRate}/day</p>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        ))}

                        {/* Custom storage option when search has no results */}
                        {showNoResultsCustomOption && (
                          <Card className="border-dashed border-primary/50 bg-primary/5 m-2">
                            <CardHeader className="pb-2 pt-3 px-3">
                              <CardTitle className="text-sm flex items-center gap-2">
                                <SearchX className="h-4 w-4" />
                                No matching storage found
                              </CardTitle>
                              <CardDescription className="text-xs">Add custom storage</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2 px-3 pb-3">
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">Storage Type</Label>
                                  <Select value={customStorage.storageType} onValueChange={(v: StorageTypeId) => {
                                    setCustomStorage({ ...customStorage, storageType: v, temperatureRange: getDefaultTemperatureRange(v) || '' });
                                  }}>
                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="dry">Dry Storage</SelectItem>
                                      <SelectItem value="cold">Cold Storage</SelectItem>
                                      <SelectItem value="freezer">Freezer</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Daily Rate ($) *</Label>
                                  <Input type="number" step="0.01" min="0" value={customStorage.dailyRate || ''} onChange={(e) => setCustomStorage({ ...customStorage, dailyRate: parseFloat(e.target.value) || 0 })} placeholder="15.00" className="h-8 text-xs" />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">Size (cubic feet)</Label>
                                  <Input type="number" min="0" value={customStorage.totalVolume || ''} onChange={(e) => setCustomStorage({ ...customStorage, totalVolume: parseFloat(e.target.value) || 0 })} placeholder="50" className="h-8 text-xs" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Access Type</Label>
                                  <Select value={customStorage.accessType} onValueChange={(v) => setCustomStorage({ ...customStorage, accessType: v })}>
                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
                                <Input type="number" min="1" value={customStorage.minimumBookingDuration || 1} onChange={(e) => setCustomStorage({ ...customStorage, minimumBookingDuration: parseInt(e.target.value) || 1 })} placeholder="1" className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Description</Label>
                                <Textarea value={customStorage.description} onChange={(e) => setCustomStorage({ ...customStorage, description: e.target.value })} placeholder="Describe the storage space..." rows={2} className="text-xs" />
                              </div>
                              
                              {/* Overstay Penalty Configuration */}
                              <div className="border-t pt-2 mt-2">
                                <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3 text-orange-500" />
                                  Overstay Penalties
                                </h4>
                                <div className="grid grid-cols-3 gap-2">
                                  <div className="space-y-1">
                                    <Label className="text-[10px]">Grace (d)</Label>
                                    <Input type="number" min="0" max="14" value={customStorage.overstayGracePeriodDays} onChange={(e) => setCustomStorage({ ...customStorage, overstayGracePeriodDays: parseInt(e.target.value) || 0 })} className="h-7 text-xs" />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[10px]">Rate (%)</Label>
                                    <Input type="number" min="0" max="50" value={Math.round(parseFloat(customStorage.overstayPenaltyRate) * 100)} onChange={(e) => setCustomStorage({ ...customStorage, overstayPenaltyRate: ((parseInt(e.target.value) || 0) / 100).toString() })} className="h-7 text-xs" />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[10px]">Max</Label>
                                    <Input type="number" min="1" max="90" value={customStorage.overstayMaxPenaltyDays} onChange={(e) => setCustomStorage({ ...customStorage, overstayMaxPenaltyDays: parseInt(e.target.value) || 1 })} className="h-7 text-xs" />
                                  </div>
                                </div>
                              </div>
                              <Button onClick={saveCustomStorage} disabled={isCreating || !customStorage.dailyRate} className="w-full h-8 text-xs">
                                {isCreating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <PlusCircle className="h-3 w-3 mr-1" />}
                                Add Custom Storage
                              </Button>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </div>

                {/* Configuration Panel */}
                <div className="lg:col-span-2">
                  <div className="border rounded-lg p-3 bg-white sticky top-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium text-sm flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        Configure
                      </h4>
                      {selectedStorageCount > 0 && (
                        <Badge variant="default" className="text-xs">{selectedStorageCount}</Badge>
                      )}
                    </div>

                    {selectedStorageCount === 0 ? (
                      <div className="text-center py-6 text-muted-foreground">
                        <Package className="h-8 w-8 mx-auto mb-2 opacity-20" />
                        <p className="text-xs">Select storage to configure</p>
                      </div>
                    ) : (
                      <ScrollArea className="h-[350px]">
                        <div className="space-y-3 pr-2">
                          {Object.entries(selectedStorage).map(([templateId, storage]) => (
                            <div key={templateId} className="p-3 border rounded-lg space-y-3 bg-gray-50">
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <Input 
                                    value={storage.name} 
                                    onChange={(e) => updateSelectedStorage(templateId, { name: e.target.value })} 
                                    className="font-medium h-7 text-xs px-2 border-transparent hover:border-input focus:border-input bg-transparent" 
                                  />
                                  <p className="text-[10px] text-muted-foreground capitalize mt-0.5 px-2">{storage.storageType} storage</p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 -mr-1 -mt-1"
                                  onClick={() => handleTemplateSelect({ id: templateId } as StorageTemplate)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <Label className="text-[10px] w-16 text-muted-foreground">Rate</Label>
                                  <div className="relative flex-1">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={storage.dailyRate}
                                      onChange={(e) => updateSelectedStorage(templateId, { dailyRate: parseFloat(e.target.value) || 0 })}
                                      className="h-7 text-xs pl-5"
                                    />
                                  </div>
                                  <span className="text-[10px] text-muted-foreground">/day</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Label className="text-[10px] w-16 text-muted-foreground">Size</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    value={storage.totalVolume || ''}
                                    onChange={(e) => updateSelectedStorage(templateId, { totalVolume: parseFloat(e.target.value) || 0 })}
                                    placeholder="cubic feet"
                                    className="h-7 text-xs flex-1"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <Label className="text-[10px] w-16 text-muted-foreground">Access</Label>
                                  <Select
                                    value={storage.accessType}
                                    onValueChange={(v) => updateSelectedStorage(templateId, { accessType: v })}
                                  >
                                    <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {Object.entries(ACCESS_TYPE_LABELS).map(([value, label]) => (
                                        <SelectItem key={value} value={value}>{label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {(storage.storageType === 'cold' || storage.storageType === 'freezer') && (
                                  <div className="flex items-center gap-2">
                                    <Label className="text-[10px] w-16 text-muted-foreground">Temp</Label>
                                    <Input
                                      value={storage.temperatureRange}
                                      onChange={(e) => updateSelectedStorage(templateId, { temperatureRange: e.target.value })}
                                      placeholder="e.g., 35-40°F"
                                      className="h-7 text-xs flex-1"
                                    />
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <Label className="text-[10px] w-16 text-muted-foreground">Min Days</Label>
                                  <Input
                                    type="number"
                                    min="1"
                                    value={storage.minimumBookingDuration}
                                    onChange={(e) => updateSelectedStorage(templateId, { minimumBookingDuration: parseInt(e.target.value) || 1 })}
                                    className="h-7 text-xs flex-1"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground">Description</Label>
                                  <Textarea
                                    value={storage.description}
                                    onChange={(e) => updateSelectedStorage(templateId, { description: e.target.value })}
                                    placeholder="Optional"
                                    rows={2}
                                    className="text-xs"
                                  />
                                </div>
                                {/* Overstay Penalty Configuration */}
                                <div className="border-t pt-2 mt-2">
                                  <h4 className="text-[10px] font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3 text-orange-500" />
                                    Penalties
                                  </h4>
                                  <div className="grid grid-cols-3 gap-1.5">
                                    <div className="space-y-0.5">
                                      <Label className="text-[10px] text-muted-foreground">Grace</Label>
                                      <Input type="number" min="0" max="14" value={storage.overstayGracePeriodDays} onChange={(e) => updateSelectedStorage(templateId, { overstayGracePeriodDays: parseInt(e.target.value) || 0 })} className="h-6 text-xs px-1" />
                                    </div>
                                    <div className="space-y-0.5">
                                      <Label className="text-[10px] text-muted-foreground">Rate%</Label>
                                      <Input type="number" min="0" max="50" value={Math.round(parseFloat(storage.overstayPenaltyRate) * 100)} onChange={(e) => updateSelectedStorage(templateId, { overstayPenaltyRate: ((parseInt(e.target.value) || 0) / 100).toString() })} className="h-6 text-xs px-1" />
                                    </div>
                                    <div className="space-y-0.5">
                                      <Label className="text-[10px] text-muted-foreground">Max</Label>
                                      <Input type="number" min="1" max="90" value={storage.overstayMaxPenaltyDays} onChange={(e) => updateSelectedStorage(templateId, { overstayMaxPenaltyDays: parseInt(e.target.value) || 1 })} className="h-6 text-xs px-1" />
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
                      <Button 
                        className="w-full mt-3" 
                        size="sm"
                        onClick={saveSelectedStorage}
                        disabled={isCreating}
                      >
                        {isCreating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Plus className="h-4 w-4 mr-1" />
                            Add {selectedStorageCount} Storage
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <OnboardingNavigationFooter
        onNext={handleNext}
        onBack={handleBack}
        isNextDisabled={kitchens.length === 0}
      />
    </div>
  );
}
