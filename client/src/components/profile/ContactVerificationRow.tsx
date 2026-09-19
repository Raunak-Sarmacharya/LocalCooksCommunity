import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { RowHelp } from "@/components/manager/settings/SettingsRow";

/**
 * Shared shell for the contact/verification rows on the chef and manager
 * profile pages.
 *
 * Every row renders through this so they stay visually identical: icon, label,
 * status pill, value, then a right-aligned action.
 *
 * THE ROW IS TWO LINES, NOT FOUR.
 *
 * It used to stack `value` → `secondary` → `description`, which made each row ~140px
 * tall and wrapped the explanatory sentences onto a second line with an orphan
 * fragment ("…so it cannot sign you in. Verify it to also use it for sign-in.").
 * Long copy now lives behind the ⓘ beside the label — which is what `RowHelp` is for,
 * and it keeps the paragraph out of the page body. What is left inline is:
 *
 *   line 1 — label · status pill · ⓘ · actions
 *   line 2 — the value, with the one-line status appended after a separator
 *
 * `description` survives for SHORT, stateful lines that must not be hidden — a
 * spinner, a load failure, or a locked-actions warning.
 */
export type ContactTone = "verified" | "action" | "pending" | "empty";

/**
 * The row-action hierarchy. One rule, applied everywhere, so no two rows disagree.
 *
 * `Button` dresses `default` and `outline` in the marketing CTA — a brand-red pill with
 * a red glow and a hover lift — so every action on this page has to say which of the
 * three ranks it is:
 *
 *   PRIMARY — the single action that completes THIS row's outstanding state ("Verify
 *     this number", "Connect Google", "Set password"). Filled and dominant.
 *   QUIET — everything else ("Change email", "Cancel", "Use a different number").
 *     Text-only, so it never competes with the primary beside it.
 *   DANGER — removing a credential. Destructive, so it takes danger colour and never
 *     the primary's weight.
 *
 * Shape and size are the APP's, not this page's: the pill (`rounded-full`) every other
 * surface uses, at `h-8` rather than the `h-9` `size="sm"` gives. Only the marketing
 * shadow and the hover lift are cancelled — the fill is the emphasis.
 *
 * `index.css` applies `min-h-[44px]` to EVERY `button`, unlayered and at every width
 * ("Minimum height for touch targets"), and `min-height` beats `height` — so a 32px
 * button needs an `!important` reset to exist at all. That reset is scoped `md:` so the
 * mobile touch target keeps its 44px. The `!` prefixes on the height and padding are
 * also required: `size` already emits `h-9 px-4`, and for two same-specificity utilities
 * Tailwind's source order decides the winner, not the class attribute.
 *
 * Two actions of EQUAL weight side by side is the specific failure this prevents:
 * "Verify this number" and "Change number" read as the same action, so neither read as
 * important. Also: no decorative icons on row actions — either every action carries one
 * or none do, and text-only is what the settings surfaces in Google, Stripe and Airbnb
 * do. (A spinner while busy is state, not decoration, and is fine.)
 */
export const PRIMARY_ROW_ACTION =
  "!h-8 !px-3 md:!min-h-0 shadow-none hover:shadow-none hover:translate-y-0";
export const QUIET_ROW_ACTION =
  "!h-8 !px-3 md:!min-h-0 text-muted-foreground hover:text-foreground";
export const DANGER_ROW_ACTION =
  "!h-8 !px-3 md:!min-h-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive";

const TONE_ICON: Record<ContactTone, string> = {
  verified: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  action: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  pending: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  empty: "bg-muted text-muted-foreground",
};

const TONE_PILL: Record<ContactTone, string> = {
  verified: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  action: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pending: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  empty: "bg-muted text-muted-foreground",
};

const TONE_ROW: Record<ContactTone, string> = {
  verified: "",
  action: "bg-amber-500/[0.04]",
  pending: "bg-sky-500/[0.04]",
  empty: "",
};

/** Rounded container that turns its children into a divided list of rows. */
export function ContactInfoCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-[1.35rem] border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ContactStatusPill({
  tone,
  children,
}: {
  tone: ContactTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_PILL[tone],
      )}
    >
      {children}
    </span>
  );
}

export interface ContactVerificationRowProps {
  /** Anchor used by deep links that scroll to this row. */
  id?: string;
  /** Matches the `aria-labelledby` on the row's heading. */
  labelId?: string;
  icon: ReactNode;
  label: string;
  tone: ContactTone;
  /** Status pills rendered next to the label. */
  badges?: ReactNode;
  /** The address or number itself. Omit when nothing is on file yet. */
  value?: ReactNode;
  /**
   * One-line status appended to the value after a separator (e.g. "Verified
   * Feb 27, 2026"). Keep it SHORT — it shares a line with the value.
   */
  secondary?: ReactNode;
  /** Longer explanation, revealed from the ⓘ beside the label. */
  help?: ReactNode;
  /**
   * Short, stateful copy that must stay visible — a spinner, a failure, a
   * locked-actions warning. Anything longer belongs in `help`.
   */
  description?: ReactNode;
  /** Right-aligned buttons. Hidden while the row is expanded. */
  actions?: ReactNode;
  /** Inline editor form, rendered full width beneath the value. */
  children?: ReactNode;
  /** Ringed when deep-linked from the verification gate. */
  highlighted?: boolean;
  className?: string;
}

export function ContactVerificationRow({
  id,
  labelId,
  icon,
  label,
  tone,
  badges,
  value,
  secondary,
  help,
  description,
  actions,
  children,
  highlighted = false,
  className,
}: ContactVerificationRowProps) {
  return (
    <section
      id={id}
      aria-labelledby={labelId}
      className={cn(
        "relative scroll-mt-24 px-5 py-4 sm:px-6",
        TONE_ROW[tone],
        highlighted && "z-10 ring-2 ring-primary ring-inset",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              TONE_ICON[tone],
            )}
            aria-hidden="true"
          >
            {icon}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 id={labelId} className="text-sm font-medium text-foreground">
                {label}
              </h3>
              {badges}
              {help ? <RowHelp label={label}>{help}</RowHelp> : null}
            </div>

            {value || secondary ? (
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm">
                {value ? (
                  <span
                    className={cn(
                      "break-all",
                      tone === "empty"
                        ? "text-muted-foreground"
                        : "font-medium text-foreground",
                    )}
                  >
                    {value}
                  </span>
                ) : null}
                {value && secondary ? (
                  <span className="text-muted-foreground" aria-hidden="true">·</span>
                ) : null}
                {secondary ? (
                  <span className="text-muted-foreground">{secondary}</span>
                ) : null}
              </p>
            ) : null}

            {description ? (
              <div className="mt-1 space-y-1 text-sm leading-relaxed text-muted-foreground">
                {description}
              </div>
            ) : null}

            {children ? <div className="mt-4">{children}</div> : null}
          </div>
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </section>
  );
}
