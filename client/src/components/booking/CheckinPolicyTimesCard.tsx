import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { kitchenCheckinPolicyTimes } from "@/lib/kitchen-checkin-policy";
import { calendarDateForBookingTime } from "@shared/operating-hours";
import { createBookingDateTime, DEFAULT_TIMEZONE, friendlyTimezoneName } from "@shared/timezone-utils";

function formatPolicyTimestamp(iso: Date | string, locale: string, timezone: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

type CheckinPolicyTimesCardProps = {
  bookingDate: string;
  startTime: string;
  operatingWindowStartTime?: string | null;
  timezone?: string | null;
  checkinWindowMinutesBefore: number;
  noShowGraceMinutes: number;
  /** `stack` for narrow sheets; `responsive` for booking-details width. */
  layout?: "stack" | "responsive";
  /** Hero treatment for the check-in sheet. */
  emphasize?: boolean;
  className?: string;
  title?: string;
  description?: string;
  /** When false, skip the title/body block (details page already has one above). */
  showIntro?: boolean;
};

/**
 * Check-in opens / visit starts — shared by booking details
 * and the chef check-in sheet so chefs see the same numbers in both places.
 */
export function CheckinPolicyTimesCard({
  bookingDate,
  startTime,
  operatingWindowStartTime,
  timezone,
  checkinWindowMinutesBefore,
  noShowGraceMinutes,
  layout = "responsive",
  emphasize = false,
  className,
  title,
  description,
  showIntro = true,
}: CheckinPolicyTimesCardProps) {
  const { t, i18n } = useTranslation("chef");
  const tz = timezone || DEFAULT_TIMEZONE;
  const times = kitchenCheckinPolicyTimes(
    bookingDate.split("T")[0],
    startTime,
    operatingWindowStartTime || startTime,
    tz,
    checkinWindowMinutesBefore,
    noShowGraceMinutes,
  );

  const alreadyOpen = Date.now() >= times.opensAt.getTime();
  const cells = [
    alreadyOpen
      ? {
        label: t("bdCheckinOpened", "Check-in opened at"),
        value: new Intl.DateTimeFormat(i18n.language, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(times.opensAt),
      }
      : {
        label: t("bdCheckinOpens", "Check-in opens"),
        value: formatPolicyTimestamp(times.opensAt, i18n.language, tz),
        hint: t("bdMinutesBeforeStart", {
          count: checkinWindowMinutesBefore,
          defaultValue: `${checkinWindowMinutesBefore} minutes before start`,
        }),
      },
    {
      label: t("bdVisitStarts", "Visit starts"),
      value: formatPolicyTimestamp(times.startsAt, i18n.language, tz),
    },
  ] as const;

  return (
    <PolicyHeroShell
      emphasize={emphasize}
      className={className}
      showIntro={showIntro}
      title={title ?? t("bdCheckInRequired", "Check In Required")}
      description={
        description ??
        t(
          "bdCheckInBody",
          "Check in when you arrive. Follow the kitchen instructions and complete any tasks marked Required.",
        )
      }
    >
      <PolicyTimeGrid layout={layout} cells={[...cells]} />
      <p className="mt-3 text-xs text-muted-foreground">
        {t(
          "bdKitchenLocalTime",
          { timezone: friendlyTimezoneName(tz, i18n.language), defaultValue: `Times are shown in the kitchen’s local time (${friendlyTimezoneName(tz, i18n.language)}).` },
        )}
      </p>
    </PolicyHeroShell>
  );
}

type CheckoutReadyCardProps = {
  bookingDate: string;
  startTime: string;
  endTime: string;
  operatingWindowStartTime?: string | null;
  timezone?: string | null;
  checkedInAt?: string | null;
  checkoutRequestedAt?: string | null;
  /** pending = waiting on manager after submit */
  mode?: "ready" | "pending";
  emphasize?: boolean;
  className?: string;
};

/** Checkout hero for the sheet — mirrors booking-details Ready to Check Out copy. */
export function CheckoutReadyCard({
  bookingDate,
  startTime,
  endTime,
  operatingWindowStartTime,
  timezone,
  checkedInAt,
  checkoutRequestedAt,
  mode = "ready",
  emphasize = true,
  className,
}: CheckoutReadyCardProps) {
  const { t, i18n } = useTranslation("chef");
  const tz = timezone || DEFAULT_TIMEZONE;
  const dateOnly = bookingDate.split("T")[0];
  const endsAt = createBookingDateTime(
    calendarDateForBookingTime(dateOnly, endTime, operatingWindowStartTime, startTime),
    endTime,
    tz,
  );

  const cells: Array<{ label: string; value: string }> = [];
  if (checkedInAt) {
    cells.push({
      label: t("bdCheckedInAt", "Checked in"),
      value: formatPolicyTimestamp(checkedInAt, i18n.language, tz),
    });
  }
  cells.push({
    label: t("bdVisitEnds", "Visit ends"),
    value: formatPolicyTimestamp(endsAt, i18n.language, tz),
  });
  if (checkoutRequestedAt) {
    cells.push({
      label: t("bdCheckoutRequested", "Checkout requested"),
      value: formatPolicyTimestamp(checkoutRequestedAt, i18n.language, tz),
    });
  }

  const nextSteps = [
    t("kciNextStep1", "Manager will review your photos and inspect the kitchen"),
    t("kciNextStep2", "The kitchen manager can record an inspection or report an issue"),
    t("kciNextStep3", "With no response in the inspection window, it closes as “no inspection recorded”"),
  ];

  return (
    <PolicyHeroShell
      emphasize={emphasize}
      className={className}
      showIntro
      title={
        mode === "pending"
          ? t("kciCheckoutPendingTitle", "Checkout submitted")
          : t("bdReadyToCheckOut", "Ready to Check Out")
      }
      description={
        mode === "pending"
          ? t(
              "kciCheckoutPendingBody",
              "Your departure is recorded. The kitchen manager can inspect it or report an issue within the inspection window; your booked time ends on its own schedule.",
            )
          : t(
              "bdCheckOutBody",
              "Follow the departure instructions and complete any tasks marked Required, then submit checkout for the kitchen manager to review.",
            )
      }
    >
      <PolicyTimeGrid layout="stack" cells={cells} />
      <ul className="mt-4 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
        {nextSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        {t(
          "bdKitchenLocalTime",
          { timezone: friendlyTimezoneName(tz, i18n.language), defaultValue: `Times are shown in the kitchen’s local time (${friendlyTimezoneName(tz, i18n.language)}).` },
        )}
      </p>
    </PolicyHeroShell>
  );
}

function PolicyHeroShell({
  emphasize,
  className,
  showIntro,
  title,
  description,
  children,
}: {
  emphasize?: boolean;
  className?: string;
  showIntro: boolean;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        emphasize ? "rounded-xl border border-border bg-muted/40 p-4 sm:p-5" : undefined,
        className,
      )}
    >
      {showIntro ? (
        <div className="mb-4">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      ) : null}
      {children}
    </div>
  );
}

function PolicyTimeGrid({
  layout,
  cells,
}: {
  layout: "stack" | "responsive";
  cells: Array<{ label: string; value: string; hint?: string }>;
}) {
  return (
    <div
      className={cn(
        layout === "stack"
          ? "grid grid-cols-1 gap-4 divide-y divide-border [&>*+*]:pt-4"
          : "grid grid-cols-1 gap-5 lg:grid-cols-3 lg:divide-x lg:divide-border",
      )}
    >
      {cells.map((cell, index) => (
        <div
          key={cell.label}
          className={cn(
            layout === "responsive" &&
              (index === 0
                ? "min-w-0 lg:pr-4"
                : index === 1
                  ? "min-w-0 lg:px-4"
                  : "min-w-0 lg:pl-4"),
          )}
        >
          <p className="text-xs text-muted-foreground">{cell.label}</p>
          <p className="mt-1 whitespace-nowrap text-sm font-medium tabular-nums">{cell.value}</p>
          {cell.hint ? <p className="mt-0.5 text-xs text-muted-foreground">{cell.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
