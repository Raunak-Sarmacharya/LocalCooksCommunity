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
  title: "Paysage réglementaire",
  icon: Globe,
  subsections: [{
    id: "three-levels",
    title: "Trois niveaux de réglementation"
  }]
}, {
  id: "food-safety-certification",
  title: "Certification en salubrité alimentaire",
  icon: GraduationCap,
  subsections: [{
    id: "skillspass-nl",
    title: "Gratuit : SkillsPass NL"
  }, {
    id: "paid-alternatives",
    title: "Alternatives payantes"
  }]
}, {
  id: "register-your-business",
  title: "Enregistrez votre entreprise",
  icon: FileText,
  subsections: [{
    id: "business-structure",
    title: "Structure de l'entreprise"
  }, {
    id: "home-based-registration",
    title: "Enregistrement à domicile"
  }, {
    id: "home-food-rules",
    title: "Ce que vous pouvez et ne pouvez pas préparer à la maison"
  }]
}, {
  id: "liability-insurance",
  title: "Assurance responsabilité civile",
  icon: Shield,
  subsections: [{
    id: "coverage-requirements",
    title: "Exigences de couverture"
  }, {
    id: "flip-insurance",
    title: "Assurance FLIP"
  }, {
    id: "additional-insured",
    title: "Assuré additionnel"
  }]
}, {
  id: "food-establishment-licence",
  title: "Permis d'établissement alimentaire",
  icon: BadgeCheck,
  subsections: [{
    id: "commercial-kitchen-users",
    title: "Utilisateurs de cuisines commerciales"
  }, {
    id: "home-kitchen-users",
    title: "Utilisateurs de cuisines à domicile"
  }]
}, {
  id: "federal-requirements",
  title: "Exigences fédérales",
  icon: Scale,
  subsections: [{
    id: "cfia-licence",
    title: "Avez-vous besoin d'une licence de l'ACIA ?"
  }, {
    id: "traceability",
    title: "Meilleures pratiques de traçabilité"
  }]
}, {
  id: "local-cooks-platform",
  title: "Votre parcours via Local Cooks",
  icon: Building2,
  subsections: [{
    id: "apply-and-connect",
    title: "Postulez et connectez-vous"
  }, {
    id: "book-and-operate",
    title: "Réservez et opérez"
  }]
}, {
  id: "home-vs-commercial",
  title: "Cuisine à domicile vs Commerciale",
  icon: Home,
  subsections: []
}, {
  id: "business-tax-essentials",
  title: "L'essentiel pour les affaires et la fiscalité",
  icon: Scale,
  subsections: [{
    id: "gst-hst",
    title: "Inscription à la TPS/TVH"
  }, {
    id: "record-keeping",
    title: "Tenue de registres"
  }, {
    id: "workplace-nl-chef",
    title: "WorkplaceNL"
  }]
}, {
  id: "shared-kitchen-operations",
  title: "Fonctionnement dans une cuisine partagée",
  icon: ClipboardCheck,
  subsections: [{
    id: "clean-in-clean-out",
    title: "Propre à l'arrivée, propre au départ"
  }, {
    id: "allergen-responsibility",
    title: "Responsabilité des allergènes"
  }, {
    id: "storage-protocols",
    title: "Protocoles de stockage"
  }]
}, {
  id: "faq",
  title: "FAQ",
  icon: BookOpen,
  subsections: []
}, {
  id: "launch-checklist",
  title: "Votre liste de contrôle de lancement",
  icon: ClipboardCheck,
  subsections: []
}, {
  id: "resources-links",
  title: "Ressources et liens",
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

export default function ChefResourcesPage_en_fr() {
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
                Guide de ressources du chef
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
              <SectionHeading id="regulatory-landscape">Paysage réglementaire</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Le système alimentaire canadien fonctionne à trois niveaux.Savoir lesquels s’appliquent à votre cas évite des surprises coûteuses.
              </p>
              <SubHeading id="three-levels">Trois niveaux de réglementation</SubHeading>
              <ResourceTable headers={["Niveau", "Régulateur", "Quand cela s'applique"]} rows={[["Fédéral", "Agence canadienne d'inspection des aliments (ACIA)", "Vente au-delà des frontières provinciales, importation ou exportation"], ["Provincial", "Service NL (à Terre-Neuve-et-Labrador)", "Toutes les entreprises alimentaires opérant dans la province"], ["Municipal", "Ville de St. John's (ou votre municipalité)", "Zonage, permis d'exploitation, vente sur les marchés"]]} />
              <InfoCard variant="info">
                <strong>La plupart des entrepreneurs du secteur alimentaire qui démarrent localement n’ont besoin que de la conformité provinciale et municipale.</strong> Les exigences fédérales entrent en vigueur lorsque vous expédiez des produits au-delà des frontières provinciales ou à l'échelle internationale.Chaque province a son propre organisme de réglementation : Service NL à Terre-Neuve-et-Labrador, les unités de santé publique en Ontario et les autorités sanitaires régionales en Colombie-Britannique.Les principes sont universels ;les agences diffèrent.
              </InfoCard>

              {/* ── Food Safety Certification ── */}
              <SectionHeading id="food-safety-certification">Certification de sécurité alimentaire</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Un certificat de manutentionnaire d'aliments prouve que vous comprenez le contrôle de la température, la prévention de la contamination croisée, les protocoles d'hygiène et la manipulation sécuritaire des aliments.
              </p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-3">
                <li><strong>Exigence légale.</strong> Au moins un manutentionnaire d'aliments certifié doit être présent pendant toutes les heures d'ouverture dans tout établissement alimentaire à Terre-Neuve-et-Labrador (<em>Règlement sur les établissements alimentaires</em>, paragraphe 6.1).</li>
                <li><strong>Accès cuisine.</strong> Les cuisines commerciales nécessitent une certification valide avant d’accorder l’accès.</li>
                <li><strong>Crédibilité professionnelle.</strong> Démontre son engagement envers la sécurité alimentaire auprès des clients et des régulateurs.</li>
              </ul>

              <SubHeading id="skillspass-nl">Gratuit : SkillsPass NL</SubHeading>
              <ResourceTable headers={["", ""]} rows={[["Coût", "Gratuit"], ["Fournisseur", "Gouvernement de Terre-Neuve-et-Labrador"], ["Site Web", "skillspassnl.com"], ["Cours", "Salubrité alimentaire : Sensibilisation générale · Préparation alimentaire à domicile · Propriétaire et gestionnaire"], ["Format", "En ligne, environ 30 minutes par module"], ["Certificat", "Téléchargement immédiat après réussite"]]} />
              <p className="text-gray-600">
                <strong>Comment commencer :</strong> Visite{" "}
                <ExtLink href="https://skillspassnl.bluedrop.io">skillspassnl.bluedrop.io</ExtLink>, créez un compte gratuit, complétez les modules pertinents, réussissez l'évaluation et téléchargez votre certificat.Pour les propriétaires d'entreprise, le module « Sécurité alimentaire : propriétaire et gestionnaire » est recommandé : il couvre les responsabilités légales au-delà de l'hygiène de base.
              </p>

              <SubHeading id="paid-alternatives">Alternatives payantes (reconnaissance pancanadienne)</SubHeading>
              <ResourceTable headers={["Fournisseur", "Validité", "Site Web"]} rows={[["ProbeIt Food Safety", "5 ans, reconnu partout au Canada", "probeit.ca"], ["Canadian Food Safety Training", "Vérifier le fournisseur", "foodsafetytraining.ca"]]} />
              <InfoCard variant="tip">
                <strong>Vous déménagez entre les provinces?</strong> Terre-Neuve accepte généralement les certifications valides d'autres provinces (par exemple, FoodSafe Level 1 de la Colombie-Britannique).Vérifiez auprès de votre agent d'hygiène du milieu local avant de vous fier à un certificat provenant d'une autre province.
              </InfoCard>

              {/* ── Register Your Business ── */}
              <SectionHeading id="register-your-business">Enregistrez votre entreprise</SectionHeading>

              <SubHeading id="business-structure">Structure de l'entreprise</SubHeading>
              <ResourceTable headers={["Structure", "Enregistrement", "Responsabilité", "Idéal pour"]} rows={[["Entreprise individuelle", "Aucun enregistrement provincial requis à T.-N.-L. (l'enregistrement d'un nom est recommandé)", "Responsabilité personnelle", "Opérateurs solos, vendeurs de marchés de producteurs"], ["Partenariat", "S'inscrire au registre des sociétés", "Responsabilité personnelle partagée", "Deux partenaires ou plus"], ["Constitution en société", "Déposer auprès du registre des sociétés", "Protection à responsabilité limitée", "Entreprises en croissance, recherche d'investissement"]]} />

              <SubHeading id="home-based-registration">Enregistrement d'une entreprise alimentaire à domicile</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Si vous envisagez d'opérer à partir d'une cuisine familiale, vous devez vous inscrire auprès du service de santé publique environnementale.Téléchargez le formulaire à partir de{" "}
                <ExtLink href="https://www.gov.nl.ca/hcs/files/publichealth-envhealth-home-based-food-industry.pdf">gov.nl.ca</ExtLink>, remplissez toutes les sections et soumettez-les au centre de services gouvernementaux le plus proche.L'inscription est <strong>gratuit</strong> et n'expire pas.
              </p>

              <SubHeading id="home-food-rules">Ce que vous pouvez et ne pouvez pas faire à la maison</SubHeading>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
                <Card className="border shadow-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-success" /> Autorisé (faible risque)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Produits de boulangerie (biscuits, gâteaux, pains, pâtisseries)</li>
                      <li>Confitures, gelées, conserves (correctement acidifiées)</li>
                      <li>Bonbons et confiseries</li>
                      <li>Granola et produits céréaliers</li>
                      <li>Mélanges d'épices et mélanges secs</li>
                    </ul>
                  </CardContent>
                </Card>
                <Card className="border shadow-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" /> Interdit (à haut risque)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Viande crue, poisson, crustacés, volaille</li>
                      <li>Fruits et légumes coupés, jus de fruits frais</li>
                      <li>Produits fermentés (kimchi, kombucha)</li>
                      <li>Pâtisseries à la crème, cheesecakes</li>
                      <li>Aliments en conserve avec un pH ≥ 4,6</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
              <InfoCard variant="warning">
                <strong>Si votre produit entre dans la catégorie interdite, vous avez besoin d’une cuisine commerciale.</strong> Louer un espace de cuisine commerciale entre 20 $ et 50 $/heure est souvent plus pratique que de rénover une cuisine domestique selon les normes commerciales (10 000 $ à plus de 50 000 $).
              </InfoCard>

              {/* ── Liability Insurance ── */}
              <SectionHeading id="liability-insurance">Assurance responsabilité civile</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                L'assurance protège votre entreprise, vos biens personnels et la cuisine dans laquelle vous travaillez. Presque toutes les cuisines commerciales exigent une preuve d'assurance avant d'accorder l'accès.
              </p>

              <SubHeading id="coverage-requirements">Exigences de couverture</SubHeading>
              <ResourceTable headers={["Couverture", "Minimum", "Objectif"]} rows={[["Responsabilité civile générale (RCG)", "2 000 000 $ au total", "Couvre les accidents, blessures, dommages matériels"], ["Responsabilité du fait des produits", "2 000 000 $ au total", "Couvre les intoxications alimentaires, les réclamations pour allergènes"], ["Dommages aux locaux loués", "300 000 $", "Couvre les dommages accidentels causés à la cuisine"], ["Assuré additionnel", "La cuisine nommée sur votre police", "Étend votre couverture à la cuisine"]]} />

              <SubHeading id="flip-insurance">Assurance FLIP (recommandée)</SubHeading>
              <p className="text-gray-600">
                FLIP (Food Liability Insurance Program) se spécialise dans la couverture abordable pour les entreprises alimentaires louant des espaces de cuisine commerciale.Il s’agit de l’option la plus largement utilisée par les locataires de cuisines partagées partout au Canada.
              </p>
              <ResourceTable headers={["", ""]} rows={[["Coût", "À partir d'environ 25,92 $/mois ou 299 $/an"], ["Assurés additionnels", "Gratuit et illimité — ajoutez des cuisines sans frais supplémentaires"], ["Franchise", "Aucune sur les réclamations en responsabilité"], ["Achat", "Instantané en ligne — certificat disponible immédiatement"], ["Ajouts", "Équipement (+8,25 $/mois), cyber-responsabilité (+8,25 $/mois), responsabilité civile complémentaire (à partir de 41,67 $/mois)"], ["Site Web", "fliprogram.com"]]} />

              <SubHeading id="additional-insured">Comprendre les « assurés supplémentaires »</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Lorsque vous ajoutez une cuisine comme assuré supplémentaire sur votre police, la cuisine est couverte par <strong>votre</strong> assurance pour les sinistres découlant de <strong>votre</strong> activités.Il s’agit d’une pratique courante dans l’industrie.
              </p>
              <InfoCard variant="info">
                <strong>Exemple :</strong> Vous préparez à manger dans une cuisine louée.Un client subit une réaction allergique et poursuit vous et la cuisine en justice.Étant donné que la cuisine est désignée comme assuré supplémentaire, votre assureur couvre la défense juridique de la cuisine pour les réclamations liées à vos opérations.
              </InfoCard>

              {/* ── Food Establishment Licence ── */}
              <SectionHeading id="food-establishment-licence">Permis d'établissement alimentaire</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Toute entreprise alimentaire opérant à partir d'une cuisine commerciale doit détenir une licence d'établissement alimentaire de Service NL en vertu du <em>Loi sur les établissements alimentaires</em>.
              </p>

              <SubHeading id="commercial-kitchen-users">Pour les utilisateurs de cuisines commerciales</SubHeading>
              <p className="text-gray-600">Il vous faut :</p>
              <ol className="list-decimal pl-5 text-gray-600 space-y-2 mt-2">
                <li><strong>Demande de licence complétée</strong> — télécharger depuis <ExtLink href="https://www.gov.nl.ca/gs/licences/env-health/food/premises/">gov.nl.ca</ExtLink></li>
                <li><strong>Plan d'étage</strong> de la cuisine (le chef de cuisine le fournit)</li>
                <li><strong>Approbation municipale</strong> le cas échéant — à St. John's, confirmer le zonage avec Planning and Development</li>
                <li><strong>Preuve de formation en sécurité alimentaire</strong> — votre certificat de l'étape 1</li>
                <li><strong>Contrat ou lettre de location</strong> confirmer votre accès à l'établissement agréé</li>
              </ol>
              <ResourceTable headers={["", ""]} rows={[["Temps de traitement", "2 à 8 semaines"], ["Renouvellement", "Annuel — Service NL vous en informera"]]} />
              <InfoCard variant="info">
                <strong>Important:</strong> La propre licence de la cuisine couvre le <em>installation</em>.Si vous opérez en tant qu'entreprise indépendante sous votre propre marque, vous aurez probablement besoin de votre propre licence.Vérifiez auprès de votre responsable local de la santé environnementale.
              </InfoCard>

              <SubHeading id="home-kitchen-users">Pour les utilisateurs de cuisine à domicile</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Votre maison doit répondre aux normes commerciales : équipement de qualité commerciale, ventilation adéquate, réfrigération adéquate, zone de préparation des aliments séparée, évier à deux compartiments, fenêtres grillagées et lutte antiparasitaire.Soumettez un plan d’étage et passez une inspection de santé environnementale.
              </p>

              {/* ── Federal Requirements ── */}
              <SectionHeading id="federal-requirements">Exigences fédérales</SectionHeading>

              <SubHeading id="cfia-licence">Avez-vous besoin d'une licence de l'ACIA?</SubHeading>
              <ResourceTable headers={["Votre activité", "Licence fédérale requise ?"]} rows={[["Vendre uniquement dans votre province", "Non"], ["Servir directement aux consommateurs (restaurant, food truck, restauration)", "Non"], ["Vendre au-delà des frontières provinciales ou territoriales", "Oui"], ["Importer des ingrédients de l'extérieur du Canada", "Oui"], ["Exporter des produits à l'international", "Oui"]]} />
              <p className="text-gray-600 mt-3">
                Si vous avez besoin d'une licence : créez un compte Mon ACIA à{" "}
                <ExtLink href="https://www.inspection.gc.ca/my-cfia">inspection.gc.ca</ExtLink>, élaborez un plan de contrôle préventif (PCP), répondez aux exigences de traçabilité et soumettez votre demande. <strong>Coût : 250 $ pour un permis de 2 ans.</strong>
              </p>

              <SubHeading id="traceability">Bonnes pratiques en matière de traçabilité</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Même si vous n'avez pas besoin d'une licence fédérale, la tenue de registres de traçabilité de base protège votre entreprise :
              </p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-2">
                <li><strong>Un pas en arrière :</strong> Conservez les factures des fournisseurs avec les numéros de lot</li>
                <li><strong>Un pas en avant :</strong> Tenir des registres de ventes pour les transactions interentreprises (les ventes au détail directes aux consommateurs sont exonérées)</li>
              </ul>

              {/* ── Local Cooks Platform ── */}
              <SectionHeading id="local-cooks-platform">Votre chemin à travers les cuisiniers locaux</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Local Cooks met en relation les entrepreneurs du secteur alimentaire avec des cuisines commerciales agréées.Voici comment fonctionne le processus.
              </p>

              <SubHeading id="apply-and-connect">Postuler et se connecter</SubHeading>
              <div className="space-y-4 my-4">
                {[{
                step: "1",
                title: "Créez votre profil et postulez",
                desc: "Parcourez les cuisines commerciales disponibles, postulez aux emplacements qui correspondent à vos besoins et téléchargez votre certificat de manipulateur d'aliments et d'autres documents dans le cadre de la candidature."
              }, {
                step: "2",
                title: "Connectez-vous avec votre gestionnaire de cuisine",
                desc: "Utilisez le système de messagerie intégré de la plateforme pour échanger les documents nécessaires à votre permis d'établissement alimentaire (adresse de la cuisine, plan d'étage, numéro de permis). Fournissez votre certificat d'assurance avec la cuisine désignée comme assuré additionnel."
              }, {
                step: "3",
                title: "Complétez les étapes d'approbation",
                desc: "Le processus d'approbation comprend plusieurs étapes — les gestionnaires vérifient vos documents et qualifications avant d'accorder un accès complet à la réservation."
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

              <SubHeading id="book-and-operate">Réserver et exploiter</SubHeading>
              <p className="text-gray-600 leading-relaxed">Une fois entièrement approuvé :</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-2">
                <li>Réservez des créneaux horaires en cuisine directement via la plateforme</li>
                <li>Ajoutez du stockage et de la location d'équipement à vos réservations selon vos besoins</li>
                <li>Payez en toute sécurité via la plateforme</li>
                <li>Gérez les réservations à venir et passées depuis votre tableau de bord</li>
              </ul>
              <InfoCard variant="tip">
                <strong>Avant votre première séance :</strong> Coordonnez-vous avec votre chef de cuisine pour une orientation en personne.Cela couvre le fonctionnement de l'équipement, les protocoles de nettoyage, les procédures d'urgence, les affectations de stockage et les règles spécifiques aux installations.
              </InfoCard>

              {/* ── Home vs Commercial ── */}
              <SectionHeading id="home-vs-commercial">Cuisine domestique ou cuisine commerciale</SectionHeading>
              <ResourceTable headers={["Facteur", "Cuisine à domicile", "Cuisine commerciale"]} rows={[["Coût de démarrage", "Faible au départ, mais la modernisation est coûteuse", "Paiement à l'utilisation — aucun investissement en capital"], ["Types d'aliments", "Faible risque uniquement (produits de boulangerie, confitures, mélanges secs)", "Tout produit alimentaire, y compris ceux à haut risque"], ["Équipement", "Doit répondre personnellement aux normes commerciales", "Équipement de qualité commerciale fourni"], ["Évolutivité", "Limitée par l'espace et la réglementation", "Flexible — réservez plus d'heures à mesure que vous grandissez"], ["Licences", "Maison inspectée et sous licence séparément", "Cuisine déjà sous licence et inspectée"], ["Réseautage", "Isolé", "Travailler avec d'autres entrepreneurs de l'alimentation"]]} />

              {/* ── Business & Tax ── */}
              <SectionHeading id="business-tax-essentials">Les essentiels des affaires et de la fiscalité</SectionHeading>

              <SubHeading id="gst-hst">Inscription à la TPS/TVH</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Obligatoire</strong> si le revenu annuel dépasse 30 000 $ (seuil des petits fournisseurs)</li>
                <li>Inscrivez-vous via <ExtLink href="https://www.canada.ca/en/revenue-agency.html">Agence du revenu du Canada</ExtLink></li>
                <li>À Terre-Neuve-et-Labrador, le total <strong>Le taux de TVH est de 15 %</strong></li>
              </ul>

              <SubHeading id="record-keeping">Tenue de registres</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                L'Agence du revenu du Canada vous oblige à conserver des dossiers commerciaux pour <strong>6 ans</strong>.Suivez : les achats d'ingrédients, les paiements de location de cuisine, les primes d'assurance, les équipements et fournitures, le chiffre d'affaires par canal et les coûts de transport.
              </p>

              <SubHeading id="workplace-nl-chef">WorkplaceNL (indemnisation des accidents du travail)</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Si vous embauchez ne serait-ce qu'un seul assistant — occasionnel, à temps partiel ou contractuel — vous devez vous inscrire auprès de <strong>Lieu de travailNL</strong>.Taux de cotisation : 1,28 $ par 100 $ de masse salariale pour les services de restauration (NIC 9210).
              </p>

              {/* ── Shared Kitchen Operations ── */}
              <SectionHeading id="shared-kitchen-operations">Opérer dans une cuisine partagée</SectionHeading>

              <SubHeading id="clean-in-clean-out">La règle du nettoyage et du nettoyage</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Arrivée :</strong> Désinfectez votre station avant de commencer.Ne présumez jamais que l'utilisateur précédent l'a laissé parfait.</li>
                <li><strong>Départ :</strong> Quittez la station prête à être inspectée : surfaces nettoyées, éviers propres, sols balayés, équipement rendu.</li>
              </ul>

              <SubHeading id="allergen-responsibility">Responsabilité des allergènes</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li>Ajoutez une mention « Peut contenir des traces de... » sur vos étiquettes</li>
                <li>Divulguer tous les ingrédients et allergènes au chef de cuisine</li>
              </ul>

              <SubHeading id="storage-protocols">Protocoles de stockage</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Étiquetez tout :</strong> Votre nom, nom du produit et date</li>
                <li><strong>La règle des 6 pouces :</strong> Rien sur le sol – utilisez des étagères ou des supports de fardage</li>
                <li><strong>Pas de mélange :</strong> Suivez la hiérarchie de stockage verticale de l'établissement (crus en dessous des prêts à manger)</li>
              </ul>

              {/* ── FAQ ── */}
              <SectionHeading id="faq">Foire aux questions</SectionHeading>
              <Accordion type="single" collapsible className="my-6">
                {[{
                q: "Combien de temps faut-il pour passer de zéro à la première vente légale ?",
                a: "Généralement 4 à 10 semaines : Certificat de manipulateur d'aliments (1 jour), assurance (instantanée), enregistrement de l'entreprise à domicile (1 à 2 semaines), Permis d'établissement alimentaire (2 à 8 semaines)."
              }, {
                q: "Puis-je commencer à vendre avant d'avoir tous les permis ?",
                a: "Non. Toutes les certifications, enregistrements et licences requis doivent être en place avant de vendre légalement des produits alimentaires."
              }, {
                q: "Ai-je besoin d'un permis uniquement pour les marchés de producteurs ?",
                a: "Vous avez besoin au minimum de votre certificat de manipulateur d'aliments et de l'enregistrement de votre entreprise. De nombreux marchés exigent également une preuve de licence et d'assurance. Soumettez les documents aux organisateurs au moins 14 jours avant l'événement (exigence de Service NL)."
              }, {
                q: "Et si je veux m'étendre au-delà de Terre-Neuve ?",
                a: "Vous aurez besoin d'une licence Salubrité des aliments au Canada de l'ACIA (250 $ pour 2 ans) et devrez respecter les exigences fédérales en matière d'étiquetage, de traçabilité et de contrôle préventif."
              }, {
                q: "Puis-je fabriquer certains produits à la maison et d'autres dans une cuisine commerciale ?",
                a: "Oui, mais vous avez besoin d'une licence appropriée pour chaque emplacement. Conservez des registres détaillés de l'endroit où chaque produit est préparé."
              }, {
                q: "Comment ajouter une cuisine comme assuré additionnel ?",
                a: "Via le portail de votre assureur. Avec FLIP, c'est instantané et gratuit — entrez le nom commercial légal et l'adresse de la cuisine, puis générez un certificat d'assurance mis à jour."
              }].map((item, i) => <AccordionItem key={i} value={`faq-${i}`}>
                    <AccordionTrigger className="text-sm font-medium text-left">{item.q}</AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground leading-relaxed">{item.a}</AccordionContent>
                  </AccordionItem>)}
              </Accordion>

              {/* ── Launch Checklist ── */}
              <SectionHeading id="launch-checklist">Votre liste de contrôle de lancement</SectionHeading>
              <InteractiveChecklist storageKey="chef-launch-checklist" phases={[{
              title: "Semaines 1\u20132 : Fondation",
              items: ["Terminer le cours SkillsPass NL de manipulateur d'aliments (gratuit, en ligne)", "Réussir l'examen de certification et télécharger votre certificat", "Rechercher quels aliments vous souhaitez préparer", "Décider : cuisine à domicile ou commerciale", "Consulter le Règlement sur les établissements alimentaires de T.-N.-L."]
            }, {
              title: "Semaines 3\u20134 : Assurance et enregistrement",
              items: ["Obtenir un devis d'assurance responsabilité de FLIP ou d'une alternative", "Acheter une assurance responsabilité minimale de 2 M$", "Télécharger votre certificat d'assurance", "Enregistrer l'entreprise alimentaire à domicile (si applicable)", "Ouvrir un compte bancaire commercial dédié"]
            }, {
              title: "Semaines 5\u20136 : Cuisine et documentation",
              items: ["Parcourir les cuisines commerciales sur Local Cooks", "Postuler aux cuisines qui correspondent à vos besoins", "Communiquer avec les gestionnaires de cuisine via la messagerie", "Échanger les documents (plans d'étage, info de licence, certificat d'assurance)", "Ajouter la cuisine comme assuré additionnel sur votre assurance"]
            }, {
              title: "Semaines 7\u201310 : Lancement",
              items: ["Rassembler tous les documents pour le permis d'établissement alimentaire", "Soumettre la demande à Service NL et payer les frais", "Effectuer une orientation en personne à la cuisine", "Signer votre contrat de location", "Réserver votre première session en cuisine"]
            }]} />

              {/* ── Resources & Links ── */}
              <SectionHeading id="resources-links">Ressources et liens</SectionHeading>
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Gouvernement — Terre-Neuve-et-Labrador</h4>
              <ResourceTable headers={["Ressource", "Lien"]} rows={[["Permis d'établissement alimentaire", "gov.nl.ca/gs/licences/env-health/food/"], ["Règlement sur les établissements alimentaires (texte intégral)", "assembly.nl.ca/legislation/sr/regulations/rc961022.htm"], ["Directives sur l'industrie alimentaire à domicile (PDF)", "gov.nl.ca/hcs/files/publichealth-envhealth-home-based-food-industry.pdf"], ["SkillsPass NL (Formation gratuite)", "skillspassnl.com"], ["WorkplaceNL", "workplacenl.ca"]]} />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Fédéral / Partout au Canada</h4>
              <ResourceTable headers={["Ressource", "Lien"]} rows={[["Trousse de l'ACIA pour les entreprises alimentaires", "inspection.canada.ca/food-safety-industry/toolkit-food-businesses"], ["Allergènes prioritaires de Santé Canada", "canada.ca/fr/sante-canada/services/aliments-nutrition/salubrite-aliments/allergies-intolerances-alimentaires.html"], ["Agence du revenu du Canada (TPS/TVH)", "canada.ca/fr/agence-revenu.html"], ["Liste de contrôle des permis PerLE", "bizpal.ca"]]} />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Assurance</h4>
              <ResourceTable headers={["Fournisseur", "Site Web"]} rows={[["Assurance FLIP (Recommandé)", "fliprogram.com"], ["Zensurance", "zensurance.com"], ["BFL Canada", "bflcanada.ca"]]} />

              {/* Disclaimer */}
              <Separator className="mt-16 mb-8" />
              <Alert className="bg-muted/30">
                <Info className="h-4 w-4" />
                <AlertTitle className="text-xs font-semibold">Dernière mise à jour : février 2026</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground leading-relaxed">
                  Ce guide est fourni à titre informatif uniquement et ne constitue pas un conseil juridique, d’assurance ou professionnel.Les réglementations, les frais et les exigences changent – ​​vérifiez toujours les exigences actuelles auprès des sources gouvernementales officielles liées ci-dessus.Consultez des professionnels qualifiés du droit, des assurances et de la sécurité alimentaire pour obtenir des conseils spécifiques à votre situation.
                </AlertDescription>
              </Alert>
            </div>
          </main>
        </div>
      </div>

      <Footer />
    </div>;
}