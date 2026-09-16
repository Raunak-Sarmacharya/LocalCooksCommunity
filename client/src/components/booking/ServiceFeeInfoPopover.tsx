import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Manager-facing info control on the payout statement.
 *
 * The service fee is the chef's cost, not the manager's — this explains who pays
 * it so the line is not read as a deduction from the payout. Popover rather than
 * tooltip so the copy stays open while it is read.
 */
export function ServiceFeeInfoPopover({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  const { t } = useTranslation("chef");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            // index.css forces min-height/min-width: 44px on every <button> and is
            // emitted unlayered, so a plain `min-h-0` loses. Tailwind v3 needs the
            // `!` prefix to keep this inline with the surrounding text row.
            "!min-h-0 !min-w-0 inline-flex items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground",
            className,
          )}
          aria-label={t("bdServiceFeeInfoAria")}
        >
          <Info className={cn("h-3.5 w-3.5", iconClassName)} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs space-y-1.5 p-3 text-sm" align="start" side="top">
        <p className="font-medium text-foreground">{t("bdServiceFeeInfoTitle")}</p>
        <p className="text-muted-foreground leading-snug">{t("bdServiceFeeInfoBody")}</p>
      </PopoverContent>
    </Popover>
  );
}
