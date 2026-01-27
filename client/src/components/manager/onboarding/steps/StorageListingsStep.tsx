import React, { useState, useMemo } from "react";
import { Info, Plus, CheckCircle, Loader2, Search, Package, Thermometer, Snowflake, Check, PlusCircle, SearchX, ChevronDown, ChevronUp } from "lucide-react";
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

export default function StorageListingsStep() {
  const {
    kitchens,
    selectedKitchenId,
    setSelectedKitchenId,
    storageForm: { listings, isLoading },
    handleNext,
    handleBack
  } = useManagerOnboarding();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['dry', 'cold', 'freezer']);
  const [isCreating, setIsCreating] = useState(false);

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
        }),
      });
      if (!response.ok) throw new Error("Failed to create storage listing");
      toast({ title: "Storage Added", description: `Successfully added "${storageName}"` });
      setCustomStorage({ name: '', storageType: 'dry', description: '', dailyRate: 0, totalVolume: 0, accessType: 'shelving-unit', temperatureRange: '', minimumBookingDuration: 1 });
      setSearchQuery('');
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  // Save from template
  const saveFromTemplate = async (template: StorageTemplate) => {
    if (!selectedKitchenId) return;
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
          name: template.name,
          storageType: template.storageType,
          description: template.description,
          basePrice: Math.round(template.suggestedDailyRate * 100),
          accessType: template.accessTypes[0] || 'walk-in',
          temperatureRange: template.temperatureRange || getDefaultTemperatureRange(template.storageType) || undefined,
          pricingModel: 'daily',
          minimumBookingDuration: 1,
          bookingDurationUnit: 'daily',
          currency: "CAD",
          isActive: true,
        }),
      });
      if (!response.ok) throw new Error("Failed to create storage listing");
      toast({ title: "Storage Added", description: `Successfully added "${template.name}"` });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
        <h3 className="text-lg font-semibold mb-1">Storage Listings (Optional)</h3>
        <p className="text-sm text-gray-600">
          Add storage options that chefs can book. This step is optional - you can skip and add listings later from your dashboard.
        </p>
      </div>

      <div className="bg-gradient-to-r from-rose-50 to-pink-50 border-2 border-rose-200/50 rounded-xl p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-rose-100 rounded-lg">
            <Info className="h-5 w-5 text-[#F51042] flex-shrink-0" />
          </div>
          <div className="text-sm text-gray-700">
            <p className="font-bold mb-2 text-gray-900">What are Storage Listings?</p>
            <p>Storage listings allow chefs to book dry storage, cold storage, or freezer space at your kitchen. You can add multiple storage options with different sizes and prices.</p>
          </div>
        </div>
      </div>

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
                    <h4 className="font-semibold text-gray-900">Existing Listings ({listings.length})</h4>
                  </div>
                  {listings.map(l => (
                    <div key={l.id} className="bg-white rounded p-3 border border-green-200">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-gray-600">{l.storageType} • ${Number(l.basePrice || 0).toFixed(2)}/day</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search storage types..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
              </div>

              {/* Storage Templates */}
              <ScrollArea className="h-[300px] border rounded-lg">
                <div className="p-2 space-y-1">
                  {filteredCategories.map((category) => (
                    <Collapsible key={category.id} open={expandedCategories.includes(category.id)} onOpenChange={() => toggleCategory(category.id)}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="w-full justify-between p-2 h-auto font-medium hover:bg-muted/50">
                          <span className="flex items-center gap-2 text-sm">
                            <StorageCategoryIcon iconName={category.iconName} className="h-4 w-4 text-muted-foreground" />
                            {category.name}
                            <Badge variant="secondary" className="ml-1 text-xs">{category.items.length}</Badge>
                          </span>
                          {expandedCategories.includes(category.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="pl-4 pr-2 pb-2 space-y-1">
                          <p className="text-xs text-muted-foreground mb-2">{category.description}</p>
                          {category.items.map((template) => {
                            const isAlreadyListed = listings.some(l => l.name.toLowerCase() === template.name.toLowerCase());
                            return (
                              <div key={template.id} className={cn("flex items-center justify-between p-2 rounded border text-sm", isAlreadyListed && "opacity-50 bg-muted")}>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm">{template.name}</p>
                                  <p className="text-xs text-muted-foreground">${template.suggestedDailyRate}/day</p>
                                </div>
                                {isAlreadyListed ? (
                                  <Badge variant="secondary" className="text-xs">Listed</Badge>
                                ) : (
                                  <Button size="sm" variant="outline" onClick={() => saveFromTemplate(template)} disabled={isCreating} className="h-7 text-xs">
                                    {isCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
                                    Add
                                  </Button>
                                )}
                              </div>
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
                        <CardDescription className="text-xs">Add "{searchQuery}" as custom storage</CardDescription>
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
                        <Button onClick={saveCustomStorage} disabled={isCreating || !customStorage.dailyRate} className="w-full h-8 text-xs">
                          {isCreating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <PlusCircle className="h-3 w-3 mr-1" />}
                          Add "{searchQuery}" Storage
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </ScrollArea>
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
