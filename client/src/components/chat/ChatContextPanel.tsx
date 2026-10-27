/**
 * Right side of a conversation (owner mock, Oct 27): what the thread is about. Chef: the kitchen, what's coming up,
 * past visits, booking access. Kitchen: the customer, what's coming up, past. Long histories stay short: two upcoming
 * items, then "+N more"; past is a count with the latest one.
 */
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { resolveImageUrl } from "@/lib/resolve-image-url";
import { cn } from "@/lib/utils";
import type { ChatContext, ChatContextItem } from "@/services/chat-service";
import { itemStatus, itemWhen } from "./chat-context-format";

type Tr = (key: string, options?: Record<string, unknown>) => string;

export function ContextItemRow({ item, compact = false }: { item: ChatContextItem; compact?: boolean }) {
  const { t: typedT, i18n } = useTranslation("chef");
  const t = typedT as unknown as Tr;
  const status = itemStatus(item, t);
  return (
    <Link href={item.href} className={cn("block rounded-lg py-2.5 text-sm hover:bg-muted/60", compact ? "px-0" : "-mx-2 px-2")}>
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{item.kind === "storage" && item.label ? item.label : t(`chatKind_${item.kind}`)}</span>
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
      </span>
      <span className="block text-muted-foreground">{itemWhen(item, i18n.language)}</span>
    </Link>
  );
}

export function StatusChip({ tone, children }: { tone: "ok" | "wait" | "muted"; children: string }) {
  return (
    <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold",
      tone === "ok" ? "bg-emerald-50 text-emerald-700" : tone === "wait" ? "bg-amber-50 text-amber-800" : "bg-muted text-muted-foreground")}>{children}</span>
  );
}

export default function ChatContextPanel({ context, role, partnerName, isLoading }: { context?: ChatContext; role: "chef" | "manager"; partnerName: string; isLoading?: boolean }) {
  const { t: typedT, i18n } = useTranslation("chef");
  const t = typedT as unknown as Tr;
  if (isLoading || !context) {
    return <div className="space-y-3 p-5" aria-busy="true">{[120, 64, 96].map((h) => <div key={h} className="animate-pulse rounded-xl bg-muted" style={{ height: h }} />)}</div>;
  }
  const more = context.upcoming.length - 2;
  const allHref = role === "chef" ? "/dashboard?view=bookings" : "/manager/dashboard?view=bookings";
  const section = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const card = "rounded-xl bg-background p-4 shadow-[inset_0_0_0_1px_hsl(var(--border))]";
  return (
    <div className="flex flex-col gap-4 p-5">
      {role === "chef" ? (
        <div className={cn(card, "p-0 overflow-hidden")}>
          {resolveImageUrl(context.kitchen.imageUrl) && <img src={resolveImageUrl(context.kitchen.imageUrl)!} alt="" className="h-28 w-full object-cover" />}
          <div className="p-4">
            <p className="font-semibold">{context.kitchen.name}</p>
            {context.kitchen.address && <p className="text-sm text-muted-foreground">{context.kitchen.address}</p>}
            {context.access && <p className="mt-2 text-sm">{t(context.access === "approved" ? "chatAccessApproved" : "chatAccessInReview")}</p>}
          </div>
        </div>
      ) : (
        <div className={card}>
          <p className="font-semibold">{partnerName}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {context.customer?.since && <><dt className="text-muted-foreground">{t("chatCustomerSince")}</dt><dd className="text-right">{new Intl.DateTimeFormat(i18n.language, { month: "short", year: "numeric" }).format(new Date(context.customer.since))}</dd></>}
            <dt className="text-muted-foreground">{t("chatCompletedBookings")}</dt><dd className="text-right">{context.customer?.completedBookings ?? 0}</dd>
            {!!context.customer?.noShows && <><dt className="text-muted-foreground">{t("chatNoShows")}</dt><dd className="text-right">{context.customer.noShows}</dd></>}
          </dl>
        </div>
      )}

      <div>
        <h3 className={section}>{t("chatComingUp")}</h3>
        <div className={cn(card, "mt-2 py-1.5")}>
          {context.upcoming.length ? context.upcoming.slice(0, 2).map((item) => <ContextItemRow key={`${item.kind}-${item.id}`} item={item} />)
            : <p className="py-2.5 text-sm text-muted-foreground">{t("chatNothingUpcoming")}</p>}
          {more > 0 && <Link href={allHref} className="block py-2 text-sm font-semibold underline underline-offset-4">{t("chatMoreUpcoming", { count: more })}</Link>}
        </div>
      </div>

      {context.past.count > 0 && (
        <div>
          <h3 className={section}>{t("chatPast", { count: context.past.count })}</h3>
          <div className={cn(card, "mt-2 py-1.5")}>
            <ContextItemRow item={context.past.latest[0]} />
            {context.past.count > 1 && <Link href={allHref} className="block py-2 text-sm font-semibold underline underline-offset-4">{t("chatSeeAll")}</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
