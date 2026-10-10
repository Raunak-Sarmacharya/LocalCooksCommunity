import { Card } from "@/components/ui/card";
import { InfoChip } from "@/components/chef/info-chip";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Building, MapPin, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ChefKitchenApplication } from "@shared/schema";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { parseBusinessInfo, formatExperience, formatExpiryDate } from "@/utils/parseBusinessInfo";
import { SecureDocumentLink } from "@/components/common/SecureDocumentLink";
import { VerifiedDocumentChip } from "@/components/common/VerifiedDocumentChip";
import { TruncatedText } from "@/components/common/TruncatedText";
import { getKitchenDisplayStatus } from "./status";
import { KitchenStatusChip, bookNowIcon as BookNowIcon } from "./status-icons";
import { SmartImage } from "@/components/ui/smart-image";
import "./kitchen-application-details.css";

interface KitchenApplicationWithLocation extends ChefKitchenApplication {
  location: {
    id: number;
    name: string;
    address: string;
    logoUrl?: string;
    brandImageUrl?: string;
  } | null;
}

interface KitchenApplicationCardProps {
  application: KitchenApplicationWithLocation;
  kitchenImageUrl?: string | null;
  onBookKitchen: (locationId: number, locationName: string, locationAddress?: string) => void;
  onDiscoverKitchens: () => void;
}

export { KitchenApplicationDetails } from "./KitchenApplicationDetails";

export default function KitchenApplicationCard({
  application: app,
  kitchenImageUrl,
  onBookKitchen,
}: KitchenApplicationCardProps) {
  /*
   * "View details" opens the My Kitchen Applications tab, where the application
   * details already live. A second copy of them in a Sheet would only drift.
   */
  const [, navigate] = useLocation();
  const { t } = useTranslation("chef");

  /*
   * The dashboard switches tabs from `popstate`, but wouter's `navigate()` is a
   * pushState on the SAME pathname (/dashboard) — only the `?view=` changes, so the
   * dashboard's [location] effect never re-runs and the tab would stay where it was
   * while the address bar said otherwise. Firing a popstate makes it actually switch.
   */
  const openKitchenApplications = () => {
    navigate(`/dashboard?view=kitchen-requests&application=${app.id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const imageUrl = kitchenImageUrl || app.location?.brandImageUrl;
  const display = getKitchenDisplayStatus(app, t);
  const kitchenName = app.location?.name || t("apptabKitchenApplication");

  return (
    <>
      <Card className="overflow-hidden shadow-none">
        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            {imageUrl ? (
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border">
                <SmartImage
                  src={getR2ProxyUrl(imageUrl)}
                  alt={kitchenName}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Building className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <TruncatedText className="block break-words font-medium">{kitchenName}</TruncatedText>
              <div className="mt-1.5"><KitchenStatusChip display={display} /></div>
            </div>
          </div>
          <p className="mt-3 flex min-w-0 items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{app.location?.address || t("apptabAddressNotAvailable")}</span>
          </p>
          {display.actionKind !== "book" && <p className="mt-1 text-xs text-muted-foreground">{display.stepCaption}</p>}
          <div className="mt-4 flex min-w-0 flex-wrap gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-w-0 flex-1 sm:flex-none"
                onClick={openKitchenApplications}
              >
                <Eye />
                {t("apptabViewDetails")}
              </Button>
              {display.actionKind === "book" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-w-0 flex-1 sm:flex-none"
                  onClick={() =>
                    onBookKitchen(
                      app.locationId,
                      app.location?.name || t("apptabKitchenFallback"),
                      app.location?.address
                    )
                  }
                >
                  <BookNowIcon />
                  {t("apptabBook")}
                </Button>
              )}
              {display.actionKind === "complete-step" && (
                <Button size="sm" variant="outline" className="min-w-0 flex-1 sm:flex-none" asChild>
                  <Link href={`/kitchen-requirements/${app.locationId}`}>{t("apptabContinue")}</Link>
                </Button>
              )}
              {display.actionKind === "discover" && (
                <Button size="sm" variant="outline" className="min-w-0 flex-1 sm:flex-none" asChild>
                  <Link href={`/apply-kitchen/${app.locationId}`}>
                    {t("kdApplyAgain", "Apply again")}
                  </Link>
                </Button>
              )}
          </div>
        </div>
      </Card>
    </>
  );
}
