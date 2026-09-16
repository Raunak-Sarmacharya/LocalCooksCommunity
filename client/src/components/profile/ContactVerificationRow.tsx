import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared shell for the contact/verification rows on the chef and manager
 * profile pages.
 *
 * Both rows — email and phone — render through this so they stay visually
 * identical: icon, label, status pill, value, helper copy, then a right-aligned
 * action. Editing expands inline inside the same row instead of swapping in a
 * differently sized block, which is what made the old layout look lopsided.
 */
export type ContactTone = "verified" | "action" | "pending" | "empty";

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
   * One-line status rendered directly under the value, in the same muted text-sm
   * style on every row (e.g. "Verified September 16, 2026" or "Verified"). Its
   * shape is fixed across rows so verified, unverified and pending entries stay
   * visually aligned even when there is no date to show.
   */
  secondary?: ReactNode;
  /** Helper copy under the secondary line. */
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
        "relative scroll-mt-24 px-5 py-5 sm:px-6",
        TONE_ROW[tone],
        highlighted && "z-10 ring-2 ring-primary ring-inset",
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              TONE_ICON[tone],
            )}
            aria-hidden="true"
          >
            {icon}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3
                id={labelId}
                className="text-sm font-medium text-foreground"
              >
                {label}
              </h3>
              {badges}
            </div>

            {value ? (
              <p
                className={cn(
                  "mt-1 break-all text-sm",
                  tone === "empty"
                    ? "text-muted-foreground"
                    : "font-medium text-foreground",
                )}
              >
                {value}
              </p>
            ) : null}

            {secondary ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {secondary}
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
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </section>
  );
}
