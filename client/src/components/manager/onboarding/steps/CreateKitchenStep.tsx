
import React from "react";
import { Plus, Loader2, Settings, HelpCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useManagerOnboarding } from "../ManagerOnboardingContext";

export default function CreateKitchenStep() {
  const { 
    hasExistingLocation, 
    locations, 
    selectedLocation,
    selectedLocationId, 
    setSelectedLocationId,
    kitchens,
    kitchenForm,
    createKitchen
  } = useManagerOnboarding();

  const { data, setData, showCreate, setShowCreate, isCreating } = kitchenForm;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
        <h3 className="text-lg font-semibold mb-1">
          {hasExistingLocation
            ? selectedLocation
              ? `Create Kitchen for ${selectedLocation.name}`
              : "Create Kitchen"
            : "Create Your First Kitchen"}
        </h3>
        <p className="text-sm text-gray-600">
          A kitchen is a specific space within your location where chefs can book time. You can add more kitchens later.
        </p>
      </div>

      {hasExistingLocation && locations.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor="location-select">Select Location</Label>
          <Select
            value={selectedLocationId?.toString() || ""}
            onValueChange={(value) => setSelectedLocationId(parseInt(value))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id.toString()}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="bg-gradient-to-r from-rose-50 to-pink-50 border-2 border-rose-200/50 rounded-xl p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-rose-100 rounded-lg">
            <HelpCircle className="h-5 w-5 text-[#F51042] flex-shrink-0" />
          </div>
          <div className="text-sm text-gray-700">
            <p className="font-bold mb-2 text-gray-900">How do Kitchens work?</p>
            <p>Each kitchen space can have its own storage and equipment listings. If you have multiple kitchen spaces at your location, create separate kitchens for each one.</p>
          </div>
        </div>
      </div>

      {kitchens.length > 0 ? (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-800">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Kitchen Created!</span>
            </div>
            <p className="text-sm text-green-700 mt-1">
              You have {kitchens.length} kitchen{kitchens.length > 1 ? 's' : ''} set up.
            </p>
          </div>
          {!showCreate && (
             <Button variant="outline" onClick={() => setShowCreate(true)} className="w-full">
               <Plus className="h-4 w-4 mr-2" /> Add Another Kitchen
             </Button>
          )}
        </div>
      ) : (
        !showCreate && (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <Settings className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-900 mb-1">No kitchen created yet</p>
            <Button onClick={() => setShowCreate(true)} className="w-full mt-4">
              <Plus className="h-4 w-4 mr-2" /> Create Your First Kitchen
            </Button>
          </div>
        )
      )}

      {showCreate && (
        <div className="border rounded-lg p-4 bg-gray-50 animate-in fade-in zoom-in-95 duration-200">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">Create Kitchen</h4>
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="kitchen-name">Kitchen Name <span className="text-red-500">*</span></Label>
              <Input
                id="kitchen-name"
                value={data.name}
                onChange={(e) => setData({ ...data, name: e.target.value })}
                placeholder="e.g., Main Kitchen"
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="kitchen-description">Description</Label>
              <Textarea
                id="kitchen-description"
                value={data.description}
                onChange={(e) => setData({ ...data, description: e.target.value })}
                placeholder="Describe your kitchen..."
                rows={3}
              />
            </div>

            <div className="border-t pt-3 mt-3">
              <h5 className="text-sm font-semibold text-gray-900 mb-3">Pricing Information</h5>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Hourly Rate *</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={data.hourlyRate}
                      onChange={(e) => setData({ ...data, hourlyRate: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Currency</Label>
                  <Select
                    value={data.currency}
                    onValueChange={(val) => setData({ ...data, currency: val })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CAD">CAD ($)</SelectItem>
                      <SelectItem value="USD">USD ($)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="grid gap-2 mt-3">
                <Label>Minimum Booking Hours</Label>
                <Input
                  type="number"
                  min="1"
                  value={data.minimumBookingHours}
                  onChange={(e) => setData({ ...data, minimumBookingHours: e.target.value })}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={() => createKitchen()} disabled={isCreating} className="flex-1">
                {isCreating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                {isCreating ? "Creating..." : "Create Kitchen"}
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)} disabled={isCreating}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
