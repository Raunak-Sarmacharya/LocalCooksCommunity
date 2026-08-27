import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TruncatedText } from "@/components/common/TruncatedText";
import type { StatusTone } from "@/components/chef/applications/status";
import { applicationStatusVariant, toneToBadgeVariant } from "@/components/chef/applications/status";
import type { StatusVariant } from "@/components/chef/dashboard/types";

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        tone === "success" && "bg-success",
        tone === "warning" && "bg-warning",
        tone === "danger" && "bg-destructive",
        tone === "progress" && "bg-foreground/35",
        tone === "neutral" && "bg-muted-foreground/30",
        className
      )}
    />
  );
}

export function ChefPageHeader({
  title,
  description,
  actions,
  titleAccessory,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  titleAccessory?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        {titleAccessory ? <div className="mt-2">{titleAccessory}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function QuietNotice({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border px-4 py-3", className)}>
      {title ? <p className="text-sm font-medium">{title}</p> : null}
      <div className={cn("text-sm text-muted-foreground", title && "mt-1")}>{children}</div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  tooltip,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: StatusTone;
  tooltip?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <TruncatedText className="min-w-0 truncate text-xs text-muted-foreground">{label}</TruncatedText>
        {tooltip ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex shrink-0 items-center justify-center border-none bg-transparent p-0 outline-none ring-0"
                aria-label={`More info about ${label}`}
              >
                <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/70 hover:text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" className="w-[280px] p-3">
              <p className="text-xs leading-relaxed text-muted-foreground">{tooltip}</p>
            </PopoverContent>
          </Popover>
        ) : null}
        <StatusDot tone={tone} className="ml-auto" />
      </div>
      <TruncatedText as="p" className="mt-2 truncate text-lg font-semibold tracking-tight">{value}</TruncatedText>
      {hint ? <TruncatedText as="p" className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</TruncatedText> : null}
    </div>
  );
}

export function kitchenStatusBadgeVariant(status: string): StatusVariant {
  switch (status) {
    case "approved":
      return "success";
    case "rejected":
      return "destructive";
    default:
      return "outline";
  }
}

export function kitchenStatusLabel(status: string): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "inReview":
      return "In review";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: StatusTone;
  children: ReactNode;
}) {
  return (
    <Badge variant={toneToBadgeVariant(tone)} className="font-medium">
      {children}
    </Badge>
  );
}

export { applicationStatusVariant };
