import { useState } from "react";
import { 
  Building2, MapPin, ChefHat, Calendar, Clock, 
  CheckCircle, AlertCircle, XCircle, Edit, Eye, 
  ArrowRight, Info, Image as ImageIcon
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface LocationData {
  id: number;
  name: string;
  address: string;
  managerId?: number;
  createdAt?: string;
  updatedAt?: string;
  kitchenLicenseUrl?: string;
  kitchenLicenseStatus?: string;
  kitchenLicenseApprovedBy?: number;
  kitchenLicenseApprovedAt?: string;
  kitchenLicenseFeedback?: string;
  logoUrl?: string;
  brandImageUrl?: string;
  notificationEmail?: string;
  notificationPhone?: string;
  timezone?: string;
  cancellationPolicyHours?: number;
  cancellationPolicyMessage?: string;
  defaultDailyBookingLimit?: number;
  minimumBookingWindowHours?: number;
}

interface LocationCardProps {
  location: LocationData;
  kitchenCount?: number;
  activeBookingsCount?: number;
  pendingApplicationsCount?: number;
  onEdit: (location: LocationData) => void;
  onManage: (location: LocationData) => void;
  onViewDetails: (location: LocationData) => void;
}

function getStatusConfig(status?: string) {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        icon: CheckCircle,
        bgColor: 'bg-green-100',
        textColor: 'text-green-800',
        borderColor: 'border-green-200',
        description: 'Your kitchen license has been approved. You can now accept bookings.'
      };
    case 'rejected':
      return {
        label: 'Rejected',
        icon: XCircle,
        bgColor: 'bg-red-100',
        textColor: 'text-red-800',
        borderColor: 'border-red-200',
        description: 'Your kitchen license was rejected. Please review the feedback and resubmit.'
      };
    case 'pending':
    default:
      return {
        label: 'Pending Approval',
        icon: Clock,
        bgColor: 'bg-yellow-100',
        textColor: 'text-yellow-800',
        borderColor: 'border-yellow-200',
        description: 'Your kitchen license is under review by the admin team.'
      };
  }
}

export default function LocationCard({
  location,
  kitchenCount = 0,
  activeBookingsCount = 0,
  pendingApplicationsCount = 0,
  onEdit,
  onManage,
  onViewDetails,
}: LocationCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const statusConfig = getStatusConfig(location.kitchenLicenseStatus);
  const StatusIcon = statusConfig.icon;

  return (
    <TooltipProvider>
      <Card 
        className={cn(
          "relative overflow-hidden transition-all duration-300 border-2",
          isHovered ? "shadow-lg scale-[1.02]" : "shadow-sm",
          location.kitchenLicenseStatus === 'rejected' && "border-red-200",
          location.kitchenLicenseStatus === 'approved' && "border-green-200",
          location.kitchenLicenseStatus === 'pending' && "border-yellow-200",
          !location.kitchenLicenseStatus && "border-gray-200"
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Status Banner */}
        <div className={cn(
          "absolute top-0 left-0 right-0 h-1",
          location.kitchenLicenseStatus === 'approved' && "bg-green-500",
          location.kitchenLicenseStatus === 'rejected' && "bg-red-500",
          location.kitchenLicenseStatus === 'pending' && "bg-yellow-500",
          !location.kitchenLicenseStatus && "bg-gray-300"
        )} />

        <CardHeader className="pb-3 pt-5">
          <div className="flex items-start justify-between gap-3">
            {/* Logo/Icon */}
            <div className="flex-shrink-0">
              {location.logoUrl ? (
                <img 
                  src={location.logoUrl} 
                  alt={location.name}
                  className="w-14 h-14 rounded-lg object-cover border border-gray-200"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    target.nextElementSibling?.classList.remove('hidden');
                  }}
                />
              ) : null}
              <div className={cn(
                "w-14 h-14 rounded-lg flex items-center justify-center",
                location.logoUrl && "hidden",
                "bg-gradient-to-br from-[#FFE8DD] to-[#FFD4C4]"
              )}>
                <Building2 className="w-7 h-7 text-[#F51042]" />
              </div>
            </div>

            {/* Status Badge */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                  statusConfig.bgColor,
                  statusConfig.textColor
                )}>
                  <StatusIcon className="w-3.5 h-3.5" />
                  {statusConfig.label}
                  {location.kitchenLicenseStatus === 'rejected' && location.kitchenLicenseFeedback && (
                    <Info className="w-3 h-3 ml-0.5" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent 
                side="bottom" 
                className="max-w-xs bg-gray-900 text-white p-3"
              >
                <p className="text-sm">{statusConfig.description}</p>
                {location.kitchenLicenseStatus === 'rejected' && location.kitchenLicenseFeedback && (
                  <div className="mt-2 pt-2 border-t border-gray-700">
                    <p className="text-xs text-gray-400 mb-1">Admin Feedback:</p>
                    <p className="text-sm">{location.kitchenLicenseFeedback}</p>
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Location Name & Address */}
          <div className="mt-3">
            <h3 className="font-semibold text-lg text-gray-900 leading-tight">
              {location.name}
            </h3>
            <div className="flex items-start gap-1.5 mt-1.5 text-gray-500">
              <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{location.address}</span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pb-4">
          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-2.5 rounded-lg bg-gray-50">
              <div className="flex items-center justify-center gap-1 text-gray-500 mb-1">
                <ChefHat className="w-4 h-4" />
              </div>
              <p className="text-lg font-bold text-gray-900">{kitchenCount}</p>
              <p className="text-xs text-gray-500">Kitchens</p>
            </div>
            <div className="text-center p-2.5 rounded-lg bg-gray-50">
              <div className="flex items-center justify-center gap-1 text-gray-500 mb-1">
                <Calendar className="w-4 h-4" />
              </div>
              <p className="text-lg font-bold text-gray-900">{activeBookingsCount}</p>
              <p className="text-xs text-gray-500">Bookings</p>
            </div>
            <div className="text-center p-2.5 rounded-lg bg-gray-50">
              <div className="flex items-center justify-center gap-1 text-gray-500 mb-1">
                <AlertCircle className="w-4 h-4" />
              </div>
              <p className="text-lg font-bold text-gray-900">{pendingApplicationsCount}</p>
              <p className="text-xs text-gray-500">Pending</p>
            </div>
          </div>

          {/* Rejection Warning */}
          {location.kitchenLicenseStatus === 'rejected' && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-100">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">License Rejected</p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Please edit this location to resubmit your kitchen license.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Pending Notice */}
          {(!location.kitchenLicenseStatus || location.kitchenLicenseStatus === 'pending') && (
            <div className="mt-4 p-3 rounded-lg bg-yellow-50 border border-yellow-100">
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-800">Awaiting Approval</p>
                  <p className="text-xs text-yellow-600 mt-0.5">
                    Your location is being reviewed. You'll be notified when approved.
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="pt-0 pb-4 px-6">
          <div className="flex items-center gap-2 w-full">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(location)}
              className="flex-1 gap-1.5"
            >
              <Edit className="w-4 h-4" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onViewDetails(location)}
              className="flex-1 gap-1.5"
            >
              <Eye className="w-4 h-4" />
              Details
            </Button>
            <Button
              size="sm"
              onClick={() => onManage(location)}
              className="flex-1 gap-1.5 bg-[#F51042] hover:bg-[#d10e3a] text-white"
              disabled={location.kitchenLicenseStatus !== 'approved'}
            >
              Manage
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </CardFooter>
      </Card>
    </TooltipProvider>
  );
}

// Skeleton loader for loading state
export function LocationCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="h-1 bg-gray-200 animate-pulse" />
      <CardHeader className="pb-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="w-14 h-14 rounded-lg bg-gray-200 animate-pulse" />
          <div className="w-28 h-6 rounded-full bg-gray-200 animate-pulse" />
        </div>
        <div className="mt-3 space-y-2">
          <div className="h-6 w-3/4 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="text-center p-2.5 rounded-lg bg-gray-50">
              <div className="h-4 w-4 mx-auto bg-gray-200 rounded animate-pulse mb-2" />
              <div className="h-6 w-8 mx-auto bg-gray-200 rounded animate-pulse" />
              <div className="h-3 w-12 mx-auto bg-gray-200 rounded animate-pulse mt-1" />
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="pt-0 pb-4 px-6">
        <div className="flex items-center gap-2 w-full">
          <div className="flex-1 h-9 bg-gray-200 rounded animate-pulse" />
          <div className="flex-1 h-9 bg-gray-200 rounded animate-pulse" />
          <div className="flex-1 h-9 bg-gray-200 rounded animate-pulse" />
        </div>
      </CardFooter>
    </Card>
  );
}
