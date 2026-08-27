import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { QuietNotice, StatTile, StatusDot } from "@/components/chef/ui";
import type { StatusTone } from "@/components/chef/applications/status";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";
import { Application } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Home, LayoutDashboard } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";

type PipelineStep = {
  id: string;
  label: string;
  hint: string;
  tone: StatusTone;
  active?: boolean;
};

function formatSubmittedAt(value?: string | Date | null) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  if (Date.now() - date.getTime() < 60 * 60 * 1000) return "Just now";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function kitchenLabel(preference?: string | null) {
  switch (preference) {
    case "commercial":
      return "Commercial";
    case "home":
      return "Home";
    case "notSure":
      return "Not sure";
    default:
      return "—";
  }
}

function statusCopy(status?: string | null): { label: string; tone: StatusTone; hint: string } {
  switch (status) {
    case "inReview":
      return { label: "In review", tone: "progress", hint: "Our team has it" };
    case "approved":
      return { label: "Approved", tone: "success", hint: "You can start selling" };
    case "rejected":
      return { label: "Rejected", tone: "danger", hint: "See notes in dashboard" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral", hint: "This application is closed" };
    default:
      return { label: "Received", tone: "success", hint: "Seller application" };
  }
}

function MetaRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: StatusTone;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
        {tone ? <StatusDot tone={tone} /> : null}
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

export default function Success() {
  const [, navigate] = useLocation();
  const { user } = useFirebaseAuth();

  const { data: applications } = useQuery<Application[]>({
    queryKey: ["/api/firebase/applications/my"],
    enabled: !!user,
    staleTime: 0,
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (user) {
      void queryClient.invalidateQueries({ queryKey: ["/api/firebase/applications/my"] });
    }
  }, [user]);

  const application = useMemo(() => {
    if (!applications?.length) return null;
    return [...applications].sort((a, b) => {
      const aTime = new Date(a.createdAt as unknown as string).getTime();
      const bTime = new Date(b.createdAt as unknown as string).getTime();
      return bTime - aTime;
    })[0];
  }, [applications]);

  const status = statusCopy(application?.status);
  const submittedAt = formatSubmittedAt(application?.createdAt as unknown as string);
  const kitchen = kitchenLabel(application?.kitchenPreference);
  const email = application?.email || user?.email || "your inbox";
  const isClosed = status.label === "Rejected" || status.label === "Cancelled";
  const isApproved = status.label === "Approved";

  const pipeline: PipelineStep[] = useMemo(() => {
    const current = isApproved ? "sell" : "review";
    const reviewTone: StatusTone = isApproved ? "success" : isClosed ? "warning" : "progress";

    return [
      {
        id: "submitted",
        label: "Application submitted",
        hint: submittedAt,
        tone: "success",
      },
      {
        id: "review",
        label: "Under review",
        hint: isClosed ? "Closed" : "2–3 business days",
        tone: reviewTone,
        active: current === "review",
      },
      {
        id: "verify",
        label: "Document check",
        hint: "Certifications confirmed",
        tone: isApproved ? "success" : "neutral",
      },
      {
        id: "sell",
        label: "Start selling",
        hint: isApproved ? "Ready" : "After approval",
        tone: isApproved ? "success" : "neutral",
        active: current === "sell",
      },
    ];
  }, [isApproved, isClosed, submittedAt]);

  const subtitle = useMemo(() => {
    if (status.label === "Approved") return "Your seller application is approved. Continue from the dashboard.";
    if (status.label === "Rejected") return "This application was not approved. Open the dashboard for details.";
    if (status.label === "Cancelled") return "This application is closed.";
    return "No action needed. Typical review is 2–3 business days.";
  }, [status.label]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow pt-24 md:pt-28 pb-12 md:pb-16">
        <div className="container mx-auto max-w-5xl space-y-8 px-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {isApproved
                  ? "Application approved"
                  : isClosed
                    ? "Application closed"
                    : "Application received"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {user ? (
                <Button onClick={() => navigate("/dashboard")}>
                  <LayoutDashboard />
                  Go to dashboard
                  <ArrowRight />
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => navigate("/")}>
                <Home />
                Home
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Status" value={status.label} hint={status.hint} tone={status.tone} />
            <StatTile
              label="Review"
              value={isApproved ? "Done" : isClosed ? "Closed" : "2–3 days"}
              hint={isApproved || isClosed ? status.label : "We'll email you"}
              tone={isApproved ? "success" : isClosed ? "warning" : "progress"}
            />
            <StatTile
              label="Kitchen"
              value={kitchen === "—" ? "Saved" : kitchen}
              hint={kitchen === "—" ? "On your application" : "Where you plan to cook"}
            />
            <StatTile
              label="Action"
              value={isApproved ? "Sell" : isClosed ? "See notes" : "None"}
              hint={isApproved ? "Open the dashboard" : isClosed ? "Details in dashboard" : "We'll email you"}
              tone={isApproved ? "success" : isClosed ? "warning" : "neutral"}
            />
          </div>

          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            <Card className="flex h-full flex-col shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">What happens next</CardTitle>
                <CardDescription>The current step is highlighted. Everything else can wait.</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 pt-0">
                <div className="divide-y border-y">
                  {pipeline.map((step) => (
                    <div
                      key={step.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <StatusDot tone={step.tone} />
                        <span className={step.active ? "font-medium" : "text-muted-foreground"}>
                          {step.label}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm text-muted-foreground">{step.hint}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="flex h-full flex-col shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Application</CardTitle>
                <CardDescription>The details we have on file.</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 pt-0">
                <div className="divide-y border-y">
                  <MetaRow
                    label="Reference"
                    value={application?.id ? `#${application.id}` : "Pending"}
                  />
                  <MetaRow label="Submitted" value={submittedAt} />
                  <MetaRow label="Kitchen" value={kitchen === "—" ? "Saved" : kitchen} />
                  <MetaRow label="Status" value={status.label} tone={status.tone} />
                </div>
              </CardContent>
              {user ? (
                <CardFooter className="mt-auto w-full">
                  <Button variant="outline" className="w-full" onClick={() => navigate("/dashboard")}>
                    View in dashboard
                    <ArrowRight />
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          </div>

          <QuietNotice title="Confirmation email">
            Sent to {email}. If it isn’t there, check spam.
          </QuietNotice>

          <p className="text-center text-sm text-muted-foreground">
            Questions?{" "}
            <a href="mailto:support@localcook.shop" className="font-medium text-primary hover:underline">
              support@localcook.shop
            </a>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
