import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import {
  LOCALE_META,
  SUPPORTED_LOCALES,
  type AppLocale,
  isAppLocale,
} from "@shared/i18n";
import { changeAppLocale } from "@/i18n/locale-actions";
import { auth } from "@/lib/firebase";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type LanguageSwitcherProps = {
  className?: string;
  /** Compact trigger for tight spaces */
  size?: "sm" | "default";
  /**
   * Visual variant:
   * - "default": subtle pill for light surfaces
   * - "footer": ghost style for dark footer backgrounds
   */
  variant?: "default" | "footer";
  /** Persist choice to user profile when signed in */
  persistToProfile?: boolean;
};

/** Base language name without region (e.g. "English", "Français"). */
function baseName(locale: AppLocale): string {
  return LOCALE_META[locale].nativeName.split(" (")[0];
}

function useCurrentLocale(): AppLocale {
  const { i18n } = useTranslation("common");
  return (
    isAppLocale(i18n.resolvedLanguage)
      ? i18n.resolvedLanguage
      : isAppLocale(i18n.language)
        ? i18n.language
        : "en-CA"
  ) as AppLocale;
}

function persistChoice(locale: AppLocale, persistToProfile: boolean) {
  return changeAppLocale(locale, {
    persistToProfile,
    getIdToken: async () => {
      const user = auth.currentUser;
      if (!user) return null;
      return user.getIdToken();
    },
  });
}

/**
 * Standalone minimal switcher (footer, standalone toolbars).
 * Trigger shows the current language's own name so any user can find it.
 */
export function LanguageSwitcher({
  className,
  size = "default",
  variant = "default",
  persistToProfile = true,
}: LanguageSwitcherProps) {
  const { t } = useTranslation("common");
  const current = useCurrentLocale();
  const isFooter = variant === "footer";

  const onChange = async (value: string) => {
    if (!isAppLocale(value)) return;
    await persistChoice(value, persistToProfile);
  };

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger
        className={cn(
          // Minimal pill: globe + language name + chevron
          "h-8 gap-1.5 rounded-full border-transparent bg-muted/60 px-3 text-xs font-medium text-foreground shadow-none",
          "transition-colors hover:bg-muted focus:ring-1 focus:ring-ring/40 data-[placeholder]:text-foreground [&>span]:line-clamp-none w-auto",
          isFooter &&
            "bg-white/10 text-white/90 hover:bg-white/15 focus:ring-white/30",
          size === "sm" ? "min-w-[6.5rem]" : "min-w-[7.5rem]",
          className
        )}
        aria-label={t("chooseLanguage")}
      >
        <Languages className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        <SelectValue aria-label={t("language")}>
          <span className="tracking-wide">{baseName(current)}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align="end"
        className="min-w-[13rem] rounded-xl border-border/60 p-1 shadow-lg"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <SelectItem
            key={locale}
            value={locale}
            className="rounded-lg py-2 pl-8 pr-3"
          >
            {/* Native name first, English name as a hint underneath */}
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-medium">
                {LOCALE_META[locale].nativeName}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {LOCALE_META[locale].englishName}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Language options as plain dropdown-menu radio items.
 * Use INSIDE an existing DropdownMenu (e.g. account menus) — nesting a
 * portal-based Select there would close the menu on interaction.
 */
export function LanguageMenuItems({
  persistToProfile = true,
}: {
  persistToProfile?: boolean;
}) {
  const current = useCurrentLocale();

  const onChange = async (value: string) => {
    if (!isAppLocale(value)) return;
    await persistChoice(value, persistToProfile);
  };

  return (
    <DropdownMenuRadioGroup value={current} onValueChange={onChange}>
      {SUPPORTED_LOCALES.map((locale) => (
        <DropdownMenuRadioItem
          key={locale}
          value={locale}
          className="py-2.5"
        >
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-medium tracking-tight">
              {LOCALE_META[locale].nativeName}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {LOCALE_META[locale].englishName}
            </span>
          </span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
