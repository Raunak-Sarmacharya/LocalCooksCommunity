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
  // Helper to get kitchen applications status summary
  const getKitchenAccessSummary = () => {
    const approved = kitchenApplications.filter((a) => a.status === "approved").length;
    const pending = kitchenApplications.filter((a) => a.status === "inReview").length;
    const total = kitchenApplications.length;
    if (total === 0) return { label: "No Applications", variant: "outline" as const };
    if (approved > 0) return { label: `${approved} Approved`, variant: "success" as const };
    if (pending > 0) return { label: `${pending} Pending`, variant: "secondary" as const };
    return { label: `${total} Total`, variant: "outline" as const };
  };

  const kitchenSummary = getKitchenAccessSummary();

  // Dynamic greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  // Dynamic subtitle based on chef's current state
  const getSubtitle = () => {
    const pendingKitchens = kitchenApplications.filter(a => a.status === "inReview").length;
    const activeBookings = enrichedBookings?.length || 0;
    const hasApp = applications?.length > 0;
    const appStatus = getApplicationStatus();

    if (!hasApp && kitchenApplications.length === 0) {
      return "Get started by applying to sell or booking a commercial kitchen.";
    }
    if (appStatus === "In Review" || pendingKitchens > 0) {
      const parts: string[] = [];
      if (appStatus === "In Review") parts.push("your seller application is under review");
      if (pendingKitchens > 0) parts.push(`${pendingKitchens} kitchen application${pendingKitchens > 1 ? "s" : ""} pending`);
      return `Heads up — ${parts.join(" and ")}.`;
    }
    if (activeBookings > 0) {
      return `You have ${activeBookings} active booking${activeBookings > 1 ? "s" : ""}. Here\u2019s your dashboard.`;
    }
    return "Here\u2019s an overview of your LocalCooks journey.";
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
        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <Store className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Seller Status
              </p>
              <p className="text-sm font-bold text-foreground">
                {getApplicationStatus() || "Not Started"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
              <Building className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Kitchen Access
              </p>
              <p className="text-sm font-bold text-foreground">{kitchenSummary.label}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center border border-green-500/20">
              <BookOpen className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Training
              </p>
              <p className="text-sm font-bold text-foreground">
                {microlearningCompletion?.confirmed ? "Completed" : "In Progress"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
              <Calendar className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Bookings
              </p>
              <p className="text-sm font-bold text-foreground">
                {enrichedBookings?.length || 0} Active
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two Path Cards - Sell on LocalCooks & Kitchen Access */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Sell on LocalCooks Path */}
        <Card className="border-border/50 shadow-sm overflow-hidden group hover:shadow-lg transition-all">
          <div className="h-2 bg-gradient-to-r from-primary to-primary/60" />
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                  <Store className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Sell on LocalCooks</CardTitle>
                  <CardDescription>Become a verified seller on our platform</CardDescription>
                </div>
              </div>
              {applications?.length > 0 && (
                <Badge
                  variant={getStatusVariant(getMostRecentApplication()?.status || "")}
                  className="text-xs"
                >
                  {formatApplicationStatus(getMostRecentApplication()?.status || "")}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Join our marketplace and sell your homemade food to customers in your area. We
              handle delivery, payments, and customer support.
            </p>

            {applications?.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      Application #{getMostRecentApplication()?.id}
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
                    <span className="text-sm font-medium">Documents</span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {getDocumentStatus()}
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/10 text-center">
                <Utensils className="h-8 w-8 text-primary mx-auto mb-2" />
                <p className="text-sm font-medium">Ready to start selling?</p>
                <p className="text-xs text-muted-foreground">
                  Apply now to become a LocalCooks seller
                </p>
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-muted/5 border-t border-border/30 pt-4">
            {applications?.length > 0 ? (
              <Button
                variant="outline"
                className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                onClick={() => onNavigate("applications")}
              >
                View Application Details
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button 
                className="w-full"
                onClick={onStartApplication}
              >
                Apply to Sell
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* Kitchen Access Path */}
        <Card className="border-border/50 shadow-sm overflow-hidden group hover:shadow-lg transition-all">
          <div className="h-2 bg-gradient-to-r from-blue-600 to-blue-400" />
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <Building className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-xl">Kitchen Access</CardTitle>
                  <CardDescription>Book commercial kitchen spaces</CardDescription>
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
              Access our network of commercial kitchens. Apply to kitchens, get approved, and
              book time slots to prepare your food.
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
                      <span className="text-sm font-medium truncate max-w-[150px]">
                        {app.location?.name || "Kitchen"}
                      </span>
                    </div>
                    <Badge
                      variant={app.status === "approved" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {app.status === "approved" ? "Approved" : "Pending"}
                    </Badge>
                  </div>
                ))}
                {kitchenApplications.length > 2 && (
                  <p className="text-xs text-muted-foreground text-center">
                    +{kitchenApplications.length - 2} more kitchens
                  </p>
                )}
              </div>
            ) : (
              <div className="p-4 bg-blue-500/5 rounded-lg border border-blue-500/10 text-center">
                <Building className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                <p className="text-sm font-medium">Need a commercial kitchen?</p>
                <p className="text-xs text-muted-foreground">Explore our partner kitchens</p>
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-muted/5 border-t border-border/30 pt-4 gap-2">
            {kitchenApplications.length > 0 ? (
              <>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => onNavigate("kitchen-applications")}
                >
                  My Kitchens
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                  onClick={() => (window.location.href = "/compare-kitchens")}
                >
                  Discover More
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => (window.location.href = "/compare-kitchens")}
              >
                Explore Kitchens
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>

      {/* Quick Actions / Next Steps */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
              <TrendingUp className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <CardTitle className="text-lg">Recommended Next Steps</CardTitle>
              <CardDescription>Continue your journey with LocalCooks</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {!microlearningCompletion?.confirmed && (
              <Button
                variant="outline"
                className="h-auto py-4 px-4 justify-start gap-3 hover:bg-primary/5 hover:border-primary/20"
                asChild
              >
                <Link href="/microlearning/overview">
                  <BookOpen className="h-5 w-5 text-green-600" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Complete Training</p>
                    <p className="text-xs text-muted-foreground">Food safety certification</p>
                  </div>
                </Link>
              </Button>
            )}

            {applications?.length === 0 && (
              <Button
                variant="outline"
                className="h-auto py-4 px-4 justify-start gap-3 hover:bg-primary/5 hover:border-primary/20"
                onClick={onStartApplication}
              >
                <Store className="h-5 w-5 text-primary" />
                <div className="text-left">
                  <p className="font-medium text-sm">Apply to Sell</p>
                  <p className="text-xs text-muted-foreground">Start your seller journey</p>
                </div>
              </Button>
            )}

            {kitchenApplications.length === 0 && (
              <Button
                variant="outline"
                className="h-auto py-4 px-4 justify-start gap-3 hover:bg-primary/5 hover:border-primary/20"
                onClick={() => (window.location.href = "/compare-kitchens")}
              >
                <Building className="h-5 w-5 text-blue-600" />
                <div className="text-left">
                  <p className="font-medium text-sm">Find a Kitchen</p>
                  <p className="text-xs text-muted-foreground">Browse commercial spaces</p>
                </div>
              </Button>
            )}

            {enrichedBookings?.length === 0 &&
              kitchenApplications.some((a) => a.status === "approved") && (
                <Button
                  variant="outline"
                  className="h-auto py-4 px-4 justify-start gap-3 hover:bg-primary/5 hover:border-primary/20"
                  onClick={() => onNavigate("bookings")}
                >
                  <Calendar className="h-5 w-5 text-amber-600" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Book a Session</p>
                    <p className="text-xs text-muted-foreground">Schedule kitchen time</p>
                  </div>
                </Button>
              )}

            <Button
              variant="outline"
              className="h-auto py-4 px-4 justify-start gap-3 hover:bg-primary/5 hover:border-primary/20"
              onClick={() => onNavigate("messages")}
            >
              <MessageCircle className="h-5 w-5 text-purple-600" />
              <div className="text-left">
                <p className="font-medium text-sm">Messages</p>
                <p className="text-xs text-muted-foreground">Chat with managers</p>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
