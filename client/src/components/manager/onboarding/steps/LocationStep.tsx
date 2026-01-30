import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { CheckCircle, FileText, Upload, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";

export default function LocationStep() {
  const {
    locationForm,
    licenseForm,
    termsForm,
    selectedLocation,
    handleNext,
    handleBack,
    isFirstStep
  } = useManagerOnboarding();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      licenseForm.setFile(file);
    }
  };

  const handleTermsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log('[LocationStep] Terms file selected:', file.name, file.size);
      termsForm.setFile(file);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="location-name">Location Name</Label>
          <Input
            id="location-name"
            placeholder="e.g. Downtown Kitchen"
            value={locationForm.name}
            onChange={(e) => locationForm.setName(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="location-address">Address</Label>
          <Input
            id="location-address"
            placeholder="Full address"
            value={locationForm.address}
            onChange={(e) => locationForm.setAddress(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="notification-email">Notification Email</Label>
            <Input
              id="notification-email"
              type="email"
              placeholder="bookings@example.com"
              value={locationForm.notificationEmail}
              onChange={(e) => locationForm.setNotificationEmail(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notification-phone">Phone (Optional)</Label>
            <Input
              id="notification-phone"
              type="tel"
              placeholder="+1 (555) 000-0000"
              value={locationForm.notificationPhone}
              onChange={(e) => locationForm.setNotificationPhone(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="border-t pt-4 mt-4">
        <h4 className="text-sm font-semibold text-foreground mb-3">Kitchen License <span className="text-destructive">*</span></h4>

        {selectedLocation?.kitchenLicenseUrl &&
          selectedLocation?.kitchenLicenseStatus !== "rejected" &&
          selectedLocation?.kitchenLicenseStatus !== "expired" && (
            <Alert className="mb-4 border-green-200 bg-green-50 text-green-800 [&>svg]:text-green-600">
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                <span className="font-medium">License Uploaded</span> - Status: {selectedLocation.kitchenLicenseStatus || "pending"}
              </AlertDescription>
            </Alert>
          )}

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="license-file">Kitchen License File <span className="text-destructive">*</span></Label>
            <div className="border-2 border-dashed border-border rounded-lg p-4 mt-1 hover:bg-muted/50 transition-colors">
              <input
                type="file"
                id="license-file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileChange}
                className="hidden"
              />
              <label htmlFor="license-file" className="cursor-pointer block text-center w-full h-full">
                {licenseForm.file ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-foreground">
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
                    <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <span className="text-sm text-primary hover:text-primary/80 font-medium">Click to upload license</span>
                    <p className="text-xs text-muted-foreground mt-1">PDF, JPG, or PNG (max 10MB)</p>
                  </>
                )}
              </label>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="license-expiry-date">
              License Expiration Date {licenseForm.file && <span className="text-destructive">*</span>}
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

      {/* Kitchen Terms & Policies Section */}
      <div className="border-t pt-4 mt-4">
        <h4 className="text-sm font-semibold text-foreground mb-3">Kitchen Terms & Policies <span className="text-destructive">*</span></h4>

        {selectedLocation?.kitchenTermsUrl && (
          <Alert className="mb-4 border-blue-200 bg-blue-50 text-blue-800 [&>svg]:text-blue-600">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              <span className="font-medium">Terms Uploaded</span> - Document on file
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="terms-file">Kitchen Terms & Policies File <span className="text-destructive">*</span></Label>
            <p className="text-xs text-muted-foreground">
              Upload your kitchen house rules, usage policies, and terms that chefs must agree to.
            </p>
            <div className="border-2 border-dashed border-border rounded-lg p-4 mt-1 hover:bg-muted/50 transition-colors">
              <input
                type="file"
                id="terms-file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={handleTermsFileChange}
                className="hidden"
              />
              <label htmlFor="terms-file" className="cursor-pointer block text-center w-full h-full">
                {termsForm.file ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-foreground">
                    <FileText className="h-4 w-4" />
                    <span>{termsForm.file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        termsForm.setFile(null);
                      }}
                      className="ml-2 h-6 px-2"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <span className="text-sm text-primary hover:text-primary/80 font-medium">Click to upload terms</span>
                    <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG, or DOC (max 10MB)</p>
                  </>
                )}
              </label>
            </div>
          </div>
        </div>
      </div>

      <OnboardingNavigationFooter
        onNext={handleNext}
        onBack={handleBack}
        showBack={!isFirstStep}
        isNextDisabled={!locationForm.name || !locationForm.address || (!licenseForm.file && !selectedLocation?.kitchenLicenseUrl) || (!termsForm.file && !selectedLocation?.kitchenTermsUrl)}
      />
    </div>
  );
}
