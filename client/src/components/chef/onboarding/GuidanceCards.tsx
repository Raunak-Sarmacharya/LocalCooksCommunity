import { ExternalLink } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ChefOnboardingGuidance } from "@/config/chef-onboarding-steps";

const DEFAULT_ICONS: LucideIcon[] = [];

interface GuidanceCardsProps {
  items: ChefOnboardingGuidance[];
  icons?: LucideIcon[];
  title?: string;
  className?: string;
  onItemClick?: (item: ChefOnboardingGuidance, index: number) => void;
}

export function GuidanceCards({
  items,
  icons = DEFAULT_ICONS,
  title,
  className,
  onItemClick,
}: GuidanceCardsProps) {
  const { t } = useTranslation("chef");
  if (!items.length) return null;

  return (
    <section className={cn("mt-10 pt-8 border-t border-border/80", className)}>
      <p className="text-sm font-semibold text-foreground mb-4">{title ?? t("onboardGuidanceCardsTitle", "Guidance")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((item, index) => {
          const Icon = icons[index];
          const isInteractive = Boolean(item.href || onItemClick);

          const content = (
            <>
              {Icon && (
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center mb-3">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <p className="text-sm font-medium text-foreground leading-snug">{item.title}</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{item.description}</p>
              {item.href && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary mt-3">
                  {t("onboardGuidanceLearnHow", "Learn how")}
                  {item.external && <ExternalLink className="h-3 w-3" />}
                </span>
              )}
            </>
          );

          const classNames = cn(
            "rounded-xl border border-border bg-muted/30 p-4 text-left h-full",
            isInteractive && "hover:border-primary/40 hover:bg-muted/50 transition-colors"
          );

          if (item.href) {
            return (
              <a
                key={`${item.title}-${index}`}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                className={classNames}
              >
                {content}
              </a>
            );
          }

          if (onItemClick) {
            return (
              <button
                key={`${item.title}-${index}`}
                type="button"
                onClick={() => onItemClick(item, index)}
                className={classNames}
              >
                {content}
              </button>
            );
          }

          return (
            <div key={`${item.title}-${index}`} className={classNames}>
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}
