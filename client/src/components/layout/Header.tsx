import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { Application } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { getSubdomainFromHostname, getSubdomainOriginForEnvironment } from "@shared/subdomain-utils";
import { parseLocationLocale } from "@/i18n/routing";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { scrollToPageSection } from "@/lib/scroll-to-page-section";
import { addCollection, Icon } from "@iconify/react";
import { navIcons } from "@/assets/mdi-nav-icons";

// The bar renders mdi glyphs - the same family the landing page uses - so they have to be in
// Iconify's store before first paint. Without this, Iconify falls back to fetching each icon
// from its public API, which is a visible pop-in and a network dependency on a marketing page.
// The subset is ~4 KB; see dev/gen-mdi-subset.mjs.
addCollection(navIcons);

// ═══════════════════════════════════════════════════════════════════════════════
// TOP BAR - visual language
// ═══════════════════════════════════════════════════════════════════════════════
// This bar has to sit on top of the chef landing page without looking like a different
// product. The landing page's own vocabulary is: a 1px hairline at #2C2C2C/[0.07] instead of a
// grey border, layered soft shadows instead of Tailwind's defaults, 20-28px corner radii on
// panels, and ink at #1F1F1F with muted copy at #5F5F5F. Everything below is built from those
// tokens rather than from the shadcn defaults the header used to inherit.
//
// Three rules worth keeping if you edit this:
//
// 1. THE SERVICES MENU HAS EXACTLY TWO SERVICE ROWS. Selling food and booking a kitchen are
//    independent - a chef can take either or both, never one *then* the other. A third row
//    (there used to be "Payments and delivery handled") splits one service into two and reads
//    as a sequence. The kitchen-owner handoff is a different audience on a different site, so
//    it is a single row below a divider, not a third peer.
//
// 2. HIT TARGETS ARE 44px. The nav labels used to be 27px tall (a bare `py-1.5` on an inline
//    anchor) while the Services trigger was 32px, so the row was neither aligned nor tappable.
//    `NAV_ITEM` below is the single owner of that height.
//
// 3. NO SERVICE DESCRIPTION MAY WRAP. A row whose description spills onto a second line
//    silently doubles its own height and breaks the rhythm of the panel. The panel is wide
//    enough for the longest one; dev/shot-chef-nav.mjs asserts it.
// ═══════════════════════════════════════════════════════════════════════════════

/** The one definition of a top-level nav label's box. 44px tall, per the house tap floor. */
const NAV_ITEM =
  "inline-flex h-11 items-center rounded-full px-3.5 text-[13.5px] font-medium text-[#4A4A4A] " +
  "transition-colors duration-200 hover:bg-[#F6F4F2] hover:text-[#1F1F1F] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042]/40 focus-visible:ring-offset-1";

/**
 * Panel shell. Width is set by the longest service description needing one line, not by taste:
 * see rule 3 above.
 */
const PANEL =
  "z-50 w-[min(460px,calc(100vw-2rem))] overflow-hidden rounded-[24px] border border-[#2C2C2C]/[0.08] " +
  "bg-white p-2.5 text-[#1F1F1F] " +
  "shadow-[0_1px_2px_rgba(44,44,44,0.04),0_14px_28px_-14px_rgba(44,44,44,0.20),0_36px_80px_-28px_rgba(44,44,44,0.34)] " +
  "data-[state=open]:animate-in data-[state=closed]:animate-out " +
  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 " +
  "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 " +
  "data-[side=bottom]:slide-in-from-top-1 origin-[--radix-dropdown-menu-content-transform-origin] " +
  "data-[state=open]:duration-150 data-[state=closed]:duration-100";

/**
 * One service row.
 *
 * Deliberately identical for both services down to the pixel. Selling food and booking a kitchen
 * are independent paths of equal weight; giving one a different tint, size or emphasis would make
 * it read as the primary offer and the other as an upsell.
 */
function ServiceRow({
  icon,
  title,
  description,
  href,
  onSelect,
}: {
  icon: string;
  title: string;
  description: string;
  href: string;
  onSelect: (e: React.MouseEvent) => void;
}) {
  return (
    <DropdownMenuItem asChild>
      <a
        href={href}
        data-service-row
        onClick={onSelect}
        className={cn(
          "group/row flex cursor-pointer items-center gap-3.5 px-3 py-3 outline-none transition-colors duration-150 hover:bg-[#F6F4F2] focus-visible:bg-[#F6F4F2] data-[highlighted]:bg-[#F6F4F2]",
          ROW_RADIUS,
        )}
      >
        <span
          className={cn(
            "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full",
            "bg-gradient-to-b from-[#F51042]/[0.12] to-[#F51042]/[0.05] text-[#F51042]",
            "ring-1 ring-inset ring-[#F51042]/[0.10]",
            "transition-colors duration-150 group-hover/row:from-[#F51042]/[0.18] group-hover/row:to-[#F51042]/[0.08]",
          )}
        >
          <Icon icon={icon} className="h-[22px] w-[22px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold leading-[1.35] tracking-[-0.01em] text-[#1F1F1F]">
            {title}
          </span>
          <span
            data-service-desc
            className="mt-1 block whitespace-nowrap text-[12.5px] leading-[1.4] text-[#5F5F5F]"
          >
            {description}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[#B8B8B8] opacity-0 transition-all duration-200 group-hover/row:bg-[#F51042]/[0.08] group-hover/row:text-[#F51042] group-hover/row:opacity-100"
        >
          <Icon icon="mdi:arrow-right" className="h-4 w-4" />
        </span>
      </a>
    </DropdownMenuItem>
  );
}

/**
 * The handoff to the kitchen-owner site.
 *
 * A different audience on a different subdomain, so it sits below a divider rather than in the
 * list above. Circular affordances and a single line of copy keep it from reading as a slab: an
 * earlier version used a solid 44px square tile and a pill button, which made the handoff the
 * heaviest thing in the panel even though it is the secondary action.
 */
function KitchenPartnerCard({
  href,
  icon,
  title,
  description,
  onSelect,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem asChild>
      <a
        href={href}
        data-kitchen-partner
        onClick={onSelect}
        className={cn(
          "group/partner mt-2 flex cursor-pointer items-center gap-3.5 px-3 py-3 outline-none",
          "border border-[#F51042]/[0.10] bg-gradient-to-r from-[#FFF4F6] via-white to-[#FFF4F6]",
          "transition-colors duration-200 hover:border-[#F51042]/[0.20] focus-visible:border-[#F51042]/[0.20] data-[highlighted]:border-[#F51042]/[0.20]",
          ROW_RADIUS,
        )}
      >
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#F51042] shadow-[0_6px_16px_-8px_rgba(245,16,66,0.55)] ring-1 ring-[#F51042]/[0.14]">
          <Icon icon={icon} className="h-[22px] w-[22px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold leading-[1.35] tracking-[-0.01em] text-[#1F1F1F]">
            {title}
          </span>
          <span
            data-partner-desc
            className="mt-1 block whitespace-nowrap text-[12.5px] leading-[1.4] text-[#5F5F5F]"
          >
            {description}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#F51042] ring-1 ring-[#F51042]/[0.12] transition-colors duration-200 group-hover/partner:bg-[#F51042] group-hover/partner:text-white group-hover/partner:ring-[#F51042]"
        >
          <Icon icon="mdi:arrow-right" className="h-4 w-4" />
        </span>
      </a>
    </DropdownMenuItem>
  );
}

/**
 * Rows inside a Radix `DropdownMenuItem` need `!` on their corner radius.
 *
 * `dropdown-menu.tsx` puts `rounded-sm` in the item's base classes, and `asChild` makes Radix's
 * `Slot` CONCATENATE the item's className with the child's - there is no tailwind-merge in that
 * path. So both `rounded-sm` (2px) and any radius written here land on the element, and the
 * stylesheet order decides. It decided 2px, which is why every row in this panel rendered as a
 * near-square rectangle. The `!` prefix is the only thing that wins regardless of order.
 */
const ROW_RADIUS = "!rounded-[18px]";
const ROW_RADIUS_SM = "!rounded-[14px]";

/** Hairline between panel sections. */
function PanelRule() {
  return <div role="separator" className="mx-2 my-2 border-t border-[#2C2C2C]/[0.07]" />;
}

/**
 * Name and email block that heads the account menu. Shared with the mobile drawer so both
 * surfaces show the same identity.
 */
function AccountIdentity({
  name,
  email,
  initial,
  photoURL,
}: {
  name: string;
  email: string | null;
  initial: string;
  photoURL: string | null;
}) {
  return (
    <div className="flex items-center gap-3 px-2.5 py-2">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#F51042]/[0.10] text-[15px] font-semibold text-[#F51042] ring-1 ring-inset ring-[#F51042]/[0.14]">
        {photoURL ? <img src={photoURL} alt="" className="h-full w-full object-cover" /> : initial}
      </span>
      <span className="min-w-0 flex-1">
        <span data-account-name className="block truncate text-[13.5px] font-semibold leading-tight text-[#1F1F1F]">
          {name}
        </span>
        {email && <span className="mt-0.5 block truncate text-[12px] leading-tight text-[#6B6B6B]">{email}</span>}
      </span>
    </div>
  );
}

/**
 * One action inside the account menu: icon, label, optional danger tone.
 *
 * A single line, unlike a `ServiceRow` - these are chrome, not offers, and giving them
 * descriptions would make the account menu as heavy as the services one.
 */
function AccountRow({
  icon,
  label,
  href,
  onSelect,
  tone = "default",
}: {
  icon: string;
  label: string;
  href?: string;
  onSelect: (e: React.MouseEvent) => void;
  tone?: "default" | "danger";
}) {
  const cls = cn(
    "flex w-full cursor-pointer items-center gap-3 px-2.5 py-2.5 text-left outline-none transition-colors duration-150",
    ROW_RADIUS_SM,
    tone === "danger"
      ? "text-[#C80A31] hover:bg-[#FFF1F4] focus-visible:bg-[#FFF1F4] data-[highlighted]:bg-[#FFF1F4]"
      : "text-[#1F1F1F] hover:bg-[#F6F4F2] focus-visible:bg-[#F6F4F2] data-[highlighted]:bg-[#F6F4F2]",
  );
  const body = (
    <>
      <Icon
        icon={icon}
        className={cn("h-[18px] w-[18px] flex-shrink-0", tone === "danger" ? "text-[#C80A31]" : "text-[#6B6B6B]")}
        aria-hidden
      />
      <span className="text-[13.5px] font-medium">{label}</span>
    </>
  );

  return (
    <DropdownMenuItem asChild>
      {href ? (
        <a href={href} data-account-row onClick={onSelect} className={cls}>
          {body}
        </a>
      ) : (
        <button type="button" data-account-row onClick={onSelect} className={cls}>
          {body}
        </button>
      )}
    </DropdownMenuItem>
  );
}

// Helper to check if an application is active (not cancelled, rejected)
const isApplicationActive = (app: Application) => {
  return app.status !== 'cancelled' && app.status !== 'rejected';
};

// Helper to check if user has any active applications
const hasActiveApplication = (applications?: Application[]) => {
  if (!applications || applications.length === 0) return false;
  return applications.some(isApplicationActive);
};

export default function Header({
  position = "fixed",
  hideHowItWorks = false,
  centerContent,
}: {
  position?: "fixed" | "static";
  hideHowItWorks?: boolean;
  /**
   * Optional slot rendered in the middle of the bar (desktop only). Pages own the content;
   * the header only provides the centred flex cell. Compare Kitchens uses it for the compact
   * search that takes over once the in-flow search scrolls past the bar.
   */
  centerContent?: ReactNode;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isServicesOpen, setIsServicesOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const firebaseAuth = useFirebaseAuth();
  const { t } = useTranslation("common");

  // ── Hover intent for the Services menu ──────────────────────────────────────
  // Radix's DropdownMenu is click/keyboard only, which is correct for a menu but wrong for a
  // marketing nav — people expect the panel on hover. The panel renders in a portal, so moving
  // the pointer from the trigger into it fires `pointerleave` on the trigger; hence BOTH the
  // trigger and the panel feed the same timer, and the panel cancels it on entry. Without the
  // delay, crossing the 4px gap between them closes the menu mid-journey.
  const servicesCloseTimer = useRef<number | null>(null);

  const cancelServicesClose = useCallback(() => {
    if (servicesCloseTimer.current !== null) {
      window.clearTimeout(servicesCloseTimer.current);
      servicesCloseTimer.current = null;
    }
  }, []);

  const openServicesOnHover = useCallback(() => {
    cancelServicesClose();
    setIsServicesOpen(true);
  }, [cancelServicesClose]);

  const scheduleServicesClose = useCallback(() => {
    cancelServicesClose();
    servicesCloseTimer.current = window.setTimeout(() => {
      servicesCloseTimer.current = null;
      setIsServicesOpen(false);
    }, 220);
  }, [cancelServicesClose]);

  useEffect(() => cancelServicesClose, [cancelServicesClose]);

  // Coarse pointers have no hover, so the trigger must stay a plain toggle there.
  const hoverOpensServices = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(hover: hover) and (pointer: fine)").matches === true,
    [],
  );

  // ── Why the focus ring is suppressed on a pointer-driven close ──────────────
  // Radix hands focus back to the trigger whenever the menu closes. That is right for a keyboard
  // user and wrong for a mouse user: the trigger is `rounded-full`, so Chrome painting
  // :focus-visible on it draws a brand-red pill outline around "Services" that then just sits
  // there after the menu is gone. So focus is only returned when the last input was a key.
  const lastInputWasKeyboard = useRef(false);
  useEffect(() => {
    const onKey = () => {
      lastInputWasKeyboard.current = true;
    };
    const onPointer = () => {
      lastInputWasKeyboard.current = false;
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  // Get current subdomain
  const currentSubdomain = useMemo(() => {
    if (typeof window !== 'undefined') {
      return getSubdomainFromHostname(window.location.hostname);
    }
    return null;
  }, []);

  // Check if Partner Login should be shown (only for kitchen.* subdomain, not chef.*)
  const showPartnerLogin = useMemo(() => {
    return currentSubdomain === 'kitchen';
  }, [currentSubdomain]);

  const loginHref = currentSubdomain === 'admin'
    ? '/admin/login'
    : showPartnerLogin ? '/manager/login' : '/auth';

  // Services: cross-subdomain audience links (full URLs — subdomain hops are hard navigations)
  // Preview → https://dev-chef.localcooks.ca ; production → https://chef.localcooks.ca
  const serviceUrls = useMemo(() => {
    const hostname =
      typeof window !== "undefined" ? window.location.hostname : "localcooks.ca";
    const opts = {
      port: typeof window !== "undefined" ? window.location.port : "",
      protocol: typeof window !== "undefined" ? window.location.protocol : "https:",
      vercelEnv: import.meta.env.VITE_VERCEL_ENV as string | undefined,
    };
    return {
      chef: getSubdomainOriginForEnvironment("chef", hostname, opts),
      kitchen: getSubdomainOriginForEnvironment("kitchen", hostname, opts),
    };
  }, []);

  // Use Firebase auth (session auth removed)
  const { user: firebaseUser } = useFirebaseAuth();

  const { data: profileUser } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) return null;
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          if (response.status === 401) {
            return null; // Not authenticated
          }
          throw new Error(`Firebase auth failed: ${response.status}`);
        }

        const userData = await response.json();
        return userData;
      } catch (error) {
        logger.error('Header - Firebase auth error:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Use profileUser (from Firebase auth) as the primary user source
  const user = profileUser || firebaseAuth.user;

  const logout = async () => {
    // Firebase logout (session auth removed)
    logger.info('Performing Firebase logout...');
    firebaseAuth.logout();
  };

  // Debug logging for header state
  logger.info('Header component state:', {
    profileUser,
    firebaseUser: firebaseAuth.user,
    finalUser: user,
    userRole: user?.role
  });

  // Fetch applicant's applications if they are logged in
  const { data: applications } = useQuery<Application[]>({
    queryKey: ["/api/firebase/applications/my"],
    queryFn: async ({ queryKey }) => {
      if (!user || (!user.uid && !user.id)) {
        throw new Error("User not authenticated");
      }

      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error("User not authenticated");
      }

      const token = await currentUser.getIdToken();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`
      };

      const response = await fetch(queryKey[0] as string, {
        credentials: 'include',
        headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || response.statusText);
      }

      const rawData = await response.json();

      // Convert snake_case to camelCase for database fields
      const normalizedData = rawData.map((app: any) => ({
        id: app.id,
        userId: app.user_id || app.userId,
        fullName: app.full_name || app.fullName,
        email: app.email,
        phone: app.phone,
        foodSafetyLicense: app.food_safety_license || app.foodSafetyLicense,
        foodEstablishmentCert: app.food_establishment_cert || app.foodEstablishmentCert,
        kitchenPreference: app.kitchen_preference || app.kitchenPreference,
        feedback: app.feedback,
        status: app.status,
        createdAt: app.created_at || app.createdAt
      }));

      return normalizedData;
    },
    enabled: !!user && user.role === "applicant",
  });

  // No longer need these for Apply Now button
  // const activeApplication = hasActiveApplication(applications);
  // const showApplyButton = !user || (user.role === "applicant" && !activeApplication && location !== "/apply");

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const closeMenu = () => {
    setIsMenuOpen(false);
  };

  const handleLogout = () => {
    setIsAccountOpen(false);
    setIsMenuOpen(false);
    logout();
  };

  const scrollToSection = useCallback((sectionId: string, event?: React.MouseEvent) => {
    event?.preventDefault();
    setIsMenuOpen(false);
    setIsServicesOpen(false);

    const scrollToElement = () => {
      if (scrollToPageSection(sectionId)) {
        closeMenu();
        return true;
      }
      return false;
    };

    // Landing pages (main, chef, kitchen) render these sections inline.
    // Strip any locale prefix (/en-CA, /fr-CA, /uk) before deciding we're "home",
    // otherwise the locale-prefixed URL makes us navigate instead of scroll.
    const { pathWithoutLocale } = parseLocationLocale(location);
    if (pathWithoutLocale === "/") {
      // Try immediately
      if (scrollToElement()) return;

      // If not found, try with delays (for dynamic content)
      const delays = [100, 300, 500, 1000, 2000, 3500];
      delays.forEach((delay) => {
        setTimeout(scrollToElement, delay);
      });
      return;
    }

    // Chef navigation uses a one-time session target so refreshing the landing
    // page always starts at the top instead of replaying an old URL hash.
    if (currentSubdomain === "chef") {
      window.sessionStorage.setItem("chef-landing-scroll-target", sectionId);
      setLocation("/");
      return;
    }

    // Other landing pages retain their existing deep-link behavior.
    setLocation(`/#${sectionId}`);
  }, [currentSubdomain, location, setLocation]);

  /**
   * Who the bar is signed in as, for the account menu.
   *
   * `users.username` mirrors the confirmed email and the users table has no name column, so a
   * session backed only by `/api/user/profile` has no name to show - which is why the bar used to
   * render the email's local part ("ronak") as if it were a name, next to a "Dashboard" link.
   * Firebase holds the real displayName; `profileUser` shadows it in `user`, so it is read from
   * `firebaseAuth.user` directly. Identity belongs inside the menu, not in the nav row.
   */
  const account = useMemo(() => {
    const email =
      firebaseAuth.user?.email ||
      (typeof user?.username === "string" && user.username.includes("@") ? user.username : null) ||
      (typeof user?.email === "string" ? user.email : null);

    const name =
      firebaseAuth.user?.displayName?.trim() ||
      user?.displayName?.trim() ||
      user?.fullName?.trim() ||
      (email ? email.split("@")[0] : "") ||
      (typeof user?.username === "string" ? user.username : "") ||
      t("profile");

    return {
      name,
      email,
      photoURL: firebaseAuth.user?.photoURL || null,
      initial: name.trim().charAt(0).toUpperCase() || "?",
    };
  }, [firebaseAuth.user, user, t]);

  // Dashboard link and label. The name is deliberately NOT part of it any more - it read as
  // "ronak's Dashboard" in a row of nav links, which is both noisy and wrong when the only name
  // available is an email prefix. The account menu carries the identity instead.
  const getDashboardInfo = () => {
    if (user?.role === "admin") {
      return { href: "/admin", text: t("adminDashboardShort") };
    } else if (user?.role === "manager") {
      return { href: "/manager/dashboard", text: t("managerDashboard") };
    } else {
      return { href: "/dashboard", text: t("dashboard") };
    }
  };

  return (
    <header
      className={cn(
        // A hairline and a blur, not `shadow-md border-b`: the landing page sits behind a grid
        // and a brand glow, and a grey 1px line plus a hard shadow read as a different product.
        "z-50 mobile-safe-area transition-colors duration-300 border-b border-[#2C2C2C]/[0.07] bg-background/85 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-background/70",
        position === "fixed" ? "fixed top-0 left-0 right-0" : "relative"
      )}
    >
      <div className="mx-auto flex h-[var(--header-height)] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* ── Lockup ────────────────────────────────────────────────────────────
            The mark is a traced vector (see client/src/assets/local-cooks-mark.svg) so it stays
            crisp at this size; the wordmark is Lobster, which is the brand board's logo face. */}
        <Link href="/" className="group flex flex-shrink-0 items-center gap-2.5">
          <Logo
            variant="brand"
            className="h-[30px] w-auto flex-shrink-0 transition-transform duration-300 group-hover:scale-[1.04] sm:h-[34px]"
          />
          <span className="flex min-w-0 flex-col justify-center">
            <span className="font-logo text-[1.3rem] leading-[0.95] tracking-[-0.005em] text-[#F51042] sm:text-[1.45rem]">
              LocalCooks
            </span>
            {currentSubdomain === 'chef' && (
              <span className="mt-[3px] text-[8.5px] font-semibold uppercase leading-none tracking-[0.16em] text-[#6B6B6B] sm:text-[9px]">
                {t("forChefs")}
              </span>
            )}
            {currentSubdomain === 'kitchen' && (
              <span className="mt-[3px] text-[8.5px] font-semibold uppercase leading-none tracking-[0.16em] text-[#6B6B6B] sm:text-[9px]">
                {t("forKitchens")}
              </span>
            )}
          </span>
        </Link>

        {centerContent && (
          <div className="hidden min-w-0 flex-1 items-center justify-center px-6 lg:flex">
            {centerContent}
          </div>
        )}

        <nav className="hidden md:block">
          <ul className="flex items-center gap-0.5">
            <li
              onPointerEnter={hoverOpensServices ? openServicesOnHover : undefined}
              onPointerLeave={hoverOpensServices ? scheduleServicesClose : undefined}
            >
              <DropdownMenu open={isServicesOpen} onOpenChange={setIsServicesOpen} modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-haspopup="menu"
                    className={cn(
                      NAV_ITEM,
                      "group cursor-pointer gap-1.5 pr-2.5",
                      "data-[state=open]:bg-[#F6F4F2] data-[state=open]:text-[#1F1F1F]",
                    )}
                  >
                    {t("services")}
                    <Icon
                      icon="mdi:chevron-down"
                      className="h-3.5 w-3.5 text-[#7A7A7A] transition-transform duration-300 group-data-[state=open]:rotate-180"
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={6}
                  className={PANEL}
                  onPointerEnter={cancelServicesClose}
                  onPointerLeave={hoverOpensServices ? scheduleServicesClose : undefined}
                  onCloseAutoFocus={(event) => {
                    // See the note on `lastInputWasKeyboard`: without this, a mouse-driven close
                    // leaves a brand-red focus pill hanging around the trigger.
                    if (!lastInputWasKeyboard.current) event.preventDefault();
                  }}
                >
                  {/* Chef side: exactly two services. See rule 1 at the top of this file.
                      Kitchen side is untouched content-wise - it inherits the new shell only. */}
                  {currentSubdomain === 'kitchen' ? (
                    <>
                      <ServiceRow
                        icon="mdi:storefront-outline"
                        title={t("kitchenServiceListSpace")}
                        description={t("kitchenServiceListSpaceDesc")}
                        href="/#how-it-works"
                        onSelect={(e) => scrollToSection("how-it-works", e)}
                      />
                      <ServiceRow
                        icon="mdi:calendar-check-outline"
                        title={t("kitchenServiceManageBookings")}
                        description={t("kitchenServiceManageBookingsDesc")}
                        href="/#how-it-works"
                        onSelect={(e) => scrollToSection("how-it-works", e)}
                      />
                      <ServiceRow
                        icon="mdi:cash-multiple"
                        title={t("kitchenServiceEarn")}
                        description={t("kitchenServiceEarnDesc")}
                        href="/#how-it-works"
                        onSelect={(e) => scrollToSection("how-it-works", e)}
                      />
                    </>
                  ) : (
                    <>
                      <ServiceRow
                        icon="mdi:storefront-outline"
                        title={t("chefServiceSell")}
                        description={t("chefServiceSellDesc")}
                        href="/#how-it-works"
                        onSelect={(e) => scrollToSection("how-it-works", e)}
                      />
                      <ServiceRow
                        icon="mdi:silverware-fork-knife"
                        title={t("chefServiceBookKitchen")}
                        description={t("chefServiceBookKitchenDesc")}
                        href="/#kitchen-access"
                        onSelect={(e) => scrollToSection("kitchen-access", e)}
                      />
                    </>
                  )}

                  <PanelRule />

                  {currentSubdomain === 'kitchen' ? (
                    <KitchenPartnerCard
                      href={serviceUrls.chef}
                      icon="mdi:chef-hat"
                      title={t("chefPartnerLink")}
                      description={t("chefPartnerLinkDesc")}
                      onSelect={() => setIsServicesOpen(false)}
                    />
                  ) : (
                    <KitchenPartnerCard
                      href={serviceUrls.kitchen}
                      icon="mdi:office-building-outline"
                      title={t("kitchenPartnerCardTitle")}
                      description={t("kitchenPartnerLinkDesc")}
                      onSelect={() => setIsServicesOpen(false)}
                    />
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
            {!hideHowItWorks && (
              <li>
                <a href="#how-it-works" className={NAV_ITEM} onClick={(e) => scrollToSection("how-it-works", e)}>
                  {t("howItWorks")}
                </a>
              </li>
            )}
            <li>
              <a href="#resources" className={NAV_ITEM} onClick={(e) => scrollToSection("resources", e)}>
                {t("resources")}
              </a>
            </li>
            <li>
              <a href="#faq" className={NAV_ITEM} onClick={(e) => scrollToSection("faq", e)}>
                {t("faq")}
              </a>
            </li>
            {!user && (
              <li className="ml-2">
                {/* A plain anchor, not `<Button>`.
                    `Button` applies `chefPrimaryCtaClass` (lib/chef-cta.ts) to every default
                    variant: a red glow shadow and a `hover:-translate-y-0.5` lift under
                    `transition-all`. Those are right for a page-level CTA sitting alone on white,
                    and wrong here, where the button is one item in a row of nav links - the glow
                    reads as a halo and the lift makes the label shimmy. Overriding them through
                    `className` means fighting tailwind-merge for the transform, so the nav CTA
                    simply does not use that component.

                    `h-9` is deliberate. index.css floors `button` / `a[role="button"]` at 44px,
                    but this is a plain anchor inside `hidden md:block`, so it is never a touch
                    target and the floor does not apply. The nav LINKS keep their 44px hit boxes
                    (invisible, so a generous target costs nothing); the CTA is the only element
                    whose visual size is on show, and 36px is what reads as a nav button rather
                    than a slab. dev/shot-chef-nav.mjs asserts both numbers. */}
                <Link
                  href={loginHref}
                  data-nav-cta
                  className={cn(
                    "inline-flex h-9 items-center justify-center rounded-full px-4",
                    "bg-[#F51042] text-[13px] font-medium leading-none tracking-[-0.01em] text-white",
                    "shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_2px_rgba(44,44,44,0.08)]",
                    "transition-[background-color,box-shadow] duration-200",
                    "hover:bg-[#E00A38] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_2px_5px_rgba(44,44,44,0.14)]",
                    "active:bg-[#CC0932]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F1F1F]/40 focus-visible:ring-offset-2",
                  )}
                >
                  {showPartnerLogin ? t("partnerLoginRegister") : t("loginRegister")}
                </Link>
              </li>
            )}

            {user && (
              <>
                <li>
                  <Link href={getDashboardInfo().href} className={NAV_ITEM}>
                    {getDashboardInfo().text}
                  </Link>
                </li>
                <li className="ml-1.5">
                  {/* The account menu. Everything that is about the PERSON rather than the
                      product lives in here: the name, the email, the dashboard, the training
                      link and sign-out. Before this, the bar printed the email's local part as
                      a nav label and parked an outlined "Logout" pill beside it, which is the
                      least elegant thing a marketing header can do. */}
                  <DropdownMenu open={isAccountOpen} onOpenChange={setIsAccountOpen} modal={false}>
                    <DropdownMenuTrigger asChild>
                      {/* Avatar + caret, as one control.
                          A bare circle of initials reads as decoration, not a button: nothing
                          about it says "this opens a menu". Every site that solved this pairs the
                          avatar with a caret - GitHub, Stripe, Linear, Vercel - and the caret is
                          what actually does the work. The hover fill is the same one the nav
                          links use, so it is discoverable without shouting, and the caret
                          rotates on open exactly like the Services trigger. */}
                      <button
                        type="button"
                        aria-label={t("accountMenu")}
                        data-account-trigger
                        className={cn(
                          "group/account flex h-9 cursor-pointer items-center gap-0.5 rounded-full pl-1 pr-1.5",
                          // index.css floors every <button> at 44x44; an avatar that size is a
                          // slab in a 64px bar. The reset is the documented escape hatch.
                          "!min-h-0 !min-w-0",
                          "transition-colors duration-200 hover:bg-[#F6F4F2] data-[state=open]:bg-[#F6F4F2]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F1F1F]/40 focus-visible:ring-offset-2",
                        )}
                      >
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#F51042]/[0.10] text-[12px] font-semibold text-[#F51042] ring-1 ring-inset ring-[#F51042]/[0.14]">
                          {account.photoURL ? (
                            <img src={account.photoURL} alt="" className="h-full w-full object-cover" />
                          ) : (
                            account.initial
                          )}
                        </span>
                        <span
                          data-account-chevron
                          className="flex h-4 w-4 flex-shrink-0 items-center justify-center"
                        >
                          <Icon
                            icon="mdi:chevron-down"
                            className="h-4 w-4 text-[#7A7A7A] transition-transform duration-300 group-data-[state=open]/account:rotate-180"
                            aria-hidden
                          />
                        </span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      sideOffset={6}
                      className={cn(PANEL, "w-[min(296px,calc(100vw-2rem))]")}
                      onCloseAutoFocus={(event) => {
                        if (!lastInputWasKeyboard.current) event.preventDefault();
                      }}
                    >
                      <AccountIdentity {...account} />
                      <PanelRule />
                      <AccountRow
                        icon="mdi:view-dashboard-outline"
                        label={getDashboardInfo().text}
                        href={getDashboardInfo().href}
                        onSelect={() => setIsAccountOpen(false)}
                      />
                      {user.role !== 'admin' && (user as any).isChef && (
                        <AccountRow
                          icon="mdi:school-outline"
                          label={t("foodSafetyTraining")}
                          href="/microlearning/overview"
                          onSelect={() => setIsAccountOpen(false)}
                        />
                      )}
                      <PanelRule />
                      <AccountRow
                        icon="mdi:logout-variant"
                        label={t("logout")}
                        tone="danger"
                        onSelect={handleLogout}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              </>
            )}
          </ul>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          {user && (
            // The avatar alone. The drawer below carries the name, the email and sign-out; a
            // name plus a bare logout icon in the bar itself is what made this row feel cluttered.
            <Link
              href={getDashboardInfo().href}
              aria-label={getDashboardInfo().text}
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#F51042]/[0.10] text-[13px] font-semibold text-[#F51042] ring-1 ring-inset ring-[#F51042]/[0.14]"
            >
              {account.photoURL ? (
                <img src={account.photoURL} alt="" className="h-full w-full object-cover" />
              ) : (
                account.initial
              )}
            </Link>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMenu}
            className="mobile-touch-target mobile-no-tap-highlight p-3 rounded-xl"
          >
            {isMenuOpen ? (
              <Icon icon="mdi:close" className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
            ) : (
              <Icon icon="mdi:menu" className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
            )}
          </Button>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="md:hidden border-t border-[#2C2C2C]/[0.07] mobile-momentum-scroll" style={{ backgroundColor: 'rgba(255, 255, 255, 0.98)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)' }}>
          <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
            <ul className="space-y-2">
              <li>
                {currentSubdomain === 'kitchen' ? (
                  <>
                    {([
                      ["mdi:storefront-outline", "kitchenServiceListSpace", "kitchenServiceListSpaceDesc", "/#how-it-works", "how-it-works"],
                      ["mdi:calendar-check-outline", "kitchenServiceManageBookings", "kitchenServiceManageBookingsDesc", "/#how-it-works", "how-it-works"],
                      ["mdi:cash-multiple", "kitchenServiceEarn", "kitchenServiceEarnDesc", "/#how-it-works", "how-it-works"],
                    ] as const).map(([icon, title, description, href, section]) => (
                      <a
                        key={title}
                        href={href}
                        data-service-row
                        className="flex items-center gap-3.5 rounded-[18px] px-3 py-3 transition-colors hover:bg-[#F6F4F2] mobile-touch-target mobile-no-tap-highlight"
                        onClick={(e) => scrollToSection(section, e)}
                      >
                        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#F51042]/[0.12] to-[#F51042]/[0.05] text-[#F51042] ring-1 ring-inset ring-[#F51042]/[0.10]">
                          <Icon icon={icon} className="h-[22px] w-[22px]" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14.5px] font-semibold leading-[1.35] tracking-[-0.01em] text-[#1F1F1F]">{t(title)}</span>
                          <span className="mt-1 block text-[12.5px] leading-[1.4] text-[#5F5F5F]">{t(description)}</span>
                        </span>
                      </a>
                    ))}
                  </>
                ) : (
                  <>
                    {([
                      ["mdi:storefront-outline", "chefServiceSell", "chefServiceSellDesc", "/#how-it-works", "how-it-works"],
                      ["mdi:silverware-fork-knife", "chefServiceBookKitchen", "chefServiceBookKitchenDesc", "/#kitchen-access", "kitchen-access"],
                    ] as const).map(([icon, title, description, href, section]) => (
                      <a
                        key={title}
                        href={href}
                        data-service-row
                        className="flex items-center gap-3.5 rounded-[18px] px-3 py-3 transition-colors hover:bg-[#F6F4F2] mobile-touch-target mobile-no-tap-highlight"
                        onClick={(e) => scrollToSection(section, e)}
                      >
                        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#F51042]/[0.12] to-[#F51042]/[0.05] text-[#F51042] ring-1 ring-inset ring-[#F51042]/[0.10]">
                          <Icon icon={icon} className="h-[22px] w-[22px]" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14.5px] font-semibold leading-[1.35] tracking-[-0.01em] text-[#1F1F1F]">{t(title)}</span>
                          <span className="mt-1 block text-[12.5px] leading-[1.4] text-[#5F5F5F]">{t(description)}</span>
                        </span>
                      </a>
                    ))}
                  </>
                )}

                <div role="separator" className="mx-2 my-2 border-t border-[#2C2C2C]/[0.07]" />

                <a
                  href={currentSubdomain === 'kitchen' ? serviceUrls.chef : serviceUrls.kitchen}
                  data-kitchen-partner
                  className="mt-2 flex items-center gap-3.5 rounded-[18px] border border-[#F51042]/[0.10] bg-gradient-to-r from-[#FFF4F6] via-white to-[#FFF4F6] px-3 py-3 mobile-touch-target mobile-no-tap-highlight"
                  onClick={closeMenu}
                >
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#F51042] shadow-[0_6px_16px_-8px_rgba(245,16,66,0.55)] ring-1 ring-[#F51042]/[0.14]">
                    <Icon
                      icon={currentSubdomain === 'kitchen' ? "mdi:chef-hat" : "mdi:office-building-outline"}
                      className="h-[22px] w-[22px]"
                      aria-hidden
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold leading-[1.35] tracking-[-0.01em] text-[#1F1F1F]">
                      {currentSubdomain === 'kitchen' ? t("chefPartnerLink") : t("kitchenPartnerCardTitle")}
                    </span>
                    <span className="mt-1 block text-[12.5px] leading-[1.4] text-[#5F5F5F]">
                      {currentSubdomain === 'kitchen' ? t("chefPartnerLinkDesc") : t("kitchenPartnerLinkDesc")}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#F51042] ring-1 ring-[#F51042]/[0.12]"
                  >
                    <Icon icon="mdi:arrow-right" className="h-4 w-4" />
                  </span>
                </a>
              </li>
              <li role="separator" className="border-t border-gray-200/70 my-1" />
              {!hideHowItWorks && <li>
                <a
                  href="#how-it-works"
                  className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                  onClick={(e) => {
                    scrollToSection("how-it-works", e);
                    closeMenu();
                  }}
                >{t("howItWorks")}</a>
              </li>}
              <li>
                <a
                  href="#resources"
                  className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                  onClick={(e) => {
                    scrollToSection("resources", e);
                    closeMenu();
                  }}
                >{t("resources")}</a>
              </li>
              <li>
                <a
                  href="#faq"
                  className="block py-3 px-2 rounded-lg hover:text-primary hover:bg-primary/5 transition-colors mobile-touch-target mobile-no-tap-highlight"
                  onClick={(e) => {
                    scrollToSection("faq", e);
                    closeMenu();
                  }}
                >{t("faq")}</a>
              </li>

              {user && (
                <>
                  <li role="separator" className="border-t border-[#2C2C2C]/[0.07] my-1" />
                  <li className="rounded-[18px] bg-[#F6F4F2]/70 p-1">
                    <AccountIdentity {...account} />
                    <Link
                      href={getDashboardInfo().href}
                      data-account-row
                      className="flex items-center gap-3 rounded-[14px] px-2.5 py-3 text-[13.5px] font-medium text-[#1F1F1F] transition-colors hover:bg-white mobile-touch-target mobile-no-tap-highlight"
                      onClick={closeMenu}
                    >
                      <Icon icon="mdi:view-dashboard-outline" className="h-[18px] w-[18px] flex-shrink-0 text-[#6B6B6B]" aria-hidden />
                      {getDashboardInfo().text}
                    </Link>
                    {user.role !== 'admin' && (user as any).isChef && (
                      <Link
                        href="/microlearning/overview"
                        data-account-row
                        className="flex items-center gap-3 rounded-[14px] px-2.5 py-3 text-[13.5px] font-medium text-[#1F1F1F] transition-colors hover:bg-white mobile-touch-target mobile-no-tap-highlight"
                        onClick={closeMenu}
                      >
                        <Icon icon="mdi:school-outline" className="h-[18px] w-[18px] flex-shrink-0 text-[#6B6B6B]" aria-hidden />
                        {t("foodSafetyTraining")}
                      </Link>
                    )}
                    <button
                      type="button"
                      data-account-row
                      onClick={() => {
                        handleLogout();
                        closeMenu();
                      }}
                      className="flex w-full items-center gap-3 rounded-[14px] px-2.5 py-3 text-left text-[13.5px] font-medium text-[#C80A31] transition-colors hover:bg-[#FFF1F4] mobile-touch-target mobile-no-tap-highlight"
                    >
                      <Icon icon="mdi:logout-variant" className="h-[18px] w-[18px] flex-shrink-0 text-[#C80A31]" aria-hidden />
                      {t("logout")}
                    </button>
                  </li>
                </>
              )}
              {!user && (
                <>
                  <li className="pt-2">
                    <Button
                      asChild
                      className="w-full rounded-full bg-primary hover:bg-opacity-90 hover-standard text-white"
                    >
                      <Link href={loginHref} onClick={closeMenu}>
                        {showPartnerLogin ? t("partnerLoginRegister") : t("loginRegister")}
                      </Link>
                    </Button>
                  </li>
                </>
              )}
            </ul>
          </div>
        </div>
      )}
    </header>
  );
}
