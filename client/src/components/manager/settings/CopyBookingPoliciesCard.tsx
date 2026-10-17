/**
 * "Copy these rules to your other kitchens" — preview per-kitchen field changes, then apply overrides.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { mt } from "@/i18n/manager";
import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PolicySection } from "./PolicySection";
import { kitchenWorkspaceSettingsKey } from "@/lib/manager-kitchens-navigation";

type Preview = {
  sourceKitchenId: number;
  sourceKitchenName: string;
  kitchens: Array<{
    kitchenId: number;
    kitchenName: string;
    changes: Array<{ field: string; from: unknown; to: unknown; action: string }>;
  }>;
};

const FIELD_LABEL: Record<string, string> = {
  minimumBookingWindowHours: "bpNoticeLabel",
  maxAdvanceBookingDays: "bpWindowLabel",
  defaultDailyBookingLimit: "bpLongestLabelOff",
  allowMultiDayBookings: "bpMultiDayLabel",
  maxBookingDays: "bpMaxDaysLabel",
  bookingBufferMinutes: "bpBufferLabel",
  weeklyChefHoursLimit: "bpWeeklyLabel",
  minimumBookingHours: "bpShortestLabel",
};

export function CopyBookingPoliciesCard({ kitchenId, kitchenCount }: { kitchenId: number; kitchenCount: number }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { data, isError, refetch, isFetching } = useQuery<Preview>({
    queryKey: ["copy-booking-policies", kitchenId],
    queryFn: () => apiGet(`/manager/kitchens/${kitchenId}/copy-booking-policies`),
    enabled: open && kitchenCount >= 2,
  });

  if (kitchenCount < 2) return null;

  const apply = async () => {
    setBusy(true); setMessage("");
    try {
      await apiPost(`/manager/kitchens/${kitchenId}/copy-booking-policies`, {});
      await queryClient.invalidateQueries({ queryKey: kitchenWorkspaceSettingsKey(kitchenId) });
      await queryClient.invalidateQueries({ queryKey: ["managerKitchenWorkspace"] });
      setMessage(mt("bpCopyDone"));
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : mt("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PolicySection title={mt("bpCopyTitle")} description={mt("bpCopyDescription")} testId="copy-booking-policies">
      <div className="space-y-3 px-4 py-3">
        {!open ? (
          <Button className="min-h-11" variant="outline" onClick={() => setOpen(true)}>
            {mt("bpCopyAction")}
          </Button>
        ) : isError ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {mt("bpCopyPreviewError")}
            <Button variant="outline" className="min-h-11" onClick={() => void refetch()}>{mt("retry")}</Button>
          </div>
        ) : isFetching || !data ? (
          <p className="text-sm text-muted-foreground">{mt("loading")}</p>
        ) : (
          <div className="space-y-3 text-sm">
            {data.kitchens.every((k) => k.changes.length === 0) ? (
              <p className="text-muted-foreground">{mt("bpCopyNoChanges")}</p>
            ) : data.kitchens.map((kitchen) => (
              <div key={kitchen.kitchenId} className="space-y-1">
                <p className="font-medium">{kitchen.kitchenName}</p>
                {kitchen.changes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{mt("bpCopyKitchenUnchanged")}</p>
                ) : (
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {kitchen.changes.map((change) => (
                      <li key={`${kitchen.kitchenId}-${change.field}`}>
                        {mt(FIELD_LABEL[change.field] || change.field, { count: Number(change.to) || 0 })}
                        {" · "}
                        {change.action === "clear" ? mt("bpCopyClearOverride") : mt("bpCopySetOverride")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setOpen(false)}>{mt("cancel")}</Button>
              <Button className="min-h-11" disabled={busy || data.kitchens.every((k) => k.changes.length === 0)} onClick={() => void apply()}>
                {mt("bpCopyConfirm")}
              </Button>
            </div>
          </div>
        )}
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </PolicySection>
  );
}
