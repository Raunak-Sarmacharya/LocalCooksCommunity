import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  BookOpen,
  Building,
  Calendar,
  FileText,
  Shield,
  MessageCircle,
  Store,
  ArrowRight,
  Utensils,
  TrendingUp,
} from "lucide-react";
import { Link } from "wouter";
import { Application } from "@shared/schema";
import { formatApplicationStatus } from "@/lib/applicationSchema";
import { StatTile } from "@/components/chef/ui";
import { TruncatedText } from "@/components/common/TruncatedText";
import { applicationStatusVariant } from "@/components/chef/applications/status";
import { useTranslation } from "react-i18next";

interface ChefOverviewProps {
  user: { displayName?: string | null } | null;
  applications: Application[];
  kitchenApplications: any[];
  enrichedBookings: any[];
  microlearningCompletion: { confirmed?: boolean } | null;
  onNavigate: (tab: string) => void;
  onStartApplication?: () => void;
  getMostRecentApplication: () => Application | null;
  getApplicationStatus: () => string | null;
  getDocumentStatus: () => string;
  getStatusVariant: (status: string) => "default" | "secondary" | "destructive" | "outline";
}

export function ChefOverview({
  user,
  applications,
  kitchenApplications,
  enrichedBookings,
  microlearningCompletion,
  onNavigate,
  onStartApplication,
  getMostRecentApplication,
  getApplicationStatus,
  getDocumentStatus,
  getStatusVariant,
}: ChefOverviewProps) {
  const { t } = useTranslation("chef");

  // Helper to get kitchen applications status summary
  const getKitchenAccessSummary = () => {
    const approved = kitchenApplications.filter((a) => a.status === "approved").length;
    const pending = kitchenApplications.filter((a) => a.status === "inReview").length;
    const total = kitchenApplications.length;
    if (total === 0) return { label: t("overviewNotStarted", "Not Started"), variant: "outline" as const };
    if (approved > 0) return { label: t("overviewApprovedCount", { count: approved, defaultValue: "{count} Approved" }), variant: "success" as const };
    if (pending > 0) return { label: t("overviewPendingCount", { count: pending, defaultValue: "{count} Pending" }), variant: "outline" as const };
    return { label: t("overviewTotalCount", { count: total, defaultValue: "{count} Total" }), variant: "outline" as const };
  };

  const kitchenSummary = getKitchenAccessSummary();

  // Dynamic greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t("overviewGoodMorning", "Good morning");
    if (hour < 17) return t("overviewGoodAfternoon", "Good afternoon");
    return t("overviewGoodEvening", "Good evening");
  };

  // Dynamic subtitle based on chef's current state
  const getSubtitle = () => {
    const pendingKitchens = kitchenApplications.filter(a => a.status === "inReview").length;
    const activeBookings = enrichedBookings?.length || 0;
    const hasApp = applications?.length > 0;
    const appStatus = getApplicationStatus();

    if (!hasApp && kitchenApplications.length === 0) {
      return t("overviewGetStartedSubtitle", "Get started by applying to sell or booking a commercial kitchen.");
    }
    if (appStatus === "In Review" || pendingKitchens > 0) {
      const parts: string[] = [];
      if (appStatus === "In Review") parts.push(t("overviewSellerAppUnderReview", "your seller application is under review"));
      if (pendingKitchens > 0) parts.push(t("overviewKitchenAppsPending", { count: pendingKitchens, defaultValue: "{count, plural, one {# kitchen application pending} other {# kitchen applications pending}}" }));
      return t("overviewHeadsUpPrefix", { parts: parts.join(` ${t("overviewAndJoiner", "and")} `), defaultValue: "Heads up — {parts}." });
    }
    if (activeBookings > 0) {
      return t("overviewActiveBookingsSubtitle", { count: activeBookings, defaultValue: "{count, plural, one {You have # active booking. Here\u2019s your dashboard.} other {You have # active bookings. Here\u2019s your dashboard.}}" });
    }
    return t("overviewDefaultSubtitle", "Here\u2019s an overview of your LocalCooks journey.");
  };

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {getGreeting()}{user?.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}!
          </h1>
          <p className="text-muted-foreground mt-1">
            {getSubtitle()}
          </p>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("overviewSellerStatus", "Seller Status")}
          value={getApplicationStatus() || t("overviewNotStarted", "Not Started")}
          tone="neutral"
        />
        <StatTile
          label={t("overviewKitchenAccess", "Kitchen Access")}
          value={kitchenSummary.label}
          tone={kitchenSummary.variant === "success" ? "success" : "neutral"}
        />
        <StatTile
          label={t("overviewTraining", "Training")}
          value={microlearningCompletion?.confirmed ? t("overviewCompleted", "Completed") : t("overviewNotStarted", "Not Started")}
          tone={microlearningCompletion?.confirmed ? "success" : "neutral"}
        />
        <StatTile
          label={t("overviewBookings", "Bookings")}
          value={enrichedBookings?.length ? t("overviewBookingsActiveCount", { count: enrichedBookings.length, defaultValue: "{count} Active" }) : t("overviewNone", "None")}
          tone={enrichedBookings?.length ? "progress" : "neutral"}
        />
      </div>

      {/* Two Path Cards - Sell on LocalCooks & Kitchen Access */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Sell on LocalCooks Path */}
        <Card className="shadow-none overflow-hidden group">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg border flex items-center justify-center">
                  <Store className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-xl">{t("overviewSellOnLocalCooksTitle", "Sell on LocalCooks")}</CardTitle>
                  <CardDescription>{t("overviewSellOnLocalCooksDesc", "Become a verified seller on our platform")}</CardDescription>
                </div>
              </div>
              {applications?.length > 0 && (
                <Badge
                  variant={applicationStatusVariant(getMostRecentApplication()?.status || "")}
                  className="text-xs"
                >
                  {formatApplicationStatus(getMostRecentApplication()?.status || "")}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("overviewSellOnLocalCooksBody", "Join our marketplace and sell your homemade food to customers in your area. We handle delivery, payments, and customer support.")}
            </p>

            {applications?.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {t("overviewApplicationNumber", { id: getMostRecentApplication()?.id, defaultValue: "Application #{id}" })}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {getMostRecentApplication()?.createdAt
                      ? new Date(getMostRecentApplication()!.createdAt).toLocaleDateString()
                      : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{t("overviewDocuments", "Documents")}</span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {getDocumentStatus()}
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg border text-center">
                <Utensils className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm font-medium">{t("overviewReadyToStartSelling", "Ready to start selling?")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("overviewApplyNowToSell", "Apply now to become a LocalCooks seller")}
                </p>
              </div>
            )}
          </CardContent>
          <CardFooter className="border-t pt-4">
            {applications?.length > 0 ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => onNavigate("applications")}
              >
                {t("overviewViewApplicationDetails", "View Application Details")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button 
                className="w-full"
                onClick={onStartApplication}
              >
                {t("overviewApplyToSell", "Apply to Sell")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* Kitchen Access Path */}
        <Card className="shadow-none overflow-hidden group">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg border flex items-center justify-center">
                  <Building className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-xl">{t("overviewKitchenAccess", "Kitchen Access")}</CardTitle>
                  <CardDescription>{t("overviewBookCommercialKitchenSpaces", "Book commercial kitchen spaces")}</CardDescription>
                </div>
              </div>
              {kitchenApplications.length > 0 && (
                <Badge variant={kitchenSummary.variant} className="text-xs">
                  {kitchenSummary.label}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("overviewKitchenAccessBody", "Access our network of commercial kitchens. Apply to kitchens, get approved, and book time slots to prepare your food.")}
            </p>

            {kitchenApplications.length > 0 ? (
              <div className="space-y-3">
                {kitchenApplications.slice(0, 2).map((app) => (
                  <div
                    key={app.id}
                    className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50"
                  >
                    <div className="flex items-center gap-2">
                      <Building className="h-4 w-4 text-muted-foreground" />
                      <TruncatedText className="text-sm font-medium truncate max-w-[150px]">
                        {app.location?.name || t("overviewKitchenFallbackName", "Kitchen")}
                      </TruncatedText>
                    </div>
                    <Badge
                      variant={app.status === "approved" ? "success" : "outline"}
                      className="text-xs"
                    >
                      {app.status === "approved" ? t("overviewStatusApproved", "Approved") : t("overviewStatusPending", "Pending")}
                    </Badge>
                  </div>
                ))}
                {kitchenApplications.length > 2 && (
                  <p className="text-xs text-muted-foreground text-center">
                    {t("overviewMoreKitchens", { count: kitchenApplications.length - 2, defaultValue: "{count, plural, one {+# more kitchen} other {+# more kitchens}}" })}
                  </p>
                )}
              </div>
            ) : (
              <div className="p-4 rounded-lg border text-center">
                <Building className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm font-medium">{t("overviewNeedCommercialKitchen", "Need a commercial kitchen?")}</p>
                <p className="text-xs text-muted-foreground">{t("overviewExplorePartnerKitchens", "Explore our partner kitchens")}</p>
              </div>
            )}
          </CardContent>
          <CardFooter className="border-t pt-4 gap-2">
            {kitchenApplications.length > 0 ? (
              <>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => onNavigate("kitchen-applications")}
                >
                  {t("overviewMyKitchensButton", "My Kitchens")}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => (window.location.href = "/compare-kitchens")}
                >
                  {t("overviewDiscoverMore", "Discover More")}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => (window.location.href = "/compare-kitchens")}
              >
                {t("overviewExploreKitchens", "Explore Kitchens")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>

      {/* Quick Actions / Next Steps */}
      <Card className="shadow-none">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg border flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-lg">{t("overviewRecommendedNextSteps", "Recommended Next Steps")}</CardTitle>
              <CardDescription>{t("overviewContinueJourney", "Continue your journey with LocalCooks")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {!microlearningCompletion?.confirmed && (
              <Button
                variant="outline"
                className="h-auto py-4 px-4 justify-start gap-3"
                asChild
              >
                <Link href="/dashboard?view=training">
                  <BookOpen className="h-5 w-5 text-muted-foreground" />
                  <div className="text-left">
                    <p className="font-medium text-sm">{t("overviewStartTraining", "Start Training")}</p>
                    <p className="text-xs text-muted-foreground">{t("overviewFoodSafetyVideos", "Food safety videos (not official cert)")}</p>
                  </div>
                </Link>
              </Button>
            )}

            {applications?.length === 0 && (
              <Button
                variant="outline"
                className="h-auto py-4 px-4 justify-start gap-3"
                onClick={onStartApplication}
              >
                <Store className="h-5 w-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="font-medium text-sm">{t("overviewApplyToSell", "Apply to Sell")}</p>
                  <p className="text-xs text-muted-foreground">{t("overviewStartSellerJourney", "Start your seller journey")}</p>
                </div>
              </Button>
            )}

            {kitchenApplications.length === 0 && (
              <Button
                variant="outline"
                className="h-auto py-4 px-4 justify-start gap-3"
                onClick={() => (window.location.href = "/compare-kitchens")}
              >
                <Building className="h-5 w-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="font-medium text-sm">{t("overviewFindKitchen", "Find a Kitchen")}</p>
                  <p className="text-xs text-muted-foreground">{t("overviewBrowseCommercialSpaces", "Browse commercial spaces")}</p>
                </div>
              </Button>
            )}

            {enrichedBookings?.length === 0 &&
              kitchenApplications.some((a) => a.status === "approved") && (
                <Button
                  variant="outline"
                  className="h-auto py-4 px-4 justify-start gap-3"
                  onClick={() => onNavigate("bookings")}
                >
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div className="text-left">
                    <p className="font-medium text-sm">{t("overviewBookSession", "Book a Session")}</p>
                    <p className="text-xs text-muted-foreground">{t("overviewScheduleKitchenTime", "Schedule kitchen time")}</p>
                  </div>
                </Button>
              )}

            <Button
              variant="outline"
              className="h-auto py-4 px-4 justify-start gap-3"
              onClick={() => onNavigate("messages")}
            >
              <MessageCircle className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium text-sm">{t("overviewMessages", "Messages")}</p>
                <p className="text-xs text-muted-foreground">{t("overviewChatWithManagers", "Chat with managers")}</p>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
