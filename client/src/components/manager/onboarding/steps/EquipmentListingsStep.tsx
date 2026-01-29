/**
 * Equipment Listings Step - Onboarding
 * 
 * Streamlined equipment selection using pre-defined templates.
 * Allows managers to quickly add common commercial kitchen equipment.
 */

import React, { useState, useMemo } from "react";
import { Info, Plus, CheckCircle, Loader2, Search, Check, ChevronDown, ChevronUp, X, DollarSign, Package, Flame, ChefHat, Snowflake, Sparkles, SprayCan, PlusCircle, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
import { EQUIPMENT_CATEGORIES, type EquipmentTemplate, type EquipmentCategoryId } from "@/lib/equipment-templates";

// Icon component mapping for categories (enterprise pattern - no emojis)
const CategoryIcon = ({ iconName, className }: { iconName: string; className?: string }) => {
  const icons: Record<string, React.ComponentType<{ className?: string }>> = {
    Flame, ChefHat, Snowflake, Sparkles, SprayCan
  };
  const Icon = icons[iconName] || Package;
  return <Icon className={className} />;
};

interface SelectedEquipment {
  templateId: string;
  name: string;
  category: string;
  condition: 'excellent' | 'good' | 'fair';
  availabilityType: 'included' | 'rental';
  sessionRate: number;
  damageDeposit: number;
  description: string;
  brand: string;
}

export default function EquipmentListingsStep() {
  const {
    kitchens,
    selectedKitchenId,
    setSelectedKitchenId,
    equipmentForm: { listings, isLoading },
    handleNext,
    handleBack 
  } = useManagerOnboarding();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['cooking', 'food-prep']);
  const [selectedEquipment, setSelectedEquipment] = useState<Record<string, SelectedEquipment>>({});
  const [isCreating, setIsCreating] = useState(false);
  
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

  // Filter templates based on search
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return EQUIPMENT_CATEGORIES;
    
    const query = searchQuery.toLowerCase();
    return EQUIPMENT_CATEGORIES.map(cat => ({
      ...cat,
      items: cat.items.filter(item => 
        item.name.toLowerCase().includes(query) ||
        cat.name.toLowerCase().includes(query)
      )
    })).filter(cat => cat.items.length > 0);
  }, [searchQuery]);

  // Computed: total filtered items for intuitive custom equipment flow
  const totalFilteredItems = filteredCategories.reduce((sum, cat) => sum + cat.items.length, 0);
  const showNoResultsCustomOption = searchQuery.trim().length > 0 && totalFilteredItems === 0;

  // Toggle category expansion
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => 
      prev.includes(categoryId) 
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  // Handle equipment template selection
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
          availabilityType: template.suggestedSessionRate > 0 ? 'rental' : 'included',
          sessionRate: template.suggestedSessionRate,
          damageDeposit: 0,
          description: '',
          brand: '',
        };
      }
      return newState;
    });
  };

  // Update selected equipment details
  const updateSelectedEquipment = (templateId: string, updates: Partial<SelectedEquipment>) => {
    setSelectedEquipment(prev => {
      if (!prev[templateId]) return prev;
      return {
        ...prev,
        [templateId]: { ...prev[templateId], ...updates }
      };
    });
  };

  // Save all selected equipment
  const handleCreate = async () => {
    if (!selectedKitchenId || selectedEquipmentCount === 0) return;

    setIsCreating(true);
    let successCount = 0;
    let errorCount = 0;

    const equipmentList = Object.values(selectedEquipment);
    
    for (const equipment of equipmentList) {
      try {
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch(`/api/manager/equipment-listings`, {
          method: "POST",
          headers: {
            'Authorization': `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            kitchenId: selectedKitchenId,
            category: equipment.category,
            equipmentType: equipment.name,
            brand: equipment.brand || undefined,
            description: equipment.description || undefined,
            condition: equipment.condition,
            availabilityType: equipment.availabilityType,
            sessionRate: equipment.availabilityType === 'rental' ? Math.round(equipment.sessionRate * 100) : 0,
            damageDeposit: equipment.availabilityType === 'rental' ? Math.round(equipment.damageDeposit * 100) : 0,
            currency: "CAD",
            isActive: true,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to create equipment listing");
        }
        successCount++;
      } catch (error) {
        console.error('Error creating equipment listing:', error);
        errorCount++;
      }
    }

    setIsCreating(false);

    if (successCount > 0) {
      toast({
        title: "Equipment Added",
        description: `Successfully added ${successCount} equipment listing${successCount > 1 ? 's' : ''}.${errorCount > 0 ? ` ${errorCount} failed.` : ''}`,
      });
      setSelectedEquipment({});
    } else {
      toast({
        title: "Error",
        description: "Failed to add equipment listings. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Save custom equipment (for intuitive "not found" flow)
  const saveCustomEquipment = async () => {
    // Use searchQuery as fallback if customEquipment.name is empty (intuitive flow)
    const equipmentName = (customEquipment.name.trim() || searchQuery.trim());
    if (!selectedKitchenId || !equipmentName) {
      toast({ title: "Error", description: "Please enter an equipment name", variant: "destructive" });
      return;
    }
    setIsCreating(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/manager/equipment-listings`, {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          kitchenId: selectedKitchenId,
          category: customEquipment.category,
          equipmentType: equipmentName,
          brand: customEquipment.brand || undefined,
          condition: customEquipment.condition,
          availabilityType: customEquipment.availabilityType,
          sessionRate: customEquipment.availabilityType === 'rental' ? Math.round(customEquipment.sessionRate * 100) : 0,
          damageDeposit: customEquipment.availabilityType === 'rental' ? Math.round(customEquipment.damageDeposit * 100) : 0,
          currency: "CAD",
          isActive: true,
        }),
      });
      if (!response.ok) throw new Error("Failed to create equipment listing");
      toast({ title: "Equipment Added", description: `Successfully added "${equipmentName}"` });
      setCustomEquipment({ name: '', category: 'cooking', condition: 'good', availabilityType: 'included', sessionRate: 0, damageDeposit: 0, brand: '' });
      setSearchQuery('');
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to add equipment", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
        <h3 className="text-lg font-semibold mb-1">Equipment Listings (Optional)</h3>
        <p className="text-sm text-gray-600">
          Select equipment available in your kitchen. You can mark items as included or available for an extra fee.
        </p>
      </div>

      <div className="bg-gradient-to-r from-rose-50 to-pink-50 border-2 border-rose-200/50 rounded-xl p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-rose-100 rounded-lg">
            <Info className="h-5 w-5 text-[#F51042] flex-shrink-0" />
          </div>
          <div className="text-sm text-gray-700">
            <p className="font-bold mb-2 text-gray-900">Why list equipment?</p>
            <p>Detailed equipment lists help chefs know if your kitchen is right for them. Select from common commercial kitchen equipment below.</p>
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
              {/* Existing Equipment */}
              {isLoading ? (
                <div className="flex justify-center p-4"><Loader2 className="animate-spin text-gray-400" /></div>
              ) : listings.length > 0 && (
                <div className="border rounded-lg p-4 bg-green-50 border-green-200 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <h4 className="font-semibold text-gray-900">Existing Equipment ({listings.length})</h4>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {listings.map(l => (
                      <div key={l.id} className="bg-white rounded p-2 border border-green-200 text-sm">
                        <p className="font-medium truncate">{l.name}</p>
                        <p className="text-xs text-gray-600">
                          {l.availabilityType === 'rental' ? `$${Number(l.sessionRate).toFixed(2)}/session` : 'Included'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search equipment..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* Equipment Selection */}
                <div className="lg:col-span-3">
                  <div className="border rounded-lg bg-gray-50">
                    <ScrollArea className="h-[350px]">
                      <div className="p-2 space-y-1">
                        {filteredCategories.map((category) => (
                          <Collapsible
                            key={category.id}
                            open={expandedCategories.includes(category.id)}
                            onOpenChange={() => toggleCategory(category.id)}
                          >
                            <CollapsibleTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-between p-2 h-auto font-medium hover:bg-white"
                              >
                                <span className="flex items-center gap-2 text-sm">
                                  <CategoryIcon iconName={category.iconName} className="h-4 w-4 text-muted-foreground" />
                                  {category.name}
                                  <Badge variant="secondary" className="text-xs">
                                    {category.items.length}
                                  </Badge>
                                </span>
                                {expandedCategories.includes(category.id) ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="grid grid-cols-2 gap-1.5 p-1.5 pl-6">
                                {category.items.map((template) => {
                                  const isSelected = !!selectedEquipment[template.id];
                                  const isAlreadyListed = listings.some(
                                    l => l.name?.toLowerCase() === template.name.toLowerCase()
                                  );
                                  
                                  return (
                                    <button
                                      key={template.id}
                                      onClick={() => !isAlreadyListed && handleTemplateSelect(template)}
                                      disabled={isAlreadyListed}
                                      className={cn(
                                        "flex items-center gap-2 p-2 rounded-md border text-left transition-all text-xs",
                                        isSelected && "border-primary bg-primary/5 ring-1 ring-primary",
                                        isAlreadyListed && "opacity-50 cursor-not-allowed bg-gray-100",
                                        !isSelected && !isAlreadyListed && "bg-white hover:border-primary/50"
                                      )}
                                    >
                                      <div className={cn(
                                        "flex items-center justify-center w-4 h-4 rounded border flex-shrink-0",
                                        isSelected ? "bg-primary border-primary" : "border-gray-300"
                                      )}>
                                        {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                                      </div>
                                      <span className="truncate">{template.name}</span>
                                      {isAlreadyListed && (
                                        <Badge variant="secondary" className="text-[10px] ml-auto">Listed</Badge>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        ))}
                        
                        {/* Intuitive custom equipment option when search has no results */}
                        {showNoResultsCustomOption && (
                          <div className="border-2 border-dashed border-primary/50 bg-primary/5 rounded-lg p-4 text-center">
                            <SearchX className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                            <h4 className="font-medium text-sm mb-1">No matching equipment</h4>
                            <p className="text-xs text-muted-foreground mb-3">
                              Can't find "{searchQuery}"? Add it as custom equipment.
                            </p>
                            <div className="space-y-2 text-left">
                              <Input 
                                value={customEquipment.name || searchQuery} 
                                onChange={(e) => setCustomEquipment(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Equipment name"
                                className="h-8 text-xs"
                              />
                              <Input 
                                value={customEquipment.brand} 
                                onChange={(e) => setCustomEquipment(prev => ({ ...prev, brand: e.target.value }))}
                                placeholder="Brand (optional)"
                                className="h-8 text-xs"
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <Select value={customEquipment.category} onValueChange={(v: EquipmentCategoryId) => setCustomEquipment(prev => ({ ...prev, category: v }))}>
                                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="cooking">Cooking</SelectItem>
                                    <SelectItem value="food-prep">Prep</SelectItem>
                                    <SelectItem value="refrigeration">Refrigeration</SelectItem>
                                    <SelectItem value="specialty">Specialty</SelectItem>
                                    <SelectItem value="cleaning">Cleaning</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Select value={customEquipment.availabilityType} onValueChange={(v: 'included' | 'rental') => setCustomEquipment(prev => ({ ...prev, availabilityType: v, sessionRate: v === 'included' ? 0 : prev.sessionRate, damageDeposit: v === 'included' ? 0 : prev.damageDeposit }))}>
                                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="included">Included</SelectItem>
                                    <SelectItem value="rental">Rental</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              {customEquipment.availabilityType === 'rental' && (
                                <>
                                  <div className="relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                    <Input 
                                      type="number" min="0" step="0.01"
                                      value={customEquipment.sessionRate} 
                                      onChange={(e) => setCustomEquipment(prev => ({ ...prev, sessionRate: parseFloat(e.target.value) || 0 }))}
                                      className="h-8 text-xs pl-5"
                                      placeholder="Rate per session"
                                    />
                                  </div>
                                  <div className="relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                    <Input 
                                      type="number" min="0" step="0.01"
                                      value={customEquipment.damageDeposit} 
                                      onChange={(e) => setCustomEquipment(prev => ({ ...prev, damageDeposit: parseFloat(e.target.value) || 0 }))}
                                      className="h-8 text-xs pl-5"
                                      placeholder="Damage deposit (optional)"
                                    />
                                  </div>
                                </>
                              )}
                              <Button 
                                size="sm"
                                className="w-full h-8 text-xs" 
                                onClick={() => {
                                  if (!customEquipment.name) setCustomEquipment(prev => ({ ...prev, name: searchQuery }));
                                  saveCustomEquipment();
                                }}
                                disabled={isCreating || (!customEquipment.name.trim() && !searchQuery.trim())}
                              >
                                {isCreating ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Adding...</> : <><PlusCircle className="h-3 w-3 mr-1" />Add Custom</>}
                              </Button>
                            </div>
                          </div>
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
                      {selectedEquipmentCount > 0 && (
                        <Badge variant="default" className="text-xs">{selectedEquipmentCount}</Badge>
                      )}
                    </div>

                    {selectedEquipmentCount === 0 ? (
                      <div className="text-center py-6 text-muted-foreground">
                        <Package className="h-8 w-8 mx-auto mb-2 opacity-20" />
                        <p className="text-xs">Select equipment to configure</p>
                      </div>
                    ) : (
                      <ScrollArea className="h-[350px]">
                        <div className="space-y-3 pr-2">
                          {Object.entries(selectedEquipment).map(([templateId, equipment]) => (
                            <div key={templateId} className="p-3 border rounded-lg space-y-3 bg-gray-50">
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <Input 
                                    value={equipment.name} 
                                    onChange={(e) => updateSelectedEquipment(templateId, { name: e.target.value })} 
                                    className="font-medium h-7 text-xs px-2 border-transparent hover:border-input focus:border-input bg-transparent" 
                                  />
                                  <p className="text-[10px] text-muted-foreground capitalize mt-0.5 px-2">{equipment.category.replace('-', ' ')}</p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 -mr-1 -mt-1"
                                  onClick={() => handleTemplateSelect({ id: templateId } as EquipmentTemplate)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <Label className="text-[10px] w-16 text-muted-foreground">Condition</Label>
                                  <Select
                                    value={equipment.condition}
                                    onValueChange={(v: 'excellent' | 'good' | 'fair') => 
                                      updateSelectedEquipment(templateId, { condition: v })
                                    }
                                  >
                                    <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="excellent">Excellent</SelectItem>
                                      <SelectItem value="good">Good</SelectItem>
                                      <SelectItem value="fair">Fair</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Label className="text-[10px] w-16 text-muted-foreground">Brand</Label>
                                  <Input
                                    value={equipment.brand}
                                    onChange={(e) => updateSelectedEquipment(templateId, { brand: e.target.value })}
                                    placeholder="Optional"
                                    className="h-7 text-xs flex-1"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <Label className="text-[10px] w-16 text-muted-foreground">Type</Label>
                                  <Select
                                    value={equipment.availabilityType}
                                    onValueChange={(v: 'included' | 'rental') => 
                                      updateSelectedEquipment(templateId, { 
                                        availabilityType: v,
                                        sessionRate: v === 'included' ? 0 : equipment.sessionRate,
                                        damageDeposit: v === 'included' ? 0 : equipment.damageDeposit
                                      })
                                    }
                                  >
                                    <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="included">Included (Free)</SelectItem>
                                      <SelectItem value="rental">Rental (Paid)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                {equipment.availabilityType === 'rental' && (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <Label className="text-[10px] w-16 text-muted-foreground">Rate</Label>
                                      <div className="relative flex-1">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                        <Input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          value={equipment.sessionRate}
                                          onChange={(e) => updateSelectedEquipment(templateId, { 
                                            sessionRate: parseFloat(e.target.value) || 0 
                                          })}
                                          className="h-7 text-xs pl-5"
                                        />
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Label className="text-[10px] w-16 text-muted-foreground">Deposit</Label>
                                      <div className="relative flex-1">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                        <Input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          value={equipment.damageDeposit}
                                          onChange={(e) => updateSelectedEquipment(templateId, { 
                                            damageDeposit: parseFloat(e.target.value) || 0 
                                          })}
                                          className="h-7 text-xs pl-5"
                                          placeholder="0.00"
                                        />
                                      </div>
                                    </div>
                                  </>
                                )}
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground">Description</Label>
                                  <Input
                                    value={equipment.description}
                                    onChange={(e) => updateSelectedEquipment(templateId, { description: e.target.value })}
                                    placeholder="Optional description"
                                    className="h-7 text-xs"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}

                    {selectedEquipmentCount > 0 && (
                      <Button 
                        className="w-full mt-3" 
                        size="sm"
                        onClick={handleCreate}
                        disabled={isCreating}
                      >
                        {isCreating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Plus className="h-4 w-4 mr-1" />
                            Add {selectedEquipmentCount} Equipment
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
      />
    </div>
  );
}
