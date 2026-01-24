
import React from "react";
import { HelpCircle, FileText, CheckCircle, Upload, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useManagerOnboarding } from "../ManagerOnboardingContext";

export default function LocationStep() {
  const { 
    locationForm, 
    licenseForm,
    selectedLocation 
  } = useManagerOnboarding();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        alert("File too large (max 10MB)"); // Or use toast if available in context/hook
        return;
      }
      licenseForm.setFile(file);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
        <h3 className="text-lg font-semibold mb-1">Location & Contact Information</h3>
        <p className="text-sm text-gray-600">
          Tell us about your kitchen location and how you'd like to receive booking notifications.
        </p>
      </div>

      <div className="bg-gradient-to-r from-rose-50 to-pink-50 border-2 border-rose-200/50 rounded-xl p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-rose-100 rounded-lg">
            <HelpCircle className="h-5 w-5 text-[#F51042] flex-shrink-0" />
          </div>
          <div className="text-sm text-gray-700">
            <p className="font-bold mb-2 text-gray-900">What is a Location?</p>
            <p>Your location is your business address. This is what chefs will see when searching for kitchen spaces. You can have multiple kitchens within one location.</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="location-name" className="flex items-center gap-2">
            Location Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="location-name"
            value={locationForm.name}
            onChange={(e) => locationForm.setName(e.target.value)}
            placeholder="e.g., Main Street Kitchen"
          />
          <p className="text-xs text-gray-500">The name of your kitchen business or location</p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="location-address" className="flex items-center gap-2">
            Full Address <span className="text-red-500">*</span>
          </Label>
          <Input
            id="location-address"
            value={locationForm.address}
            onChange={(e) => locationForm.setAddress(e.target.value)}
            placeholder="e.g., 123 Main St, St. John's, NL A1B 2C3"
          />
          <p className="text-xs text-gray-500">Complete street address where your kitchen is located</p>
        </div>

        <div className="border-t pt-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">Notification Preferences (Optional)</h4>
          <p className="text-xs text-gray-600 mb-4">
            Configure where you'll receive booking notifications. If left empty, notifications will be sent to your account email.
          </p>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="notification-email">Notification Email</Label>
              <Input
                id="notification-email"
                type="email"
                value={locationForm.notificationEmail}
                onChange={(e) => locationForm.setNotificationEmail(e.target.value)}
                placeholder="notifications@example.com"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notification-phone">Notification Phone (SMS)</Label>
              <Input
                id="notification-phone"
                type="tel"
                value={locationForm.notificationPhone}
                onChange={(e) => locationForm.setNotificationPhone(e.target.value)}
                placeholder="(709) 555-1234"
              />
            </div>
          </div>
        </div>

        <div className="border-t pt-4 mt-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">Kitchen License (Optional)</h4>
          <p className="text-xs text-gray-600 mb-4">
            Upload your kitchen operating license for admin approval. This is required to activate bookings, but you can upload it later.
          </p>

          {selectedLocation?.kitchenLicenseUrl && 
           selectedLocation?.kitchenLicenseStatus !== "rejected" && 
           selectedLocation?.kitchenLicenseStatus !== "expired" && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
               <div className="flex items-center gap-2 text-green-800 mb-2">
                 <CheckCircle className="h-5 w-5" />
                 <span className="font-medium">License Uploaded</span>
               </div>
               <p className="text-sm text-green-700">Status: {selectedLocation.kitchenLicenseStatus || "pending"}</p>
            </div>
          )}

          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="license-file">Kitchen License File</Label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 mt-1 hover:bg-gray-50 transition-colors">
                <input
                  type="file"
                  id="license-file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <label htmlFor="license-file" className="cursor-pointer block text-center w-full h-full">
                  {licenseForm.file ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-700">
                      <FileText className="h-4 w-4" />
                      <span>{licenseForm.file.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          licenseForm.setFile(null);
                        }}
                        className="ml-2 h-6 px-2"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                      <span className="text-sm text-[#F51042] hover:text-rose-600 font-medium">Click to upload license</span>
                      <p className="text-xs text-gray-500 mt-1">PDF, JPG, or PNG (max 10MB)</p>
                    </>
                  )}
                </label>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="license-expiry-date">
                License Expiration Date {licenseForm.file && <span className="text-red-500">*</span>}
              </Label>
              <Input
                id="license-expiry-date"
                type="date"
                value={licenseForm.expiryDate}
                onChange={(e) => licenseForm.setExpiryDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
