/**
 * Equipment Listings Step - Onboarding
 * 
 * Streamlined equipment selection using pre-defined templates.
 * Allows managers to quickly add common commercial kitchen equipment.
 */

import React, { useState, useMemo } from "react";
import { Info, Plus, CheckCircle, Loader2, Search, Check, ChevronDown, ChevronUp, X, DollarSign, Package } from "lucide-react";
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
import { EQUIPMENT_CATEGORIES, type EquipmentTemplate } from "@/lib/equipment-templates";

interface SelectedEquipment {
  templateId: string;
  name: string;
  category: string;
  condition: 'excellent' | 'good' | 'fair';
  availabilityType: 'included' | 'rental';
  sessionRate: number;
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
            condition: equipment.condition,
            availabilityType: equipment.availabilityType,
            sessionRate: equipment.availabilityType === 'rental' ? Math.round(equipment.sessionRate * 100) : 0,
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
                          {l.availabilityType === 'rental' ? `$${(Number(l.sessionRate) / 100).toFixed(2)}/session` : 'Included'}
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
                                  <span>{category.icon}</span>
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
                      <ScrollArea className="h-[250px]">
                        <div className="space-y-2 pr-2">
                          {Object.entries(selectedEquipment).map(([templateId, equipment]) => (
                            <div key={templateId} className="p-2 border rounded-md space-y-2 bg-gray-50">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium truncate flex-1">{equipment.name}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5"
                                  onClick={() => handleTemplateSelect({ id: templateId } as EquipmentTemplate)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="flex gap-2">
                                <Select
                                  value={equipment.availabilityType}
                                  onValueChange={(v: 'included' | 'rental') => 
                                    updateSelectedEquipment(templateId, { 
                                      availabilityType: v,
                                      sessionRate: v === 'included' ? 0 : equipment.sessionRate
                                    })
                                  }
                                >
                                  <SelectTrigger className="h-7 text-xs flex-1">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="included">Included</SelectItem>
                                    <SelectItem value="rental">Rental</SelectItem>
                                  </SelectContent>
                                </Select>
                                {equipment.availabilityType === 'rental' && (
                                  <div className="relative w-20">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                    <Input
                                      type="number"
                                      min="0"
                                      value={equipment.sessionRate}
                                      onChange={(e) => updateSelectedEquipment(templateId, { 
                                        sessionRate: parseFloat(e.target.value) || 0 
                                      })}
                                      className="h-7 text-xs pl-5"
                                    />
                                  </div>
                                )}
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
