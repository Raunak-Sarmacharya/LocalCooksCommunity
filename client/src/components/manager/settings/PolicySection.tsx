/**
 * Booking Policies building blocks.
 *
 * Every policy group on the kitchen's Booking Policies tab reads the same way (Airbnb host settings /
 * The Food Corridor kitchen settings): a short heading, ONE line saying what the group controls, a
 * single card of label · consequence · control rows, and at most one save at the card's foot.
 * Whitespace separates the groups; the only dividers are the row separators inside a card.
 */
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "@/components/ui/manager-icons";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function PolicySection({ title, description, footer, children, testId }: {
  title: ReactNode;
  description?: ReactNode;
  /** Preview + the section's one save, rendered at the card's foot. */
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3" data-testid={testId}>
      <div className="space-y-0.5">
        <h3 id={headingId} className="text-base font-semibold leading-6 text-foreground">{title}</h3>
        {description ? <p className="text-sm leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <Card className="overflow-hidden">
        {children}
        {footer ? <div className="border-t border-border px-4 py-3">{footer}</div> : null}
      </Card>
    </section>
  );
}

/** Read-only: the damage and cleaning rules are Local Cooks' policy, not a kitchen setting. Collapsed by default. */
export function ManagerDamagePolicySection() {
  const { t } = useTranslation("booking");
  const { t: mt } = useTranslation("manager");
  const [open, setOpen] = useState(false);
  return (
    <div id="damage-and-cleaning" className="scroll-mt-24">
      <PolicySection title={t("dcV2PolicyTitle")} description={mt("bpDamageDescription")} testId="damage-policy-section">
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              {t("dcV2HowClaimsWork")}
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 px-4 pb-4 text-sm leading-6 text-muted-foreground">
            <p>{t("dcV2ManagerPolicySummary")}</p>
            <p>{t("dcV2ManagerPolicyDetails")}</p>
          </CollapsibleContent>
        </Collapsible>
      </PolicySection>
    </div>
  );
}
