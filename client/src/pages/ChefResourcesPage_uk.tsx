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
import { ExternalLink, BookOpen, Shield, Building2, FileText, GraduationCap, Scale, Globe, ClipboardCheck, BadgeCheck, Home, CheckCircle2, AlertTriangle, Info, ChevronRight, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════
// SECTION DATA — All content structured as digestible chunks
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
  id: "regulatory-landscape",
  title: "Нормативно-правова база",
  icon: Globe,
  subsections: [{
    id: "three-levels",
    title: "Три рівні регулювання"
  }]
}, {
  id: "food-safety-certification",
  title: "Сертифікація безпечності харчових продуктів",
  icon: GraduationCap,
  subsections: [{
    id: "skillspass-nl",
    title: "Безкоштовно: SkillsPass NL"
  }, {
    id: "paid-alternatives",
    title: "Платні альтернативи"
  }]
}, {
  id: "register-your-business",
  title: "Зареєструйте свій бізнес",
  icon: FileText,
  subsections: [{
    id: "business-structure",
    title: "Структура бізнесу"
  }, {
    id: "home-based-registration",
    title: "Реєстрація на дому"
  }, {
    id: "home-food-rules",
    title: "Що ви можете та не можете готувати вдома"
  }]
}, {
  id: "liability-insurance",
  title: "Страхування відповідальності",
  icon: Shield,
  subsections: [{
    id: "coverage-requirements",
    title: "Вимоги до покриття"
  }, {
    id: "flip-insurance",
    title: "Страхування FLIP"
  }, {
    id: "additional-insured",
    title: "Додатково застрахований"
  }]
}, {
  id: "food-establishment-licence",
  title: "Ліцензія на харчове приміщення",
  icon: BadgeCheck,
  subsections: [{
    id: "commercial-kitchen-users",
    title: "Користувачі комерційної кухні"
  }, {
    id: "home-kitchen-users",
    title: "Користувачі домашньої кухні"
  }]
}, {
  id: "federal-requirements",
  title: "Федеральні вимоги",
  icon: Scale,
  subsections: [{
    id: "cfia-licence",
    title: "Чи потрібна вам ліцензія CFIA?"
  }, {
    id: "traceability",
    title: "Кращі практики відстеження"
  }]
}, {
  id: "local-cooks-platform",
  title: "Ваш шлях через Local Cooks",
  icon: Building2,
  subsections: [{
    id: "apply-and-connect",
    title: "Подати заявку та підключитись"
  }, {
    id: "book-and-operate",
    title: "Бронювати та працювати"
  }]
}, {
  id: "home-vs-commercial",
  title: "Домашня та комерційна кухня",
  icon: Home,
  subsections: []
}, {
  id: "business-tax-essentials",
  title: "Основи бізнесу та податків",
  icon: Scale,
  subsections: [{
    id: "gst-hst",
    title: "Реєстрація GST/HST"
  }, {
    id: "record-keeping",
    title: "Ведення обліку"
  }, {
    id: "workplace-nl-chef",
    title: "WorkplaceNL"
  }]
}, {
  id: "shared-kitchen-operations",
  title: "Робота на спільній кухні",
  icon: ClipboardCheck,
  subsections: [{
    id: "clean-in-clean-out",
    title: "Чисто при вході, чисто при виході"
  }, {
    id: "allergen-responsibility",
    title: "Відповідальність за алергени"
  }, {
    id: "storage-protocols",
    title: "Протоколи зберігання"
  }]
}, {
  id: "faq",
  title: "Часті питання (FAQ)",
  icon: BookOpen,
  subsections: []
}, {
  id: "launch-checklist",
  title: "Ваш контрольний список для запуску",
  icon: ClipboardCheck,
  subsections: []
}, {
  id: "resources-links",
  title: "Ресурси та посилання",
  icon: ExternalLink,
  subsections: []
}];

// ═══════════════════════════════════════════════════════════════
// REUSABLE UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

function InfoCard({
  children,
  variant = "info"
}: {
  children: React.ReactNode;
  variant?: "info" | "warning" | "tip";
}) {
  const icons = {
    info: Info,
    warning: AlertTriangle,
    tip: CheckCircle2
  };
  const Icon = icons[variant];
  return <Alert className="my-6 border bg-background">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <AlertDescription className="text-sm leading-relaxed text-muted-foreground">
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
    const domainWithPath = text.match(/^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z]{2,})+([/][^\s]*)?$/i);
    if (domainWithPath) {
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
  } = useTranslation("chef");
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
              <CheckCircle2 className="h-3.5 w-3.5" /> {t("allDoneReadyToLaunch", "All done — you're ready to launch!")}
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
  } = useTranslation("chef");
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

export default function ChefResourcesPage_en_uk() {
  const {
    t
  } = useTranslation("chef");
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
      <SEOHead title={t("seoChefResourcesTitle", "Chef Resources — Start Your Food Business in Canada")} description={t("seoChefResourcesDesc", "Complete guide to food safety certification, business registration, insurance, and licensing for food entrepreneurs in Newfoundland & Labrador and across Canada.")} canonicalUrl="/resources" keywords={["food business Canada", "food handler certificate NL", "commercial kitchen rental", "food entrepreneur guide", "food safety Newfoundland", "start food business", "FLIP insurance", "food establishment licence", "SkillsPass NL"]} faq={[{
      question: "Do I need a food safety certificate to use LocalCooks?",
      answer: "Yes, all chefs using LocalCooks must complete a food safety certification. In Newfoundland & Labrador, you can get certified for free through SkillsPass NL, which covers food handler training."
    }, {
      question: "How do I register my food business in Newfoundland?",
      answer: "You can register as a sole proprietor or corporation through Service Newfoundland and Labrador. Home-based food businesses require additional registration through the Department of Health and Community Services."
    }, {
      question: "What insurance do I need as a food entrepreneur?",
      answer: "LocalCooks requires minimum $2 million liability coverage. FLIP (Food Liability Insurance Program) offers affordable coverage specifically for food entrepreneurs starting at $199/year."
    }, {
      question: "Can I operate a home-based food business in NL?",
      answer: "Yes, but you must register as a Home-Based Food Business and comply with specific restrictions. Low-risk baked goods and preserves are typically allowed, while high-risk items require a commercial kitchen."
    }, {
      question: "How long does it take to get approved on LocalCooks?",
      answer: "Most chef applications are reviewed and approved within 24 hours. You'll need to complete your food safety certification and provide government ID during the application process."
    }]} siteNavigation={[{
      name: "Apply as Chef",
      description: "Join LocalCooks — get approved in 24 hours, keep 100% during trial",
      url: "https://chef.localcooks.ca/apply"
    }, {
      name: "Book a Kitchen",
      description: "Browse and book commercial kitchens in St. John's, Newfoundland",
      url: "https://chef.localcooks.ca/book-kitchen"
    }, {
      name: "Compare Kitchens",
      description: "Compare commercial kitchen facilities, amenities, and pricing",
      url: "https://chef.localcooks.ca/compare-kitchens"
    }, {
      name: "Chef Resources",
      description: "Complete guide to starting your food business in Canada",
      url: "https://chef.localcooks.ca/resources"
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
                <BookOpen className="h-3 w-3 mr-1.5" />
                Ресурсний посібник шеф-кухаря
              </Badge>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3 leading-tight">
                {t("guideStartingLegal", "Your Guide to Starting a Legal")}{" "}
                <span className="text-[#F51042]">{t("foodBusinessWord", "Food Business")}</span>{" "}
                {t("inCanada", "in Canada")}
              </h1>
              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl mb-4">
                {t("chefResourcesSubtitle", "Currently serving Newfoundland & Labrador — built to scale across Canada. Everything you need from food safety certification to your first kitchen booking.")}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {[{
                icon: CheckCircle2,
                text: t("updatedFeb2026", "Updated February 2026")
              }, {
                icon: BookOpen,
                text: t("tenMinRead", "10-minute read")
              }].map((item, i) => <span key={i} className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <item.icon className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                    {item.text}
                  </span>)}
              </div>
              <Separator className="mt-8" />
            </div>

            <div className="prose-sm sm:prose prose-gray max-w-none prose-table:my-0 prose-thead:border-0 prose-tr:border-0 prose-th:p-0 prose-td:p-0">

              {/* ── Regulatory Landscape ── */}
              <SectionHeading id="regulatory-landscape">Регуляторний ландшафт</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Продовольча система Канади функціонує на трьох рівнях.Знання того, які з них стосуються вас, запобігає дорогим сюрпризам.
              </p>
              <SubHeading id="three-levels">Три рівні регулювання</SubHeading>
              <ResourceTable headers={["Рівень", "Регулятор", "Коли застосовується"]} rows={[["Федеральний", "Канадське агентство перевірки харчових продуктів (CFIA)", "Продаж за межі провінції, імпорт або експорт"], ["Провінційний", "Service NL (на Ньюфаундленді та Лабрадорі)", "Всі харчові підприємства, що працюють у провінції"], ["Муніципальний", "Місто Сент-Джонс (або ваш муніципалітет)", "Зонування, бізнес-дозволи, продаж на ринках"]]} />
              <InfoCard variant="info">
                <strong>Більшість підприємців, які займаються харчовою промисловістю, починають працювати на місцевому рівні, потребують лише провінційних і муніципальних вимог.</strong> Федеральні вимоги діють, коли ви доставляєте продукти через кордони провінцій або за кордон.Кожна провінція має власного регулятора — Служба Нідерландів у Нідерландах, відділи охорони здоров’я в Онтаріо, регіональні органи охорони здоров’я в Британській Колумбії.Принципи універсальні;агентства відрізняються.
              </InfoCard>

              {/* ── Food Safety Certification ── */}
              <SectionHeading id="food-safety-certification">Сертифікат безпечності харчових продуктів</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Сертифікат спеціаліста з харчових продуктів підтверджує, що ви розумієте контроль температури, запобігання перехресному забрудненню, гігієнічні протоколи та безпечне поводження з харчовими продуктами.
              </p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-3">
                <li><strong>Правова вимога.</strong> Принаймні один сертифікований обробник харчових продуктів повинен бути присутнім протягом усього робочого часу в будь-якому харчовому закладі в Нідерландах (<em>Правила приміщень харчування</em>, Розділ 6.1).</li>
                <li><strong>Доступ до кухні.</strong> Комерційні кухні потребують дійсної сертифікації перед наданням доступу.</li>
                <li><strong>Професійний авторитет.</strong> Демонструє відданість безпеці харчових продуктів клієнтам і регуляторам.</li>
              </ul>

              <SubHeading id="skillspass-nl">Безкоштовно: SkillsPass NL</SubHeading>
              <ResourceTable headers={["", ""]} rows={[["Вартість", "Безкоштовно"], ["Постачальник", "Уряд Ньюфаундленду та Лабрадору"], ["Вебсайт", "skillspassnl.com"], ["Курси", "Безпека харчових продуктів: Загальна обізнаність · Приготування їжі вдома · Власник і менеджер"], ["Формат", "Онлайн, приблизно 30 хвилин на модуль"], ["Сертифікат", "Завантажується негайно після здачі"]]} />
              <p className="text-gray-600">
                <strong>Як почати:</strong> Відвідайте{" "}
                <ExtLink href="https://skillspassnl.bluedrop.io">skillspassnl.bluedrop.io</ExtLink>, створіть безкоштовний обліковий запис, пройдіть відповідні модулі, пройдіть оцінювання та завантажте свій сертифікат.Для власників бізнесу рекомендується модуль «Безпека харчових продуктів: власник і менеджер» — він охоплює юридичні зобов’язання, окрім елементарної гігієни.
              </p>

              <SubHeading id="paid-alternatives">Платні альтернативи (визнання в усій Канаді)</SubHeading>
              <ResourceTable headers={["Постачальник", "Термін дії", "Вебсайт"]} rows={[["ProbeIt Food Safety", "5 років, визнається по всій Канаді", "probeit.ca"], ["Canadian Food Safety Training", "Перевірте постачальника", "foodsafetytraining.ca"]]} />
              <InfoCard variant="tip">
                <strong>Переїзд між провінціями?</strong> Ньюфаундленд зазвичай приймає дійсні сертифікати з інших провінцій (наприклад, FoodSafe Level 1 з Британської Колумбії).Перш ніж покладатися на сертифікат, отриманий за межами провінції, зверніться до місцевого спеціаліста з охорони навколишнього середовища.
              </InfoCard>

              {/* ── Register Your Business ── */}
              <SectionHeading id="register-your-business">Зареєструйте свій бізнес</SectionHeading>

              <SubHeading id="business-structure">Структура бізнесу</SubHeading>
              <ResourceTable headers={["Структура", "Реєстрація", "Відповідальність", "Найкраще для"]} rows={[["Приватний підприємець", "Провінційна реєстрація в NL не потрібна (рекомендується реєстрація імені)", "Особиста відповідальність", "Одиночні оператори, продавці на фермерських ринках"], ["Партнерство", "Зареєструватися в Реєстрі компаній", "Спільна особиста відповідальність", "Два або більше партнерів"], ["Корпорація", "Подати документи до Реєстру компаній", "Обмежена відповідальність", "Зростаючий бізнес, пошук інвестицій"]]} />

              <SubHeading id="home-based-registration">Домашня реєстрація харчового бізнесу</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Якщо ви плануєте працювати з домашньої кухні, ви повинні зареєструватися у відділі охорони навколишнього середовища.Завантажити форму з{" "}
                <ExtLink href="https://www.gov.nl.ca/hcs/files/publichealth-envhealth-home-based-food-industry.pdf">gov.nl.ca</ExtLink>, заповніть усі розділи та надішліть до найближчого Центру державних послуг.Реєстрація є <strong>безкоштовно</strong> і не закінчується.
              </p>

              <SubHeading id="home-food-rules">Що можна і чого не можна приготувати вдома</SubHeading>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
                <Card className="border shadow-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-success" /> Дозволено (з низьким рівнем ризику)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Хлібобулочні вироби (печиво, торти, хліб, тістечка)</li>
                      <li>Джеми, желе, варення (правильно підкислені)</li>
                      <li>Цукерки та кондитерські вироби</li>
                      <li>Гранола і злакові продукти</li>
                      <li>Суміші спецій та сухі суміші</li>
                    </ul>
                  </CardContent>
                </Card>
                <Card className="border shadow-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" /> Заборонено (високий ризик)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Сире м'ясо, риба, молюски, птиця</li>
                      <li>Нарізати фрукти та овочі, свіжі соки</li>
                      <li>Ферментовані продукти (кімчі, чайний гриб)</li>
                      <li>Кремова випічка, сирники</li>
                      <li>Консерви з pH ≥ 4,6</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
              <InfoCard variant="warning">
                <strong>Якщо ваш продукт потрапляє в категорію заборонених, вам потрібна комерційна кухня.</strong> Оренда комерційного кухонного простору за 20–50 доларів США на годину часто практичніша, ніж переобладнання домашньої кухні до комерційних стандартів (10 000–50 000 доларів США+).
              </InfoCard>

              {/* ── Liability Insurance ── */}
              <SectionHeading id="liability-insurance">Страхування відповідальності</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Страхування захищає ваш бізнес, ваші особисті активи та кухню, на якій ви працюєте. Майже всі комерційні кухні вимагають підтвердження страхування перед наданням доступу.
              </p>

              <SubHeading id="coverage-requirements">Вимоги до покриття</SubHeading>
              <ResourceTable headers={["Покриття", "Мінімум", "Мета"]} rows={[["Загальна комерційна відповідальність (CGL)", "$2 000 000 сукупно", "Покриває нещасні випадки, травми, пошкодження майна"], ["Відповідальність за продукцію", "$2 000 000 сукупно", "Покриває харчові отруєння, претензії щодо алергенів"], ["Пошкодження орендованих приміщень", "$300 000", "Покриває випадкове пошкодження кухні"], ["Додатково застрахований", "Кухня, зазначена у вашому полісі", "Поширює ваше покриття на кухню"]]} />

              <SubHeading id="flip-insurance">Страхування FLIP (рекомендовано)</SubHeading>
              <p className="text-gray-600">
                FLIP (Програма страхування відповідальності за харчові продукти) спеціалізується на доступному страховому покритті для підприємств харчової промисловості, які орендують комерційні кухонні приміщення.Це найпоширеніший варіант для орендарів спільної кухні по всій Канаді.
              </p>
              <ResourceTable headers={["", ""]} rows={[["Вартість", "Від приблизно $25.92/місяць або $299/рік"], ["Додатково застраховані", "Безкоштовно та необмежено — додавайте кухні без додаткових витрат"], ["Франшиза", "Немає на претензії щодо відповідальності"], ["Купівля", "Миттєво онлайн — сертифікат доступний негайно"], ["Додатки", "Обладнання (+$8.25/міс), кібервідповідальність (+$8.25/міс), додаткова відповідальність (від $41.67/міс)"], ["Вебсайт", "fliprogram.com"]]} />

              <SubHeading id="additional-insured">Розуміння «додаткового страхувальника»</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Коли ви додаєте кухню як додаткову застраховану компанію у своєму полісі, кухня покривається <strong>ваш</strong> страхування претензій, що випливають з <strong>ваш</strong> діяльності.Це стандартна практика в галузі.
              </p>
              <InfoCard variant="info">
                <strong>Приклад:</strong> Ви готуєте їжу на орендованій кухні.Клієнт відчуває алергічну реакцію і подає до суду і на вас, і на кухню.Оскільки кухню зазначено як Додаткового страхувальника, ваш страховик покриває юридичний захист кухні за претензіями, пов’язаними з вашою діяльністю.
              </InfoCard>

              {/* ── Food Establishment Licence ── */}
              <SectionHeading id="food-establishment-licence">Ліцензія на заклад харчування</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Будь-який харчовий бізнес, який працює на комерційній кухні, повинен мати ліцензію на ведення харчового закладу від Service NL відповідно до <em>Акт про харчові приміщення</em>.
              </p>

              <SubHeading id="commercial-kitchen-users">Для користувачів комерційної кухні</SubHeading>
              <p className="text-gray-600">Вам потрібно:</p>
              <ol className="list-decimal pl-5 text-gray-600 space-y-2 mt-2">
                <li><strong>Заповнена заявка на ліцензію</strong> — завантажити з <ExtLink href="https://www.gov.nl.ca/gs/licences/env-health/food/premises/">gov.nl.ca</ExtLink></li>
                <li><strong>План поверху</strong> кухні (це забезпечує керівник кухні)</li>
                <li><strong>Муніципальне погодження</strong> якщо застосовно — у Сент-Джонсі, підтвердьте зонування в плануванні та розвитку</li>
                <li><strong>Підтвердження проходження навчання з безпеки харчових продуктів</strong> — ваш сертифікат із кроку 1</li>
                <li><strong>Договір оренди або лист</strong> підтвердження вашого доступу до ліцензованого закладу</li>
              </ol>
              <ResourceTable headers={["", ""]} rows={[["Час обробки", "2–8 тижнів"], ["Поновлення", "Щорічно — Service NL повідомить вас"]]} />
              <InfoCard variant="info">
                <strong>Important:</strong> Власна ліцензія кухні охоплює <em>об'єкт</em>.Якщо ви працюєте як незалежний бізнес під власним брендом, вам, швидше за все, потрібна власна ліцензія.Зверніться до місцевого спеціаліста з охорони навколишнього середовища.
              </InfoCard>

              <SubHeading id="home-kitchen-users">Для користувачів домашньої кухні</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Ваш дім має відповідати комерційним стандартам: комерційне обладнання, належна вентиляція, адекватне охолодження, окрема зона для приготування їжі, раковина з двома відділеннями, екрановані вікна та захист від шкідників.Надішліть план приміщення та пройдіть екологічну перевірку.
              </p>

              {/* ── Federal Requirements ── */}
              <SectionHeading id="federal-requirements">Федеральні вимоги</SectionHeading>

              <SubHeading id="cfia-licence">Вам потрібна ліцензія CFIA?</SubHeading>
              <ResourceTable headers={["Ваша діяльність", "Потрібна федеральна ліцензія?"]} rows={[["Продаж тільки у вашій провінції", "Ні"], ["Подача безпосередньо споживачам (ресторан, фуд-трак, кейтеринг)", "Ні"], ["Продаж за межі провінції або території", "Так"], ["Імпорт інгредієнтів з-поза меж Канади", "Так"], ["Експорт продукції за кордон", "Так"]]} />
              <p className="text-gray-600 mt-3">
                Якщо вам потрібна ліцензія: створіть обліковий запис My CFIA за адресою{" "}
                <ExtLink href="https://www.inspection.gc.ca/my-cfia">inspection.gc.ca</ExtLink>, розробіть план превентивного контролю (PCP), відповідайте вимогам відстеження та надішліть заявку. <strong>Вартість: $250 за 2-річну ліцензію.</strong>
              </p>

              <SubHeading id="traceability">Найкраща практика відстеження</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Навіть якщо вам не потрібна федеральна ліцензія, ведення основних записів відстеження захищає ваш бізнес:
              </p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-2">
                <li><strong>Один крок назад:</strong> Зберігайте рахунки постачальника з номерами партій</li>
                <li><strong>Один крок вперед:</strong> Ведіть облік продажів для операцій між компаніями (безпосередні роздрібні продажі споживачам не поширюються)</li>
              </ul>

              {/* ── Local Cooks Platform ── */}
              <SectionHeading id="local-cooks-platform">Ваш шлях до місцевих кухарів</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Local Cooks об’єднує підприємців, які займаються їжею, з ліцензованими комерційними кухнями.Ось як відбувається процес.
              </p>

              <SubHeading id="apply-and-connect">Застосувати та підключитися</SubHeading>
              <div className="space-y-4 my-4">
                {[{
                step: "1",
                title: "Створіть свій профіль і подайте заявку",
                desc: "Переглядайте доступні комерційні кухні, подавайте заявки на локації, які відповідають вашим потребам, і завантажуйте свій сертифікат маніпулятора харчових продуктів та інші документи як частину заявки."
              }, {
                step: "2",
                title: "Зв'яжіться з вашим менеджером кухні",
                desc: "Використовуйте вбудовану систему обміну повідомленнями платформи для обміну документами, необхідними для вашої ліцензії на харчове приміщення (адреса кухні, план поверху, номер ліцензії). Надайте свій сертифікат страхування з кухнею, зазначеною як Додатково застрахований."
              }, {
                step: "3",
                title: "Завершіть етапи затвердження",
                desc: "Процес затвердження має кілька етапів — менеджери перевіряють ваші документи та кваліфікацію перед наданням повного доступу до бронювання."
              }].map(item => <Card key={item.step} className="bg-muted/30">
                    <CardContent className="p-4 flex gap-4 items-start">
                      <Badge className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-sm">{item.step}</Badge>
                      <div>
                        <p className="font-medium">{item.title}</p>
                        <p className="text-sm text-muted-foreground mt-1">{item.desc}</p>
                      </div>
                    </CardContent>
                  </Card>)}
              </div>

              <SubHeading id="book-and-operate">Бронюйте та керуйте</SubHeading>
              <p className="text-gray-600 leading-relaxed">Після повного схвалення:</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-2">
                <li>Бронюйте інтервали для кухні безпосередньо через платформу</li>
                <li>За потреби додайте до своїх бронювань сховище та оренду обладнання</li>
                <li>Платіть безпечно через платформу</li>
                <li>Керуйте майбутніми та минулими бронюваннями зі своєї інформаційної панелі</li>
              </ul>
              <InfoCard variant="tip">
                <strong>Перед першим сеансом:</strong> Зверніться до керівника кухні для особистої орієнтації.Це стосується роботи обладнання, протоколів очищення, аварійних процедур, призначень для зберігання та правил, що стосуються конкретного об’єкта.
              </InfoCard>

              {/* ── Home vs Commercial ── */}
              <SectionHeading id="home-vs-commercial">Дім проти комерційної кухні</SectionHeading>
              <ResourceTable headers={["Фактор", "Домашня кухня", "Комерційна кухня"]} rows={[["Початкові витрати", "Низькі на початку, але модернізація дорога", "Оплата за використання — без капітальних вкладень"], ["Типи продуктів", "Тільки з низьким ризиком (випічка, джеми, сухі суміші)", "Будь-який харчовий продукт, включаючи високий ризик"], ["Обладнання", "Повинні особисто відповідати комерційним стандартам", "Надається комерційне обладнання"], ["Масштабованість", "Обмежена простором і правилами", "Гнучка — бронюйте більше годин у міру зростання"], ["Ліцензування", "Дім інспектується і ліцензується окремо", "Кухня вже ліцензована і проінспектована"], ["Мережа", "Ізольовано", "Робота поруч з іншими харчовими підприємцями"]]} />

              {/* ── Business & Tax ── */}
              <SectionHeading id="business-tax-essentials">Основи бізнесу та оподаткування</SectionHeading>

              <SubHeading id="gst-hst">Реєстрація GST/HST</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Обов'язковий</strong> якщо річний дохід перевищує 30 000 доларів США (невеликий поріг постачальника)</li>
                <li>Зареєструватися через <ExtLink href="https://www.canada.ca/en/revenue-agency.html">Агентство доходів Канади</ExtLink></li>
                <li>У Ньюфаундленді і Лабрадорі комбін <strong>Ставка HST становить 15%</strong></li>
              </ul>

              <SubHeading id="record-keeping">Ведення документації</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Агентство доходів Канади вимагає, щоб ви вели ділові записи для <strong>6 років</strong>.Відстежуйте: покупки інгредієнтів, платежі за оренду кухні, страхові внески, обладнання та матеріали, дохід від продажів за каналами та транспортні витрати.
              </p>

              <SubHeading id="workplace-nl-chef">WorkplaceNL (компенсація працівникам)</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Якщо ви наймете хоча б одного помічника — випадкового, неповний робочий день або за контрактом — ви повинні зареєструватися в <strong>Робоче місцеNL</strong>.Ставка оцінки: 1,28 доларів США за 100 доларів США заробітної плати за послуги харчування (NIC 9210).
              </p>

              {/* ── Shared Kitchen Operations ── */}
              <SectionHeading id="shared-kitchen-operations">Робота на загальній кухні</SectionHeading>

              <SubHeading id="clean-in-clean-out">Правило прибирання, прибирання</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Прибуття:</strong> Продезінфікуйте станцію перед початком.Ніколи не припускайте, що попередній користувач залишив його ідеальним.</li>
                <li><strong>Відхід:</strong> Залиште станцію готовою до перевірки — поверхні вимиті, раковини чисті, підлоги підметені, обладнання повернуто.</li>
              </ul>

              <SubHeading id="allergen-responsibility">Відповідальність за алерген</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li>Зберігайте алергени високого ризику в щільно закритих контейнерах з чіткими етикетками</li>
                <li>Виконуйте завдання з високим вмістом алергенів у кінці сеансу, коли це можливо</li>
                <li>Додайте до своїх міток повідомлення «Може містити сліди...».</li>
                <li>Розкрийте всі інгредієнти та алергени менеджеру кухні</li>
              </ul>

              <SubHeading id="storage-protocols">Протоколи зберігання</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Позначте все:</strong> Ваше ім'я, назва продукту та дата</li>
                <li><strong>Правило 6 дюймів:</strong> Нічого на підлозі — використовуйте полиці або стелажі</li>
                <li><strong>Без змішування:</strong> Дотримуйтеся вертикальної ієрархії зберігання закладу (сирець нижче готового до вживання)</li>
              </ul>

              {/* ── FAQ ── */}
              <SectionHeading id="faq">Часті запитання</SectionHeading>
              <Accordion type="single" collapsible className="my-6">
                {[{
                q: "Скільки часу потрібно від нуля до першого легального продажу?",
                a: "Зазвичай 4\u201310 тижнів: Сертифікат маніпулятора харчових продуктів (1 день), страхування (миттєво), реєстрація домашнього бізнесу (1\u20132 тижні), Ліцензія на харчове приміщення (2\u20138 тижнів)."
              }, {
                q: "Чи можу я почати продавати, перш ніж матиму всі ліцензії?",
                a: "Ні. Усі необхідні сертифікати, реєстрації та ліцензії повинні бути на місці, перш ніж ви зможете легально продавати харчові продукти."
              }, {
                q: "Чи потрібна мені ліцензія лише для фермерських ринків?",
                a: "Вам потрібен як мінімум сертифікат маніпулятора харчових продуктів та реєстрація бізнесу. Багато ринків також вимагають доказ ліцензування та страхування. Подайте документи організаторам щонайменше за 14 днів до події (вимога Service NL)."
              }, {
                q: "Що якщо я хочу розширитися за межі Ньюфаундленду?",
                a: "Вам знадобиться ліцензія Безпечні харчові продукти для канадців від CFIA (250 $ на 2 роки) і потрібно буде відповідати федеральним вимогам щодо маркування, відстежуваності та превентивного контролю."
              }, {
                q: "Чи можу я виробляти деякі продукти вдома, а інші в комерційній кухні?",
                a: "Так, але вам потрібна відповідна ліцензія для кожного місця. Ведіть детальні записи про те, де кожен продукт виготовляється."
              }, {
                q: "Як додати кухню як Додатково застрахованого?",
                a: "Через портал вашого страховика. З FLIP це миттєво і безкоштовно \u2014 введіть юридичну назву та адресу кухні, потім згенеруйте оновлений сертифікат страхування."
              }].map((item, i) => <AccordionItem key={i} value={`faq-${i}`}>
                    <AccordionTrigger className="text-sm font-medium text-left">{item.q}</AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground leading-relaxed">{item.a}</AccordionContent>
                  </AccordionItem>)}
              </Accordion>

              {/* ── Launch Checklist ── */}
              <SectionHeading id="launch-checklist">Ваш контрольний список для запуску</SectionHeading>
              <InteractiveChecklist storageKey="chef-launch-checklist" phases={[{
              title: "Тижні 1\u20132: Основа",
              items: ["Пройдіть безкоштовний онлайн-курс з обробки харчових продуктів SkillsPass NL", "Складіть іспит на сертифікацію та завантажте свій сертифікат", "Дослідіть, які продукти ви хочете готувати", "Вирішіть: домашня чи комерційна кухня", "Ознайомтеся з правилами щодо харчових приміщень Ньюфаундленду і Лабрадору"]
            }, {
              title: "Тижні 3\u20134: Страхування та реєстрація",
              items: ["Отримайте пропозицію зі страхування відповідальності від FLIP або альтернативного постачальника", "Придбайте страхування відповідальності щонайменше на 2 млн доларів", "Завантажте свій страховий сертифікат", "Зареєструйте домашній харчовий бізнес (якщо застосовно)", "Відкрийте окремий банківський рахунок для бізнесу"]
            }, {
              title: "Тижні 5\u20136: Кухня та документи",
              items: ["Перегляньте комерційні кухні на Local Cooks", "Подайте заявки до кухонь, які відповідають вашим потребам", "Зв'яжіться з керівниками кухонь через обмін повідомленнями", "Обміняйтеся документами (плани поверхів, інформація про ліцензію, COI)", "Додайте кухню як додаткового застрахованого у своєму страхуванні"]
            }, {
              title: "Тижні 7\u201310: Запуск",
              items: ["Зберіть усі документи для ліцензії на харчове приміщення", "Подайте заявку до Service NL і сплатіть збори", "Пройдіть очне ознайомлення з кухнею", "Підпишіть договір оренди", "Забронюйте свою першу сесію на кухні"]
            }]} />

              {/* ── Resources & Links ── */}
              <SectionHeading id="resources-links">Ресурси та посилання</SectionHeading>
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Уряд — Ньюфаундленд і Лабрадор</h4>
              <ResourceTable headers={["Ресурс", "Посилання"]} rows={[["Ліцензія на харчове приміщення", "gov.nl.ca/gs/licences/env-health/food/"], ["Правила щодо харчових приміщень (Повний текст)", "assembly.nl.ca/legislation/sr/regulations/rc961022.htm"], ["Керівництво для домашньої харчової промисловості (PDF)", "gov.nl.ca/hcs/files/publichealth-envhealth-home-based-food-industry.pdf"], ["SkillsPass NL (Безкоштовне навчання)", "skillspassnl.com"], ["WorkplaceNL", "workplacenl.ca"]]} />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Федеральний / Канадський</h4>
              <ResourceTable headers={["Ресурс", "Посилання"]} rows={[["Інструментарій CFIA для харчових підприємств", "inspection.canada.ca/food-safety-industry/toolkit-food-businesses"], ["Пріоритетні алергени Health Canada", "canada.ca/en/health-canada/services/food-nutrition/food-safety/food-allergies-intolerances.html"], ["Канадське податкове агентство (GST/HST)", "canada.ca/en/revenue-agency.html"], ["Контрольний список дозволів BizPaL", "bizpal.ca"]]} />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">страхування</h4>
              <ResourceTable headers={["Постачальник", "Вебсайт"]} rows={[["Страхування FLIP (Рекомендовано)", "fliprogram.com"], ["Zensurance", "zensurance.com"], ["BFL Canada", "bflcanada.ca"]]} />

              {/* Disclaimer */}
              <Separator className="mt-16 mb-8" />
              <Alert className="bg-muted/30">
                <Info className="h-4 w-4" />
                <AlertTitle className="text-xs font-semibold">Останнє оновлення: лютий 2026 р</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground leading-relaxed">
                  Цей посібник призначено лише для інформаційних цілей і не є юридичною, страховою чи професійною порадою.Правила, збори та зміни вимог — завжди перевіряйте поточні вимоги за допомогою офіційних державних джерел, посилання на які наведено вище.Зверніться до кваліфікованих спеціалістів з питань права, страхування та безпеки харчових продуктів, щоб отримати пораду у вашій ситуації.
                </AlertDescription>
              </Alert>
            </div>
          </main>
        </div>
      </div>

      <Footer />
    </div>;
}