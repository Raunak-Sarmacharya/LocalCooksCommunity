import { Building, BookOpen, Calendar, CreditCard, FileText, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  SupportPageShell,
  type SupportFaqCategory,
  type SupportResource,
} from "@/components/support/SupportPageShell";

interface ChefSupportPageProps {
  userEmail?: string;
  userName?: string;
  userId?: string;
  onOpenResolutionCenter?: () => void;
  pendingResolutionCount?: number;
}

/**
 * Support, for chefs.
 *
 * Layout lives in `SupportPageShell`; this file is only the answers. The manager
 * page is its mirror image — same shell, questions about running a kitchen
 * rather than booking one.
 */
export default function ChefSupportPage({
  onOpenResolutionCenter,
  pendingResolutionCount = 0,
}: ChefSupportPageProps) {
  const { t } = useTranslation("chef");

  const faqItems: SupportFaqCategory[] = [
    {
      category: t("supportCategoryGettingStarted", "Getting started"),
      icon: Calendar,
      questions: [
        {
          q: t("supportFaqGettingStartedQ1", "How do I complete my chef application?"),
          a: t("supportFaqGettingStartedA1", "Open Applications and start a seller application. Add your details, kitchen preference, and food safety documents."),
        },
        {
          q: t("supportFaqGettingStartedQ2", "What documents do I need?"),
          a: t("supportFaqGettingStartedA2", "A valid Food Safety License is required. A Food Establishment Certificate is optional unless a kitchen asks for it."),
        },
        {
          q: t("supportFaqGettingStartedQ3", "How long does review take?"),
          a: t("supportFaqGettingStartedA3", "Most applications are reviewed within 24–48 hours. You\u2019ll get an email when the status changes."),
        },
      ],
    },
    {
      category: t("supportCategoryKitchenBookings", "Kitchen bookings"),
      icon: Building,
      questions: [
        {
          q: t("supportFaqKitchenBookingsQ1", "How do I book a commercial kitchen?"),
          a: t("supportFaqKitchenBookingsA1", "Browse Discover Kitchens, apply, and book time slots after you\u2019re approved."),
        },
        {
          q: t("supportFaqKitchenBookingsQ2", "Can I cancel or reschedule?"),
          a: t("supportFaqKitchenBookingsA2", "Manage bookings from My Bookings. Cancellation rules vary by kitchen."),
        },
        {
          q: t("supportFaqKitchenBookingsQ3", "What equipment is included?"),
          a: t("supportFaqKitchenBookingsA3", "Each listing shows equipment, storage, and rates before you apply or book."),
        },
      ],
    },
    {
      category: t("supportCategoryPayments", "Payments"),
      icon: CreditCard,
      questions: [
        {
          q: t("supportFaqPaymentsQ1", "How do I get paid?"),
          a: t("supportFaqPaymentsA1", "Connect Stripe after your seller application is approved. Payouts usually arrive in 2–3 business days."),
        },
        {
          q: t("supportFaqPaymentsQ2", "How are kitchen fees calculated?"),
          a: t("supportFaqPaymentsA2", "Hourly kitchen rates plus any storage or equipment. You\u2019ll see the total before you confirm."),
        },
      ],
    },
    {
      category: t("supportCategoryTraining", "Training"),
      icon: BookOpen,
      questions: [
        {
          q: t("supportFaqTrainingQ1", "Is food safety training mandatory?"),
          a: t("supportFaqTrainingA1", "No. Local Cooks videos are optional extra learning, not official certification. Kitchens may still require an official food handler certificate."),
        },
        {
          q: t("supportFaqTrainingQ2", "Where are the videos?"),
          a: t("supportFaqTrainingA2", "Open Training from Overview. Completing them issues a Local Cooks learning certificate only."),
        },
      ],
    },
  ];

  const resources: SupportResource[] = [
    { label: t("chefSetupLink", "Chef setup"), icon: Calendar, href: "/chef-setup" },
    { label: t("termsLink", "Terms"), icon: Shield, href: "/terms" },
    { label: t("privacyLink", "Privacy"), icon: FileText, href: "/privacy" },
  ];

  return (
    <SupportPageShell
      title={t("supportPageTitle", "Support")}
      description={t("supportPageDesc", "Answers, contact, and the resolution center.")}
      liveChatTitle={t("liveChat", "Live chat")}
      liveChatHours={t("liveChatHours", "Weekdays, 9:00 AM–5:00 PM NST.")}
      startChatLabel={t("startChatBtn", "Start chat")}
      emailTitle={t("emailTitle", "Email")}
      sendEmailLabel={t("sendEmailBtn", "Send email")}
      phoneTitle={t("phoneTitle", "Phone")}
      callLabel={t("callBtn", "Call")}
      supportHoursTitle={t("supportHoursTitle", "Support hours")}
      supportHoursDescription={t("supportHoursDesc", "Live chat is Monday–Friday, 9:00 AM–5:00 PM NST. Outside those hours, leave a message and we\u2019ll reply within 24 hours.")}
      faqTitle={t("faqTitle", "Frequently asked questions")}
      faqCategories={faqItems}
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
