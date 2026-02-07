/**
 * Equipment Listing Management
 * 
 * Enterprise-grade equipment management for commercial kitchens.
 * Features:
 * - Pre-defined equipment templates for quick selection
 * - Streamlined 2-step form (select equipment → set pricing)
 * - Bulk equipment selection
 * - Modern, intuitive UI with shadcn components
 */

import { 
  Wrench, Save, Loader2, Plus, X, Check, Search, Pencil, Trash2, 
  Package, Grid3X3, DollarSign, ChevronDown, ChevronUp,
  Flame, ChefHat, Snowflake, Sparkles, SprayCan, PlusCircle, SearchX
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
import { ManagerPageLayout } from "@/components/layout/ManagerPageLayout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { EQUIPMENT_CATEGORIES, type EquipmentTemplate, type EquipmentCategoryId } from "@/lib/equipment-templates";

// Icon component mapping for categories (enterprise pattern - no emojis)
const CategoryIcon = ({ iconName, className }: { iconName: string; className?: string }) => {
  const icons: Record<string, React.ComponentType<{ className?: string }>> = {
    Flame, ChefHat, Snowflake, Sparkles, SprayCan
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

interface EquipmentListing {
  id?: number;
  kitchenId: number;
  category: 'food-prep' | 'cooking' | 'refrigeration' | 'cleaning' | 'specialty';
  equipmentType: string;
  brand?: string;
  model?: string;
  description?: string;
  condition: 'excellent' | 'good' | 'fair' | 'needs-repair';
  availabilityType: 'included' | 'rental';
  sessionRate?: number;
  currency: string;
  damageDeposit?: number;
  isActive?: boolean;
}

interface SelectedEquipment {
  templateId: string;
  name: string;
  category: EquipmentListing['category'];
  condition: EquipmentListing['condition'];
  availabilityType: 'included' | 'rental';
  sessionRate: number;
  damageDeposit: number;
  description: string;
  brand: string;
}

export default function EquipmentListingManagement() {
  return (
    <ManagerPageLayout
      title="Equipment Management"
      description="Manage your kitchen equipment listings"
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
          <EquipmentListingContent
            selectedLocationId={selectedLocationId}
            selectedKitchenId={selectedKitchenId}
          />
        );
      }}
    </ManagerPageLayout>
  );
}

function EquipmentListingContent({
  selectedLocationId,
  selectedKitchenId
}: {
  selectedLocationId: number | null,
  selectedKitchenId: number | null
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [listings, setListings] = useState<EquipmentListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'list' | 'add'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['cooking', 'food-prep']);
  const [selectedEquipment, setSelectedEquipment] = useState<Record<string, SelectedEquipment>>({});
  
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingListing, setEditingListing] = useState<EquipmentListing | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [toggleDialogOpen, setToggleDialogOpen] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<{ id: number; isActive: boolean } | null>(null);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  // Custom equipment state for intuitive "not found" flow
  const [customEquipment, setCustomEquipment] = useState({
    name: '',
    category: 'cooking' as EquipmentCategoryId,
    condition: 'good' as 'excellent' | 'good' | 'fair',
    availabilityType: 'included' as 'included' | 'rental',
    sessionRate: 0,
    damageDeposit: 0,
    brand: '',
  });

  const selectedEquipmentCount = Object.keys(selectedEquipment).length;

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
      const data = await apiGet(`/manager/kitchens/${selectedKitchenId}/equipment-listings`);
      // Convert proper values to dollars for UI
      const mappedData = Array.isArray(data) ? data.map((item: any) => ({
        ...item,
        sessionRate: item.sessionRate ? item.sessionRate / 100 : 0,
        damageDeposit: item.damageDeposit ? item.damageDeposit / 100 : 0,
        hourlyRate: item.hourlyRate ? item.hourlyRate / 100 : 0,
      })) : [];
      setListings(mappedData);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to load equipment listings", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return EQUIPMENT_CATEGORIES;
    const query = searchQuery.toLowerCase();
    return EQUIPMENT_CATEGORIES.map(cat => ({
      ...cat,
      items: cat.items.filter(item => item.name.toLowerCase().includes(query) || cat.name.toLowerCase().includes(query))
    })).filter(cat => cat.items.length > 0);
  }, [searchQuery]);

  const totalFilteredItems = filteredCategories.reduce((sum, cat) => sum + cat.items.length, 0);
  const showNoResultsCustomOption = searchQuery.trim().length > 0 && totalFilteredItems === 0;

  const saveCustomEquipment = async () => {
    // Use searchQuery as fallback if customEquipment.name is empty (intuitive flow)
    const equipmentName = (customEquipment.name.trim() || searchQuery.trim());
    if (!selectedKitchenId || !equipmentName) {
      toast({ title: "Error", description: "Please enter an equipment name", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await apiPost('/manager/equipment-listings', {
        kitchenId: selectedKitchenId,
        category: customEquipment.category,
        equipmentType: equipmentName,
        brand: customEquipment.brand || undefined,
        condition: customEquipment.condition,
        availabilityType: customEquipment.availabilityType,
        sessionRate: customEquipment.availabilityType === 'rental' ? Math.round(customEquipment.sessionRate * 100) : 0,
        damageDeposit: customEquipment.availabilityType === 'rental' ? Math.round(customEquipment.damageDeposit * 100) : 0,
        currency: 'CAD',
        isActive: true,
      });
      toast({ title: "Equipment Added", description: `Successfully added "${equipmentName}"` });
      setCustomEquipment({ name: '', category: 'cooking', condition: 'good', availabilityType: 'included', sessionRate: 0, damageDeposit: 0, brand: '' });
      setSearchQuery('');
      setActiveTab('list');
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/equipment-listings`] });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to add equipment", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => prev.includes(categoryId) ? prev.filter(id => id !== categoryId) : [...prev, categoryId]);
  };

  const handleTemplateSelect = (template: EquipmentTemplate) => {
    setSelectedEquipment(prev => {
      const newState = { ...prev };
      if (newState[template.id]) {
        delete newState[template.id];
      } else {
        newState[template.id] = {
          templateId: template.id,
          name: template.name,
          category: template.category,
          condition: template.defaultCondition,
          availabilityType: 'included',
          sessionRate: template.suggestedSessionRate,
          damageDeposit: 0,
          description: '',
          brand: '',
        };
      }
      return newState;
    });
  };

  const updateSelectedEquipment = (templateId: string, updates: Partial<SelectedEquipment>) => {
    setSelectedEquipment(prev => {
      if (!prev[templateId]) return prev;
      return { ...prev, [templateId]: { ...prev[templateId], ...updates } };
    });
  };

  const saveSelectedEquipment = async () => {
    if (!selectedKitchenId || selectedEquipmentCount === 0) return;
    setIsSaving(true);
    let successCount = 0;
    for (const equipment of Object.values(selectedEquipment)) {
      try {
        await apiPost('/manager/equipment-listings', {
          kitchenId: selectedKitchenId,
          category: equipment.category,
          equipmentType: equipment.name,
          brand: equipment.brand || undefined,
          description: equipment.description || undefined,
          condition: equipment.condition,
          availabilityType: equipment.availabilityType,
          sessionRate: equipment.availabilityType === 'rental' ? Math.round(equipment.sessionRate * 100) : 0,
          damageDeposit: equipment.availabilityType === 'rental' ? Math.round(equipment.damageDeposit * 100) : 0,
          currency: 'CAD',
          isActive: true,
        });
        successCount++;
      } catch (error) {
        console.error('Error creating equipment listing:', error);
      }
    }
    setIsSaving(false);
    if (successCount > 0) {
      toast({ title: "Equipment Added", description: `Successfully added ${successCount} equipment listing${successCount > 1 ? 's' : ''}.` });
      setSelectedEquipment({});
      setActiveTab('list');
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/equipment-listings`] });
    } else {
      toast({ title: "Error", description: "Failed to add equipment listings.", variant: "destructive" });
    }
  };

  const handleEdit = (listing: EquipmentListing) => {
    setEditingListing(listing);
    setEditDialogOpen(true);
  };

  const saveEditedListing = async () => {
    if (!editingListing?.id) return;
    setIsSaving(true);
    try {
      await apiPut(`/manager/equipment-listings/${editingListing.id}`, {
        ...editingListing,
        sessionRate: editingListing.availabilityType === 'rental' ? Math.round((editingListing.sessionRate || 0) * 100) : 0,
        damageDeposit: editingListing.availabilityType === 'rental' ? Math.round((editingListing.damageDeposit || 0) * 100) : 0,
      });
      toast({ title: "Success", description: "Equipment listing updated successfully" });
      setEditDialogOpen(false);
      setEditingListing(null);
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/equipment-listings`] });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update listing", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await apiDelete(`/manager/equipment-listings/${pendingDeleteId}`);
      toast({ title: "Success", description: "Equipment listing deleted successfully" });
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
      await apiPut(`/manager/equipment-listings/${id}`, { isActive });
      queryClient.invalidateQueries({ queryKey: [`/api/manager/equipment-listings`] });
      loadListings();
      toast({ title: "Status Updated", description: `Equipment listing is now ${isActive ? 'active' : 'inactive'}` });
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
          <Wrench className="h-12 w-12 mb-4 opacity-20" />
          <h3 className="text-lg font-medium text-foreground mb-1">No Kitchen Selected</h3>
          <p>Select a location and kitchen from the sidebar to manage equipment.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'list' | 'add')}>
        <div className="flex items-center justify-between mb-4">
          <TabsList className="grid w-[300px] grid-cols-2">
            <TabsTrigger value="list" className="flex items-center gap-2"><Package className="h-4 w-4" />My Equipment</TabsTrigger>
            <TabsTrigger value="add" className="flex items-center gap-2"><Plus className="h-4 w-4" />Add Equipment</TabsTrigger>
          </TabsList>
          {selectedKitchen && <Badge variant="outline" className="text-sm">{selectedKitchen.name}</Badge>}
        </div>

        <TabsContent value="list" className="mt-0">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Equipment Inventory</CardTitle>
              <CardDescription>{listings.length} equipment listing{listings.length !== 1 ? 's' : ''} for this kitchen</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
              ) : listings.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p className="font-medium">No equipment listed yet</p>
                  <p className="text-sm mt-1">Click "Add Equipment" to get started</p>
                  <Button className="mt-4" onClick={() => setActiveTab('add')}><Plus className="h-4 w-4 mr-2" />Add Equipment</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {listings.map((listing) => (
                    <div key={listing.id} className={cn("flex items-center justify-between p-4 border rounded-lg transition-colors", listing.isActive === false && "bg-muted/50 opacity-75")}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium truncate">{listing.equipmentType}</h4>
                          {listing.brand && <span className="text-sm text-muted-foreground">({listing.brand})</span>}
                          <Badge variant={listing.isActive !== false ? "default" : "secondary"} className="text-xs">{listing.isActive !== false ? 'Active' : 'Inactive'}</Badge>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="capitalize">{listing.category.replace('-', ' ')}</span>
                          <span>•</span>
                          <span className="capitalize">{listing.condition}</span>
                          <span>•</span>
                          <span className={cn("font-medium", listing.availabilityType === 'included' ? "text-green-600" : "text-blue-600")}>
                            {listing.availabilityType === 'included' ? 'Included' : `$${(listing.sessionRate || 0).toFixed(2)}/session`}
                          </span>
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
            <Input placeholder="Search equipment..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2"><Grid3X3 className="h-5 w-5" />Select Equipment</CardTitle>
                  <CardDescription>Choose equipment from our pre-defined list</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px] pr-4">
                    <div className="space-y-2">
                      {filteredCategories.map((category) => (
                        <Collapsible key={category.id} open={expandedCategories.includes(category.id)} onOpenChange={() => toggleCategory(category.id)}>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" className="w-full justify-between p-3 h-auto font-medium hover:bg-muted/50">
                              <span className="flex items-center gap-2"><CategoryIcon iconName={category.iconName} className="h-4 w-4 text-muted-foreground" />{category.name}<Badge variant="secondary" className="ml-2">{category.items.length}</Badge></span>
                              {expandedCategories.includes(category.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="grid grid-cols-2 gap-2 p-2 pl-8">
                              {category.items.map((template) => {
                                const isSelected = !!selectedEquipment[template.id];
                                const isAlreadyListed = listings.some(l => l.equipmentType.toLowerCase() === template.name.toLowerCase());
                                return (
                                  <button key={template.id} onClick={() => !isAlreadyListed && handleTemplateSelect(template)} disabled={isAlreadyListed}
                                    className={cn("flex items-center gap-2 p-3 rounded-lg border text-left transition-all", isSelected && "border-primary bg-primary/5 ring-1 ring-primary", isAlreadyListed && "opacity-50 cursor-not-allowed bg-muted", !isSelected && !isAlreadyListed && "hover:border-primary/50 hover:bg-muted/50")}>
                                    <div className={cn("flex items-center justify-center w-5 h-5 rounded border", isSelected ? "bg-primary border-primary" : "border-muted-foreground/30")}>
                                      {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">{template.name}</p>
                                      {template.suggestedSessionRate > 0 && <p className="text-xs text-muted-foreground">~${template.suggestedSessionRate}/session</p>}
                                    </div>
                                    {isAlreadyListed && <Badge variant="secondary" className="text-xs">Listed</Badge>}
                                  </button>
                                );
                              })}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                      
                      {/* Intuitive custom equipment option when search has no results */}
                      {showNoResultsCustomOption && (
                        <Card className="border-dashed border-primary/50 bg-primary/5">
                          <CardContent className="p-6 text-center">
                            <SearchX className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
                            <h4 className="font-medium mb-1">No matching equipment found</h4>
                            <p className="text-sm text-muted-foreground mb-4">
                              Can't find "{searchQuery}"? Add it as custom equipment.
                            </p>
                            <div className="space-y-3 text-left">
                              <div>
                                <Label className="text-xs">Equipment Name</Label>
                                <Input 
                                  value={customEquipment.name || searchQuery} 
                                  onChange={(e) => setCustomEquipment(prev => ({ ...prev, name: e.target.value }))}
                                  placeholder="Equipment name"
                                  className="mt-1"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-xs">Category</Label>
                                  <Select value={customEquipment.category} onValueChange={(v: EquipmentCategoryId) => setCustomEquipment(prev => ({ ...prev, category: v }))}>
                                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="cooking">Cooking</SelectItem>
                                      <SelectItem value="food-prep">Prep</SelectItem>
                                      <SelectItem value="refrigeration">Refrigeration</SelectItem>
                                      <SelectItem value="specialty">Specialty</SelectItem>
                                      <SelectItem value="cleaning">Cleaning</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-xs">Condition</Label>
                                  <Select value={customEquipment.condition} onValueChange={(v: 'excellent' | 'good' | 'fair') => setCustomEquipment(prev => ({ ...prev, condition: v }))}>
                                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="excellent">Excellent</SelectItem>
                                      <SelectItem value="good">Good</SelectItem>
                                      <SelectItem value="fair">Fair</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-xs">Availability</Label>
                                  <Select value={customEquipment.availabilityType} onValueChange={(v: 'included' | 'rental') => setCustomEquipment(prev => ({ ...prev, availabilityType: v, sessionRate: v === 'included' ? 0 : prev.sessionRate }))}>
                                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="included">Included</SelectItem>
                                      <SelectItem value="rental">Rental</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                {customEquipment.availabilityType === 'rental' && (
                                  <div>
                                    <Label className="text-xs">Rate (CAD)</Label>
                                    <div className="relative mt-1">
                                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                      <Input 
                                        type="number" min="0" step="0.01"
                                        value={customEquipment.sessionRate} 
                                        onChange={(e) => setCustomEquipment(prev => ({ ...prev, sessionRate: parseFloat(e.target.value) || 0 }))}
                                        className="pl-5"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                              <Button 
                                className="w-full mt-2" 
                                onClick={() => {
                                  if (!customEquipment.name) setCustomEquipment(prev => ({ ...prev, name: searchQuery }));
                                  saveCustomEquipment();
                                }}
                                disabled={isSaving || (!customEquipment.name.trim() && !searchQuery.trim())}
                              >
                                {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding...</> : <><PlusCircle className="h-4 w-4 mr-2" />Add Custom Equipment</>}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-1">
              <Card className="sticky top-4">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center justify-between">
                    <span className="flex items-center gap-2"><DollarSign className="h-5 w-5" />Configure</span>
                    {selectedEquipmentCount > 0 && <Badge>{selectedEquipmentCount} selected</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedEquipmentCount === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Package className="h-10 w-10 mx-auto mb-3 opacity-20" />
                      <p className="text-sm">Select equipment from the list to configure pricing</p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px] pr-2">
                      <div className="space-y-4">
                        {Object.entries(selectedEquipment).map(([templateId, equipment]) => (
                          <div key={templateId} className="p-3 border rounded-lg space-y-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <Input value={equipment.name} onChange={(e) => updateSelectedEquipment(templateId, { name: e.target.value })} className="font-medium h-8 px-2 -ml-2 border-transparent hover:border-input focus:border-input" />
                                <p className="text-xs text-muted-foreground capitalize mt-1">{equipment.category.replace('-', ' ')}</p>
                              </div>
                              <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1 -mt-1" onClick={() => handleTemplateSelect({ id: templateId } as EquipmentTemplate)}><X className="h-3 w-3" /></Button>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-20">Type</Label>
                                <Select value={equipment.availabilityType} onValueChange={(v: 'included' | 'rental') => updateSelectedEquipment(templateId, { availabilityType: v, sessionRate: v === 'included' ? 0 : equipment.sessionRate })}>
                                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent><SelectItem value="included">Included (Free)</SelectItem><SelectItem value="rental">Rental (Paid)</SelectItem></SelectContent>
                                </Select>
                              </div>
                              {equipment.availabilityType === 'rental' && (
                                <div className="flex items-center gap-2">
                                  <Label className="text-xs w-20">Rate</Label>
                                  <div className="relative flex-1">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                    <Input type="number" min="0" step="0.01" value={equipment.sessionRate} onChange={(e) => updateSelectedEquipment(templateId, { sessionRate: parseFloat(e.target.value) || 0 })} className="h-8 text-xs pl-5" />
                                  </div>
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-20">Condition</Label>
                                <Select value={equipment.condition} onValueChange={(v: EquipmentListing['condition']) => updateSelectedEquipment(templateId, { condition: v })}>
                                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent><SelectItem value="excellent">Excellent</SelectItem><SelectItem value="good">Good</SelectItem><SelectItem value="fair">Fair</SelectItem></SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-20">Brand</Label>
                                <Input value={equipment.brand} onChange={(e) => updateSelectedEquipment(templateId, { brand: e.target.value })} placeholder="Optional" className="h-8 text-xs" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                  {selectedEquipmentCount > 0 && (
                    <Button className="w-full mt-4" onClick={saveSelectedEquipment} disabled={isSaving}>
                      {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding...</> : <><Save className="h-4 w-4 mr-2" />Add {selectedEquipmentCount} Equipment</>}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Sheet open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
          <SheetHeader className="p-6 pb-4 border-b">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#FFE8DD] to-[#FFD4C4] flex items-center justify-center">
                <Wrench className="w-5 h-5 text-[#F51042]" />
              </div>
              <div>
                <SheetTitle className="text-lg">Edit Equipment</SheetTitle>
                <SheetDescription>Update the details for this equipment listing</SheetDescription>
              </div>
            </div>
          </SheetHeader>
          
          {editingListing && (
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Equipment Name</Label>
                <div className="relative">
                  <Wrench className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input 
                    value={editingListing.equipmentType} 
                    onChange={(e) => setEditingListing({ ...editingListing, equipmentType: e.target.value })}
                    className="pl-10"
                    placeholder="Equipment name"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Brand</Label>
                  <div className="relative">
                    <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input 
                      value={editingListing.brand || ''} 
                      onChange={(e) => setEditingListing({ ...editingListing, brand: e.target.value })}
                      className="pl-10"
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Condition</Label>
                  <Select value={editingListing.condition} onValueChange={(v: EquipmentListing['condition']) => setEditingListing({ ...editingListing, condition: v })}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="excellent">Excellent</SelectItem>
                      <SelectItem value="good">Good</SelectItem>
                      <SelectItem value="fair">Fair</SelectItem>
                      <SelectItem value="needs-repair">Needs Repair</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-sm font-medium">Availability Type</Label>
                <Select value={editingListing.availabilityType} onValueChange={(v: 'included' | 'rental') => setEditingListing({ ...editingListing, availabilityType: v, sessionRate: v === 'included' ? 0 : editingListing.sessionRate })}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="included">Included (Free with kitchen)</SelectItem>
                    <SelectItem value="rental">Rental (Paid addon)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {editingListing.availabilityType === 'rental' && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Session Rate (CAD)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input 
                      type="number" 
                      min="0" 
                      step="0.01" 
                      value={editingListing.sessionRate || ''} 
                      onChange={(e) => setEditingListing({ ...editingListing, sessionRate: parseFloat(e.target.value) || 0 })}
                      className="pl-10"
                    />
                  </div>
                </div>
              )}
              
              <div className="space-y-2">
                <Label className="text-sm font-medium">Description</Label>
                <Textarea 
                  value={editingListing.description || ''} 
                  onChange={(e) => setEditingListing({ ...editingListing, description: e.target.value })}
                  placeholder="Optional description..."
                  rows={3}
                  className="min-h-[80px] resize-none"
                />
              </div>
            </div>
          )}
          
          <SheetFooter className="p-6 pt-4 border-t gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={saveEditedListing} 
              disabled={isSaving}
              className="bg-[#F51042] hover:bg-[#d10e3a] text-white gap-2"
            >
              {isSaving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving...</> : <><Check className="h-4 w-4" />Save Changes</>}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Equipment Listing?</DialogTitle><DialogDescription>This action cannot be undone. The equipment listing will be permanently removed.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button><Button variant="destructive" onClick={handleDelete}>Delete</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={toggleDialogOpen} onOpenChange={setToggleDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Deactivate Equipment Listing?</DialogTitle><DialogDescription>This equipment will no longer be available for booking. You can reactivate it at any time.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setToggleDialogOpen(false); setPendingToggle(null); }} disabled={isToggling}>Cancel</Button>
            <Button variant="destructive" onClick={() => pendingToggle && doToggleActive(pendingToggle.id, pendingToggle.isActive)} disabled={isToggling}>
              {isToggling ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deactivating...</> : 'Deactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}