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
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { useTranslation } from "react-i18next";
import {
  Building,
  Calendar,
  Clock,
  MessageCircle,
  ArrowRight,
  Utensils,
  MapPin,
  Snowflake,
  Thermometer,
  Package,
  FileCheck,
} from "lucide-react";
import type {
  KitchenApplicationWithLocation,
  PublicKitchen,
  BookingLocation,
} from "./types";
import { ChefPageHeader } from "@/components/chef/ui";
import { TruncatedText } from "@/components/common/TruncatedText";
import { getKitchenDisplayStatus, toneToBadgeVariant } from "@/components/chef/applications/status";
import { SmartImage } from "@/components/ui/smart-image";
import { requestDiscoverKitchensWalkthrough } from "@/components/kitchen-application/DiscoverKitchensButtonTour";

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
  const { t } = useTranslation("chef");

  // Format price (cents to dollars)
  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(0)}`;

  return (
    <div className="space-y-8">
      <ChefPageHeader
        title={t("apptabMyKitchensTitle", "My kitchens")}
        description={t("apptabMyKitchensDesc", "Commercial kitchens you’ve applied to. Book when a kitchen is fully approved.")}
      />

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
            const display = getKitchenDisplayStatus(app, t);

            return (
              <Card
                key={app.id}
                className="group overflow-hidden shadow-none"
              >
                <div className="flex flex-col md:flex-row">
                  {/* Image Section */}
                  <div className="md:w-72 lg:w-80 flex-shrink-0">
                    <AspectRatio ratio={16 / 10} className="md:h-full">
                      {hasImage ? (
                        <SmartImage
                          src={getR2ProxyUrl(imageUrl)}
                          alt={app.location?.name || 'Kitchen'}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-muted">
                          <Building className="h-12 w-12 text-muted-foreground" />
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
                          <TruncatedText as="h3" className="truncate text-lg font-semibold">
                            {app.location?.name || t("apptabUnknownLocation", "Unknown Location")}
                          </TruncatedText>
                          <Badge variant={toneToBadgeVariant(display.tone)} className="font-medium">
                            {display.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                          <TruncatedText className="truncate">{app.location?.address || t("apptabAddressNotAvailable")}</TruncatedText>
                        </div>
                      </div>

                      {/* Price Badge */}
                      {priceDisplay && (
                        <div className="text-right flex-shrink-0">
                          <div className="flex items-center gap-1 text-lg font-bold text-foreground">
                            <span>{priceDisplay}</span>
                          </div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("apptabPerHour", "per hour")}</p>
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
                              {t("apptabMoreEquipment", { count: remainingEquipment, defaultValue: "+{count} more" })}
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
                                  <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
                                    <Thermometer className="h-3.5 w-3.5 text-muted-foreground" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent><p>{t("apptabColdStorageAvailable", "Cold Storage Available")}</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {storageSummary.hasFreezerStorage && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
                                    <Snowflake className="h-3.5 w-3.5 text-muted-foreground" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent><p>{t("apptabFreezerStorageAvailable", "Freezer Storage Available")}</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {storageSummary.hasDryStorage && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
                                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent><p>{t("apptabDryStorageAvailable", "Dry Storage Available")}</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      )}

                      {/* Show placeholder if no equipment/storage data */}
                      {displayEquipment.length === 0 && (!storageSummary || storageSummary.totalStorageUnits === 0) && (
                        <span className="text-xs text-muted-foreground italic">{t("apptabKitchenDetailsAfterBooking", "Kitchen details available after booking")}</span>
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
                          {t("apptabChat", "Chat")}
                        </Button>
                      )}
                      {app.status === "approved" &&
                        ((app.current_tier ?? 1) >= 3 ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              onOpenBookingSheet({
                                id: app.locationId,
                                name: app.location?.name || t("apptabKitchenFallback", "Kitchen"),
                                address: app.location?.address,
                              });
                            }}
                          >
                            <Calendar />
                            {t("apptabBook", "Book")}
                          </Button>
                        ) : display.actionKind === "wait" ? (
                          <Badge variant="outline" className="font-medium">
                            <FileCheck className="mr-1 h-3 w-3" />
                            {t("apptabStep2Submitted", "Step 2 submitted")}
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              window.location.href = `/kitchen-requirements/${app.locationId}`;
                            }}
                          >
                            <ArrowRight />
                            {t("apptabContinue", "Continue")}
                          </Button>
                        ))}
                      {app.status === "inReview" && (
                        <Badge variant="outline" className="font-medium">
                          <Clock className="mr-1 h-3 w-3" />
                          {t("apptabInReviewBadge", "In review")}
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
        <Card className="border-dashed py-16 shadow-none">
          <CardContent className="flex flex-col items-center gap-4 text-center">
            <Building className="h-8 w-8 text-muted-foreground" />
            <div className="space-y-1">
              <CardTitle className="text-lg">{t("apptabNoKitchenAccessYet", "No kitchen access yet")}</CardTitle>
              <CardDescription className="max-w-sm">
                {t("apptabBrowseKitchensDesc", "Browse commercial kitchens and apply to start booking.")}
              </CardDescription>
            </div>
            <Button
              onClick={() => {
                requestDiscoverKitchensWalkthrough();
                onSetActiveTab("discover-kitchens");
              }}
            >
              {t("apptabExploreKitchens", "Explore kitchens")}
              <ArrowRight />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
