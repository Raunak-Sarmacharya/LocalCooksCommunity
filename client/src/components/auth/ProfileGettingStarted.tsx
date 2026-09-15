import { Check, Circle, ListChecks, Mail, Phone, User } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

/** Rows that still need attention, so the caller can deep-link to the right section. */
export type ProfileGettingStartedField = "displayName" | "email" | "phone";

export default function ProfileGettingStarted({
  displayName,
  email,
  emailVerified = false,
  phoneNumber,
  onComplete,
}: {
  displayName?: string | null;
  email?: string | null;
  /** Ownership of the address, not merely its presence. */
  emailVerified?: boolean;
  phoneNumber?: string | null;
  onComplete: (field: ProfileGettingStartedField) => void;
}) {
  const { t } = useTranslation("chef");
  const [open, setOpen] = useState(false);
  const fields: Array<{
    id: ProfileGettingStartedField;
    label: string;
    complete: boolean;
    Icon: typeof User;
  }> = [
    { id: "displayName", label: t("gettingStartedFullName", "Add your full name"), complete: !!displayName?.trim(), Icon: User },
    // An address that is merely typed in is not enough: an unverified email blocks
    // every action, so this row tracks verification rather than presence.
    { id: "email", label: t("gettingStartedEmail", "Verify your email address"), complete: emailVerified, Icon: Mail },
    { id: "phone", label: t("gettingStartedPhone", "Add your phone number"), complete: !!phoneNumber?.trim(), Icon: Phone },
  ];
  const completed = fields.filter((field) => field.complete).length;
  if (completed === fields.length) return null;

  const progress = t("gettingStartedProgress", {
    completed,
    total: fields.length,
    defaultValue: "{completed} of {total} complete",
  });
  const nextIndex = fields.findIndex((field) => !field.complete);

  return (
    <SidebarGroup className="mt-auto px-2 py-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <SidebarMenuButton
                tooltip={`${t("gettingStarted", "Getting started")}: ${progress}`}
                aria-label={`${t("gettingStarted", "Getting started")}: ${progress}`}
                className="font-medium data-[state=open]:bg-sidebar-accent"
              >
                <ListChecks className="text-sidebar-primary" aria-hidden />
                <span>{t("gettingStarted", "Getting started")}</span>
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground group-data-[collapsible=icon]:hidden">
                  {completed}/{fields.length}
                </span>
              </SidebarMenuButton>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" sideOffset={10} className="w-80 rounded-2xl p-4">
              <h2 className="text-sm font-semibold">{t("completeYourProfile", "Complete your profile")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{progress}</p>
              <ol className="ml-1 mt-4 space-y-0.5 border-l border-border py-1 pl-5" aria-label={progress}>
                {fields.map((field, index) => {
                  const isNext = index === nextIndex;
                  const { Icon } = field;
                  // Completed rows are read-only — only open fields take the chef anywhere.
                  const rowClass = cn(
                    "flex w-full items-center gap-2 rounded-md py-1.5 pr-1.5 text-left text-xs leading-4",
                    !field.complete &&
                      "cursor-pointer transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  );
                  const content = (
                    <>
                      <span className={field.complete ? "text-muted-foreground line-through" : isNext ? "font-medium text-foreground" : "text-muted-foreground"}>
                        {field.label}
                      </span>
                      <Icon className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </>
                  );
                  return (
                    <li key={field.id} className="relative">
                      {/* Checkbox rule: done = brand tick, open = empty outline. */}
                      <span
                        className="absolute -left-[27px] top-1/2 flex size-3.5 -translate-y-1/2 items-center justify-center bg-popover"
                        aria-hidden
                      >
                        {field.complete ? (
                          <Check className="size-3.5 text-primary" />
                        ) : (
                          <Circle className="size-3 text-muted-foreground/50" />
                        )}
                      </span>
                      {field.complete ? (
                        <div className={rowClass}>{content}</div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            onComplete(field.id);
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
