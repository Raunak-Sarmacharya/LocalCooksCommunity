import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  Building2, MapPin, Mail, Phone, Clock, Calendar, 
  Globe, Image as ImageIcon, Save, Loader2, CheckCircle,
  XCircle, AlertCircle, Upload, FileText
} from "lucide-react";
import { getTimezoneOptions, DEFAULT_TIMEZONE } from "@/utils/timezone-utils";
import { auth } from "@/lib/firebase";
import type { LocationData } from "./LocationCard";
import { cn } from "@/lib/utils";
import { ImageWithReplace } from "@/components/ui/image-with-replace";

interface LocationEditModalProps {
  location: LocationData;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  viewOnly?: boolean;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentFirebaseUser = auth.currentUser;
  
  if (currentFirebaseUser) {
    try {
      const freshToken = await currentFirebaseUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${freshToken}`,
      };
    } catch (error) {
      console.error('Error getting Firebase token:', error);
    }
  }
  
  const token = localStorage.getItem('firebaseToken');
  if (token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }
  
  return {
    'Content-Type': 'application/json',
  };
}

function getStatusConfig(status?: string) {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        icon: CheckCircle,
        bgColor: 'bg-green-100',
        textColor: 'text-green-800',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        icon: XCircle,
        bgColor: 'bg-red-100',
        textColor: 'text-red-800',
      };
    case 'pending':
    default:
      return {
        label: 'Pending',
        icon: Clock,
        bgColor: 'bg-yellow-100',
        textColor: 'text-yellow-800',
      };
  }
}

export default function LocationEditModal({
  location,
  isOpen,
  onClose,
  onSave,
  viewOnly = false,
}: LocationEditModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const timezoneOptions = getTimezoneOptions();
  
  // Form state
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address);
  const [notificationEmail, setNotificationEmail] = useState(location.notificationEmail || "");
  const [notificationPhone, setNotificationPhone] = useState(location.notificationPhone || "");
  const [timezone, setTimezone] = useState(location.timezone || DEFAULT_TIMEZONE);
  const [cancellationPolicyHours, setCancellationPolicyHours] = useState(
    location.cancellationPolicyHours?.toString() || "24"
  );
  const [cancellationPolicyMessage, setCancellationPolicyMessage] = useState(
    location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time."
  );
  const [defaultDailyBookingLimit, setDefaultDailyBookingLimit] = useState(
    location.defaultDailyBookingLimit?.toString() || "2"
  );
  const [minimumBookingWindowHours, setMinimumBookingWindowHours] = useState(
    location.minimumBookingWindowHours?.toString() || "1"
  );
  const [logoUrl, setLogoUrl] = useState(location.logoUrl || "");

  // Reset form when location changes
  useEffect(() => {
    setName(location.name);
    setAddress(location.address);
    setNotificationEmail(location.notificationEmail || "");
    setNotificationPhone(location.notificationPhone || "");
    setTimezone(location.timezone || DEFAULT_TIMEZONE);
    setCancellationPolicyHours(location.cancellationPolicyHours?.toString() || "24");
    setCancellationPolicyMessage(
      location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time."
    );
    setDefaultDailyBookingLimit(location.defaultDailyBookingLimit?.toString() || "2");
    setMinimumBookingWindowHours(location.minimumBookingWindowHours?.toString() || "1");
    setLogoUrl(location.logoUrl || "");
  }, [location]);

  // Update basic info mutation
  const updateBasicInfo = useMutation({
    mutationFn: async (data: { name: string; address: string; notificationEmail: string; notificationPhone: string }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${location.id}`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update location");
      }
      
      return response.json();
    },
  });

  // Update settings mutation
  const updateSettings = useMutation({
    mutationFn: async (data: {
      cancellationPolicyHours?: number;
      cancellationPolicyMessage?: string;
      defaultDailyBookingLimit?: number;
      minimumBookingWindowHours?: number;
      logoUrl?: string;
      timezone?: string;
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${location.id}/cancellation-policy`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update location settings");
      }
      
      return response.json();
    },
  });

  const handleSave = async () => {
    try {
      // Update basic info
      await updateBasicInfo.mutateAsync({
        name,
        address,
        notificationEmail,
        notificationPhone,
      });

      // Update settings
      await updateSettings.mutateAsync({
        cancellationPolicyHours: parseInt(cancellationPolicyHours) || 24,
        cancellationPolicyMessage,
        defaultDailyBookingLimit: parseInt(defaultDailyBookingLimit) || 2,
        minimumBookingWindowHours: parseInt(minimumBookingWindowHours) || 1,
        logoUrl: logoUrl || undefined,
        timezone,
      });

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
      queryClient.invalidateQueries({ queryKey: ["locationDetails", location.id] });

      toast({
        title: "Success",
        description: "Location updated successfully",
      });

      onSave();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update location",
        variant: "destructive",
      });
    }
  };

  const isLoading = updateBasicInfo.isPending || updateSettings.isPending;
  const statusConfig = getStatusConfig(location.kitchenLicenseStatus);
  const StatusIcon = statusConfig.icon;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {location.logoUrl ? (
                <ImageWithReplace
                  imageUrl={location.logoUrl}
                  onImageChange={() => {}} // Read-only in header
                  alt={location.name}
                  className="w-12 h-12"
                  containerClassName="w-12 h-12"
                  aspectRatio="1/1"
                  showReplaceButton={false}
                  showRemoveButton={false}
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#FFE8DD] to-[#FFD4C4] flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-[#F51042]" />
                </div>
              )}
              <div>
                <DialogTitle className="text-xl">
                  {viewOnly ? "Location Details" : "Edit Location"}
                </DialogTitle>
                <DialogDescription>
                  {viewOnly ? "View your location information" : "Update your location details and settings"}
                </DialogDescription>
              </div>
            </div>
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
              statusConfig.bgColor,
              statusConfig.textColor
            )}>
              <StatusIcon className="w-3.5 h-3.5" />
              {statusConfig.label}
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="basic" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="license">License</TabsTrigger>
          </TabsList>

          {/* Basic Info Tab */}
          <TabsContent value="basic" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="name">Location Name</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter location name"
                  className="pl-10"
                  disabled={viewOnly}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <Textarea
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Enter full address"
                  className="pl-10 min-h-[80px]"
                  disabled={viewOnly}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Notification Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="email"
                    type="email"
                    value={notificationEmail}
                    onChange={(e) => setNotificationEmail(e.target.value)}
                    placeholder="email@example.com"
                    className="pl-10"
                    disabled={viewOnly}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Notification Phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="phone"
                    type="tel"
                    value={notificationPhone}
                    onChange={(e) => setNotificationPhone(e.target.value)}
                    placeholder="(416) 123-4567"
                    className="pl-10"
                    disabled={viewOnly}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Location Logo</Label>
              <ImageWithReplace
                imageUrl={logoUrl || undefined}
                onImageChange={(newUrl) => setLogoUrl(newUrl || "")}
                alt="Location logo"
                className="w-full max-w-xs"
                containerClassName="w-full max-w-xs"
                aspectRatio="1/1"
                showReplaceButton={!viewOnly}
                showRemoveButton={!viewOnly}
                fieldName="logo"
              />
              {viewOnly && !logoUrl && (
                <p className="text-sm text-gray-500">No logo uploaded</p>
              )}
            </div>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone} disabled={viewOnly}>
                <SelectTrigger>
                  <Globe className="w-4 h-4 mr-2 text-gray-400" />
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {timezoneOptions.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cancellationHours">Cancellation Policy (hours)</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="cancellationHours"
                    type="number"
                    min="0"
                    value={cancellationPolicyHours}
                    onChange={(e) => setCancellationPolicyHours(e.target.value)}
                    className="pl-10"
                    disabled={viewOnly}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bookingLimit">Daily Booking Limit (hours)</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="bookingLimit"
                    type="number"
                    min="1"
                    max="24"
                    value={defaultDailyBookingLimit}
                    onChange={(e) => setDefaultDailyBookingLimit(e.target.value)}
                    className="pl-10"
                    disabled={viewOnly}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minBookingWindow">Minimum Booking Window (hours)</Label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="minBookingWindow"
                  type="number"
                  min="0"
                  max="168"
                  value={minimumBookingWindowHours}
                  onChange={(e) => setMinimumBookingWindowHours(e.target.value)}
                  className="pl-10"
                  disabled={viewOnly}
                />
              </div>
              <p className="text-xs text-gray-500">
                How many hours in advance bookings must be made (0-168 hours)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cancellationMessage">Cancellation Policy Message</Label>
              <Textarea
                id="cancellationMessage"
                value={cancellationPolicyMessage}
                onChange={(e) => setCancellationPolicyMessage(e.target.value)}
                placeholder="Enter cancellation policy message"
                className="min-h-[80px]"
                disabled={viewOnly}
              />
              <p className="text-xs text-gray-500">
                Use {"{hours}"} to insert the cancellation hours value
              </p>
            </div>
          </TabsContent>

          {/* License Tab */}
          <TabsContent value="license" className="space-y-4 mt-4">
            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-gray-600" />
                  <span className="font-medium">Kitchen License</span>
                </div>
                <div className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                  statusConfig.bgColor,
                  statusConfig.textColor
                )}>
                  <StatusIcon className="w-3.5 h-3.5" />
                  {statusConfig.label}
                </div>
              </div>

              {location.kitchenLicenseUrl ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">
                    Your kitchen license has been uploaded and is{" "}
                    {location.kitchenLicenseStatus === 'approved' 
                      ? 'approved' 
                      : location.kitchenLicenseStatus === 'rejected'
                      ? 'rejected'
                      : 'under review'}.
                  </p>
                  <a 
                    href={location.kitchenLicenseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#F51042] hover:underline inline-flex items-center gap-1"
                  >
                    <FileText className="w-4 h-4" />
                    View uploaded license
                  </a>
                </div>
              ) : (
                <p className="text-sm text-gray-600">
                  No kitchen license has been uploaded yet. Please upload your license during the location creation process.
                </p>
              )}

              {location.kitchenLicenseStatus === 'rejected' && location.kitchenLicenseFeedback && (
                <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-100">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-800">Admin Feedback</p>
                      <p className="text-sm text-red-600 mt-1">{location.kitchenLicenseFeedback}</p>
                    </div>
                  </div>
                </div>
              )}

              {location.kitchenLicenseApprovedAt && (
                <p className="text-xs text-gray-500">
                  {location.kitchenLicenseStatus === 'approved' ? 'Approved' : 'Reviewed'} on:{" "}
                  {new Date(location.kitchenLicenseApprovedAt).toLocaleDateString()}
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>
            {viewOnly ? "Close" : "Cancel"}
          </Button>
          {!viewOnly && (
            <Button 
              onClick={handleSave} 
              disabled={isLoading}
              className="bg-[#F51042] hover:bg-[#d10e3a] text-white gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
