import { MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KitchenManagerContactCardProps {
  /** The kitchen's manager, resolved server-side. Falls back to a generic label. */
  managerName?: string | null;
  kitchenName: string;
  address?: string | null;
  /** True once the chef has submitted the Chef Application Requirements. */
  submitted: boolean;
  /** Whether this kitchen makes the Food Establishment Licence compulsory. */
  requiresEstablishmentLicence: boolean;
  /** Whether a licence is already on file — fresh upload or carried over. */
  licenceOnFile: boolean;
  onMessage: () => void;
  className?: string;
}

/**
 * The chef's route to the person reviewing their application.
 *
 * Lifted out of the progress tracker, where it sat as a footnote under the checklist. It answers a
 * different question from the tracker — the tracker says *what is missing*, this says *who to talk
 * to* — and burying it under a list of outstanding items meant the one action that unblocks a stuck
 * application was the easiest thing on the page to scroll past.
 *
 * Deliberately the SAME visual language as the tracker beside it: one `primary` border tint, no fill,
 * no badge, no colour. It earns attention from position and from naming a real person, not from
 * decoration — which is also why it names the manager, the kitchen and the address rather than
 * saying "the kitchen manager".
 */
export function KitchenManagerContactCard({
  managerName,
  kitchenName,
  address,
  submitted,
  requiresEstablishmentLicence,
  licenceOnFile,
  onMessage,
  className,
}: KitchenManagerContactCardProps) {
  const { t } = useTranslation("kitchen");

  const name = managerName?.trim() || t("kmcManagerFallback", { defaultValue: "your kitchen manager" });

  /*
   * Three states, not one generic paragraph.
   *
   * The licence sentence is the only reason this card exists for most chefs, so it
   * is shown ONLY while the licence is genuinely outstanding — required by this
   * kitchen and not yet on file. Once the kitchen drops the requirement, or the
   * chef uploads it, the copy falls back to the neutral line rather than telling
   * them to go and get something they already have.
   */
  const body = submitted
    ? t("kmcBodySubmitted", {
        defaultValue:
          "Your Chef Application Requirements are with {name} for review. Message them if anything needs correcting.",
        name,
      })
    : requiresEstablishmentLicence && !licenceOnFile
      ? t("kmcBodyLicence", {
          defaultValue:
            "You need the Food Establishment Licence for this premises. Message {name} to coordinate it, then upload it above and submit for review.",
          name,
        })
      : t("kmcBodyGeneral", {
          defaultValue:
            "Message {name} if anything about these requirements is unclear before you submit.",
          name,
        });

  return (
    <div className={cn("min-w-0", className)}>
      <Card className="flex flex-col border-primary/30 shadow-none">
        <CardContent className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("kmcEyebrow", { defaultValue: "Your kitchen manager" })}
          </p>

          <p className="mt-1 truncate text-sm font-medium text-foreground">{name}</p>

          {/* Kitchen and address on separate lines: a joined "·" line ran past the
              20rem rail and truncated the address, which is the part that says WHICH
              kitchen this is. */}
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{kitchenName}</p>
          {address ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{address}</p>
          ) : null}

          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3 h-8 w-full"
            onClick={onMessage}
          >
            <MessageCircle className="mr-1.5 size-3.5" aria-hidden="true" />
            {t("kmcMessage", { defaultValue: "Message {name}", name })}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default KitchenManagerContactCard;
