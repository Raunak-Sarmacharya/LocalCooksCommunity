import { useState, type ElementType } from "react";
import { SiStripe } from "react-icons/si";
import { Calendar, CalendarClock, Check, ChevronRight, Circle, ClipboardList, Edit, FileCheck, ListChecks, User } from "@/components/ui/manager-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { mt } from "@/i18n/manager";
import type { ManagerSetupStep } from "@/hooks/use-onboarding-status";

/** Short action phrases for the popover + the icon each step already uses elsewhere
 *  (CompletionSummaryStep / EnterpriseStepper), so both checklists read alike. */
const STEP_META: Record<ManagerSetupStep["id"], { Icon: ElementType; labelKey: string; iconClassName?: string }> = {
  profile: { Icon: User, labelKey: "managerSetupStepProfile" },
  license: { Icon: FileCheck, labelKey: "managerSetupStepLicense" },
  kitchen: { Icon: Calendar, labelKey: "managerSetupStepKitchen" },
  availability: { Icon: CalendarClock, labelKey: "managerSetupStepAvailability" },
  requirements: { Icon: ClipboardList, labelKey: "managerSetupStepRequirements" },
  payments: { Icon: SiStripe, labelKey: "managerSetupStepPayments", iconClassName: "size-3.5 text-stripe" },
};

interface ChecklistItem {
  id: string;
  title: string;
  complete: boolean;
  Icon: ElementType;
  /** Overrides the default icon colour/size — the Stripe mark uses `text-stripe`. */
  iconClassName?: string;
  onSelect: () => void;
}

interface ManagerGettingStartedProps {
  steps: ManagerSetupStep[];
  improvementSteps?: string[];
  onSelectStep?: (stepId: ManagerSetupStep["id"]) => void;
  onImprove?: (task: string) => void;
}

export function ManagerGettingStarted({ steps, improvementSteps = [], onSelectStep, onImprove }: ManagerGettingStartedProps) {
  const [open, setOpen] = useState(false);

  const checklistItems: ChecklistItem[] = [
    ...steps.map((step) => {
      const meta = STEP_META[step.id];
      return {
        id: step.id,
        title: mt(meta.labelKey),
        complete: step.complete,
        Icon: meta.Icon,
        iconClassName: meta.iconClassName,
        onSelect: () => onSelectStep?.(step.id),
      };
    }),
    ...improvementSteps.map((title, index) => ({
      id: `improvement-${index}`,
      title,
      complete: false,
      Icon: Edit,
      onSelect: () => onImprove?.(title),
    })),
  ];
  const completed = checklistItems.filter((item) => item.complete).length;
  const progressLabel = mt("managerSetupProgress", { completed, total: checklistItems.length });
  const nextStepIndex = checklistItems.findIndex((item) => !item.complete);

  if (!checklistItems.length || completed === checklistItems.length) return null;

  return (
    <SidebarGroup className="mt-auto px-2 py-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <SidebarMenuButton
                tooltip={`${mt("managerGettingStarted")}: ${progressLabel}`}
                aria-label={`${mt("managerGettingStarted")}: ${progressLabel}`}
                className="font-medium data-[state=open]:bg-sidebar-accent"
              >
                <ListChecks className="text-sidebar-primary" aria-hidden="true" />
                <span>{mt("managerGettingStarted")}</span>
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground group-data-[collapsible=icon]:hidden">
                  {completed}/{checklistItems.length}
                </span>
                <ChevronRight className="group-data-[collapsible=icon]:hidden" aria-hidden="true" />
              </SidebarMenuButton>
            </PopoverTrigger>

            <PopoverContent side="right" align="end" sideOffset={10} className="w-80 p-4 rounded-2xl">
              <div className="mb-4">
                <h2 className="text-sm font-semibold">{mt("managerGettingStarted")}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{progressLabel}</p>
              </div>
              <ol className="ml-1 space-y-0.5 border-l border-border py-1 pl-5" aria-label={progressLabel}>
                {checklistItems.map((item, index) => {
                  const isNext = index === nextStepIndex;
                  // Completed rows are read-only — only open steps (and listing
                  // improvements) take the user anywhere.
                  const rowClass = cn(
                    "flex w-full items-center gap-2 rounded-md py-1.5 pr-1.5 text-left text-xs leading-4",
                    !item.complete &&
                      "cursor-pointer transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  );
                  const content = (
                    <>
                      <span className={item.complete ? "text-muted-foreground line-through" : isNext ? "font-medium text-foreground" : "text-muted-foreground"}>
                        {item.title}
                      </span>
                      <item.Icon className={cn("ml-auto shrink-0", item.iconClassName ?? "size-3.5 text-muted-foreground")} />
                    </>
                  );
                  return (
                    <li key={item.id} className="relative">
                      {/* Checkbox rule: done = brand tick, open = empty outline. */}
                      <span
                        className="absolute -left-[27px] top-1/2 flex size-3.5 -translate-y-1/2 items-center justify-center bg-popover"
                        aria-hidden="true"
                      >
                        {item.complete ? (
                          <Check className="size-3.5 text-primary" />
                        ) : (
                          <Circle className="size-3 text-muted-foreground/50" />
                        )}
                      </span>
                      {item.complete ? (
                        <div className={rowClass}>{content}</div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            item.onSelect();
                          }}
                          className={rowClass}
                        >
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </PopoverContent>
          </Popover>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

export default ManagerGettingStarted;
