import type { ComponentType, CSSProperties } from "react";
import {
  SiGmail,
  SiGmx,
  SiIcloud,
  SiMaildotcom,
  SiProtonmail,
  SiQq,
  SiTuta,
  SiZoho,
} from "react-icons/si";
import { Icon } from "@iconify/react";
import type { EmailProviderBrand } from "@/lib/email-provider";
import { cn } from "@/lib/utils";

/**
 * Brand mark + official brand hex (Simple Icons colours).
 * Outlook and Yahoo are not in this react-icons build, so those two use the
 * MDI brand glyphs tinted with the same official colours.
 */
const BRAND_MARKS: Record<
  EmailProviderBrand,
  | { kind: "si"; Icon: ComponentType<{ className?: string; style?: CSSProperties }>; color: string }
  | { kind: "mdi"; icon: string; color: string }
> = {
  gmail: { kind: "si", Icon: SiGmail, color: "#EA4335" },
  outlook: { kind: "mdi", icon: "mdi:microsoft-outlook", color: "#0078D4" },
  yahoo: { kind: "mdi", icon: "mdi:yahoo", color: "#6001D2" },
  icloud: { kind: "si", Icon: SiIcloud, color: "#3693F3" },
  proton: { kind: "si", Icon: SiProtonmail, color: "#6D4AFF" },
  gmx: { kind: "si", Icon: SiGmx, color: "#1C449B" },
  zoho: { kind: "si", Icon: SiZoho, color: "#E42527" },
  qq: { kind: "si", Icon: SiQq, color: "#EB1923" },
  tuta: { kind: "si", Icon: SiTuta, color: "#840010" },
  mailcom: { kind: "si", Icon: SiMaildotcom, color: "#0046BE" },
  generic: { kind: "mdi", icon: "mdi:email", color: "#5F6368" },
};

/** Colored brand mark for the detected email provider. */
export function EmailProviderBrandIcon({
  brand,
  className,
}: {
  brand: EmailProviderBrand;
  className?: string;
}) {
  const mark = BRAND_MARKS[brand];
  const classes = cn("h-4 w-4 shrink-0", className);

  if (mark.kind === "mdi") {
    return <Icon icon={mark.icon} className={classes} style={{ color: mark.color }} aria-hidden />;
  }

  const SiIcon = mark.Icon;
  return <SiIcon className={classes} style={{ color: mark.color }} aria-hidden />;
}
