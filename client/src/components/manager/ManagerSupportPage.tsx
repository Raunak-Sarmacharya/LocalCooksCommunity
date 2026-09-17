import { useTranslation } from "react-i18next";
import { Building, Calendar, ClipboardCheck, CreditCard, FileText, Shield, Users } from "lucide-react";

import { SupportPageShell, type SupportFaqCategory, type SupportResource } from "@/components/support/SupportPageShell";

interface ManagerSupportPageProps {
  /** Damage claims and overstay penalties, if the host tracks them. */
  onOpenResolutionCenter?: () => void;
  pendingResolutionCount?: number;
}

/**
 * Support, for kitchen managers.
 *
 * Same shell as the chef page, different answers. The chef FAQ is about applying
 * to cook somewhere and booking a kitchen; a manager's questions are the mirror
 * image — getting approved, setting rules, and running bookings — so the two
 * cannot share copy without answering neither.
 *
 * Copy uses inline defaults (`t(key, "…")`) to match `ChefSupportPage`. Move them
 * into the locale files if the support copy ever needs translating properly.
 */
export default function ManagerSupportPage({
  onOpenResolutionCenter,
  pendingResolutionCount = 0,
}: ManagerSupportPageProps) {
  const { t } = useTranslation("manager");

  const faqCategories: SupportFaqCategory[] = [
    {
      category: t("supportManagerCatSetup", "Getting set up"),
      icon: Calendar,
      questions: [
        {
          q: t("supportManagerSetupQ1", "How do I finish setting up my business?"),
          a: t("supportManagerSetupA1", "Work through the setup steps from your dashboard. You can leave and come back at any point — your progress is saved as you go."),
        },
        {
          q: t("supportManagerSetupQ2", "Why is my kitchen licence under review?"),
          a: t("supportManagerSetupA2", "Every licence is checked before a kitchen goes live. You'll get an email the moment it's approved, usually within 2 business days."),
        },
        {
          q: t("supportManagerSetupQ3", "When can chefs start booking?"),
          a: t("supportManagerSetupA3", "As soon as your licence is approved and your kitchen has availability set. You'll be notified by email."),
        },
      ],
    },
    {
      category: t("supportManagerCatKitchens", "Your kitchens"),
      icon: Building,
      questions: [
        {
          q: t("supportManagerKitchensQ1", "How do I add another kitchen?"),
          a: t("supportManagerKitchensA1", "Open My Kitchens from your dashboard. You can create as many kitchens as your location supports, each with its own rates and availability."),
        },
        {
          q: t("supportManagerKitchensQ2", "How do I set my cancellation and notice rules?"),
          a: t("supportManagerKitchensA2", "Booking Policies holds your cancellation windows, notice periods and other booking rules. Check-in and check-out timing lives in its own page."),
        },
        {
          q: t("supportManagerKitchensQ3", "What's the difference between availability and rates?"),
          a: t("supportManagerKitchensA3", "Availability decides when chefs can book you. Your hourly and daily rates, plus minimum booking hours, are set per kitchen."),
        },
      ],
    },
    {
      category: t("supportManagerCatApplications", "Chef applications"),
      icon: Users,
      questions: [
        {
          q: t("supportManagerApplicationsQ1", "What are application requirements?"),
          a: t("supportManagerApplicationsA1", "The documents and questions a chef must satisfy before they can book your kitchen. You control these per location."),
        },
        {
          q: t("supportManagerApplicationsQ2", "What's the difference between the two tiers?"),
          a: t("supportManagerApplicationsA2", "\"Request to apply\" is platform-wide and set by Local Cooks. \"Kitchen Documents\" are yours, and are collected from a chef after Local Cooks approves them."),
        },
      ],
    },
    {
      category: t("supportManagerCatBookings", "Bookings and check-in"),
      icon: ClipboardCheck,
      questions: [
        {
          q: t("supportManagerBookingsQ1", "How do I approve a booking?"),
          a: t("supportManagerBookingsA1", "Open Bookings, review the request, and approve or decline it. You'll be emailed about new requests."),
        },
        {
          q: t("supportManagerBookingsQ2", "How does check-in and check-out work?"),
          a: t("supportManagerBookingsA2", "Set your check-in window and no-show grace in Check-in & Check-out, then record arrivals from the booking itself."),
        },
        {
          q: t("supportManagerBookingsQ3", "What if something is damaged?"),
          a: t("supportManagerBookingsA3", "Raise a damage claim from the booking. Claims and overstay penalties are tracked together in the resolution center."),
        },
      ],
    },
    {
      category: t("supportManagerCatPayments", "Payments"),
      icon: CreditCard,
      questions: [
        {
          q: t("supportManagerPaymentsQ1", "How do I get paid?"),
          a: t("supportManagerPaymentsA1", "Connect Stripe in Payment Setup. Payouts usually arrive within 2–3 business days of a completed booking."),
        },
        {
          q: t("supportManagerPaymentsQ2", "How are my earnings calculated?"),
          a: t("supportManagerPaymentsA2", "Your hourly and daily rates, plus any storage or equipment the chef books. Revenue is broken down in the Revenue tab."),
        },
      ],
    },
  ];

  // Contact is already the first three cards above, so it is not repeated here.
  const resources: SupportResource[] = [
    { label: t("supportManagerResourceSetup", "Manager setup"), icon: Calendar, href: "/manager/setup" },
    { label: t("supportManagerResourceTerms", "Terms"), icon: Shield, href: "/terms" },
    { label: t("supportManagerResourcePrivacy", "Privacy"), icon: FileText, href: "/privacy" },
  ];

  return (
    <SupportPageShell
      title={t("supportPageTitle", "Support")}
      description={t("supportManagerPageDesc", "Answers, contact, and the resolution center.")}
      liveChatTitle={t("liveChat", "Live chat")}
      liveChatHours={t("liveChatHours", "Weekdays, 9:00 AM–5:00 PM NST.")}
      startChatLabel={t("startChatBtn", "Start chat")}
      emailTitle={t("emailTitle", "Email")}
      sendEmailLabel={t("sendEmailBtn", "Send email")}
      phoneTitle={t("phoneTitle", "Phone")}
      callLabel={t("callBtn", "Call")}
      supportHoursTitle={t("supportHoursTitle", "Support hours")}
      supportHoursDescription={t("supportHoursDesc", "Live chat is Monday–Friday, 9:00 AM–5:00 PM NST. Outside those hours, leave a message and we'll reply within 24 hours.")}
      faqTitle={t("faqTitle", "Frequently asked questions")}
      faqCategories={faqCategories}
      resourcesTitle={t("resourcesTitle", "Resources")}
      resources={resources}
      resolutionCenterTitle={t("resolutionCenterTitle", "Resolution center")}
      resolutionCenterDescription={t("resolutionCenterCardDesc", "Damage claims and overstay penalties.")}
      openLabel={t("openBtn", "Open")}
      onOpenResolutionCenter={onOpenResolutionCenter}
      pendingResolutionCount={pendingResolutionCount}
    />
  );
}
