import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { MessageCircle, Mail, Phone, HelpCircle, Shield, FileText, ExternalLink, AlertTriangle, Calendar } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTidioChat } from "@/components/chat/TidioController";
import { ChefPageHeader, QuietNotice } from "@/components/chef/ui";

/**
 * The support page's layout, with no content of its own.
 *
 * The chef and manager support pages are the same surface — contact cards, a
 * FAQ accordion, resources — differing only in the answers. Keeping one shell
 * means a change to the contact block or the FAQ markup lands on both, instead
 * of one side quietly drifting from the other.
 *
 * Content is passed in already translated, so this file needs no namespace.
 */

export interface SupportFaqItem {
  q: string;
  a: string;
}

export interface SupportFaqCategory {
  category: string;
  icon: LucideIcon;
  questions: SupportFaqItem[];
}

export interface SupportResource {
  label: string;
  icon: LucideIcon;
  /** External or in-app link. Omit when `onClick` is used instead. */
  href?: string;
  onClick?: () => void;
}

export interface SupportPageShellProps {
  title: string;
  description: string;
  /** Contact-card headings, so the two audiences can word them differently. */
  liveChatTitle: string;
  liveChatHours: string;
  startChatLabel: string;
  emailTitle: string;
  sendEmailLabel: string;
  phoneTitle: string;
  callLabel: string;
  supportHoursTitle: string;
  supportHoursDescription: string;
  faqTitle: string;
  faqCategories: SupportFaqCategory[];
  resourcesTitle: string;
  resources: SupportResource[];
  /** Only shown when `onOpenResolutionCenter` is supplied. */
  resolutionCenterTitle: string;
  resolutionCenterDescription: string;
  openLabel: string;
  onOpenResolutionCenter?: () => void;
  pendingResolutionCount?: number;
}

export function SupportPageShell({
  title,
  description,
  liveChatTitle,
  liveChatHours,
  startChatLabel,
  emailTitle,
  sendEmailLabel,
  phoneTitle,
  callLabel,
  supportHoursTitle,
  supportHoursDescription,
  faqTitle,
  faqCategories,
  resourcesTitle,
  resources,
  resolutionCenterTitle,
  resolutionCenterDescription,
  openLabel,
  onOpenResolutionCenter,
  pendingResolutionCount = 0,
}: SupportPageShellProps) {
  const { openChat } = useTidioChat();

  return (
    <div className="space-y-8">
      <ChefPageHeader title={title} description={description} />

      <div
        className={`grid grid-cols-1 gap-4 ${
          onOpenResolutionCenter ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"
        }`}
      >
        <Card className="flex h-full flex-col shadow-none">
          <CardHeader>
            <CardTitle className="text-base">{liveChatTitle}</CardTitle>
            <CardDescription>{liveChatHours}</CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto">
            <Button className="w-full" onClick={openChat}>
              <MessageCircle />
              {startChatLabel}
            </Button>
          </CardFooter>
        </Card>

        <Card className="flex h-full flex-col shadow-none">
          <CardHeader>
            <CardTitle className="text-base">{emailTitle}</CardTitle>
            <CardDescription>support@localcook.shop</CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto">
            <Button variant="outline" className="w-full" asChild>
              <a href="mailto:support@localcook.shop">
                {sendEmailLabel}
                <ExternalLink />
              </a>
            </Button>
          </CardFooter>
        </Card>

        <Card className="flex h-full flex-col shadow-none">
          <CardHeader>
            <CardTitle className="text-base">{phoneTitle}</CardTitle>
            <CardDescription>(709) 689-2942</CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto">
            <Button variant="outline" className="w-full" asChild>
              <a href="tel:+17096892942">
                <Phone />
                {callLabel}
              </a>
            </Button>
          </CardFooter>
        </Card>

        {onOpenResolutionCenter && (
          <Card className="flex h-full flex-col shadow-none">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{resolutionCenterTitle}</CardTitle>
                  <CardDescription>{resolutionCenterDescription}</CardDescription>
                </div>
                {pendingResolutionCount > 0 && (
                  <Badge variant="destructive">{pendingResolutionCount}</Badge>
                )}
              </div>
            </CardHeader>
            <CardFooter className="mt-auto">
              <Button variant="outline" className="w-full" onClick={onOpenResolutionCenter}>
                <AlertTriangle />
                {openLabel}
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>

      <QuietNotice title={supportHoursTitle}>{supportHoursDescription}</QuietNotice>

      <div>
        <div className="mb-4 flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-base font-semibold">{faqTitle}</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {faqCategories.map((category) => {
            const Icon = category.icon;
            return (
              <Card key={category.category} className="shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    {category.category}
                  </CardTitle>
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
            );
          })}
        </div>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{resourcesTitle}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {resources.map((resource) => {
            const Icon = resource.icon;
            return resource.href ? (
              <Button key={resource.label} variant="outline" asChild className="h-auto justify-start py-3">
                <a href={resource.href}>
                  <Icon />
                  {resource.label}
                </a>
              </Button>
            ) : (
              <Button
                key={resource.label}
                variant="outline"
                className="h-auto justify-start py-3"
                onClick={resource.onClick}
              >
                <Icon />
                {resource.label}
              </Button>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

export default SupportPageShell;
