import type { ComponentType, ReactNode } from "react";
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  ShoppingBag,
  Store,
  UtensilsCrossed,
} from "lucide-react";
import { SiStripe } from "react-icons/si";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChefPageHeader, QuietNotice, StatTile } from "@/components/chef/ui";
import {
  openChefShopHome,
  useShopStatus,
  useStripeDashboardLink,
} from "@/components/chef/seller-revenue/hooks/useSellerRevenue";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/formatters";
import locoLogo from "@/assets/LoCoLogo.svg";
import type { StatusTone } from "@/components/chef/applications/status";

interface ChefSellerAccountProps {
  onOpenApplications?: () => void;
}

type ChefTFunction = (key: string, options?: Record<string, unknown>) => string;

const SELLER_ACTIONS = (t: ChefTFunction) =>
  [
    {
      icon: UtensilsCrossed,
      title: t("actionMenuPrices"),
      detail: t("actionMenuPricesDesc"),
    },
    {
      icon: ShoppingBag,
      title: t("actionOrders"),
      detail: t("actionOrdersDesc"),
    },
    {
      icon: Store,
      title: t("actionStorefront"),
      detail: t("actionStorefrontDesc"),
    },
    {
      icon: Clock,
      title: t("actionShopSettings"),
      detail: t("actionShopSettingsDesc"),
    },
  ] as const;

const STRIPE_ACTIONS = (t: ChefTFunction) =>
  [
    {
      icon: Banknote,
      title: t("stripeActionPayouts"),
      detail: t("stripeActionPayoutsDesc"),
    },
    {
      icon: Building2,
      title: t("stripeActionBank"),
      detail: t("stripeActionBankDesc"),
    },
    {
      icon: FileText,
      title: t("stripeActionTax"),
      detail: t("stripeActionTaxDesc"),
    },
    {
      icon: ArrowLeftRight,
      title: t("stripeActionTransfers"),
      detail: t("stripeActionTransfersDesc"),
    },
  ] as const;

function BrandMark({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background",
        className
      )}
    >
      {children}
    </div>
  );
}

function ActionList({
  items,
  muted,
}: {
  items: readonly { icon: ComponentType<{ className?: string }>; title: string; detail: string }[];
  muted?: boolean;
}) {
  return (
    <ul className={muted ? "divide-y border-y opacity-60" : "divide-y border-y"}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.title} className="flex items-start gap-3 py-2.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium leading-none">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function LinkedAccountsSkeleton() {
  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div>
        <Skeleton className="mb-2 h-8 w-52" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="shadow-none">
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-3 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-start gap-3">
                <Skeleton className="h-11 w-11 rounded-lg" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-40" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function ChefSellerAccount({ onOpenApplications }: ChefSellerAccountProps) {
  const { t } = useTranslation("chef");
  const { data: shopStatus, isLoading } = useShopStatus();
  const dashboardLinkMutation = useStripeDashboardLink();
  const { toast } = useToast();

  const hasShop = Boolean(shopStatus?.phpShopId || shopStatus?.linked);
  const stripeConnected = Boolean(shopStatus?.phpShopStripeAccountId);
  const payoutsOn = stripeConnected;
  const linkedAt = shopStatus?.linkedAt ? formatDate(shopStatus.linkedAt) : null;

  const shopTone: StatusTone = hasShop ? "success" : "progress";
  const stripeTone: StatusTone = stripeConnected ? "success" : hasShop ? "warning" : "progress";
  const payoutsTone: StatusTone = payoutsOn ? "success" : hasShop ? "warning" : "neutral";

  const handleOpenStripe = async () => {
    if (!stripeConnected) {
      openChefShopHome();
      return;
    }
    try {
      const result = await dashboardLinkMutation.mutateAsync();
      if (result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      }
    } catch {
      toast({
        title: t("errorTitle"),
        description: t("openStripeFailed"),
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return <LinkedAccountsSkeleton />;
  }

  return (
    <div className="space-y-8">
      <ChefPageHeader
        title={t("linkedAccountsTitle")}
        description={t("linkedAccountsSubtitle")}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t("sellerShopLabel")}
          value={hasShop ? t("statusReady") : t("statusPending")}
          hint={hasShop && shopStatus?.phpShopId ? t("shopIdHint", { shopId: shopStatus.phpShopId }) : t("afterSellerApprovalHint")}
          tone={shopTone}
        />
        <StatTile
          label={t("stripeLabel")}
          value={stripeConnected ? t("statusConnected") : hasShop ? t("statusNotConnected") : t("statusPending")}
          hint={stripeConnected ? t("expressDashboardHint") : hasShop ? t("connectFromShopHint") : t("afterShopCreatedHint")}
          tone={stripeTone}
        />
        <StatTile
          label={t("payoutsLabel")}
          value={payoutsOn ? t("statusOn") : t("statusOff")}
          hint={payoutsOn ? t("payoutsOnHint") : t("needsStripeHint")}
          tone={payoutsTone}
        />
        <StatTile
          label={t("linkedLabel")}
          value={linkedAt ?? "—"}
          hint={linkedAt ? t("linkedDateHint") : t("notLinkedYetHint")}
          tone={hasShop ? "success" : "neutral"}
        />
      </div>

      {!hasShop && (
        <QuietNotice title={t("sellerAccountsAfterApprovalTitle")}>
          {t("sellerAccountsAfterApprovalBody")}
          {onOpenApplications ? (
            <>
              {" "}
              <button
                type="button"
                className="font-medium text-foreground underline-offset-4 hover:underline"
                onClick={onOpenApplications}
              >
                {t("viewApplication")}
              </button>
            </>
          ) : null}
        </QuietNotice>
      )}

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <Card className="flex h-full flex-col shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <BrandMark>
                  <img src={locoLogo} alt="" className="h-8 w-8 object-contain" />
                </BrandMark>
                <div>
                  <CardTitle className="text-base">{t("sellerShopCardTitle")}</CardTitle>
                  <CardDescription className="mt-1">{t("sellerShopCardDesc")}</CardDescription>
                </div>
              </div>
              <Badge variant={hasShop ? "success" : "outline"} className="shrink-0 font-medium">
                {hasShop ? t("statusReady") : t("statusPending")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex-1 pt-0">
            <ActionList items={SELLER_ACTIONS(t as unknown as ChefTFunction)} muted={!hasShop} />
          </CardContent>
          <CardFooter className="mt-auto w-full">
            <Button
              variant="outline"
              className="w-full"
              onClick={openChefShopHome}
              disabled={!hasShop}
            >
              {t("openShop")}
              <ExternalLink />
            </Button>
          </CardFooter>
        </Card>

        <Card className="flex h-full flex-col shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <BrandMark>
                  <SiStripe className="h-5 w-5 text-stripe" aria-hidden />
                </BrandMark>
                <div>
                  <img
                    src="/stripe-logo.png"
                    alt="Stripe"
                    className="mt-0.5 h-5 w-auto"
                  />
                  <CardDescription className="mt-1">{t("stripeCardDesc")}</CardDescription>
                </div>
              </div>
              <Badge
                variant={stripeConnected ? "success" : hasShop ? "warning" : "outline"}
                className="shrink-0 font-medium"
              >
                {stripeConnected ? t("statusConnected") : hasShop ? t("statusNotConnected") : t("statusPending")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex-1 pt-0">
            <ActionList items={STRIPE_ACTIONS(t as unknown as ChefTFunction)} muted={!stripeConnected} />
          </CardContent>
          <CardFooter className="mt-auto w-full">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleOpenStripe}
              disabled={!hasShop || dashboardLinkMutation.isPending}
            >
              {stripeConnected ? t("openStripe") : t("connectInShop")}
              {dashboardLinkMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ExternalLink />
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
