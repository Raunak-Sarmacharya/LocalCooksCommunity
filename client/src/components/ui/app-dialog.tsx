import * as React from "react";
import { DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The shared modal surface for app dialogs.
 *
 * Every modal in the product was a slide-over sheet until 2026-09-30, so they
 * inherited the sheet's chrome: a full-height panel, no visual hierarchy, and a
 * header that was just a bold line. This shell gives them the treatment the
 * hand-built modals already had — `SellerJourneyDialog` (`rounded-3xl border-0
 * shadow-2xl` with generous padding) and `CancellationPolicyDialog` (a
 * deliberate width, left-aligned header, leading icon) — so a dialog reads as
 * one considered surface rather than a panel that happens to be centred.
 *
 * Two ways to use it:
 *
 * 1. **Surface only.** `<AppDialogContent className="sm:max-w-md">` — for short
 *    dialogs. Keeps the base `overflow-y-auto`, so content still scrolls.
 * 2. **Sectioned.** Pass `p-0 gap-0 overflow-hidden` and use
 *    `AppDialogHeader` / `AppDialogBody` / `AppDialogFooter`. The header and
 *    footer then never scroll and `AppDialogBody` becomes the only scrolling
 *    region, which is what makes long forms readable.
 *
 * `DialogContent`'s own defaults (`grid`, `gap-3`, `p-4`, `border`,
 * `rounded-2xl`, `shadow-lg`) are all overridden; `max-h-[90vh]` is kept.
 */

type DialogContentProps = React.ComponentProps<typeof DialogContent>;

export function AppDialogContent({ className, children, ...props }: DialogContentProps) {
  return (
    <DialogContent
      className={cn(
        "flex flex-col gap-4 rounded-3xl border-0 p-4 shadow-2xl sm:p-6",
        className,
      )}
      {...props}
    >
      {children}
    </DialogContent>
  );
}

interface AppDialogHeaderProps {
  /** Leading icon. Sits in a tinted tile so the title has a clear anchor. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Status chip rendered beside the title (e.g. a `Badge`). */
  badge?: React.ReactNode;
  /** Right-aligned controls, level with the title. */
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function AppDialogHeader({
  icon,
  title,
  description,
  badge,
  actions,
  className,
  children,
}: AppDialogHeaderProps) {
  return (
    <div
      className={cn("flex min-w-0 items-start gap-3 border-b px-4 py-4 text-left sm:px-6 sm:py-5", className)}
    >
      {icon ? (
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-muted/50 text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle className="min-w-0 break-words text-base font-semibold leading-tight tracking-tight">{title}</DialogTitle>
          {badge}
        </div>
        {description ? <DialogDescription className="text-sm leading-6">{description}</DialogDescription> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function AppDialogBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5", className)}>{children}</div>;
}

export function AppDialogFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        // Mirrors `DialogFooter`'s base direction so a `sm:` override is not needed,
        // and `gap-2` replaces its `sm:space-x-2` (which would stack on top of gap).
        "flex flex-col-reverse gap-2 border-t px-4 py-4 sm:flex-row sm:justify-end sm:space-x-0 sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
