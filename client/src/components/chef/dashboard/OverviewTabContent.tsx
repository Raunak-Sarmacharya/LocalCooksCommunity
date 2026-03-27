import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { formatDate, formatTime } from "@/lib/formatters";
import {
  BookOpen,
  Building,
  Calendar,
  Clock,
  FileText,
  Shield,
  Store,
  ArrowRight,
  Utensils,
  TrendingUp,
  MessageCircle,
} from "lucide-react";
import { formatApplicationStatus } from "@/lib/applicationSchema";
import type { 
  AnyApplication, 
  KitchenApplicationWithLocation, 
  KitchenSummary,
  MicrolearningCompletion,
  EnrichedBooking,
  StatusVariant
} from "./types";

interface OverviewTabContentProps {
  user: {
    displayName?: string | null;
  } | null;
  applications: AnyApplication[];
  kitchenApplications: KitchenApplicationWithLocation[];
  kitchenSummary: KitchenSummary;
  microlearningCompletion: MicrolearningCompletion | null | undefined;
  enrichedBookings: EnrichedBooking[];
  getMostRecentApplication: () => AnyApplication | null;
  getApplicationStatus: () => string | null;
  getDocumentStatus: () => string;
  getStatusVariant: (status: string) => StatusVariant;
  onSetActiveTab: (tab: string) => void;
  onSetApplicationViewMode: (mode: 'list' | 'form' | 'documents') => void;
  onBookSessionClick: () => void;
}

export default function OverviewTabContent({
  user,
  applications,
  kitchenApplications,
  kitchenSummary,
  microlearningCompletion,
  enrichedBookings,
  getMostRecentApplication,
  getApplicationStatus,
  getDocumentStatus,
  getStatusVariant,
  onSetActiveTab,
  onSetApplicationViewMode,
  onBookSessionClick,
}: OverviewTabContentProps) {
  
  // Helper to get kitchen app status for the overview cards
  const getKitchenAppStatus = (app: KitchenApplicationWithLocation) => {
    if (app.status === 'inReview') {
      return { label: 'In Review', variant: 'secondary' as const, color: 'bg-amber-500' };
    }
    if (app.status === 'rejected') {
      return { label: 'Rejected', variant: 'destructive' as const, color: 'bg-red-500' };
    }
    if (app.status === 'approved') {
      const tier = app.current_tier ?? 1;
      if (tier >= 3) {
        return { label: 'Ready to Book', variant: 'success' as const, color: 'bg-green-600' };
      }
      if (tier === 2 && app.tier2_completed_at) {
        return { label: 'Step 2 Review', variant: 'secondary' as const, color: 'bg-orange-500' };
      }
      if (tier === 2 && !app.tier2_completed_at) {
        return { label: 'Step 2 Pending', variant: 'secondary' as const, color: 'bg-blue-500' };
      }
      return { label: 'Step 1 Approved', variant: 'success' as const, color: 'bg-blue-600' };
    }
    return { label: 'Unknown', variant: 'outline' as const, color: 'bg-muted-foreground/40' };
  };

  // Dynamic greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  // Dynamic subtitle based on chef state
  const getSubtitle = () => {
    const pendingKitchens = kitchenApplications.filter(a => a.status === 'inReview').length;
    const activeBookings = enrichedBookings?.length || 0;
    const hasApp = applications?.length > 0;
    const appStatus = getApplicationStatus();

    if (!hasApp && kitchenApplications.length === 0) {
      return 'Get started by applying to sell or booking a commercial kitchen.';
    }
    if (appStatus === 'In Review' || pendingKitchens > 0) {
      const parts: string[] = [];
      if (appStatus === 'In Review') parts.push('your seller application is under review');
      if (pendingKitchens > 0) parts.push(`${pendingKitchens} kitchen application${pendingKitchens > 1 ? 's' : ''} pending`);
      return `Heads up \u2014 ${parts.join(' and ')}.`;
    }
    if (activeBookings > 0) {
      return `You have ${activeBookings} active booking${activeBookings > 1 ? 's' : ''}. Here\u2019s your dashboard.`;
    }
    return 'Here\u2019s an overview of your LocalCooks journey.';
  };

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {getGreeting()}{user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}!
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
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Seller Status</p>
              <p className="text-sm font-bold text-foreground">{getApplicationStatus() || "Not Started"}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
              <Building className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kitchen Access</p>
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
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Training</p>
              <p className="text-sm font-bold text-foreground">{microlearningCompletion?.confirmed ? "Completed" : "In Progress"}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
              <Calendar className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bookings</p>
              <p className="text-sm font-bold text-foreground">{enrichedBookings?.length || 0} Active</p>
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
                <Badge variant={getStatusVariant(getMostRecentApplication()?.status || "")} className="text-xs">
                  {formatApplicationStatus(getMostRecentApplication()?.status || "")}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Join our marketplace and sell your homemade food to customers in your area. We handle delivery, payments, and customer support.
            </p>
            
            {applications?.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Application #{getMostRecentApplication()?.id}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {getMostRecentApplication()?.createdAt ? new Date(getMostRecentApplication()!.createdAt).toLocaleDateString() : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Documents</span>
                  </div>
                  <Badge variant="outline" className="text-xs">{getDocumentStatus()}</Badge>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/10 text-center">
                <Utensils className="h-8 w-8 text-primary mx-auto mb-2" />
                <p className="text-sm font-medium">Ready to start selling?</p>
                <p className="text-xs text-muted-foreground">Apply now to become a LocalCooks seller</p>
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-muted/5 border-t border-border/30 pt-4">
            {applications?.length > 0 ? (
              <Button 
                variant="outline" 
                className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                onClick={() => onSetActiveTab("applications")}
              >
                View Application Details
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button 
                className="w-full"
                onClick={() => {
                  onSetApplicationViewMode('form');
                  onSetActiveTab('applications');
                }}
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
              Access our network of commercial kitchens. Apply to kitchens, get approved, and book time slots to prepare your food.
            </p>
            
            {kitchenApplications.length > 0 ? (
              <div className="space-y-3">
                {kitchenApplications.slice(0, 2).map((app) => {
                  const status = getKitchenAppStatus(app);
                  return (
                    <div key={app.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
                      <div className="flex items-center gap-2">
                        <Building className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium truncate max-w-[150px]">{app.location?.name || 'Kitchen'}</span>
                      </div>
                      <Badge 
                        variant={status.variant} 
                        className={cn("text-xs", status.color, "text-white hover:" + status.color)}
                      >
                        {status.label}
                      </Badge>
                    </div>
                  );
                })}
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
                  onClick={() => onSetActiveTab("kitchen-applications")}
                >
                  My Kitchens
                </Button>
                <Button 
                  variant="outline"
                  className="flex-1 group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                  onClick={() => onSetActiveTab("discover-kitchens")}
                >
                  Discover More
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button 
                variant="secondary"
                className="w-full"
                onClick={() => onSetActiveTab("discover-kitchens")}
              >
                Explore Kitchens
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>

      {/* Upcoming Bookings + Recent Activity */}
      {(enrichedBookings?.length > 0 || applications?.length > 0 || kitchenApplications.length > 0) && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Upcoming Bookings — Airbnb/Calendly pattern */}
          {enrichedBookings?.length > 0 && (() => {
            const statusBadgeConfig: Record<string, { label: string; dotColor: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" }> = {
              confirmed: { label: 'Confirmed', dotColor: 'bg-green-500', variant: 'success' },
              pending: { label: 'Awaiting Approval', dotColor: 'bg-amber-500', variant: 'secondary' },
              completed: { label: 'Completed', dotColor: 'bg-blue-500', variant: 'default' },
              cancelled: { label: 'Cancelled', dotColor: 'bg-red-400', variant: 'destructive' },
            };

            // Sort: pending first, then confirmed, then by booking date ascending
            const sortedBookings = [...enrichedBookings].sort((a, b) => {
              const priority: Record<string, number> = { pending: 0, confirmed: 1, completed: 2, cancelled: 3 };
              const pa = priority[a.status] ?? 4;
              const pb = priority[b.status] ?? 4;
              if (pa !== pb) return pa - pb;
              const dateA = a.bookingDate || '';
              const dateB = b.bookingDate || '';
              return dateA.localeCompare(dateB) || (a.startTime || '').localeCompare(b.startTime || '');
            });

            const displayBookings = sortedBookings.slice(0, 4);

            // Status summary counts
            const statusCounts: Record<string, number> = {};
            enrichedBookings.forEach((b) => {
              const s = b.status || 'unknown';
              statusCounts[s] = (statusCounts[s] || 0) + 1;
            });

            return (
              <Card className="border-border/50 shadow-sm overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                        <Calendar className="h-5 w-5 text-amber-600" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">Your Bookings</CardTitle>
                        <CardDescription>{enrichedBookings.length} total</CardDescription>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => onSetActiveTab("bookings")}
                    >
                      View all
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                  {/* Inline status summary — Linear-style dot + count row */}
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/40">
                    {Object.entries(statusCounts).map(([status, count]) => {
                      const config = statusBadgeConfig[status] || { label: status, dotColor: 'bg-muted-foreground' };
                      return (
                        <div key={status} className="flex items-center gap-1.5">
                          <span className={cn("h-2 w-2 rounded-full", config.dotColor)} />
                          <span className="text-xs text-muted-foreground">
                            {count} {config.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-1">
                    {displayBookings.map((booking, idx) => {
                      const config = statusBadgeConfig[booking.status] || { label: booking.status, dotColor: 'bg-muted-foreground', variant: 'outline' as const };
                      const bookingDateObj = booking.bookingDate ? new Date(booking.bookingDate + 'T00:00:00') : null;
                      const today = new Date();
                      const tomorrow = new Date(Date.now() + 86400000);
                      const isToday = bookingDateObj ? today.toDateString() === bookingDateObj.toDateString() : false;
                      const isTomorrow = bookingDateObj ? tomorrow.toDateString() === bookingDateObj.toDateString() : false;
                      
                      const dateLabel = !bookingDateObj ? '—' : isToday ? 'Today' : isTomorrow ? 'Tomorrow' : formatDate(booking.bookingDate, 'short');
                      const timeLabel = booking.startTime && booking.endTime ? `${formatTime(booking.startTime)} – ${formatTime(booking.endTime)}` : '';

                      return (
                        <div 
                          key={booking.id}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg transition-colors hover:bg-muted/50 cursor-pointer",
                            idx < displayBookings.length - 1 && "border-b border-border/30"
                          )}
                          onClick={() => onSetActiveTab("bookings")}
                        >
                          {/* Date block */}
                          <div className="flex-shrink-0 w-12 text-center">
                            <p className={cn(
                              "text-xs font-semibold uppercase tracking-wide",
                              isToday ? "text-primary" : "text-muted-foreground"
                            )}>
                              {dateLabel}
                            </p>
                            {booking.startTime && (
                              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                                {formatTime(booking.startTime)}
                              </p>
                            )}
                          </div>
                          {/* Vertical accent line */}
                          <div className={cn("w-0.5 h-10 rounded-full flex-shrink-0", config.dotColor)} />
                          {/* Booking details */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {booking.kitchenName || booking.locationName || 'Kitchen Session'}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{timeLabel}</p>
                          </div>
                          {/* Status badge */}
                          <Badge variant={config.variant} className="text-[10px] flex-shrink-0">
                            {config.label}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                  {enrichedBookings.length > 4 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full mt-3 text-xs"
                      onClick={() => onSetActiveTab("bookings")}
                    >
                      +{enrichedBookings.length - 4} more booking{enrichedBookings.length - 4 !== 1 ? 's' : ''}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Recent Activity Feed */}
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                  <Clock className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <CardTitle className="text-lg">Recent Activity</CardTitle>
                  <CardDescription>Your latest actions</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[200px] overflow-y-auto">
                {/* Generate activity items from existing data */}
                {[...(applications || []).map(app => ({
                  icon: Store,
                  color: 'text-primary',
                  label: `Seller application ${app.status === 'approved' ? 'approved' : app.status === 'inReview' ? 'submitted' : app.status}`,
                  time: app.createdAt ? formatDate(app.createdAt, 'short') : '',
                  sortDate: app.createdAt ? new Date(app.createdAt).getTime() : 0,
                })),
                ...kitchenApplications.map(app => ({
                  icon: Building,
                  color: 'text-blue-600',
                  label: `Applied to ${app.location?.name || 'kitchen'}`,
                  time: app.createdAt ? formatDate(app.createdAt, 'short') : '',
                  sortDate: app.createdAt ? new Date(app.createdAt).getTime() : 0,
                })),
                ...(enrichedBookings || []).slice(0, 3).map(b => ({
                  icon: Calendar,
                  color: 'text-amber-600',
                  label: `Booking at ${b.kitchenName || b.locationName || 'kitchen'} — ${b.status}`,
                  time: b.bookingDate ? formatDate(b.bookingDate, 'short') : '',
                  sortDate: b.bookingDate ? new Date(b.bookingDate + 'T00:00:00').getTime() : 0,
                })),
                ].sort((a, b) => b.sortDate - a.sortDate).slice(0, 5).map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="mt-0.5">
                      <item.icon className={cn("h-4 w-4", item.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.time}</p>
                    </div>
                  </div>
                ))}
                {applications?.length === 0 && kitchenApplications.length === 0 && enrichedBookings?.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No recent activity yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
                onClick={() => {
                  onSetApplicationViewMode('form');
                  onSetActiveTab('applications');
                }}
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
                onClick={() => onSetActiveTab("discover-kitchens")}
              >
                <Building className="h-5 w-5 text-blue-600" />
                <div className="text-left">
                  <p className="font-medium text-sm">Find a Kitchen</p>
                  <p className="text-xs text-muted-foreground">Browse commercial spaces</p>
                </div>
              </Button>
            )}

            {enrichedBookings?.length === 0 && kitchenApplications.some(a => a.status === 'approved') && (
              <Button 
                variant="outline" 
                className="h-auto py-4 px-4 justify-start gap-3 hover:bg-primary/5 hover:border-primary/20"
                onClick={onBookSessionClick}
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
              onClick={() => onSetActiveTab("messages")}
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
