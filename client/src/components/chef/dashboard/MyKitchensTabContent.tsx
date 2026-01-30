import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import {
  Building,
  Calendar,
  CheckCircle,
  Clock,
  XCircle,
  MessageCircle,
  ArrowRight,
  Utensils,
  MapPin,
  Snowflake,
  Thermometer,
  Package,
} from "lucide-react";
import type { 
  KitchenApplicationWithLocation, 
  PublicKitchen,
  BookingLocation 
} from "./types";

interface MyKitchensTabContentProps {
  kitchenApplications: KitchenApplicationWithLocation[];
  publicKitchens: PublicKitchen[] | undefined;
  chefId: number | null;
  onSetActiveTab: (tab: string) => void;
  onOpenBookingSheet: (location: BookingLocation) => void;
  onOpenChat: (app: KitchenApplicationWithLocation) => void;
}

export default function MyKitchensTabContent({
  kitchenApplications,
  publicKitchens,
  chefId,
  onSetActiveTab,
  onOpenBookingSheet,
  onOpenChat,
}: MyKitchensTabContentProps) {
  
  // Format price (cents to dollars)
  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(0)}`;

  // Status badge configuration
  const getStatusConfig = (app: KitchenApplicationWithLocation) => {
    if (app.status === 'approved' && (app.current_tier ?? 1) >= 3) {
      return { label: 'Ready to Book', bgColor: 'bg-blue-600 hover:bg-blue-600', icon: CheckCircle };
    }
    if (app.status === 'approved') {
      return { label: 'In Progress', bgColor: 'bg-amber-500 hover:bg-amber-500', icon: Clock };
    }
    if (app.status === 'inReview') {
      return { label: 'In Review', bgColor: 'bg-amber-500 hover:bg-amber-500', icon: Clock };
    }
    return { label: 'Rejected', bgColor: 'bg-red-500 hover:bg-red-500', icon: XCircle };
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shadow-sm">
          <Building className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">My Kitchens</h2>
          <p className="text-muted-foreground mt-1">Your approved commercial kitchen spaces.</p>
        </div>
      </div>

      {kitchenApplications.length > 0 ? (
        <div className="space-y-4">
          {kitchenApplications.map((app) => {
            // Find matching public kitchen data for images, equipment, storage
            const kitchenData = publicKitchens?.find(k => k.locationId === app.locationId);
            const hasImage = !!kitchenData?.imageUrl || !!app.location?.brandImageUrl;
            const imageUrl = kitchenData?.imageUrl || app.location?.brandImageUrl;
            const equipment = kitchenData?.equipment || [];
            const displayEquipment = equipment.slice(0, 3);
            const remainingEquipment = equipment.length - 3;
            const storageSummary = kitchenData?.storageSummary;
            const hourlyRate = kitchenData?.hourlyRate;
            const priceDisplay = hourlyRate ? formatPrice(hourlyRate) : null;
            const statusConfig = getStatusConfig(app);

            return (
              <Card
                key={app.id}
                className="overflow-hidden border-border/50 hover:shadow-lg hover:border-border transition-all duration-300 group"
              >
                <div className="flex flex-col md:flex-row">
                  {/* Image Section */}
                  <div className="md:w-72 lg:w-80 flex-shrink-0">
                    <AspectRatio ratio={16 / 10} className="md:h-full">
                      {hasImage ? (
                        <img
                          src={getR2ProxyUrl(imageUrl)}
                          alt={app.location?.name || 'Kitchen'}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 flex items-center justify-center">
                          <Building className="h-16 w-16 text-white/80" />
                        </div>
                      )}
                    </AspectRatio>
                  </div>

                  {/* Content Section */}
                  <div className="flex-1 p-5 md:p-6 flex flex-col">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="text-xl font-bold text-foreground truncate">
                            {app.location?.name || 'Unknown Location'}
                          </h3>
                          <Badge
                            variant="default"
                            className={cn(
                              "text-[10px] uppercase tracking-wider",
                              statusConfig.bgColor
                            )}
                          >
                            <statusConfig.icon className="h-3 w-3 mr-1" />
                            {statusConfig.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">{app.location?.address || 'Address not available'}</span>
                        </div>
                      </div>

                      {/* Price Badge */}
                      {priceDisplay && (
                        <div className="text-right flex-shrink-0">
                          <div className="flex items-center gap-1 text-lg font-bold text-foreground">
                            <span>{priceDisplay}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">per hour</p>
                        </div>
                      )}
                    </div>

                    {/* Equipment & Storage */}
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      {/* Equipment badges */}
                      {displayEquipment.length > 0 && (
                        <>
                          {displayEquipment.map((item: string, idx: number) => (
                            <Badge
                              key={idx}
                              variant="outline"
                              className="text-xs font-normal bg-muted/30 border-border/50"
                            >
                              <Utensils className="h-3 w-3 mr-1 text-muted-foreground" />
                              {item}
                            </Badge>
                          ))}
                          {remainingEquipment > 0 && (
                            <Badge variant="outline" className="text-xs font-normal bg-muted/30 border-border/50">
                              +{remainingEquipment} more
                            </Badge>
                          )}
                        </>
                      )}

                      {/* Storage indicators */}
                      {storageSummary && storageSummary.totalStorageUnits > 0 && (
                        <div className="flex items-center gap-1 ml-1">
                          {(displayEquipment.length > 0) && <span className="text-muted-foreground/50">|</span>}
                          {storageSummary.hasColdStorage && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <div className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center">
                                    <Thermometer className="h-3.5 w-3.5 text-blue-600" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent><p>Cold Storage Available</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {storageSummary.hasFreezerStorage && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <div className="w-6 h-6 rounded bg-cyan-100 flex items-center justify-center">
                                    <Snowflake className="h-3.5 w-3.5 text-cyan-600" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent><p>Freezer Storage Available</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {storageSummary.hasDryStorage && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <div className="w-6 h-6 rounded bg-amber-100 flex items-center justify-center">
                                    <Package className="h-3.5 w-3.5 text-amber-600" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent><p>Dry Storage Available</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      )}

                      {/* Show placeholder if no equipment/storage data */}
                      {displayEquipment.length === 0 && (!storageSummary || storageSummary.totalStorageUnits === 0) && (
                        <span className="text-xs text-muted-foreground italic">Kitchen details available after booking</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 mt-auto pt-2">
                      {(app.status === 'approved' || app.status === 'inReview') && app.chat_conversation_id && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => {
                            if (!chefId) return;
                            onOpenChat(app);
                          }}
                        >
                          <MessageCircle className="h-4 w-4" />
                          Chat
                        </Button>
                      )}
                      {app.status === 'approved' && (
                        (app.current_tier ?? 1) >= 3 ? (
                          <Button
                            size="sm"
                            className="gap-2 bg-blue-600 hover:bg-blue-700"
                            onClick={() => {
                              onOpenBookingSheet({
                                id: app.locationId,
                                name: app.location?.name || 'Kitchen',
                                address: app.location?.address,
                              });
                            }}
                          >
                            <Calendar className="h-4 w-4" />
                            Book Now
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() => window.location.href = `/kitchen-requirements/${app.locationId}`}
                          >
                            <ArrowRight className="h-4 w-4" />
                            Complete Requirements
                          </Button>
                        )
                      )}
                      {app.status === 'inReview' && (
                        <Badge variant="secondary" className="text-xs">
                          <Clock className="h-3 w-3 mr-1" />
                          Awaiting manager review
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed border-2 py-16 bg-muted/5">
          <CardContent className="text-center flex flex-col items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
              <Building className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <CardTitle className="text-xl">No kitchen access yet</CardTitle>
              <CardDescription className="max-w-sm mx-auto">Explore commercial kitchens in your area and apply for access to start booking.</CardDescription>
            </div>
            <Button className="px-8 rounded-xl bg-blue-600 hover:bg-blue-700" onClick={() => onSetActiveTab("discover-kitchens")}>
              Explore Kitchens
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
