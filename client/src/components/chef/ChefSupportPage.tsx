import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  MessageCircle,
  Mail,
  Phone,
  HelpCircle,
  BookOpen,
  FileText,
  ChefHat,
  Building,
  CreditCard,
  Shield,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTidioChat } from "@/components/chat/TidioController";
import { ChefPageHeader, QuietNotice } from "@/components/chef/ui";

interface ChefSupportPageProps {
  userEmail?: string;
  userName?: string;
  userId?: string;
  onOpenResolutionCenter?: () => void;
  pendingResolutionCount?: number;
}

export default function ChefSupportPage({
  onOpenResolutionCenter,
  pendingResolutionCount = 0,
}: ChefSupportPageProps) {
  const { t } = useTranslation("chef");
  const { openChat } = useTidioChat();

  const faqItems = [
    {
      category: t("supportCategoryGettingStarted", "Getting started"),
      icon: ChefHat,
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

  return (
    <div className="space-y-8">
      <ChefPageHeader
        title={t("supportPageTitle", "Support")}
        description={t("supportPageDesc", "Answers, contact, and the resolution center.")}
      />

      <div
        className={`grid grid-cols-1 gap-4 ${
          onOpenResolutionCenter ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"
        }`}
      >
        <Card className="flex h-full flex-col shadow-none">
          <CardHeader>
            <CardTitle className="text-base">{t("liveChat", "Live chat")}</CardTitle>
            <CardDescription>{t("liveChatHours", "Weekdays, 9:00 AM–5:00 PM NST.")}</CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto">
            <Button className="w-full" onClick={openChat}>
              <MessageCircle />
              {t("startChatBtn", "Start chat")}
            </Button>
          </CardFooter>
        </Card>

        <Card className="flex h-full flex-col shadow-none">
          <CardHeader>
            <CardTitle className="text-base">{t("emailTitle", "Email")}</CardTitle>
            <CardDescription>support@localcook.shop</CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto">
            <Button variant="outline" className="w-full" asChild>
              <a href="mailto:support@localcook.shop">
                {t("sendEmailBtn", "Send email")}
                <ExternalLink />
              </a>
            </Button>
          </CardFooter>
        </Card>

        <Card className="flex h-full flex-col shadow-none">
          <CardHeader>
            <CardTitle className="text-base">{t("phoneTitle", "Phone")}</CardTitle>
            <CardDescription>(709) 689-2942</CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto">
            <Button variant="outline" className="w-full" asChild>
              <a href="tel:+17096892942">
                <Phone />
                {t("callBtn", "Call")}
              </a>
            </Button>
          </CardFooter>
        </Card>

        {onOpenResolutionCenter && (
          <Card className="flex h-full flex-col shadow-none">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{t("resolutionCenterTitle", "Resolution center")}</CardTitle>
                  <CardDescription>{t("resolutionCenterCardDesc", "Damage claims and overstay penalties.")}</CardDescription>
                </div>
                {pendingResolutionCount > 0 && (
                  <Badge variant="destructive">{pendingResolutionCount}</Badge>
                )}
              </div>
            </CardHeader>
            <CardFooter className="mt-auto">
              <Button variant="outline" className="w-full" onClick={onOpenResolutionCenter}>
                <AlertTriangle />
                {t("openBtn", "Open")}
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>

      <QuietNotice title={t("supportHoursTitle", "Support hours")}>
        {t("supportHoursDesc", "Live chat is Monday–Friday, 9:00 AM–5:00 PM NST. Outside those hours, leave a message and we’ll reply within 24 hours.")}
      </QuietNotice>

      <div>
        <div className="mb-4 flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-base font-semibold">{t("faqTitle", "Frequently asked questions")}</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {faqItems.map((category) => (
            <Card key={category.category} className="shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{category.category}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Accordion type="single" collapsible className="w-full">
                  {category.questions.map((item, itemIndex) => (
                    <AccordionItem key={itemIndex} value={`item-${itemIndex}`}>
                      <AccordionTrigger className="text-left text-sm font-medium hover:no-underline">
                        {item.q}
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground">
                        {item.a}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t("resourcesTitle", "Resources")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Button variant="outline" asChild className="h-auto justify-start py-3">
            <a href="/chef-setup">
              <ChefHat />
              {t("chefSetupLink", "Chef setup")}
            </a>
          </Button>
          <Button variant="outline" asChild className="h-auto justify-start py-3">
            <a href="/terms">
              <Shield />
              {t("termsLink", "Terms")}
            </a>
          </Button>
          <Button variant="outline" asChild className="h-auto justify-start py-3">
            <a href="/privacy">
              <FileText />
              {t("privacyLink", "Privacy")}
            </a>
          </Button>
          <Button variant="outline" className="h-auto justify-start py-3" onClick={openChat}>
            <Mail />
            {t("contactLink", "Contact")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
