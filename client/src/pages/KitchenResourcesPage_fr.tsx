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
  title: "Votre fondement juridique",
  icon: Scale,
  subsections: [{
    id: "food-establishment-licence",
    title: "Permis d'établissement alimentaire"
  }, {
    id: "inspection-system",
    title: "Système d'inspection"
  }, {
    id: "workplace-nl",
    title: "WorkplaceNL"
  }, {
    id: "fire-safety",
    title: "Sécurité incendie"
  }, {
    id: "federal-considerations",
    title: "Considérations fédérales"
  }]
}, {
  id: "insurance",
  title: "Assurance",
  icon: Shield,
  subsections: [{
    id: "your-insurance-portfolio",
    title: "Votre portefeuille"
  }, {
    id: "renter-insurance",
    title: "Exigences en matière d'assurance locataire"
  }, {
    id: "verifying-coi",
    title: "Vérification des attestations"
  }]
}, {
  id: "risk-assessment",
  title: "Évaluation des risques",
  icon: AlertCircle,
  subsections: [{
    id: "haccp-assessment",
    title: "Évaluation basée sur HACCP"
  }, {
    id: "pre-rental-screening",
    title: "Vérification pré-location"
  }]
}, {
  id: "onboarding-chefs",
  title: "Intégration des chefs",
  icon: ClipboardCheck,
  subsections: [{
    id: "application-review",
    title: "Examen des candidatures"
  }, {
    id: "info-exchange",
    title: "Échange d'informations"
  }, {
    id: "document-verification",
    title: "Vérification des documents"
  }, {
    id: "orientation",
    title: "Orientation en personne"
  }]
}, {
  id: "operational-excellence",
  title: "Excellence opérationnelle",
  icon: BadgeCheck,
  subsections: [{
    id: "facility-standards",
    title: "Normes des installations"
  }, {
    id: "allergen-management",
    title: "Gestion des allergènes"
  }, {
    id: "cleaning-sanitation",
    title: "Nettoyage et désinfection"
  }, {
    id: "preventive-maintenance",
    title: "Entretien préventif"
  }]
}, {
  id: "revenue-pricing",
  title: "Revenus et tarification",
  icon: DollarSign,
  subsections: [{
    id: "pricing-models",
    title: "Modèles de tarification"
  }, {
    id: "revenue-streams",
    title: "Flux de revenus"
  }, {
    id: "setting-rates",
    title: "Fixer vos tarifs"
  }]
}, {
  id: "record-keeping",
  title: "Tenue de registres",
  icon: FileText,
  subsections: [{
    id: "what-to-keep",
    title: "Ce qu'il faut conserver"
  }, {
    id: "inspection-ready",
    title: "Rester prêt pour l'inspection"
  }]
}, {
  id: "emergency-protocols",
  title: "Protocoles d'urgence",
  icon: Flame,
  subsections: []
}, {
  id: "legal-considerations",
  title: "Considérations juridiques",
  icon: Scale,
  subsections: [{
    id: "rental-agreement",
    title: "L'essentiel du contrat de location"
  }, {
    id: "escalation-framework",
    title: "Cadre d'escalade"
  }]
}, {
  id: "compliance-checklist",
  title: "Liste de contrôle principale de conformité",
  icon: ClipboardCheck,
  subsections: []
}, {
  id: "km-resources-links",
  title: "Ressources et liens",
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
                  Réinitialiser
                </button>}
            </div>
          </div>
          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-500 ease-out", overallPercent === 100 ? "bg-emerald-500" : "bg-primary")} style={{
            width: `${overallPercent}%`
          }} />
          </div>
          {overallPercent === 100 && <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Tout est fait : vous êtes entièrement conforme !
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
              Navigation
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

export default function KitchenResourcesPage_en_fr() {
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
                Guide du gestionnaire de cuisine
              </Badge>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3 leading-tight">
                Le {t("completeGuideOperating", "Complete Guide to Operating a")}{" "}
                <span className="text-[#F51042]">{t("sharedKitchenWord", "Shared Commercial Kitchen")}</span>
              </h1>
              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl mb-4">
                Desservant actuellement Terre-Neuve-et-Labrador – construit pour évoluer partout au Canada.Licences, assurances, évaluation des risques, opérations et tarification pour les responsables des installations.
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
              <SectionHeading id="legal-foundation">Votre fondement juridique</SectionHeading>

              <SubHeading id="food-establishment-licence">Permis d'établissement alimentaire (Service NL)</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Toute cuisine commerciale qui produit, prépare, stocke ou vend des aliments à Terre-Neuve-et-Labrador doit détenir un <strong>Permis d'établissement alimentaire</strong> délivré par Service NL sous le <em>Loi sur les établissements alimentaires</em>.
              </p>
              <ol className="list-decimal pl-5 text-gray-600 space-y-2 mt-3">
                <li>Remplissez la demande de licence à partir de <ExtLink href="https://www.gov.nl.ca/gs/licences/env-health/food/">gov.nl.ca</ExtLink></li>
                <li>Soumettre un plan d'étage détaillé montrant tous les équipements, installations sanitaires, stockage, ventilation et points d'entrée/sortie</li>
                <li>Obtenez l'approbation du zonage municipal — à St. John's, contactez Planning and Development</li>
                <li>Fournir une preuve de formation en matière de salubrité alimentaire — au moins un manutentionnaire certifié doit être présent pendant chaque heure d'exploitation (<em>Règlement sur les établissements alimentaires</em>, article 6.1)</li>
              </ol>

              <SubHeading id="inspection-system">Le système d'inspection de T.-N.-L.</SubHeading>
              <ResourceTable headers={["Niveau de risque", "Fréquence", "Activités typiques"]} rows={[["Risque élevé", "4 fois par an", "Viande crue/fruits de mer, restauration à grand volume, cuisines multi-utilisateurs"], ["Risque moyen", "2 fois par an", "Boulangeries, préparation alimentaire modérée, menu limité"], ["Faible risque", "Une fois tous les 2 ans", "Aliments préemballés, produits secs à faible risque uniquement"]]} />
              <p className="text-gray-600">
                Problème des inspecteurs <strong>articles critiques</strong> (doit être corrigé immédiatement) et <strong>articles non critiques</strong> (délai de conformité indiqué).Tous les rapports sont accessibles au public pendant deux ans.
              </p>
              <InfoCard variant="tip">
                <strong>Conseil de pro pour les cuisines partagées :</strong> Dans de nombreuses juridictions canadiennes, une inspection de santé publique peut être requise pour <em>chaque locataire individuel</em> — la propre inspection de la cuisine ne couvre pas automatiquement toutes les entreprises qui y opèrent.
              </InfoCard>

              <SubHeading id="workplace-nl">Inscription à WorkplaceNL</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Si votre cuisine est <strong>incorporé</strong>, vous devez vous inscrire auprès de WorkplaceNL quel que soit le nombre d'employés.Les entreprises individuelles doivent s'enregistrer au moment où elles embauchent un travailleur.
              </p>
              <ResourceTable headers={["Code NIC", "Industrie", "Taux 2025"]} rows={[["9210", "Services alimentaires", "1,28 $ par tranche de 100 $ de paie"], ["9211", "Restaurants, autorisés", "1,28 $ par tranche de 100 $ de paie"], ["9221", "Traiteurs", "1,28 $ par tranche de 100 $ de paie"]]} />
              <InfoCard variant="info">
                Si vos locataires sont des entreprises indépendantes (et non vos employés), ils sont responsables de leur propre couverture WorkplaceNL.Cependant, confirmez-le auprès de WorkplaceNL si la relation peut être interprétée comme une relation employeur-travailleur.
              </InfoCard>

              <SubHeading id="fire-safety">Systèmes de sécurité et d'extinction d'incendie</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-3">
                <li>Toute cuisine utilisant des équipements produisant de la graisse doit disposer d'un <strong>système d'extinction automatique d'incendie</strong> (NFPA 96)</li>
                <li><strong>Conforme UL-300</strong> les systèmes chimiques humides sont la norme canadienne</li>
                <li>Une inspection semestrielle par un fournisseur certifié est obligatoire</li>
                <li><strong>Extincteurs portatifs de classe « K »</strong> doit être présent</li>
              </ul>

              <SubHeading id="federal-considerations">Considérations fédérales</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Si un locataire fait du commerce interprovincial ou si votre installation effectue la transformation en son nom, vous pourriez tomber sous le coup <strong>Règlement sur la salubrité des aliments au Canada (RSAC)</strong>.L'ACIA reconnaît les installations à usage partagé comme des nœuds essentiels de la chaîne d'approvisionnement.
              </p>

              {/* ── Insurance ── */}
              <SectionHeading id="insurance">Assurance</SectionHeading>

              <SubHeading id="your-insurance-portfolio">Votre portefeuille d'assurance</SubHeading>
              <ResourceTable headers={["Couverture", "Détails"]} rows={[["Responsabilité civile générale", "5 000 000 $+ au total recommandé pour les installations multi-utilisateurs"], ["Assurance de biens", "Bâtiment, équipement, inventaire — à la valeur de remplacement avec interruption des affaires"], ["Bris d'équipement", "Protège contre les pannes mécaniques/électriques d'actifs critiques"], ["Responsabilité civile complémentaire", "Ajoute 2 à 5 M$ au-dessus de la CGL pour les réclamations catastrophiques"], ["Cyber-responsabilité", "Couvre les violations de données lors du traitement de données de réservation/paiement numériques"]]} />

              <SubHeading id="renter-insurance">Exigences en matière d'assurance locataire</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Chaque locataire doit avoir son propre CGL et nommer votre cuisine comme <strong>Assuré supplémentaire</strong>.Il s’agit du mécanisme de transfert de risque le plus important.
              </p>
              <ResourceTable headers={["Type de couverture", "Minimum", "Pourquoi"]} rows={[["Responsabilité civile générale", "2 000 000 $ au total", "Norme de l'industrie pour les entreprises alimentaires au Canada"], ["Responsabilité du fait des produits", "2 000 000 $ au total", "Couvre les intoxications alimentaires, les allergènes non déclarés"], ["Dommages aux locaux loués", "300 000 $", "Couvre les dommages accidentels causés par l'incendie ou l'eau"], ["Assuré additionnel", "Le nom de votre cuisine", "Étend la couverture du locataire à vous"]]} />

              <SubHeading id="verifying-coi">Vérification des certificats d'assurance</SubHeading>
              <ol className="list-decimal pl-5 text-gray-600 space-y-1 mt-3">
                <li>Le nom légal et l'adresse exacts de votre cuisine doivent apparaître en tant que titulaire du certificat</li>
                <li>Les dates d’entrée en vigueur et d’expiration doivent couvrir toute la période de location</li>
                <li>Les limites de couverture doivent atteindre ou dépasser vos minimums</li>
                <li>Responsabilité du fait des produits et dommages aux locaux loués tous deux répertoriés</li>
                <li>L'assureur doit être agréé et légitime</li>
              </ol>
              <InfoCard variant="warning">
                <strong>Bonne pratique :</strong> Définissez des rappels de calendrier 60 et 30 jours avant l’expiration de chaque police.Suspendez immédiatement l’accès à la réservation si aucun renouvellement n’est reçu.Aucune exception.
              </InfoCard>

              {/* ── Risk Assessment ── */}
              <SectionHeading id="risk-assessment">Évaluation des risques</SectionHeading>

              <SubHeading id="haccp-assessment">Évaluation des risques basée sur HACCP</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Évaluez chaque candidat selon quatre catégories de danger :
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
                        {risk.critical && <Badge variant="destructive" className="mr-2 text-[10px]">Critique</Badge>}
                        {risk.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className={cn("text-sm", risk.critical ? "text-red-700" : "text-muted-foreground")}>{risk.desc}</p>
                    </CardContent>
                  </Card>)}
              </div>
              <p className="text-gray-600 text-sm">
                <strong>Allergènes prioritaires au Canada (Santé Canada) :</strong> Arachides, noix, lait, œufs, blé/triticale, soja, sésame, moutarde, crustacés, mollusques, poisson et sulfites.
              </p>

              <SubHeading id="pre-rental-screening">Liste de contrôle de vérification avant la location</SubHeading>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
                <Card className="border-red-200 bg-red-50/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-red-800 flex items-center gap-2">
                      <Badge variant="destructive" className="text-[10px]">Obligatoire</Badge>
                      Niveau 1 : non négociable
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Certificat valide de manutentionnaire d'aliments</li>
                      <li>Certificat d'assurance (2 M$ CGL, assuré supplémentaire)</li>
                      <li>Contrat de location signé</li>
                      <li>Évaluation des risques terminée</li>
                    </ul>
                  </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-amber-800">Niveau 2 : Avant les opérations</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Enregistrement ou licence d'entreprise</li>
                      <li>Licence d'établissement alimentaire (ou preuve de demande)</li>
                      <li>Coordonnées d'urgence</li>
                      <li>Déclarations complètes des ingrédients/allergènes</li>
                      <li>Accusé de réception de la fin de l'orientation</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>

              {/* ── Onboarding ── */}
              <SectionHeading id="onboarding-chefs">Chefs intégrés</SectionHeading>

              <SubHeading id="application-review">Étape 1 : Examen de la candidature (jours 1 à 3)</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li>Profil d'évaluation : type d'aliment, volume de production, besoins en matière d'horaire, niveau d'expérience</li>
                <li>Confirmer que le certificat de manutentionnaire d'aliments est téléchargé et à jour</li>
                <li>Vérification rapide de compatibilité : allergènes, besoins en matériel, conflits de stockage</li>
                <li><strong>Répondez rapidement</strong> — des délais de réponse rapides attirent des locataires de qualité</li>
              </ul>

              <SubHeading id="info-exchange">Étape 2 : Échange d’informations (jours 3 à 10)</SubHeading>
              <p className="text-gray-600 mb-3">Utilisez la messagerie de la plateforme pour échanger :</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Vous fournissez</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Raison sociale et adresse légales de l'entreprise</li>
                      <li>Numéro de licence d'établissement alimentaire</li>
                      <li>Plan d'étage, liste des équipements</li>
                      <li>Règles de cuisine, horaires, tarifs</li>
                      <li>Exigences d'assurance</li>
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Vous demandez</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>COI avec votre cuisine comme assuré supplémentaire</li>
                      <li>Détails de l'enregistrement de l'entreprise</li>
                      <li>Permis d'établissement alimentaire (ou preuve)</li>
                      <li>Liste complète des ingrédients et des allergènes</li>
                      <li>Coordonnées d'urgence</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>

              <SubHeading id="document-verification">Étape 3 : Vérification des documents (jours 10 à 14)</SubHeading>
              <p className="text-gray-600">Ne planifiez pas d’orientation ou de temps de cuisine tant que chaque document n’a pas été vérifié.</p>

              <SubHeading id="orientation">Étape 4 : Orientation en personne (1,5 à 2 heures)</SubHeading>
              <p className="text-gray-600 mb-3">Chaque locataire, quelle que soit son expérience, suit une orientation couvrant :</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Visite des installations :</strong> Toutes les zones, sorties de secours, extincteurs, missions de stockage</li>
                <li><strong>Formation sur les équipements :</strong> Demandez au locataire de vous faire une démonstration – vérifiez sa compréhension</li>
                <li><strong>Protocoles de nettoyage :</strong> Normes, solutions désinfectantes, conséquences en cas de non-respect</li>
                <li><strong>Procédures de sécurité :</strong> Incendie, premiers secours, déversements, contacts d'urgence</li>
                <li><strong>Administrative:</strong> Procédures de réservation/paiement, attentes en matière de communication, rapports de réparation</li>
              </ul>

              {/* ── Operational Excellence ── */}
              <SectionHeading id="operational-excellence">Excellence opérationnelle</SectionHeading>

              <SubHeading id="facility-standards">Normes des installations</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li>Réfrigération à 4°C ou moins, congélateurs à -18°C ou moins, maintien au chaud à 60°C ou plus</li>
                <li>Journaux de température conservés et disponibles pour inspection</li>
                <li>Stockage dédié par locataire - tous les articles étiquetés (nom, date, contenu)</li>
                <li>Aliments crus en dessous des aliments prêts à manger – toujours.Rotation FIFO</li>
                <li>Lave-mains dans chaque zone de préparation avec savon et serviettes à service unique</li>
              </ul>

              <SubHeading id="allergen-management">Programme de gestion des allergènes</SubHeading>
              <ol className="list-decimal pl-5 text-gray-600 space-y-2 mt-3">
                <li><strong>Disclosure:</strong> Liste complète des ingrédients avec allergènes avant la première utilisation</li>
                <li><strong>Aucune allégation sans allergène :</strong> Les étiquettes doivent indiquer les allergènes pertinents dans les processus partagés dans les installations.</li>
                <li><strong>Planification par risque :</strong> Production sans allergène en premier, allergène en dernier ou après assainissement</li>
                <li><strong>Séparation de stockage :</strong> Étiquettes à code couleur (par exemple, rouge pour les noix, bleu pour les produits laitiers)</li>
                <li><strong>Vérification du nettoyage :</strong> L'eau chaude savonneuse élimine les protéines allergènes ;le désinfectant seul ne suffit pas</li>
                <li><strong>Communication:</strong> Registre des allergènes partagé visible par tous les locataires</li>
              </ol>

              <SubHeading id="cleaning-sanitation">Normes de nettoyage et d’assainissement</SubHeading>
              <ResourceTable headers={["Solution", "Concentration", "Notes"]} rows={[["Chlore (eau de Javel)", "100 ppm (½ c. à thé par litre)", "Perd son efficacité après 3 heures"], ["Ammonium quaternaire", "200 ppm", "Suivre les instructions du fabricant"], ["Iode", "25 ppm", "Moins commun ; vérifier avec des bandelettes de test"]]} />

              <SubHeading id="preventive-maintenance">Entretien préventif</SubHeading>
              <ResourceTable headers={["Fréquence", "Tâches"]} rows={[["Quotidien", "Vérifier les niveaux d'huile, essuyer les lignes de cuisson, vérifier les températures du réfrigérateur, vider les bacs à graisse"], ["Hebdomadaire", "Nettoyer les serpentins du condenseur, inspecter les friteuses, vérifier les hottes/filtres, tester les arrêts de sécurité"], ["Mensuel", "Étalonner les thermostats, inspecter la plomberie/l'électricité, vérifier les zones de stockage"], ["Semestriel", "Inspection de l'extinction d'incendie (obligatoire), nettoyage des hottes/conduits"], ["Annuel", "Entretien complet de l'équipement, test des conduites de gaz, évaluation de la lutte antiparasitaire"]]} />

              {/* ── Revenue & Pricing ── */}
              <SectionHeading id="revenue-pricing">Stratégie de revenus et de prix</SectionHeading>

              <SubHeading id="pricing-models">Modèles de tarification</SubHeading>
              <p className="text-gray-600 mb-3">Tiré de l’enquête 2023 auprès des opérateurs de cuisine partagée (The Food Corridor) :</p>
              <ResourceTable headers={["Modèle", "Données de l'industrie"]} rows={[["Tarifs horaires", "Plage nationale de 15 à 45 $/heure. 42 % facturent 20 à 29 $/heure."], ["Abonnements mensuels", "54 % des exploitants proposent des forfaits prépayés. Fournit des revenus prévisibles."], ["Paiement à l'utilisation", "39 % le proposent. Idéal pour les utilisateurs saisonniers/ponctuels. Taux horaire plus élevé."]]} />
              <InfoCard variant="tip">
                <strong>Bonne pratique :</strong> Proposez une combinaison : des forfaits mensuels pour les locataires engagés et un paiement à l'utilisation pour les utilisateurs occasionnels.45 % des opérateurs proposent deux options de facturation ou plus.
              </InfoCard>

              <SubHeading id="revenue-streams">Flux de revenus au-delà du temps passé en cuisine</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Locations de stockage :</strong> 10 $ à 50 $ par étagère/unité.Une demande souvent plus élevée que le temps passé en cuisine.</li>
                <li><strong>Suppléments d'équipement :</strong> +5 $ à 10 $/heure pour l'équipement spécialisé.</li>
                <li><strong>Événements spéciaux :</strong> Tarif premium pour les pop-ups, les cours de cuisine (50 $/heure ou 500 $ forfaitaire par jour).</li>
                <li><strong>Tarifs heures pleines/heures creuses :</strong> 28 % des cuisines utilisent des tarifs variables selon l'heure de la journée.</li>
              </ul>

              <SubHeading id="setting-rates">Fixer vos tarifs</SubHeading>
              <ol className="list-decimal pl-5 text-gray-600 space-y-1 mt-3">
                <li>Frais fixes : hypothèque/loyer, assurance, personnel, frais de plateforme</li>
                <li>Coûts variables : services publics, entretien, produits de nettoyage, lutte antiparasitaire</li>
                <li>Tarifs du marché : recherchez des cuisines comparables dans votre région</li>
                <li>Votre valeur unique : équipement spécialisé, entreposage, emplacement</li>
                <li>Utilisation cible : heures de réservation réalistes par jour/semaine</li>
              </ol>
              <InfoCard variant="info">
                <strong>Conseils à l'industrie :</strong> Résistez à être l’option la moins chère.Les prix bas créent une perception de qualité inférieure et attirent des locataires moins sérieux.Prix ​​basé sur la valeur et les coûts.
              </InfoCard>

              {/* ── Record Keeping ── */}
              <SectionHeading id="record-keeping">Tenue de registres</SectionHeading>

              <SubHeading id="what-to-keep">Que conserver (minimum 6 ans pour les dossiers fiscaux)</SubHeading>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Dossiers des installations</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Permis d'établissement alimentaire (actuel + précédent)</li>
                      <li>Plans d'étage et spécifications d'équipement</li>
                      <li>Journaux de maintenance et d'étalonnage</li>
                      <li>Enregistrements de surveillance de la température</li>
                      <li>Listes de contrôle de nettoyage, dossiers de lutte antiparasitaire</li>
                      <li>Certificats d'inspection de lutte contre les incendies</li>
                      <li>Polices d'assurance, rapports d'inspection</li>
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Dossiers par locataire</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Contrat de location signé</li>
                      <li>Certificat de manutentionnaire d'aliments avec expiration</li>
                      <li>COI avec vérification assurée supplémentaire</li>
                      <li>Enregistrement/licence d'entreprise</li>
                      <li>Documentation d'évaluation des risques</li>
                      <li>Accusé de réception de l'orientation</li>
                      <li>Déclarations d'allergènes, rapports d'incidents</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>

              <SubHeading id="inspection-ready">Rester prêt pour l'inspection</SubHeading>
              <p className="text-gray-600">Les auto-inspections mensuelles utilisant cette liste de contrôle vous permettent de rester prêt :</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-2">
                <li>Permis affiché et visible</li>
                <li>Tous les équipements opérationnels et propres</li>
                <li>La température enregistre le courant et la plage</li>
                <li>Lavabos à mains approvisionnés</li>
                <li>Aliments stockés correctement (couverts, étiquetés, crus en dessous de PAM)</li>
                <li>Aucune preuve de parasite, journaux de nettoyage à jour</li>
                <li>Équipement de sécurité incendie accessible, étiquettes d'inspection à jour</li>
              </ul>

              {/* ── Emergency Protocols ── */}
              <SectionHeading id="emergency-protocols">Protocoles d'urgence</SectionHeading>
              <p className="text-gray-600 mb-4">Élaborez des procédures écrites pour chaque scénario et affichez-les visiblement :</p>
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
              <SectionHeading id="legal-considerations">Considérations juridiques</SectionHeading>

              <SubHeading id="rental-agreement">Les essentiels du contrat de location</SubHeading>
              <p className="text-gray-600 mb-3">
                Demandez à un avocat de réviser votre accord une fois (500 $ à 1 500 $).Modèle :{" "}
                <ExtLink href="https://www.gov.mb.ca/agriculture/food-and-ag-processing/starting-a-food-business/pubs/kitchen-rental-agreement-contract.pdf">Contrat de location de cuisine de Manitoba Agriculture</ExtLink>
              </p>
              <ol className="list-decimal pl-5 text-gray-600 space-y-1 text-sm">
                <li>Conformité à la loi</li>
                <li>Minimums d’assurance + exigence d’assuré supplémentaire</li>
                <li>Maintien des certifications en sécurité alimentaire</li>
                <li>Indemnisation</li>
                <li>Utilisation et entretien du matériel</li>
                <li>Normes de nettoyage avec sanctions financières</li>
                <li>Règles de stockage et d'étiquetage</li>
                <li>Planification et accès</li>
                <li>Frais et paiement</li>
                <li>Clauses de résiliation</li>
              </ol>

              <SubHeading id="escalation-framework">Cadre de remontée d'informations</SubHeading>
              <ResourceTable headers={["Problème", "Étapes d'escalade"]} rows={[["Cuisine laissée sale", "1. Documenter avec photos → 2. Frais de nettoyage → 3. Avertissement écrit → 4. Résiliation"], ["Équipement endommagé", "1. Documenter → 2. Déterminer la cause → 3. Déposer une réclamation via l'assurance locataire → 4. Facturer selon l'accord"], ["Défaut d'assurance", "1. Rappels à 60/30 jours → 2. Suspendre l'accès à l'expiration → 3. Aucune exception"], ["Violation de la salubrité alimentaire", "1. Arrêter l'activité → 2. Documenter → 3. Re-former + avertir → 4. Résilier si grave/répété"]]} />

              {/* ── Compliance Checklist ── */}
              <SectionHeading id="compliance-checklist">Liste de contrôle principale de conformité</SectionHeading>
              <InteractiveChecklist storageKey="kitchen-compliance-checklist" phases={[{
              title: "Avant l'ouverture",
              items: ["Permis d'établissement alimentaire obtenu", "Inspection préalable à l'ouverture réussie", "Assurance RC commerciale (5 M$+ recommandé)", "Système d'extinction d'incendie installé et inspecté", "Inscription à WorkplaceNL (si applicable)", "Modèle de contrat de location révisé par un avocat", "Politique sur les allergènes, protocoles d'urgence et protocoles de nettoyage documentés", "Contrat de lutte antiparasitaire en place", "Profil Local Cooks créé"]
            }, {
              title: "Avant chaque nouveau locataire",
              items: ["Demande examinée", "Évaluation des risques HACCP terminée", "Certificat de manipulateur d'aliments vérifié", "Certificat d'assurance vérifié (limites, couvertures, assuré additionnel)", "Contrat de location signé", "Liste complète des allergènes reçue", "Aucun conflit avec les locataires existants", "Orientation planifiée"]
            }, {
              title: "Mensuel",
              items: ["Entretien selon le calendrier préventif", "Registres de température examinés", "Nettoyage vérifié par sondage", "Dates d'expiration des assurances examinées", "Auto-inspection terminée"]
            }, {
              title: "Semestriel",
              items: ["Inspection du système d'extinction d'incendie", "Nettoyage professionnel de la hotte et de la ventilation", "Examiner tous les certificats d'assurance des locataires"]
            }, {
              title: "Annuel",
              items: ["Renouveler le permis d'établissement alimentaire", "Renouveler toutes les polices d'assurance", "Recueillir les certificats d'assurance mis à jour", "Examiner les conditions du contrat de location", "Entretien complet de l'équipement", "Déclaration WorkplaceNL soumise", "Examiner les tarifs"]
            }]} />

              {/* ── Resources & Links ── */}
              <SectionHeading id="km-resources-links">Ressources et liens</SectionHeading>
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Gouvernement — Terre-Neuve-et-Labrador</h4>
              <ResourceTable headers={["Ressource", "Lien"]} rows={[["Permis d'établissement alimentaire", "gov.nl.ca/gs/licences/env-health/food/"], ["Règlement sur les établissements alimentaires (texte intégral)", "assembly.nl.ca/legislation/sr/regulations/rc961022.htm"], ["Règlement sur les services de protection contre les incendies", "assembly.nl.ca/legislation/sr/regulations/rc120045.htm"], ["Inscription de l'employeur à WorkplaceNL", "workplacenl.ca/employers/register-my-business/"]]} />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Guides des meilleures pratiques de l'industrie</h4>
              <ResourceTable headers={["Ressource", "Lien"]} rows={[["Cuisines partagées — Guide du propriétaire (Ontario, 2025)", "wdgpublichealth.ca (PDF)"], ["Modèle de contrat de location de cuisine (Manitoba)", "gov.mb.ca (PDF)"], ["Trousse de cuisine commerciale : Gérer les risques (Alberta)", "open.alberta.ca"], ["The Food Corridor — Modèles de tarification", "thefoodcorridor.com"]]} />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Assurance</h4>
              <ResourceTable headers={["Fournisseur", "Site Web"]} rows={[["Assurance FLIP (Recommandé pour les locataires)", "fliprogram.com"], ["BFL Canada", "bflcanada.ca"], ["Zensurance", "zensurance.com"], ["Assurance Aligned", "alignedinsurance.com"]]} />

              {/* Disclaimer */}
              <Separator className="mt-16 mb-8" />
              <Alert className="bg-muted/30">
                <Info className="h-4 w-4" />
                <AlertTitle className="text-xs font-semibold">Dernière mise à jour : février 2026</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground leading-relaxed">
                  Ce guide est fourni à titre informatif uniquement et ne constitue pas un conseil juridique, d’assurance ou professionnel.Les réglementations, les frais et les exigences changent – ​​vérifiez toujours les exigences actuelles auprès des sources gouvernementales officielles liées ci-dessus.
                </AlertDescription>
              </Alert>
            </div>
          </main>
        </div>
      </div>

      <Footer />
    </div>;
}