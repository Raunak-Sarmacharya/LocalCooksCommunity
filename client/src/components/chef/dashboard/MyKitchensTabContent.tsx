import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import {
  Building,
  Calendar,
  Clock,
  MessageCircle,
  ArrowRight,
  FileCheck,
} from "lucide-react";
import type {
  KitchenApplicationWithLocation,
  PublicKitchen,
  BookingLocation,
} from "./types";
import { ChefPageHeader } from "@/components/chef/ui";
import { getKitchenDisplayStatus } from "@/components/chef/applications/status";
import { KitchenGridCard } from "@/components/kitchen/KitchenGridCard";
import { requestDiscoverKitchensWalkthrough } from "@/components/kitchen-application/DiscoverKitchensButtonTour";
import { chefOutlineCtaClass, chefPrimaryCtaClass } from "@/lib/chef-cta";
import { kitchenPreviewPath } from "@/lib/discover-location-groups";
import {
  mergeEquipmentLists,
  mergeStorageSummaries,
} from "@/lib/kitchen-grid-card";
import { cn } from "@/lib/utils";

interface MyKitchensTabContentProps {
  kitchenApplications: KitchenApplicationWithLocation[];
  publicKitchens: PublicKitchen[] | undefined;
  chefId: number | null;
  onSetActiveTab: (tab: string) => void;
  onOpenBookingSheet: (location: BookingLocation) => void;
  onOpenChat: (app: KitchenApplicationWithLocation) => void;
}

const actionClass = "h-11 min-h-[44px] w-full box-border font-semibold";
const outlineActionClass = cn(
  actionClass,
  chefOutlineCtaClass(),
  "border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 hover:text-gray-900"
);

export default function MyKitchensTabContent({
  kitchenApplications,
  publicKitchens,
  chefId,
  onSetActiveTab,
  onOpenBookingSheet,
  onOpenChat,
}: MyKitchensTabContentProps) {
  const { t } = useTranslation("chef");

  return (
    <div className="space-y-8">
      <ChefPageHeader
        title={t("apptabMyKitchensTitle", "My kitchens")}
        description={t(
          "apptabMyKitchensDesc",
          "Commercial kitchens you’ve applied to. Book when a kitchen is fully approved."
        )}
      />

      {kitchenApplications.length > 0 ? (
        <div className="grid auto-rows-fr grid-cols-1 items-stretch gap-6 md:grid-cols-2 xl:grid-cols-3">
          {kitchenApplications.map((app) => {
            const kitchensAtLocation =
              publicKitchens?.filter((k) => k.locationId === app.locationId) ?? [];
            const kitchenData =
              kitchensAtLocation.find((k) => !!k.imageUrl) ||
              kitchensAtLocation.find((k) => (k.galleryImages?.length ?? 0) > 0) ||
              kitchensAtLocation[0];
            const imageUrl =
              kitchenData?.imageUrl || kitchenData?.galleryImages?.[0] || null;
            const equipment = mergeEquipmentLists(
              kitchensAtLocation.map((k) => k.equipment)
            );
            const storageSummary = mergeStorageSummaries(
              kitchensAtLocation.map((k) => k.storageSummary)
            );
            const display = getKitchenDisplayStatus(app, t);
            const title =
              app.location?.name || t("apptabUnknownLocation", "Unknown Location");
            const previewHref = kitchenPreviewPath(
              app.locationId,
              kitchenData?.locationSlug
            );

            const showChat =
              (app.status === "approved" || app.status === "inReview") &&
              !!app.chat_conversation_id;

            // Same single footer slot as Discover — primary CTA only; Chat is icon beside it
            let primary: ReactNode = (
              <Button
                variant="outline"
                className={outlineActionClass}
                onClick={() => {
                  window.location.href = previewHref;
                }}
              >
                {t("apptabViewDetails", "View details")}
              </Button>
            );
            if (app.status === "approved") {
              if ((app.current_tier ?? 1) >= 3) {
                primary = (
                  <Button
                    className={chefPrimaryCtaClass(actionClass)}
                    onClick={() => {
                      onOpenBookingSheet({
                        id: app.locationId,
                        name:
                          app.location?.name ||
                          t("apptabKitchenFallback", "Kitchen"),
                        address: app.location?.address,
                      });
                    }}
                  >
                    <Calendar className="mr-1.5 h-4 w-4" />
                    {t("apptabBook", "Book")}
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Button>
                );
              } else if (display.actionKind === "wait") {
                primary = (
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-11 w-full justify-center font-medium",
                      chefOutlineCtaClass()
                    )}
                  >
                    <FileCheck className="mr-1 h-3 w-3" />
                    {t("apptabStep2Submitted", "Step 2 submitted")}
                  </Badge>
                );
              } else {
                primary = (
                  <Button
                    variant="outline"
                    className={outlineActionClass}
                    onClick={() => {
                      window.location.href = `/kitchen-requirements/${app.locationId}`;
                    }}
                  >
                    <ArrowRight className="mr-1.5 h-4 w-4" />
                    {t("apptabContinue", "Continue")}
                  </Button>
                );
              }
            } else if (app.status === "inReview") {
              primary = (
                <Badge
                  variant="outline"
                  className={cn(
                    "h-11 w-full justify-center font-medium",
                    chefOutlineCtaClass()
                  )}
                >
                  <Clock className="mr-1 h-3 w-3" />
                  {t("apptabInReviewBadge", "In review")}
                </Badge>
              );
            }

            return (
              <KitchenGridCard
                key={app.id}
                title={title}
                address={
                  app.location?.address ||
                  t("apptabAddressNotAvailable", "Address not available")
                }
                imageUrl={imageUrl}
                hourlyRateCents={kitchenData?.hourlyRate}
                equipment={equipment}
                storageSummary={storageSummary}
                overlayChip={
                  <span className="inline-flex items-center rounded-full bg-background/95 px-3 py-1.5 text-xs font-medium shadow-sm">
                    {display.label}
                  </span>
                }
                onCardClick={() => {
                  window.location.href = previewHref;
                }}
                actionRows={1}
                actions={
                  <div className="flex w-full gap-2">
                    {showChat ? (
                      <Button
                        variant="outline"
                        size="icon"
                        className={cn(
                          outlineActionClass,
                          "w-11 shrink-0 px-0"
                        )}
                        aria-label={t("apptabChat", "Chat")}
                        onClick={() => {
                          if (!chefId) return;
                          onOpenChat(app);
                        }}
                      >
                        <MessageCircle className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <div className="min-w-0 flex-1">{primary}</div>
                  </div>
                }
              />
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed py-16 shadow-none">
          <CardContent className="flex flex-col items-center gap-4 text-center">
            <Building className="h-8 w-8 text-muted-foreground" />
            <div className="space-y-1">
              <CardTitle className="text-lg">
                {t("apptabNoKitchenAccessYet", "No kitchen access yet")}
              </CardTitle>
              <CardDescription className="max-w-sm">
                {t(
                  "apptabBrowseKitchensDesc",
                  "Browse commercial kitchens and apply to start booking."
                )}
              </CardDescription>
            </div>
            <Button
              className={chefPrimaryCtaClass()}
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
