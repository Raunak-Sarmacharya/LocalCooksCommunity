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
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";

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

  const [formData, setFormData] = useState({
    storageType: 'dry' as 'dry' | 'cold' | 'freezer',
    name: '',
    description: '',
    basePrice: 0,
    minimumBookingDuration: 1,
  });
  const [isCreating, setIsCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = async () => {
    if (!formData.name || !selectedKitchenId) return;

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
          name: formData.name,
          storageType: formData.storageType,
          description: formData.description || null,
          basePrice: Math.round(formData.basePrice * 100),
          pricingModel: 'daily',
          minimumBookingDuration: formData.minimumBookingDuration,
          bookingDurationUnit: 'daily',
          photos: [],
          currency: "CAD",
          isActive: true,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create storage listing");
      }

      toast({ title: "Storage Listing Created" });
      setShowCreate(false);
      setFormData({
        storageType: 'dry',
        name: '',
        description: '',
        basePrice: 0,
        minimumBookingDuration: 1,
      });
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
                      <p className="text-xs text-gray-600">{l.storageType} • ${(Number(l.basePrice || 0) / 100).toFixed(2)}/day</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="border rounded-lg p-4 bg-gray-50">
                <div className="space-y-3">
                  <div className="grid gap-2">
                    <Label>Storage Type</Label>
                    <Select value={formData.storageType} onValueChange={(v: any) => setFormData({ ...formData, storageType: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dry">Dry Storage</SelectItem>
                        <SelectItem value="cold">Cold Storage</SelectItem>
                        <SelectItem value="freezer">Freezer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label>Name *</Label>
                    <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Main Dry Storage" />
                  </div>

                  <div className="grid gap-2">
                    <Label>Description</Label>
                    <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={2} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label>Daily Rate ($) *</Label>
                      <Input type="number" value={formData.basePrice} onChange={e => setFormData({ ...formData, basePrice: parseFloat(e.target.value) || 0 })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Min Days *</Label>
                      <Input type="number" value={formData.minimumBookingDuration} onChange={e => setFormData({ ...formData, minimumBookingDuration: parseInt(e.target.value) || 1 })} />
                    </div>
                  </div>

                  <Button onClick={handleCreate} disabled={!formData.name || isCreating} className="w-full">
                    {isCreating ? <Loader2 className="animate-spin h-4 w-4" /> : <Plus className="h-4 w-4 mr-2" />}
                    Add Storage Listing
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
        isNextDisabled={kitchens.length === 0}
      />
    </div>
  );
}
