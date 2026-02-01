import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { CheckCircle, FileText, Upload, X, AlertCircle, Calendar, Mail, Phone, Building, Bell, Info, User } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
import AddressAutocomplete from "@/components/ui/address-autocomplete";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function LocationStep() {
  const {
    locationForm,
    licenseForm,
    termsForm,
    selectedLocation,
    handleNext,
    handleBack,
    isFirstStep,
    skipCurrentStep
  } = useManagerOnboarding();

  const { toast } = useToast();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      toast({
        title: "Uploading license...",
        description: file.name,
      });
      try {
        await licenseForm.uploadFile(file);
        toast({
          title: "License uploaded successfully",
          description: file.name,
        });
      } catch (error) {
        toast({
          title: "Upload failed",
          description: "Failed to upload license file. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  const handleTermsFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      toast({
        title: "Uploading terms...",
        description: file.name,
      });
      try {
        await termsForm.uploadFile(file);
        toast({
          title: "Terms uploaded successfully",
          description: file.name,
        });
      } catch (error) {
        toast({
          title: "Upload failed",
          description: "Failed to upload terms file. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  // Validation based on preferred contact method
  const isContactValid = () => {
    const method = locationForm.preferredContactMethod;
    if (method === "email") return !!locationForm.contactEmail;
    if (method === "phone") return !!locationForm.contactPhone;
    return !!locationForm.contactEmail && !!locationForm.contactPhone;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Business Information Section */}
      <Card className="border-slate-200/60 dark:border-slate-700/60 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Building className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                </div>
                Business Information
              </CardTitle>
              <CardDescription className="mt-1.5 text-slate-500 dark:text-slate-400">
                Enter your kitchen business details
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="business-name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Business Name
            </Label>
            <Input
              id="business-name"
              placeholder="e.g. Downtown Commercial Kitchen"
              value={locationForm.name}
              onChange={(e) => locationForm.setName(e.target.value)}
              className="h-10"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              This name will be displayed to chefs browsing your kitchen
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="business-address" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Business Address
            </Label>
            <AddressAutocomplete
              value={locationForm.address}
              onChange={(value) => locationForm.setAddress(value)}
              placeholder="Start typing your address..."
              className="h-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Primary Contact Section */}
      <Card className="border-slate-200/60 dark:border-slate-700/60 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
                  <User className="w-4 h-4 text-[#F51042]" />
                </div>
                Primary Contact
              </CardTitle>
              <CardDescription className="mt-1.5 text-slate-500 dark:text-slate-400">
                Your preferred method for business inquiries and support
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Preferred Contact Method */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Preferred Contact Method
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <p className="text-xs">This is how we'll reach you for account-related matters and support inquiries.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <RadioGroup
              value={locationForm.preferredContactMethod}
              onValueChange={(value) => locationForm.setPreferredContactMethod(value as "email" | "phone" | "both")}
              className="flex flex-wrap gap-3"
            >
              <label 
                htmlFor="contact-email"
                className={cn(
                  "flex items-center space-x-2.5 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all",
                  locationForm.preferredContactMethod === "email" 
                    ? "border-[#F51042] bg-red-50 dark:bg-red-950/20 dark:border-[#F51042]" 
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                )}
              >
                <RadioGroupItem value="email" id="contact-email" className="shrink-0" />
                <span className="flex items-center gap-1.5 text-sm">
                  <Mail className="w-3.5 h-3.5" /> Email
                </span>
              </label>
              <label 
                htmlFor="contact-phone"
                className={cn(
                  "flex items-center space-x-2.5 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all",
                  locationForm.preferredContactMethod === "phone" 
                    ? "border-[#F51042] bg-red-50 dark:bg-red-950/20 dark:border-[#F51042]" 
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                )}
              >
                <RadioGroupItem value="phone" id="contact-phone" className="shrink-0" />
                <span className="flex items-center gap-1.5 text-sm">
                  <Phone className="w-3.5 h-3.5" /> Phone
                </span>
              </label>
              <label 
                htmlFor="contact-both"
                className={cn(
                  "flex items-center space-x-2.5 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all",
                  locationForm.preferredContactMethod === "both" 
                    ? "border-[#F51042] bg-red-50 dark:bg-red-950/20 dark:border-[#F51042]" 
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                )}
              >
                <RadioGroupItem value="both" id="contact-both" className="shrink-0" />
                <span className="text-sm">Both</span>
              </label>
            </RadioGroup>
          </div>

          {/* Contact Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={cn(
              "space-y-2 transition-opacity duration-200",
              locationForm.preferredContactMethod === "phone" && "opacity-50"
            )}>
              <Label htmlFor="contact-email" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Contact Email
                {(locationForm.preferredContactMethod === "email" || locationForm.preferredContactMethod === "both") && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </Label>
              <Input
                id="contact-email"
                type="email"
                placeholder="you@business.com"
                value={locationForm.contactEmail}
                onChange={(e) => locationForm.setContactEmail(e.target.value)}
                className="h-10"
                disabled={locationForm.preferredContactMethod === "phone"}
              />
            </div>
            <div className={cn(
              "space-y-2 transition-opacity duration-200",
              locationForm.preferredContactMethod === "email" && "opacity-50"
            )}>
              <Label htmlFor="contact-phone" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Contact Phone
                {(locationForm.preferredContactMethod === "phone" || locationForm.preferredContactMethod === "both") && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </Label>
              <Input
                id="contact-phone"
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={locationForm.contactPhone}
                onChange={(e) => locationForm.setContactPhone(e.target.value)}
                className="h-10"
                disabled={locationForm.preferredContactMethod === "email"}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Platform Notifications Section */}
      <Card className="border-slate-200/60 dark:border-slate-700/60 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
                  <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                Platform Notifications
              </CardTitle>
              <CardDescription className="mt-1.5 text-slate-500 dark:text-slate-400">
                Where you'll receive booking updates and chef applications
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Notification Fields - Both always visible */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="notification-email" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Notification Email
              </Label>
              <Input
                id="notification-email"
                type="email"
                placeholder="bookings@business.com"
                value={locationForm.notificationEmail}
                onChange={(e) => locationForm.setNotificationEmail(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notification-phone" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Notification Phone
                <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">(Optional)</span>
              </Label>
              <Input
                id="notification-phone"
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={locationForm.notificationPhone}
                onChange={(e) => locationForm.setNotificationPhone(e.target.value)}
                className="h-10"
              />
            </div>
          </div>

          {/* Notification Info */}
          <Alert className="border-blue-100 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-900/50">
            <Bell className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertDescription className="text-xs text-blue-700 dark:text-blue-300">
              <span className="font-medium">You'll receive notifications for:</span> New booking requests, chef applications, booking confirmations, cancellations, and important platform updates.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* License Upload Section */}
      <Card className="border-slate-200/60 dark:border-slate-700/60 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                Commercial Kitchen License
              </CardTitle>
              <CardDescription className="mt-1.5 text-slate-500 dark:text-slate-400">
                Upload your commercial kitchen license for verification
              </CardDescription>
            </div>
            <Badge variant="destructive" className="text-xs">Required</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {selectedLocation?.kitchenLicenseUrl &&
            selectedLocation?.kitchenLicenseStatus !== "rejected" &&
            selectedLocation?.kitchenLicenseStatus !== "expired" && (
              <Alert className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300">
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <span className="font-medium">License Uploaded</span> — Status: {selectedLocation.kitchenLicenseStatus || "pending"}
                </AlertDescription>
              </Alert>
            )}

          <div className="space-y-2">
            <Label htmlFor="license-file" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              License File
            </Label>
            <div className={cn(
              "relative border-2 border-dashed rounded-xl p-6 transition-all duration-200",
              (licenseForm.file || licenseForm.uploadedUrl)
                ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-700" 
                : "border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50"
            )}>
              <input
                type="file"
                id="license-file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileChange}
                className="hidden"
              />
              <label htmlFor="license-file" className="cursor-pointer block text-center w-full h-full">
                {licenseForm.file || licenseForm.uploadedUrl ? (
                  <div className="flex items-center justify-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {licenseForm.file?.name || (licenseForm.uploadedUrl ? "License uploaded" : "File")}
                      </p>
                      {licenseForm.file && licenseForm.file.size > 0 && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {formatFileSize(licenseForm.file.size)}
                        </p>
                      )}
                      {!licenseForm.file && licenseForm.uploadedUrl && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400">
                          Uploaded to cloud
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        licenseForm.setFile(null);
                      }}
                      className="ml-auto h-8 w-8 p-0 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto">
                      <Upload className="w-6 h-6 text-slate-400 dark:text-slate-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Upload license file
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        PDF, JPG, or PNG (max 10MB)
                      </p>
                    </div>
                  </div>
                )}
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="license-expiry-date" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              <Calendar className="w-4 h-4 inline mr-1" />
              Expiration Date
              {licenseForm.file && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input
              id="license-expiry-date"
              type="date"
              value={licenseForm.expiryDate}
              onChange={(e) => licenseForm.setExpiryDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="h-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Terms & Policies Section */}
      <Card className="border-slate-200/60 dark:border-slate-700/60 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                Terms & Policies
              </CardTitle>
              <CardDescription className="mt-1.5 text-slate-500 dark:text-slate-400">
                House rules and policies chefs must agree to before booking
              </CardDescription>
            </div>
            <Badge variant="destructive" className="text-xs">Required</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {selectedLocation?.kitchenTermsUrl && (
            <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300">
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                <span className="font-medium">Terms Uploaded</span> — Document on file
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="terms-file" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Terms & Policies File
            </Label>
            <div className={cn(
              "relative border-2 border-dashed rounded-xl p-6 transition-all duration-200",
              (termsForm.file || termsForm.uploadedUrl)
                ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700" 
                : "border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50"
            )}>
              <input
                type="file"
                id="terms-file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={handleTermsFileChange}
                className="hidden"
              />
              <label htmlFor="terms-file" className="cursor-pointer block text-center w-full h-full">
                {termsForm.file || termsForm.uploadedUrl ? (
                  <div className="flex items-center justify-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {termsForm.file?.name || (termsForm.uploadedUrl ? "Terms uploaded" : "File")}
                      </p>
                      {termsForm.file && termsForm.file.size > 0 && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {formatFileSize(termsForm.file.size)}
                        </p>
                      )}
                      {!termsForm.file && termsForm.uploadedUrl && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Uploaded to cloud
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        termsForm.setFile(null);
                      }}
                      className="ml-auto h-8 w-8 p-0 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto">
                      <Upload className="w-6 h-6 text-slate-400 dark:text-slate-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Upload terms document
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        PDF, JPG, PNG, or DOC (max 10MB)
                      </p>
                    </div>
                  </div>
                )}
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      <OnboardingNavigationFooter
        onNext={handleNext}
        onBack={handleBack}
        onSkip={skipCurrentStep}
        showBack={!isFirstStep}
        showSkip={true}
        isNextDisabled={
          !locationForm.name || 
          !locationForm.address || 
          !isContactValid() ||
          (!licenseForm.file && !licenseForm.uploadedUrl && !selectedLocation?.kitchenLicenseUrl) || 
          (!termsForm.file && !termsForm.uploadedUrl && !selectedLocation?.kitchenTermsUrl)
        }
      />
    </div>
  );
}
