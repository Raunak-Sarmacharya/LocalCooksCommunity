import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import SEOHead from "@/components/SEO/SEOHead";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ExternalLink, Shield, FileText, Scale, ClipboardCheck, BadgeCheck, Flame, CheckCircle2, AlertTriangle, Info, ChevronRight, Menu, DollarSign, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════
// SECTION DATA
// ═══════════════════════════════════════════════════════════════

interface Section {
  id: string;
  title: string;
  icon: React.ElementType;
  subsections?: {
    id: string;
    title: string;
  }[];
}
const SECTIONS: Section[] = [{
  id: "legal-foundation",
  title: "Ваша правова основа",
  icon: Scale,
  subsections: [{
    id: "food-establishment-licence",
    title: "Ліцензія на харчове приміщення"
  }, {
    id: "inspection-system",
    title: "Система перевірок"
  }, {
    id: "workplace-nl",
    title: "WorkplaceNL"
  }, {
    id: "fire-safety",
    title: "Пожежна безпека"
  }, {
    id: "federal-considerations",
    title: "Федеральні аспекти"
  }]
}, {
  id: "insurance",
  title: "Страхування",
  icon: Shield,
  subsections: [{
    id: "your-insurance-portfolio",
    title: "Ваш портфель"
  }, {
    id: "renter-insurance",
    title: "Вимоги до страхування орендаря"
  }, {
    id: "verifying-coi",
    title: "Перевірка страхових сертифікатів"
  }]
}, {
  id: "risk-assessment",
  title: "Оцінка ризиків",
  icon: AlertCircle,
  subsections: [{
    id: "haccp-assessment",
    title: "Оцінка на основі HACCP"
  }, {
    id: "pre-rental-screening",
    title: "Попередня перевірка перед орендою"
  }]
}, {
  id: "onboarding-chefs",
  title: "Адаптація шеф-кухарів",
  icon: ClipboardCheck,
  subsections: [{
    id: "application-review",
    title: "Розгляд заявок"
  }, {
    id: "info-exchange",
    title: "Обмін інформацією"
  }, {
    id: "document-verification",
    title: "Перевірка документів"
  }, {
    id: "orientation",
    title: "Орієнтація на місці"
  }]
}, {
  id: "operational-excellence",
  title: "Операційна досконалість",
  icon: BadgeCheck,
  subsections: [{
    id: "facility-standards",
    title: "Стандарти приміщення"
  }, {
    id: "allergen-management",
    title: "Управління алергенами"
  }, {
    id: "cleaning-sanitation",
    title: "Прибирання та санітарія"
  }, {
    id: "preventive-maintenance",
    title: "Профілактичне обслуговування"
  }]
}, {
  id: "revenue-pricing",
  title: "Доходи та ціноутворення",
  icon: DollarSign,
  subsections: [{
    id: "pricing-models",
    title: "Моделі ціноутворення"
  }, {
    id: "revenue-streams",
    title: "Джерела доходу"
  }, {
    id: "setting-rates",
    title: "Встановлення тарифів"
  }]
}, {
  id: "record-keeping",
  title: "Ведення обліку",
  icon: FileText,
  subsections: [{
    id: "what-to-keep",
    title: "Що потрібно зберігати"
  }, {
    id: "inspection-ready",
    title: "Готовність до перевірок"
  }]
}, {
  id: "emergency-protocols",
  title: "Протоколи в надзвичайних ситуаціях",
  icon: Flame,
  subsections: []
}, {
  id: "legal-considerations",
  title: "Правові аспекти",
  icon: Scale,
  subsections: [{
    id: "rental-agreement",
    title: "Основи договору оренди"
  }, {
    id: "escalation-framework",
    title: "Система ескалації"
  }]
}, {
  id: "compliance-checklist",
  title: "Головний контрольний список відповідності",
  icon: ClipboardCheck,
  subsections: []
}, {
  id: "km-resources-links",
  title: "Ресурси та посилання",
  icon: ExternalLink,
  subsections: []
}];

// ═══════════════════════════════════════════════════════════════
// REUSABLE UI COMPONENTS (same pattern as ChefResourcesPage)
// ═══════════════════════════════════════════════════════════════

function InfoCard({
  children,
  variant = "info"
}: {
  children: React.ReactNode;
  variant?: "info" | "warning" | "tip";
}) {
  const styles = {
    info: "bg-blue-50 border-blue-200 text-blue-900 [&>svg]:text-blue-500",
    warning: "bg-amber-50 border-amber-200 text-amber-900 [&>svg]:text-amber-500",
    tip: "bg-emerald-50 border-emerald-200 text-emerald-900 [&>svg]:text-emerald-500"
  };
  const icons = {
    info: Info,
    warning: AlertTriangle,
    tip: CheckCircle2
  };
  const Icon = icons[variant];
  return <Alert className={cn("my-6", styles[variant])}>
      <Icon className="h-5 w-5" />
      <AlertDescription className="text-sm leading-relaxed">
        {children}
      </AlertDescription>
    </Alert>;
}
function ResourceTable({
  headers,
  rows
}: {
  headers: string[];
  rows: string[][];
}) {
  const makeLink = (text: string) => {
    const urlWithPath = text.match(/^(https?:\/\/|www\.)[^\s]+/i);
    if (urlWithPath) {
      const fullUrl = urlWithPath[0].startsWith('http') ? urlWithPath[0] : `https://${urlWithPath[0]}`;
      return <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
          {text}
          <ExternalLink className="h-3 w-3" />
        </a>;
    }
    const domainOnly = text.match(/^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z]{2,})+$/i);
    if (domainOnly) {
      return <a href={`https://${text}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
          {text}
          <ExternalLink className="h-3 w-3" />
        </a>;
    }
    return text;
  };
  return <Card className="my-6 overflow-hidden border not-prose">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/60 border-b">
              {headers.map((h, i) => <th key={i} className="text-left px-4 py-3 font-semibold text-foreground text-xs uppercase tracking-wider whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, ri) => <tr key={ri} className="hover:bg-muted/30 transition-colors">
                {row.map((cell, ci) => <td key={ci} className={cn("px-4 py-3 text-muted-foreground", ci === 0 && "font-medium text-foreground whitespace-nowrap")}>{makeLink(cell)}</td>)}
              </tr>)}
          </tbody>
        </table>
      </div>
    </Card>;
}
function ExtLink({
  href,
  children
}: {
  href: string;
  children: React.ReactNode;
}) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>;
}
function SectionHeading({
  id,
  children
}: {
  id: string;
  children: React.ReactNode;
}) {
  return <div className="mt-16 mb-6">
      <h2 id={id} className="text-2xl font-bold scroll-mt-24 flex items-center gap-3 pb-3">
        {children}
      </h2>
      <Separator />
    </div>;
}
function SubHeading({
  id,
  children
}: {
  id: string;
  children: React.ReactNode;
}) {
  return <h3 id={id} className="text-lg font-semibold mt-10 mb-4 scroll-mt-24">
      {children}
    </h3>;
}
function InteractiveChecklist({
  storageKey,
  phases
}: {
  storageKey: string;
  phases: {
    title: string;
    items: string[];
  }[];
}) {
  const {
    t
  } = useTranslation("kitchen");
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const toggle = useCallback((key: string) => {
    setChecked(prev => {
      const next = {
        ...prev,
        [key]: !prev[key]
      };
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }, [storageKey]);
  const resetAll = useCallback(() => {
    setChecked({});
    localStorage.removeItem(storageKey);
  }, [storageKey]);
  const totalItems = phases.reduce((sum, p) => sum + p.items.length, 0);
  const totalChecked = Object.values(checked).filter(Boolean).length;
  const overallPercent = totalItems > 0 ? Math.round(totalChecked / totalItems * 100) : 0;
  return <div className="space-y-6 my-6">
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">{t("overallProgress", "Overall Progress")}</span>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-primary">{totalChecked}/{totalItems} {t("completeWord", "complete")}</span>
              {totalChecked > 0 && <button onClick={resetAll} className="text-xs text-muted-foreground hover:text-destructive transition-colors underline">
                  Скинути
                </button>}
            </div>
          </div>
          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-500 ease-out", overallPercent === 100 ? "bg-emerald-500" : "bg-primary")} style={{
            width: `${overallPercent}%`
          }} />
          </div>
          {overallPercent === 100 && <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Готово — ви повністю відповідаєте!
            </p>}
        </CardContent>
      </Card>
      {phases.map((phase, pi) => {
      const phaseChecked = phase.items.filter((_, ii) => checked[`${pi}-${ii}`]).length;
      const phasePercent = phase.items.length > 0 ? Math.round(phaseChecked / phase.items.length * 100) : 0;
      return <Card key={pi}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{phase.title}</CardTitle>
                <span className={cn("text-xs font-medium", phasePercent === 100 ? "text-emerald-600" : "text-muted-foreground")}>
                  {phaseChecked}/{phase.items.length}
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                <div className={cn("h-full rounded-full transition-all duration-500 ease-out", phasePercent === 100 ? "bg-emerald-500" : "bg-primary/60")} style={{
              width: `${phasePercent}%`
            }} />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-1">
                {phase.items.map((item, ii) => {
              const key = `${pi}-${ii}`;
              const isChecked = !!checked[key];
              return <li key={ii} onClick={() => toggle(key)} className={cn("flex items-start gap-2.5 text-sm p-2 rounded-md cursor-pointer transition-colors select-none", isChecked ? "text-muted-foreground/60 line-through" : "text-foreground hover:bg-muted/50")}>
                      <Checkbox checked={isChecked} className="mt-0.5 pointer-events-none" tabIndex={-1} />
                      <span>{item}</span>
                    </li>;
            })}
              </ul>
            </CardContent>
          </Card>;
    })}
    </div>;
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR NAVIGATION — Clean docs-style, collapsible sections
// ═══════════════════════════════════════════════════════════════

function SidebarNav({
  onNavigate,
  onItemClick
}: {
  onNavigate: (id: string) => void;
  onItemClick?: () => void;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);else next.add(id);
      return next;
    });
  };
  const navigateAndClose = (id: string) => {
    onNavigate(id);
    onItemClick?.();
  };
  return <nav className="space-y-1">
      {SECTIONS.map(section => {
      const hasSubs = section.subsections && section.subsections.length > 0;
      const isExpanded = expandedSections.has(section.id);
      return <div key={section.id}>
            {hasSubs ? <button onClick={() => toggleSection(section.id)} className="group w-full text-left flex items-center justify-between px-2.5 py-2 rounded-md text-[13px] font-semibold text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors">
                <span className="truncate">{section.title}</span>
                <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform duration-200", isExpanded && "rotate-90")} />
              </button> : <button onClick={() => navigateAndClose(section.id)} className="group w-full text-left flex items-center px-2.5 py-2 rounded-md text-[13px] font-medium text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors">
                <span className="truncate">{section.title}</span>
              </button>}
            {isExpanded && hasSubs && <div className="ml-3 border-l-2 border-border/60 pl-3 py-1 space-y-0.5">
                {section.subsections!.map(sub => <button key={sub.id} onClick={() => navigateAndClose(sub.id)} className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                    {sub.title}
                  </button>)}
              </div>}
          </div>;
    })}
    </nav>;
}

// ═══════════════════════════════════════════════════════════════
// MOBILE NAV — Sheet drawer from left
// ═══════════════════════════════════════════════════════════════

function MobileNav({
  onNavigate
}: {
  onNavigate: (id: string) => void;
}) {
  const {
    t
  } = useTranslation("kitchen");
  const [open, setOpen] = useState(false);
  return <div className="lg:hidden sticky top-16 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
      <div className="container mx-auto max-w-7xl px-4">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 -ml-2 h-10 text-[13px] font-medium text-muted-foreground hover:text-foreground">
              <Menu className="h-4 w-4" />
              Навігація
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="px-4 pt-4 pb-3 border-b">
              <SheetTitle className="text-sm font-semibold">{t("onThisPage", "On this page")}</SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-60px)]">
              <div className="p-3">
                <SidebarNav onNavigate={onNavigate} onItemClick={() => setOpen(false)} />
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>
    </div>;
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function KitchenResourcesPage_en_uk() {
  const {
    t
  } = useTranslation("kitchen");
  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({
          behavior: "smooth",
          block: "start",
          inline: "nearest"
        });
      });
    }
  }, []);
  return <div className="min-h-screen flex flex-col bg-background">
      <SEOHead title={t("seoKitchenResourcesTitle", "Kitchen Manager Resources — Operating a Shared Commercial Kitchen in Canada")} description={t("seoKitchenResourcesDesc", "Complete guide to licensing, insurance, risk assessment, operations, and pricing for shared commercial kitchens in Newfoundland & Labrador and across Canada.")} canonicalUrl="/resources" keywords={["commercial kitchen management", "shared kitchen operations", "kitchen rental business", "food establishment licence NL", "commercial kitchen insurance", "kitchen manager guide", "HACCP shared kitchen", "commercial kitchen pricing", "kitchen rental agreement"]} faq={[{
      question: "What licence do I need to operate a shared commercial kitchen in Newfoundland?",
      answer: "You need a Food Establishment Licence from the Department of Health and Community Services. For shared kitchen operations, you'll also need a HACCP-based food safety plan and must meet specific requirements for kitchen design, equipment, and sanitation."
    }, {
      question: "How much liability insurance do I need for my shared kitchen?",
      answer: "LocalCooks requires minimum $2 million liability coverage. It's recommended to have commercial general liability (CGL) insurance that covers food service operations, equipment damage, and tenant injuries."
    }, {
      question: "What should I include in a kitchen rental agreement?",
      answer: "A comprehensive agreement should cover: hourly/daily rates, security deposits, equipment usage rules, cleaning responsibilities, insurance requirements, cancellation policies, and liability provisions. LocalCooks provides standard agreement templates."
    }, {
      question: "How do I set pricing for my commercial kitchen?",
      answer: "Consider your costs (rent, utilities, equipment depreciation), market rates in your area, and target occupancy. Most shared kitchens charge $25-75/hour depending on amenities, location, and included equipment. LocalCooks provides pricing analytics to help optimize rates."
    }, {
      question: "What are the key operational requirements for a shared kitchen?",
      answer: "Key requirements include: proper food safety certifications, HACCP plan implementation, regular equipment maintenance, cleaning schedules, waste management, pest control, and proper record-keeping for all chef bookings and food preparation activities."
    }]} siteNavigation={[{
      name: "List Your Kitchen",
      description: "Monetize your commercial kitchen space — list in minutes",
      url: "https://kitchen.localcooks.ca/manager/setup"
    }, {
      name: "Kitchen Manager Resources",
      description: "Complete guide to operating a shared commercial kitchen in Canada",
      url: "https://kitchen.localcooks.ca/resources"
    }, {
      name: "Terms",
      description: "Terms of service for kitchen managers",
      url: "https://kitchen.localcooks.ca/terms"
    }, {
      name: "Privacy",
      description: "Privacy policy",
      url: "https://kitchen.localcooks.ca/privacy"
    }]} />
      <Header />

      {/* Mobile navigation — Sheet drawer */}
      <MobileNav onNavigate={scrollToSection} />

      {/* Main layout — left sidebar + content */}
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 pt-24 sm:pt-28">
        <div className="flex gap-0 lg:gap-10">
          {/* Desktop Sidebar — sticky left nav */}
          <aside className="hidden lg:block w-56 xl:w-60 flex-shrink-0">
            <div className="sticky top-24">
              <ScrollArea className="h-[calc(100vh-7rem)] pr-3">
                <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3 px-2">{t("onThisPage", "On this page")}</p>
                <SidebarNav onNavigate={scrollToSection} />
              </ScrollArea>
            </div>
          </aside>

          {/* Content area */}
          <main className="flex-1 min-w-0 max-w-3xl py-8 lg:py-12 lg:border-l lg:pl-10">
            {/* Compact hero — integrated into content flow */}
            <div className="mb-10">
              <Badge variant="secondary" className="mb-4 bg-[#F51042] text-white hover:bg-[#F51042]/90 text-xs font-semibold tracking-wide px-3 py-1">
                <ClipboardCheck className="h-3 w-3 mr-1.5" />
                Керівник кухні
              </Badge>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3 leading-tight">
                The {t("completeGuideOperating", "Complete Guide to Operating a")}{" "}
                <span className="text-[#F51042]">{t("sharedKitchenWord", "Shared Commercial Kitchen")}</span>
              </h1>
              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl mb-4">
                Наразі обслуговує Ньюфаундленд і Лабрадор — створено для масштабування по всій Канаді.Ліцензування, страхування, оцінка ризиків, операції та ціноутворення для стюардів.
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {[{
                icon: CheckCircle2,
                text: t("updatedFeb2026", "Updated February 2026")
              }, {
                icon: ClipboardCheck,
                text: "15-minute read"
              }].map((item, i) => <span key={i} className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <item.icon className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                    {item.text}
                  </span>)}
              </div>
              <Separator className="mt-8" />
            </div>

            <div className="prose-sm sm:prose prose-gray max-w-none prose-table:my-0 prose-thead:border-0 prose-tr:border-0 prose-th:p-0 prose-td:p-0">

              {/* ── Legal Foundation ── */}
              <SectionHeading id="legal-foundation">Ваша правова база</SectionHeading>

              <SubHeading id="food-establishment-licence">Ліцензія закладу харчування (Нідерландська служба)</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Кожна комерційна кухня, яка виробляє, готує, зберігає або продає їжу в Ньюфаундленді та Лабрадорі, повинна мати дійсний <strong>Ліцензія на заклад харчування</strong> виданий Службою НЛ під ст <em>Акт про харчові приміщення</em>.
              </p>
              <ol className="list-decimal pl-5 text-gray-600 space-y-2 mt-3">
                <li>Заповніть заявку на ліцензію від <ExtLink href="https://www.gov.nl.ca/gs/licences/env-health/food/">gov.nl.ca</ExtLink></li>
                <li>Подайте детальний план поверху із зазначенням усього обладнання, санітарних приміщень, сховищ, вентиляції та точок входу/виходу</li>
                <li>Отримайте схвалення муніципального зонування — у Сент-Джонсі зверніться до відділу планування та розвитку</li>
                <li>Надайте підтвердження проходження навчання з безпеки харчових продуктів — принаймні один сертифікований обробник повинен бути присутнім протягом кожної години роботи (<em>Правила приміщень харчування</em>, Розділ 6.1)</li>
              </ol>

              <SubHeading id="inspection-system">Система перевірки NL</SubHeading>
              <ResourceTable headers={["Рівень ризику", "Частота", "Типова діяльність"]} rows={[["Високий ризик", "4 рази на рік", "Сире м'ясо/морепродукти, великий обсяг кейтерингу, багатокористувацькі кухні"], ["Середній ризик", "2 рази на рік", "Пекарні, помірна підготовка їжі, обмежене меню"], ["Низький ризик", "Один раз на 2 роки", "Попередньо упакована їжа, тільки сухі продукти з низьким ризиком"]]} />
              <p className="text-gray-600">
                Випуск інспекторів <strong>критичні елементи</strong> (треба негайно виправити) і <strong>некритичні елементи</strong> (термін відповідності вказаний).Усі звіти є відкритими протягом двох років.
              </p>
              <InfoCard variant="tip">
                <strong>Професійна порада для спільних кухонь:</strong> У багатьох канадських юрисдикціях може знадобитися інспекція громадського здоров’я <em>кожного окремого орендаря</em> — власна перевірка кухні не охоплює автоматично всі підприємства, які в ній працюють.
              </InfoCard>

              <SubHeading id="workplace-nl">WorkplaceNL Реєстрація</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Якщо ваша кухня <strong>включені</strong>, ви повинні зареєструватися в WorkplaceNL незалежно від кількості співробітників.Підприємці-підприємці повинні реєструватися в момент найму будь-якого працівника.
              </p>
              <ResourceTable headers={["Код NIC", "Галузь", "Ставка 2025"]} rows={[["9210", "Послуги харчування", "$1,28 за кожні $100 заробітної плати"], ["9211", "Ресторани, ліцензовані", "$1,28 за кожні $100 заробітної плати"], ["9221", "Кейтеринг", "$1,28 за кожні $100 заробітної плати"]]} />
              <InfoCard variant="info">
                Якщо ваші орендарі є незалежними підприємствами (а не вашими працівниками), вони самі відповідають за покриття WorkplaceNL.Однак підтвердьте це в WorkplaceNL, якщо відносини можна тлумачити як роботодавець-працівник.
              </InfoCard>

              <SubHeading id="fire-safety">Системи пожежної безпеки та гасіння</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-3">
                <li>Будь-яка кухня, на якій використовується обладнання для виробництва жиру, повинна мати <strong>автоматична система пожежогасіння</strong> (NFPA 96)</li>
                <li><strong>Відповідає UL-300</strong> Системи вологої хімії є канадським стандартом</li>
                <li>Піврічна перевірка сертифікованим постачальником є обов'язковою</li>
                <li><strong>Переносні вогнегасники класу «К».</strong> має бути присутнім</li>
              </ul>

              <SubHeading id="federal-considerations">Федеральні міркування</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Якщо будь-який орендар торгує між провінціями або якщо ваш заклад виконує обробку від його імені, ви можете потрапити під <strong>Правила безпечної їжі для канадців (SFCR)</strong>.CFIA визнає об’єкти спільного користування критичними вузлами ланцюга поставок.
              </p>

              {/* ── Insurance ── */}
              <SectionHeading id="insurance">страхування</SectionHeading>

              <SubHeading id="your-insurance-portfolio">Ваш страховий портфель</SubHeading>
              <ResourceTable headers={["Покриття", "Деталі"]} rows={[["Загальна комерційна відповідальність", "$5 000 000+ сукупно рекомендується для багатокористувацьких об'єктів"], ["Страхування майна", "Будівля, обладнання, інвентар — за відновною вартістю з перериванням бізнесу"], ["Поломка обладнання", "Захищає від механічних/електричних несправностей критичних активів"], ["Додаткова відповідальність (Umbrella)", "Додає $2–5 млн понад CGL для катастрофічних претензій"], ["Кібер-відповідальність", "Покриває витоки даних при обробці цифрових бронювань/даних платежів"]]} />

              <SubHeading id="renter-insurance">Вимоги до страхування орендаря</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Кожен орендар повинен мати свій власний CGL і назвати свою кухню <strong>Додатковий страхувальник</strong>.Це єдиний найважливіший механізм передачі ризику.
              </p>
              <ResourceTable headers={["Тип покриття", "Мінімум", "Чому"]} rows={[["Загальна комерційна відповідальність", "$2 000 000 сукупно", "Галузевий стандарт для харчового бізнесу в Канаді"], ["Відповідальність за продукцію", "$2 000 000 сукупно", "Покриває харчові отруєння, незадекларовані алергени"], ["Пошкодження орендованих приміщень", "$300 000", "Покриває випадкове пошкодження вогнем або водою"], ["Додатково застрахований", "Зазначено вашу кухню", "Поширює покриття орендаря на вас"]]} />

              <SubHeading id="verifying-coi">Перевірка страхових свідоцтв</SubHeading>
              <ol className="list-decimal pl-5 text-gray-600 space-y-1 mt-3">
                <li>Точна юридична назва та адреса вашої кухні мають бути вказані як власник сертифіката</li>
                <li>Дати набрання чинності та терміну дії мають охоплювати повний період оренди</li>
                <li>Обмеження покриття мають відповідати вашим мінімумам або перевищувати їх</li>
                <li>Відповідальність за продукт і пошкодження орендованих приміщень обидва перераховані</li>
                <li>Страховик повинен мати ліцензію та бути законним</li>
              </ol>
              <InfoCard variant="warning">
                <strong>Найкраща практика:</strong> Встановіть календарні нагадування за 60 і 30 днів до закінчення терміну дії кожної політики.Негайно призупиніть доступ до бронювання, якщо не буде поновлено.Без винятків.
              </InfoCard>

              {/* ── Risk Assessment ── */}
              <SectionHeading id="risk-assessment">Оцінка ризиків</SectionHeading>

              <SubHeading id="haccp-assessment">Оцінка ризиків на основі HACCP</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Оцініть кожного заявника за чотирма категоріями небезпеки:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
                {[{
                title: "Biological Risks",
                desc: "Raw meat, poultry, seafood, dairy. Cross-contamination potential with existing renters.",
                critical: false
              }, {
                title: "Chemical Risks",
                desc: "Processing chemicals must be locked, labelled, separated from food areas.",
                critical: false
              }, {
                title: "Physical Risks",
                desc: "Glass packaging, sharp equipment, hazards for other users.",
                critical: false
              }, {
                title: "Allergen Risks (Critical)",
                desc: "Highest-stakes risk. No renter should make \u201Callergen-free\u201D claims in a shared kitchen.",
                critical: true
              }].map(risk => <Card key={risk.title} className={risk.critical ? "border-red-200 bg-red-50/50" : ""}>
                    <CardHeader className="pb-2">
                      <CardTitle className={cn("text-base", risk.critical ? "text-red-800" : "")}>
                        {risk.critical && <Badge variant="destructive" className="mr-2 text-[10px]">Критичний</Badge>}
                        {risk.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className={cn("text-sm", risk.critical ? "text-red-700" : "text-muted-foreground")}>{risk.desc}</p>
                    </CardContent>
                  </Card>)}
              </div>
              <p className="text-gray-600 text-sm">
                <strong>Пріоритетні алергени в Канаді (Health Canada):</strong> Арахіс, горіхи, молоко, яйця, пшениця/тритикале, соя, кунжут, гірчиця, ракоподібні, молюски, риба та сульфіти.
              </p>

              <SubHeading id="pre-rental-screening">Перелік перевірок перед орендою</SubHeading>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
                <Card className="border-red-200 bg-red-50/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-red-800 flex items-center gap-2">
                      <Badge variant="destructive" className="text-[10px]">Обов'язковий</Badge>
                      Рівень 1: не підлягає обговоренню
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Дійсний сертифікат спеціаліста з харчових продуктів</li>
                      <li>Сертифікат страхування (2 мільйони доларів CGL, додатковий страхувальник)</li>
                      <li>Підписаний договір оренди</li>
                      <li>Завершена оцінка ризиків</li>
                    </ul>
                  </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-amber-800">Рівень 2: До операцій</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Реєстрація підприємства або ліцензія</li>
                      <li>Ліцензія підприємства харчування (або підтвердження заявки)</li>
                      <li>Контактна інформація для екстрених випадків</li>
                      <li>Повні декларації інгредієнтів/алергенів</li>
                      <li>Підтвердження проходження орієнтування</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>

              {/* ── Onboarding ── */}
              <SectionHeading id="onboarding-chefs">Навчальні шеф-кухарі</SectionHeading>

              <SubHeading id="application-review">Крок 1: Розгляд заявки (дні 1–3)</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li>Огляд профілю: тип їжі, обсяг виробництва, потреби в графіку, рівень досвіду</li>
                <li>Переконайтеся, що Сертифікат обробника харчових продуктів завантажено та актуальний</li>
                <li>Швидка перевірка на сумісність: алергени, потреби в обладнанні, конфлікти зберігання</li>
                <li><strong>Відповідайте оперативно</strong> — швидкий час відгуку приваблює якісних орендарів</li>
              </ul>

              <SubHeading id="info-exchange">Крок 2: Обмін інформацією (3–10 дні)</SubHeading>
              <p className="text-gray-600 mb-3">Використовуйте систему обміну повідомленнями платформи для обміну:</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Ви надаєте</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Юридична назва підприємства та адреса</li>
                      <li>Номер ліцензії закладу харчування</li>
                      <li>Поверховий план, перелік обладнання</li>
                      <li>Правила кухні, години роботи, ціноутворення</li>
                      <li>Вимоги до страхування</li>
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Ви запитуєте</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>COI з вашою кухнею як додаткове страхування</li>
                      <li>Реєстрація підприємства</li>
                      <li>Ліцензія закладу харчування (або підтвердження)</li>
                      <li>Повний список інгредієнтів і алергенів</li>
                      <li>Контактна інформація для екстрених випадків</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>

              <SubHeading id="document-verification">Крок 3: перевірка документів (дні 10–14)</SubHeading>
              <p className="text-gray-600">Не плануйте орієнтування чи кухню, доки не буде перевірено кожен документ.</p>

              <SubHeading id="orientation">Крок 4: Особиста орієнтація (1,5–2 години)</SubHeading>
              <p className="text-gray-600 mb-3">Кожен орендар, незалежно від досвіду, проходить інструктаж, який охоплює:</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Огляд об'єкта:</strong> Всі території, аварійні виходи, вогнегасники, складські призначення</li>
                <li><strong>Навчання обладнання:</strong> Попросіть орендаря продемонструвати вам у відповідь — перевірте розуміння</li>
                <li><strong>Протоколи очищення:</strong> Стандарти, дезінфікуючі рішення, наслідки за невідповідність</li>
                <li><strong>Процедури безпеки:</strong> Пожежа, перша допомога, розливи, екстрені контакти</li>
                <li><strong>Administrative:</strong> Процедури бронювання/оплати, очікування спілкування, звітність про ремонт</li>
              </ul>

              {/* ── Operational Excellence ── */}
              <SectionHeading id="operational-excellence">Операційна досконалість</SectionHeading>

              <SubHeading id="facility-standards">Стандарти об'єктів</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li>Охолодження при 4°C або нижче, морозильні камери при -18°C або нижче, гаряче зберігання при 60°C або вище</li>
                <li>Температурні журнали ведуться та доступні для перевірки</li>
                <li>Спеціальне сховище для кожного орендаря — усі елементи з мітками (ім’я, дата, вміст)</li>
                <li>Сирі продукти нижче готових до споживання — завжди.Ротація FIFO</li>
                <li>Раковини для миття рук у кожній зоні підготовки з милом і одноразовими рушниками</li>
              </ul>

              <SubHeading id="allergen-management">Програма управління алергенами</SubHeading>
              <ol className="list-decimal pl-5 text-gray-600 space-y-2 mt-3">
                <li><strong>Disclosure:</strong> Повний список інгредієнтів з алергенами перед першим використанням</li>
                <li><strong>Без алергенів:</strong> На етикетках повинні бути вказані відповідні алергени для процесів спільного використання</li>
                <li><strong>Розклад за ризиком:</strong> Спочатку безалергенне виробництво, алергенне в останню чергу або після санітарної обробки</li>
                <li><strong>Поділ зберігання:</strong> Етикетки з кольоровим кодуванням (наприклад, червоний для горіхів, синій для молочних продуктів)</li>
                <li><strong>Перевірка очищення:</strong> Гаряча вода з милом видаляє білки-алергени;один дезінфікуючий засіб не робить</li>
                <li><strong>Communication:</strong> Спільний реєстр алергенів, видимий для всіх орендарів</li>
              </ol>

              <SubHeading id="cleaning-sanitation">Стандарти очищення та санітарії</SubHeading>
              <ResourceTable headers={["Розчин", "Концентрація", "Примітки"]} rows={[["Хлор (відбілювач)", "100 ppm (½ ч. л. на літр)", "Втрачає ефективність через 3 години"], ["Четвертинний амоній", "200 ppm", "Дотримуйтесь інструкцій виробника"], ["Йод", "25 ppm", "Менш поширений; перевіряйте тестовими смужками"]]} />

              <SubHeading id="preventive-maintenance">Профілактичне обслуговування</SubHeading>
              <ResourceTable headers={["Частота", "Завдання"]} rows={[["Щодня", "Перевірка рівня олії, протирання варильних поверхонь, перевірка температури в холодильнику, очищення жировловлювачів"], ["Щотижня", "Очищення змійовиків конденсатора, огляд фритюрниць, перевірка витяжок/фільтрів, тестування захисних відключень"], ["Щомісяця", "Калібрування термостатів, огляд сантехніки/електрики, перевірка зон зберігання"], ["Раз на півроку", "Перевірка системи пожежогасіння (обов'язково), очищення витяжок/повітропроводів"], ["Щороку", "Повне обслуговування обладнання, тестування газопроводів, оцінка боротьби зі шкідниками"]]} />

              {/* ── Revenue & Pricing ── */}
              <SectionHeading id="revenue-pricing">Дохід і стратегія ціноутворення</SectionHeading>

              <SubHeading id="pricing-models">Моделі ціноутворення</SubHeading>
              <p className="text-gray-600 mb-3">З опитування операторів спільної кухні 2023 року (The Food Corridor):</p>
              <ResourceTable headers={["Модель", "Дані галузі"]} rows={[["Погодинні ставки", "Національний діапазон $15–$45/год. 42% стягують $20–$29/год."], ["Щомісячні абонементи", "54% операторів пропонують передплачені плани. Забезпечує передбачуваний дохід."], ["Оплата за використання", "39% пропонують це. Найкраще для сезонних/одноразових користувачів. Вища погодинна ставка."]]} />
              <InfoCard variant="tip">
                <strong>Найкраща практика:</strong> Запропонуйте комбінацію — місячні плани для відданих орендарів і оплата за використання для випадкових користувачів.45% операторів пропонують два або більше варіантів оплати.
              </InfoCard>

              <SubHeading id="revenue-streams">Потоки доходу поза межами кухонного часу</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Оренда складів:</strong> $10–$50 за полицю/одиницю.Часто більший попит, ніж час на кухні.</li>
                <li><strong>Доплати за обладнання:</strong> +$5–$10/год для спеціалізованого обладнання.</li>
                <li><strong>Особливі події:</strong> Преміальні ціни на спливаючі вікна, кулінарні курси (50 доларів США за годину або 500 доларів США на день).</li>
                <li><strong>Ціни в пік/непік:</strong> 28% кухонь використовують змінні ставки за часом доби.</li>
              </ul>

              <SubHeading id="setting-rates">Встановлення тарифів</SubHeading>
              <ol className="list-decimal pl-5 text-gray-600 space-y-1 mt-3">
                <li>Постійні витрати: іпотека/оренда, страхування, персонал, плата за платформу</li>
                <li>Змінні витрати: комунальні послуги, технічне обслуговування, миючі засоби, боротьба зі шкідниками</li>
                <li>Ринкові ціни: дослідіть подібні кухні у вашому регіоні</li>
                <li>Ваша унікальна цінність: спеціальне обладнання, склад, розташування</li>
                <li>Цільове використання: реалістичне бронювання годин на день/тиждень</li>
              </ol>
              <InfoCard variant="info">
                <strong>Галузеві поради:</strong> Не варто бути найдешевшим варіантом.Низькі ціни створюють уявлення про нижчу якість і приваблюють менш серйозних орендарів.Ціна на основі вартості та вартості.
              </InfoCard>

              {/* ── Record Keeping ── */}
              <SectionHeading id="record-keeping">Ведення документації</SectionHeading>

              <SubHeading id="what-to-keep">Що зберігати (мінімум 6 років для податкової звітності)</SubHeading>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Записи закладу</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Ліцензія закладу харчування (поточна + попередня)</li>
                      <li>Плани поверхів і характеристики обладнання</li>
                      <li>Журнали технічного обслуговування та калібрування</li>
                      <li>Записи моніторингу температури</li>
                      <li>Контрольні списки прибирання, записи про боротьбу зі шкідниками</li>
                      <li>Акти протипожежної перевірки</li>
                      <li>Страхові поліси, акти перевірки</li>
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Записи кожного орендаря</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Підписаний договір оренди</li>
                      <li>Сертифікат спеціаліста з харчових продуктів із закінченням терміну дії</li>
                      <li>COI з додатковою перевіркою страхувальника</li>
                      <li>Реєстрація бізнесу/ліцензія</li>
                      <li>Документація з оцінки ризиків</li>
                      <li>Підтвердження орієнтації</li>
                      <li>Декларації алергенів, звіти про інциденти</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>

              <SubHeading id="inspection-ready">Готовність до огляду</SubHeading>
              <p className="text-gray-600">Щомісячні самоперевірки за допомогою цього контрольного списку допоможуть вам бути готовими:</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-2">
                <li>Ліцензія розміщена та видима</li>
                <li>Все обладнання справне та чисте</li>
                <li>Температурні журнали поточні та в діапазоні</li>
                <li>Умивальники укомплектовані</li>
                <li>Їжа зберігається належним чином (накривається, маркується, сира нижче RTE)</li>
                <li>Немає доказів шкідників, журнали очищення актуальні</li>
                <li>Пожежна техніка доступна, техоглядні бирки діючі</li>
              </ul>

              {/* ── Emergency Protocols ── */}
              <SectionHeading id="emergency-protocols">Протоколи надзвичайних ситуацій</SectionHeading>
              <p className="text-gray-600 mb-4">Розробіть письмові процедури для кожного сценарію та розмістіть їх на видному місці:</p>
              <Accordion type="single" collapsible className="my-6">
                {[{
                title: "Power Outage",
                items: ["Do not open refrigerators/freezers unnecessarily", "Food in closed fridge stays safe ~4 hours; full freezer ~48 hours", "Contact Environmental Health if outage exceeds safe limits", "Document everything"]
              }, {
                title: "Water Supply Disruption",
                items: ["Cease food preparation immediately", "Notify all booked renters", "Contact utility and Environmental Health"]
              }, {
                title: "Fire",
                items: ["Evacuate immediately, call 911", "Suppression system activates automatically", "Do not re-enter until cleared by fire department", "Document, contact insurance, notify Service NL"]
              }, {
                title: "Foodborne Illness Complaint",
                items: ["Document thoroughly", "Identify the renter responsible", "Notify Environmental Health immediately", "Preserve remaining food samples"]
              }, {
                title: "Equipment Failure",
                items: ["Remove from service immediately", "If refrigeration fails, monitor temps and relocate food", "Contact service provider, document with photos", "Notify affected renters"]
              }].map((protocol, i) => <AccordionItem key={i} value={`protocol-${i}`}>
                    <AccordionTrigger className="text-sm font-semibold text-left">{protocol.title}</AccordionTrigger>
                    <AccordionContent>
                      <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-0.5">
                        {protocol.items.map((item, j) => <li key={j}>{item}</li>)}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>)}
              </Accordion>

              {/* ── Legal Considerations ── */}
              <SectionHeading id="legal-considerations">Юридичні міркування</SectionHeading>

              <SubHeading id="rental-agreement">Основи договору оренди</SubHeading>
              <p className="text-gray-600 mb-3">
                Попросіть юриста один раз переглянути вашу угоду ($500–$1500).Шаблон:{" "}
                <ExtLink href="https://www.gov.mb.ca/agriculture/food-and-ag-processing/starting-a-food-business/pubs/kitchen-rental-agreement-contract.pdf">Договір оренди сільськогосподарської кухні Манітоби</ExtLink>
              </p>
              <ol className="list-decimal pl-5 text-gray-600 space-y-1 text-sm">
                <li>Відповідність закону</li>
                <li>Страхові мінімуми + вимога додаткового страхувальника</li>
                <li>Сертифікація безпеки харчових продуктів</li>
                <li>Відшкодування</li>
                <li>Використання та догляд за обладнанням</li>
                <li>Стандарти прибирання з фінансовими штрафами</li>
                <li>Правила зберігання та маркування</li>
                <li>Планування та доступ</li>
                <li>Комісії та оплата</li>
                <li>Застереження про розірвання</li>
              </ol>

              <SubHeading id="escalation-framework">Структура ескалації</SubHeading>
              <ResourceTable headers={["Проблема", "Кроки ескалації"]} rows={[["Кухня залишена брудною", "1. Задокументувати з фото → 2. Плата за прибирання → 3. Письмове попередження → 4. Розірвання"], ["Обладнання пошкоджено", "1. Задокументувати → 2. Визначити причину → 3. Подати претензію за покриттям орендаря → 4. Стягнути згідно з угодою"], ["Закінчення страховки", "1. Нагадування за 60/30 днів → 2. Призупинити доступ по закінченню → 3. Без винятків"], ["Порушення безпеки харчових продуктів", "1. Зупинити діяльність → 2. Задокументувати → 3. Перенавчання + попередження → 4. Розірвання, якщо серйозно/повторно"]]} />

              {/* ── Compliance Checklist ── */}
              <SectionHeading id="compliance-checklist">Основний контрольний список відповідності</SectionHeading>
              <InteractiveChecklist storageKey="kitchen-compliance-checklist" phases={[{
              title: "Перед відкриттям",
              items: ["Отримано ліцензію на харчове приміщення", "Пройдено інспекцію перед відкриттям", "Страхування загальної відповідальності (рекомендовано $5 млн+)", "Систему пожежогасіння встановлено та перевірено", "Зареєстровано у WorkplaceNL (якщо застосовно)", "Шаблон договору оренди перевірено юристом", "Політику щодо алергенів, протоколи дій у надзвичайних ситуаціях та прибирання задокументовано", "Контракт на боротьбу зі шкідниками укладено", "Профіль Local Cooks створено"]
            }, {
              title: "Перед кожним новим орендарем",
              items: ["Заявку розглянуто", "Оцінку ризиків HACCP завершено", "Сертифікат обробника харчових продуктів перевірено", "Страховий сертифікат перевірено (ліміти, покриття, додатковий страхувальник)", "Договір оренди підписано", "Отримано повний список алергенів", "Немає конфліктів з існуючими орендарями", "Ознайомлення заплановано"]
            }, {
              title: "Щомісяця",
              items: ["Обслуговування за графіком профілактичного обслуговування", "Журнали температури перевірено", "Прибирання вибірково перевірено", "Дати закінчення строку дії страховки перевірено", "Самоінспекцію завершено"]
            }, {
              title: "Раз на півроку",
              items: ["Інспекція системи пожежогасіння", "Професійне очищення витяжки та вентиляції", "Переглянути всі страхові сертифікати орендарів"]
            }, {
              title: "Щороку",
              items: ["Поновити ліцензію на харчове приміщення", "Поновити всі страхові поліси", "Зібрати оновлені страхові сертифікати", "Переглянути умови договору оренди", "Повне технічне обслуговування обладнання", "Звіт WorkplaceNL подано", "Переглянути ціноутворення"]
            }]} />

              {/* ── Resources & Links ── */}
              <SectionHeading id="km-resources-links">Ресурси та посилання</SectionHeading>
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Уряд — Ньюфаундленд і Лабрадор</h4>
              <ResourceTable headers={["Ресурс", "Посилання"]} rows={[["Ліцензія на харчове приміщення", "gov.nl.ca/gs/licences/env-health/food/"], ["Правила щодо харчових приміщень (Повний текст)", "assembly.nl.ca/legislation/sr/regulations/rc961022.htm"], ["Правила пожежної безпеки", "assembly.nl.ca/legislation/sr/regulations/rc120045.htm"], ["Реєстрація роботодавця у WorkplaceNL", "workplacenl.ca/employers/register-my-business/"]]} />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Посібники з найкращих галузевих практик</h4>
              <ResourceTable headers={["Ресурс", "Посилання"]} rows={[["Спільні кухні — Посібник для власників (Онтаріо, 2025)", "wdgpublichealth.ca (PDF)"], ["Шаблон договору оренди кухні (Манітоба)", "gov.mb.ca (PDF)"], ["Інструментарій комерційної кухні: Управління ризиками (Альберта)", "open.alberta.ca"], ["The Food Corridor — Моделі ціноутворення", "thefoodcorridor.com"]]} />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">страхування</h4>
              <ResourceTable headers={["Постачальник", "Вебсайт"]} rows={[["Страхування FLIP (Рекомендовано для орендарів)", "fliprogram.com"], ["BFL Canada", "bflcanada.ca"], ["Zensurance", "zensurance.com"], ["Aligned Insurance", "alignedinsurance.com"]]} />

              {/* Disclaimer */}
              <Separator className="mt-16 mb-8" />
              <Alert className="bg-muted/30">
                <Info className="h-4 w-4" />
                <AlertTitle className="text-xs font-semibold">Останнє оновлення: лютий 2026 р</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground leading-relaxed">
                  Цей посібник призначено лише для інформаційних цілей і не є юридичною, страховою чи професійною порадою.Правила, збори та зміни вимог — завжди перевіряйте поточні вимоги за допомогою офіційних державних джерел, посилання на які наведено вище.
                </AlertDescription>
              </Alert>
            </div>
          </main>
        </div>
      </div>

      <Footer />
    </div>;
}