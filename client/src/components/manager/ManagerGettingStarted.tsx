import { CheckCircle2, ChevronRight, Circle, ListChecks } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { mt } from "@/i18n/manager";
import type { ManagerSetupStep } from "@/hooks/use-onboarding-status";

interface ManagerGettingStartedProps {
  steps: ManagerSetupStep[];
  improvementSteps?: string[];
  onContinue?: () => void;
  onImprove?: (task: string) => void;
}

export function ManagerGettingStarted({ steps, improvementSteps = [], onContinue, onImprove }: ManagerGettingStartedProps) {
  const checklistItems = [
    ...steps.map((step) => ({ id: step.id, title: mt(step.labelKey), complete: step.complete })),
    ...improvementSteps.map((title, index) => ({ id: `improvement-${index}`, title, complete: false })),
  ];
  const completed = checklistItems.filter((step) => step.complete).length;
  const progressLabel = mt("managerSetupProgress", { completed, total: checklistItems.length });
  const nextStepIndex = checklistItems.findIndex((step) => !step.complete);
  const hasIncompleteSetup = steps.some((step) => !step.complete);

  if (!checklistItems.length || completed === checklistItems.length) return null;

  return (
    <SidebarGroup className="mt-auto px-2 py-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <Popover>
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
              <div className="ml-1 border-l border-border py-1 pl-5">
                <ol className="space-y-3" aria-label={progressLabel}>
                  {checklistItems.map((step, index) => {
                    const isNext = index === nextStepIndex;
                    return (
                      <li key={step.id} className="relative min-h-4 text-xs leading-4">
                        <span className="absolute -left-[27px] top-0 flex size-3.5 items-center justify-center bg-popover" aria-hidden="true">
                          {step.complete ? (
                            <CheckCircle2 className="size-3.5 text-emerald-600" />
                          ) : isNext ? (
                            <span className="size-2 rounded-full bg-primary ring-2 ring-popover" />
                          ) : (
                            <Circle className="size-3 text-muted-foreground/50" />
                          )}
                        </span>
                        <span className={step.complete ? "text-muted-foreground line-through" : isNext ? "font-medium text-foreground" : "text-muted-foreground"}>
                          {step.title}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-4 h-8 w-fit"
                  onClick={() => hasIncompleteSetup ? onContinue?.() : onImprove?.(improvementSteps[0])}
                >
                  {hasIncompleteSetup ? mt("continueSetup") : mt("completeListing")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

export default ManagerGettingStarted;
