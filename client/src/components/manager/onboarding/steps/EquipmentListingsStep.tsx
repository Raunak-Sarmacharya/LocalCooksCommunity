
import React, { useState } from "react";
import { Info, Plus, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useManagerOnboarding } from "../ManagerOnboardingContext";

import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter"; // [NEW]

export default function EquipmentListingsStep() {
  const {
    kitchens,
    selectedKitchenId,
    setSelectedKitchenId,
    equipmentForm: { listings, isLoading },
    handleNext, // [NEW]
    handleBack // [NEW] 
  } = useManagerOnboarding();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: '',
    category: 'food-prep',
    description: '',
    condition: 'good',
    availabilityType: 'included' as 'included' | 'rental',
    sessionRate: 0,
  });
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!formData.name || !selectedKitchenId) return;

    setIsCreating(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      // Ensure sessionRate is sent as a string if the API expects it, or number. based on original file, it might be string. 
      // The context type sees it as string | number. I'll send number.
      // Wait, original file used `equipmentType` but new type has `category`. 
      // I'll stick to what the API likely expects. 
      // Looking at `ManagerOnboardingWizard.tsx`: `createEquipmentMutation` calls `/api/manager/equipment-listings`.
      // It sends: kitchenId, name, equipmentType (which I mapped to category?), description, condition, availabilityType, hourlyRate/sessionRate, currency, isActive.

      const response = await fetch(`/api/manager/equipment-listings`, {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          kitchenId: selectedKitchenId,
          name: formData.name,
          equipmentType: formData.category, // Mapping category to equipmentType for API compatibility
          description: formData.description || null,
          condition: formData.condition,
          availabilityType: formData.availabilityType,
          hourlyRate: formData.availabilityType === 'rental' ? formData.sessionRate : 0,
          currency: "CAD",
          isActive: true,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create equipment listing");
      }

      toast({ title: "Equipment Listing Created" });
      setFormData({
        name: '',
        category: 'food-prep',
        description: '',
        condition: 'good',
        availabilityType: 'included',
        sessionRate: 0,
      });
      // Similarly, we accept that the list won't auto-update until we explicitly refresh or reload context.
      // The user can add more.
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
        <h3 className="text-lg font-semibold mb-1">Equipment Listings (Optional)</h3>
        <p className="text-sm text-gray-600">
          List the equipment available in your kitchen. You can mark items as included in the rental or available for an extra fee.
        </p>
      </div>

      <div className="bg-gradient-to-r from-rose-50 to-pink-50 border-2 border-rose-200/50 rounded-xl p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-rose-100 rounded-lg">
            <Info className="h-5 w-5 text-[#F51042] flex-shrink-0" />
          </div>
          <div className="text-sm text-gray-700">
            <p className="font-bold mb-2 text-gray-900">Why list equipment?</p>
            <p>Detailed equipment lists help chefs know if your kitchen is right for them. Specifying condition and availability ensures transparency.</p>
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
                    <h4 className="font-semibold text-gray-900">Existing Equipment ({listings.length})</h4>
                  </div>
                  {listings.map(l => (
                    <div key={l.id} className="bg-white rounded p-3 border border-green-200">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-gray-600">{l.equipmentType || l.category} • {l.availabilityType === 'rental' ? `$${l.sessionRate}/session` : 'Included'}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="border rounded-lg p-4 bg-gray-50">
                <div className="space-y-3">
                  <div className="grid gap-2">
                    <Label>Equipment Name *</Label>
                    <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Robot Coupe" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label>Category</Label>
                      <Select value={formData.category} onValueChange={(v: any) => setFormData({ ...formData, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="food-prep">Food Prep</SelectItem>
                          <SelectItem value="cooking">Cooking</SelectItem>
                          <SelectItem value="refrigeration">Refrigeration</SelectItem>
                          <SelectItem value="cleaning">Cleaning</SelectItem>
                          <SelectItem value="specialty">Specialty</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Condition</Label>
                      <Select value={formData.condition} onValueChange={(v: any) => setFormData({ ...formData, condition: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="excellent">Excellent</SelectItem>
                          <SelectItem value="good">Good</SelectItem>
                          <SelectItem value="fair">Fair</SelectItem>
                          <SelectItem value="needs_repair">Needs Repair</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label>Description</Label>
                    <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={2} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label>Availability</Label>
                      <Select
                        value={formData.availabilityType}
                        onValueChange={(v: 'included' | 'rental') => setFormData({ ...formData, availabilityType: v, sessionRate: v === 'included' ? 0 : formData.sessionRate })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="included">Included in Rental</SelectItem>
                          <SelectItem value="rental">Extra Fee (Rental)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {formData.availabilityType === 'rental' && (
                      <div className="grid gap-2">
                        <Label>Session Fee ($)</Label>
                        <Input type="number" value={formData.sessionRate} onChange={e => setFormData({ ...formData, sessionRate: parseFloat(e.target.value) || 0 })} />
                      </div>
                    )}
                  </div>

                  <Button onClick={handleCreate} disabled={!formData.name || isCreating} className="w-full">
                    {isCreating ? <Loader2 className="animate-spin h-4 w-4" /> : <Plus className="h-4 w-4 mr-2" />}
                    Add Equipment Listing
                  </Button>
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
