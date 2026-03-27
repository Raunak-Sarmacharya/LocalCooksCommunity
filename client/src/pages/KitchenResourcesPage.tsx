import { useState, useCallback } from "react";
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
import {
  ExternalLink, Shield, FileText,
  Scale, ClipboardCheck, BadgeCheck, Flame,
  CheckCircle2, AlertTriangle, Info, ChevronRight,
  Menu, DollarSign, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════
// SECTION DATA
// ═══════════════════════════════════════════════════════════════

interface Section {
  id: string;
  title: string;
  icon: React.ElementType;
  subsections?: { id: string; title: string }[];
}

const SECTIONS: Section[] = [
  {
    id: "legal-foundation",
    title: "Your Legal Foundation",
    icon: Scale,
    subsections: [
      { id: "food-establishment-licence", title: "Food Establishment Licence" },
      { id: "inspection-system", title: "Inspection System" },
      { id: "workplace-nl", title: "WorkplaceNL" },
      { id: "fire-safety", title: "Fire Safety" },
      { id: "federal-considerations", title: "Federal Considerations" },
    ],
  },
  {
    id: "insurance",
    title: "Insurance",
    icon: Shield,
    subsections: [
      { id: "your-insurance-portfolio", title: "Your Portfolio" },
      { id: "renter-insurance", title: "Renter Insurance Requirements" },
      { id: "verifying-coi", title: "Verifying COIs" },
    ],
  },
  {
    id: "risk-assessment",
    title: "Risk Assessment",
    icon: AlertCircle,
    subsections: [
      { id: "haccp-assessment", title: "HACCP-Based Assessment" },
      { id: "pre-rental-screening", title: "Pre-Rental Screening" },
    ],
  },
  {
    id: "onboarding-chefs",
    title: "Onboarding Chefs",
    icon: ClipboardCheck,
    subsections: [
      { id: "application-review", title: "Application Review" },
      { id: "info-exchange", title: "Information Exchange" },
      { id: "document-verification", title: "Document Verification" },
      { id: "orientation", title: "In-Person Orientation" },
    ],
  },
  {
    id: "operational-excellence",
    title: "Operational Excellence",
    icon: BadgeCheck,
    subsections: [
      { id: "facility-standards", title: "Facility Standards" },
      { id: "allergen-management", title: "Allergen Management" },
      { id: "cleaning-sanitation", title: "Cleaning &amp; Sanitation" },
      { id: "preventive-maintenance", title: "Preventive Maintenance" },
    ],
  },
  {
    id: "revenue-pricing",
    title: "Revenue &amp; Pricing",
    icon: DollarSign,
    subsections: [
      { id: "pricing-models", title: "Pricing Models" },
      { id: "revenue-streams", title: "Revenue Streams" },
      { id: "setting-rates", title: "Setting Your Rates" },
    ],
  },
  {
    id: "record-keeping",
    title: "Record Keeping",
    icon: FileText,
    subsections: [
      { id: "what-to-keep", title: "What to Keep" },
      { id: "inspection-ready", title: "Staying Inspection-Ready" },
    ],
  },
  {
    id: "emergency-protocols",
    title: "Emergency Protocols",
    icon: Flame,
    subsections: [],
  },
  {
    id: "legal-considerations",
    title: "Legal Considerations",
    icon: Scale,
    subsections: [
      { id: "rental-agreement", title: "Rental Agreement Essentials" },
      { id: "escalation-framework", title: "Escalation Framework" },
    ],
  },
  {
    id: "compliance-checklist",
    title: "Master Compliance Checklist",
    icon: ClipboardCheck,
    subsections: [],
  },
  {
    id: "km-resources-links",
    title: "Resources &amp; Links",
    icon: ExternalLink,
    subsections: [],
  },
];

// ═══════════════════════════════════════════════════════════════
// REUSABLE UI COMPONENTS (same pattern as ChefResourcesPage)
// ═══════════════════════════════════════════════════════════════

function InfoCard({ children, variant = "info" }: { children: React.ReactNode; variant?: "info" | "warning" | "tip" }) {
  const styles = {
    info: "bg-blue-50 border-blue-200 text-blue-900 [&>svg]:text-blue-500",
    warning: "bg-amber-50 border-amber-200 text-amber-900 [&>svg]:text-amber-500",
    tip: "bg-emerald-50 border-emerald-200 text-emerald-900 [&>svg]:text-emerald-500",
  };
  const icons = {
    info: Info,
    warning: AlertTriangle,
    tip: CheckCircle2,
  };
  const Icon = icons[variant];
  return (
    <Alert className={cn("my-6", styles[variant])}>
      <Icon className="h-5 w-5" />
      <AlertDescription className="text-sm leading-relaxed">
        {children}
      </AlertDescription>
    </Alert>
  );
}

function ResourceTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const makeLink = (text: string) => {
    const urlWithPath = text.match(/^(https?:\/\/|www\.)[^\s]+/i);
    if (urlWithPath) {
      const fullUrl = urlWithPath[0].startsWith('http') ? urlWithPath[0] : `https://${urlWithPath[0]}`;
      return (
        <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
          {text}
          <ExternalLink className="h-3 w-3" />
        </a>
      );
    }
    const domainOnly = text.match(/^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z]{2,})+$/i);
    if (domainOnly) {
      return (
        <a href={`https://${text}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
          {text}
          <ExternalLink className="h-3 w-3" />
        </a>
      );
    }
    return text;
  };
  return (
    <Card className="my-6 overflow-hidden border not-prose">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/60 border-b">
              {headers.map((h, i) => (
                <th key={i} className="text-left px-4 py-3 font-semibold text-foreground text-xs uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-muted/30 transition-colors">
                {row.map((cell, ci) => (
                  <td key={ci} className={cn("px-4 py-3 text-muted-foreground", ci === 0 && "font-medium text-foreground whitespace-nowrap")}>{makeLink(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="mt-16 mb-6">
      <h2 id={id} className="text-2xl font-bold scroll-mt-24 flex items-center gap-3 pb-3">
        {children}
      </h2>
      <Separator />
    </div>
  );
}

function SubHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-lg font-semibold mt-10 mb-4 scroll-mt-24">
      {children}
    </h3>
  );
}

function InteractiveChecklist({ storageKey, phases }: { storageKey: string; phases: { title: string; items: string[] }[] }) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  const toggle = useCallback((key: string) => {
    setChecked((prev) => {
      const next = { ...prev, [key]: !prev[key] };
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
  const overallPercent = totalItems > 0 ? Math.round((totalChecked / totalItems) * 100) : 0;

  return (
    <div className="space-y-6 my-6">
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Progress</span>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-primary">{totalChecked}/{totalItems} complete</span>
              {totalChecked > 0 && (
                <button onClick={resetAll} className="text-xs text-muted-foreground hover:text-destructive transition-colors underline">
                  Reset
                </button>
              )}
            </div>
          </div>
          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-500 ease-out", overallPercent === 100 ? "bg-emerald-500" : "bg-primary")}
              style={{ width: `${overallPercent}%` }}
            />
          </div>
          {overallPercent === 100 && (
            <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> All done — you&apos;re fully compliant!
            </p>
          )}
        </CardContent>
      </Card>
      {phases.map((phase, pi) => {
        const phaseChecked = phase.items.filter((_, ii) => checked[`${pi}-${ii}`]).length;
        const phasePercent = phase.items.length > 0 ? Math.round((phaseChecked / phase.items.length) * 100) : 0;
        return (
          <Card key={pi}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{phase.title}</CardTitle>
                <span className={cn("text-xs font-medium", phasePercent === 100 ? "text-emerald-600" : "text-muted-foreground")}>
                  {phaseChecked}/{phase.items.length}
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                <div
                  className={cn("h-full rounded-full transition-all duration-500 ease-out", phasePercent === 100 ? "bg-emerald-500" : "bg-primary/60")}
                  style={{ width: `${phasePercent}%` }}
                />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-1">
                {phase.items.map((item, ii) => {
                  const key = `${pi}-${ii}`;
                  const isChecked = !!checked[key];
                  return (
                    <li
                      key={ii}
                      onClick={() => toggle(key)}
                      className={cn(
                        "flex items-start gap-2.5 text-sm p-2 rounded-md cursor-pointer transition-colors select-none",
                        isChecked ? "text-muted-foreground/60 line-through" : "text-foreground hover:bg-muted/50"
                      )}
                    >
                      <Checkbox checked={isChecked} className="mt-0.5 pointer-events-none" tabIndex={-1} />
                      <span>{item}</span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR NAVIGATION — Clean docs-style, collapsible sections
// ═══════════════════════════════════════════════════════════════

function SidebarNav({ onNavigate, onItemClick }: { onNavigate: (id: string) => void; onItemClick?: () => void }) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const navigateAndClose = (id: string) => {
    onNavigate(id);
    onItemClick?.();
  };

  return (
    <nav className="space-y-1">
      {SECTIONS.map((section) => {
        const hasSubs = section.subsections && section.subsections.length > 0;
        const isExpanded = expandedSections.has(section.id);

        return (
          <div key={section.id}>
            {hasSubs ? (
              <button
                onClick={() => toggleSection(section.id)}
                className="group w-full text-left flex items-center justify-between px-2.5 py-2 rounded-md text-[13px] font-semibold text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <span className="truncate">{section.title}</span>
                <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform duration-200", isExpanded && "rotate-90")} />
              </button>
            ) : (
              <button
                onClick={() => navigateAndClose(section.id)}
                className="group w-full text-left flex items-center px-2.5 py-2 rounded-md text-[13px] font-medium text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <span className="truncate">{section.title}</span>
              </button>
            )}
            {isExpanded && hasSubs && (
              <div className="ml-3 border-l-2 border-border/60 pl-3 py-1 space-y-0.5">
                {section.subsections!.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => navigateAndClose(sub.id)}
                    className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    {sub.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════
// MOBILE NAV — Sheet drawer from left
// ═══════════════════════════════════════════════════════════════

function MobileNav({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden sticky top-16 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
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
              <SheetTitle className="text-sm font-semibold">On this page</SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-60px)]">
              <div className="p-3">
                <SidebarNav onNavigate={onNavigate} onItemClick={() => setOpen(false)} />
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function KitchenResourcesPage() {
  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
      });
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEOHead
        title="Kitchen Manager Resources — Operating a Shared Commercial Kitchen in Canada"
        description="Complete guide to licensing, insurance, risk assessment, operations, and pricing for shared commercial kitchens in Newfoundland & Labrador and across Canada."
        canonicalUrl="/resources"
        keywords={[
          "commercial kitchen management", "shared kitchen operations", "kitchen rental business",
          "food establishment licence NL", "commercial kitchen insurance", "kitchen manager guide",
          "HACCP shared kitchen", "commercial kitchen pricing", "kitchen rental agreement",
        ]}
        faq={[
          { question: "What licence do I need to operate a shared commercial kitchen in Newfoundland?", answer: "You need a Food Establishment Licence from the Department of Health and Community Services. For shared kitchen operations, you'll also need a HACCP-based food safety plan and must meet specific requirements for kitchen design, equipment, and sanitation." },
          { question: "How much liability insurance do I need for my shared kitchen?", answer: "LocalCooks requires minimum $2 million liability coverage. It's recommended to have commercial general liability (CGL) insurance that covers food service operations, equipment damage, and tenant injuries." },
          { question: "What should I include in a kitchen rental agreement?", answer: "A comprehensive agreement should cover: hourly/daily rates, security deposits, equipment usage rules, cleaning responsibilities, insurance requirements, cancellation policies, and liability provisions. LocalCooks provides standard agreement templates." },
          { question: "How do I set pricing for my commercial kitchen?", answer: "Consider your costs (rent, utilities, equipment depreciation), market rates in your area, and target occupancy. Most shared kitchens charge $25-75/hour depending on amenities, location, and included equipment. LocalCooks provides pricing analytics to help optimize rates." },
          { question: "What are the key operational requirements for a shared kitchen?", answer: "Key requirements include: proper food safety certifications, HACCP plan implementation, regular equipment maintenance, cleaning schedules, waste management, pest control, and proper record-keeping for all chef bookings and food preparation activities." },
        ]}
        siteNavigation={[
          { name: "List Your Kitchen", description: "Monetize your commercial kitchen space — list in minutes", url: "https://kitchen.localcooks.ca/manager/setup" },
          { name: "Kitchen Manager Resources", description: "Complete guide to operating a shared commercial kitchen in Canada", url: "https://kitchen.localcooks.ca/resources" },
          { name: "Terms", description: "Terms of service for kitchen managers", url: "https://kitchen.localcooks.ca/terms" },
          { name: "Privacy", description: "Privacy policy", url: "https://kitchen.localcooks.ca/privacy" },
        ]}
      />
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
                <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-3 px-2">On this page</p>
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
                Kitchen Manager Guide
              </Badge>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3 leading-tight">
                The Complete Guide to Operating a{" "}
                <span className="text-[#F51042]">Shared Commercial Kitchen</span>
              </h1>
              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl mb-4">
                Currently serving Newfoundland &amp; Labrador — built to scale across Canada. Licensing, insurance, risk assessment, operations, and pricing for facility stewards.
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {[
                  { icon: CheckCircle2, text: "Updated February 2026" },
                  { icon: ClipboardCheck, text: "15-minute read" },
                ].map((item, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <item.icon className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                    {item.text}
                  </span>
                ))}
              </div>
              <Separator className="mt-8" />
            </div>

            <div className="prose-sm sm:prose prose-gray max-w-none prose-table:my-0 prose-thead:border-0 prose-tr:border-0 prose-th:p-0 prose-td:p-0">

              {/* ── Legal Foundation ── */}
              <SectionHeading id="legal-foundation">Your Legal Foundation</SectionHeading>

              <SubHeading id="food-establishment-licence">Food Establishment Licence (Service NL)</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Every commercial kitchen that produces, prepares, stores, or sells food in Newfoundland and Labrador must hold a valid <strong>Food Establishment Licence</strong> issued by Service NL under the <em>Food Premises Act</em>.
              </p>
              <ol className="list-decimal pl-5 text-gray-600 space-y-2 mt-3">
                <li>Complete the licence application from <ExtLink href="https://www.gov.nl.ca/gs/licences/env-health/food/">gov.nl.ca</ExtLink></li>
                <li>Submit a detailed floor plan showing all equipment, sanitary facilities, storage, ventilation, and entry/exit points</li>
                <li>Obtain municipal zoning approval — in St. John&apos;s, contact Planning and Development</li>
                <li>Provide proof of food safety training — at least one certified handler must be present during every hour of operation (<em>Food Premises Regulations</em>, Section 6.1)</li>
              </ol>

              <SubHeading id="inspection-system">The NL Inspection System</SubHeading>
              <ResourceTable
                headers={["Risk Level", "Frequency", "Typical Activities"]}
                rows={[
                  ["High Risk", "4 times per year", "Raw meat/seafood, large-volume catering, multi-user kitchens"],
                  ["Medium Risk", "2 times per year", "Bakeries, moderate food prep, limited menu"],
                  ["Low Risk", "Once every 2 years", "Pre-packaged food, low-risk dry goods only"],
                ]}
              />
              <p className="text-gray-600">
                Inspectors issue <strong>critical items</strong> (must be corrected immediately) and <strong>non-critical items</strong> (compliance period given). All reports are publicly accessible for two years.
              </p>
              <InfoCard variant="tip">
                <strong>Pro tip for shared kitchens:</strong> In many Canadian jurisdictions, a Public Health inspection may be required for <em>each individual renter</em> — the kitchen&apos;s own inspection does not automatically cover all businesses operating within it.
              </InfoCard>

              <SubHeading id="workplace-nl">WorkplaceNL Registration</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                If your kitchen is <strong>incorporated</strong>, you must register with WorkplaceNL regardless of employee count. Sole proprietorships must register the moment they hire any worker.
              </p>
              <ResourceTable
                headers={["NIC Code", "Industry", "2025 Rate"]}
                rows={[
                  ["9210", "Food Services", "$1.28 per $100 of payroll"],
                  ["9211", "Restaurants, Licensed", "$1.28 per $100 of payroll"],
                  ["9221", "Caterers", "$1.28 per $100 of payroll"],
                ]}
              />
              <InfoCard variant="info">
                If your renters are independent businesses (not your employees), they are responsible for their own WorkplaceNL coverage. However, confirm this with WorkplaceNL if the relationship could be interpreted as employer-worker.
              </InfoCard>

              <SubHeading id="fire-safety">Fire Safety &amp; Suppression Systems</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-3">
                <li>Any kitchen using grease-producing equipment must have an <strong>automatic fire suppression system</strong> (NFPA 96)</li>
                <li><strong>UL-300 compliant</strong> wet chemical systems are the Canadian standard</li>
                <li>Semi-annual inspection by certified provider is mandatory</li>
                <li><strong>Class &ldquo;K&rdquo; portable fire extinguishers</strong> must be present</li>
              </ul>

              <SubHeading id="federal-considerations">Federal Considerations</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                If any renter trades inter-provincially, or if your facility performs processing on their behalf, you may fall under the <strong>Safe Food for Canadians Regulations (SFCR)</strong>. The CFIA recognizes shared-use facilities as critical supply chain nodes.
              </p>

              {/* ── Insurance ── */}
              <SectionHeading id="insurance">Insurance</SectionHeading>

              <SubHeading id="your-insurance-portfolio">Your Insurance Portfolio</SubHeading>
              <ResourceTable
                headers={["Coverage", "Details"]}
                rows={[
                  ["Commercial General Liability", "$5,000,000+ aggregate recommended for multi-user facility"],
                  ["Property Insurance", "Building, equipment, inventory — at replacement cost with business interruption"],
                  ["Equipment Breakdown", "Protects against mechanical/electrical failure of critical assets"],
                  ["Umbrella/Excess Liability", "Adds $2–5M above CGL for catastrophic claims"],
                  ["Cyber Liability", "Covers data breaches if handling digital bookings/payment data"],
                ]}
              />

              <SubHeading id="renter-insurance">Renter Insurance Requirements</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Every renter must carry their own CGL and name your kitchen as <strong>Additional Insured</strong>. This is the single most important risk-transfer mechanism.
              </p>
              <ResourceTable
                headers={["Coverage Type", "Minimum", "Why"]}
                rows={[
                  ["Commercial General Liability", "$2,000,000 aggregate", "Industry standard for food businesses in Canada"],
                  ["Product Liability", "$2,000,000 aggregate", "Covers food poisoning, undeclared allergens"],
                  ["Damage to Premises Rented", "$300,000", "Covers accidental fire or water damage"],
                  ["Additional Insured", "Your kitchen named", "Extends renter coverage to you"],
                ]}
              />

              <SubHeading id="verifying-coi">Verifying Certificates of Insurance</SubHeading>
              <ol className="list-decimal pl-5 text-gray-600 space-y-1 mt-3">
                <li>Your kitchen&apos;s exact legal name and address must appear as Certificate Holder</li>
                <li>Effective and expiry dates must cover the full rental period</li>
                <li>Coverage limits must meet or exceed your minimums</li>
                <li>Product Liability and Damage to Premises Rented both listed</li>
                <li>Insurer must be licensed and legitimate</li>
              </ol>
              <InfoCard variant="warning">
                <strong>Best practice:</strong> Set calendar reminders 60 and 30 days before each policy expires. Suspend booking access immediately if no renewal is received. No exceptions.
              </InfoCard>

              {/* ── Risk Assessment ── */}
              <SectionHeading id="risk-assessment">Risk Assessment</SectionHeading>

              <SubHeading id="haccp-assessment">HACCP-Based Risk Assessment</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Assess every applicant across four hazard categories:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
                {[
                  { title: "Biological Risks", desc: "Raw meat, poultry, seafood, dairy. Cross-contamination potential with existing renters.", critical: false },
                  { title: "Chemical Risks", desc: "Processing chemicals must be locked, labelled, separated from food areas.", critical: false },
                  { title: "Physical Risks", desc: "Glass packaging, sharp equipment, hazards for other users.", critical: false },
                  { title: "Allergen Risks (Critical)", desc: "Highest-stakes risk. No renter should make \u201Callergen-free\u201D claims in a shared kitchen.", critical: true },
                ].map((risk) => (
                  <Card key={risk.title} className={risk.critical ? "border-red-200 bg-red-50/50" : ""}>
                    <CardHeader className="pb-2">
                      <CardTitle className={cn("text-base", risk.critical ? "text-red-800" : "")}>
                        {risk.critical && <Badge variant="destructive" className="mr-2 text-[10px]">Critical</Badge>}
                        {risk.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className={cn("text-sm", risk.critical ? "text-red-700" : "text-muted-foreground")}>{risk.desc}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <p className="text-gray-600 text-sm">
                <strong>Priority allergens in Canada (Health Canada):</strong> Peanuts, tree nuts, milk, eggs, wheat/triticale, soy, sesame, mustard, crustaceans, molluscs, fish, and sulphites.
              </p>

              <SubHeading id="pre-rental-screening">Pre-Rental Screening Checklist</SubHeading>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
                <Card className="border-red-200 bg-red-50/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-red-800 flex items-center gap-2">
                      <Badge variant="destructive" className="text-[10px]">Required</Badge>
                      Tier 1: Non-Negotiable
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Valid Food Handler Certificate</li>
                      <li>Certificate of Insurance ($2M CGL, additional insured)</li>
                      <li>Signed rental agreement</li>
                      <li>Completed risk assessment</li>
                    </ul>
                  </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-amber-800">Tier 2: Before Operations</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Business registration or licence</li>
                      <li>Food Establishment Licence (or proof of application)</li>
                      <li>Emergency contact info</li>
                      <li>Full ingredient/allergen declarations</li>
                      <li>Orientation completion acknowledgment</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>

              {/* ── Onboarding ── */}
              <SectionHeading id="onboarding-chefs">Onboarding Chefs</SectionHeading>

              <SubHeading id="application-review">Step 1: Application Review (Days 1–3)</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li>Review profile: food type, production volume, schedule needs, experience level</li>
                <li>Confirm Food Handler Certificate is uploaded and current</li>
                <li>Quick compatibility check: allergens, equipment needs, storage conflicts</li>
                <li><strong>Respond promptly</strong> — fast response times attract quality renters</li>
              </ul>

              <SubHeading id="info-exchange">Step 2: Information Exchange (Days 3–10)</SubHeading>
              <p className="text-gray-600 mb-3">Use the platform&apos;s messaging system to exchange:</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">You Provide</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Legal business name and address</li>
                      <li>Food Establishment Licence number</li>
                      <li>Floor plan, equipment list</li>
                      <li>Kitchen rules, hours, pricing</li>
                      <li>Insurance requirements</li>
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">You Request</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>COI with your kitchen as additional insured</li>
                      <li>Business registration details</li>
                      <li>Food Establishment Licence (or proof)</li>
                      <li>Full ingredient and allergen list</li>
                      <li>Emergency contact info</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>

              <SubHeading id="document-verification">Step 3: Document Verification (Days 10–14)</SubHeading>
              <p className="text-gray-600">Do not schedule orientation or kitchen time until every document is verified.</p>

              <SubHeading id="orientation">Step 4: In-Person Orientation (1.5–2 Hours)</SubHeading>
              <p className="text-gray-600 mb-3">Every renter, regardless of experience, goes through orientation covering:</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Facility tour:</strong> All areas, emergency exits, fire extinguishers, storage assignments</li>
                <li><strong>Equipment training:</strong> Have the renter demonstrate back to you — verify understanding</li>
                <li><strong>Cleaning protocols:</strong> Standards, sanitizing solutions, consequences for non-compliance</li>
                <li><strong>Safety procedures:</strong> Fire, first aid, spills, emergency contacts</li>
                <li><strong>Administrative:</strong> Booking/payment procedures, communication expectations, repair reporting</li>
              </ul>

              {/* ── Operational Excellence ── */}
              <SectionHeading id="operational-excellence">Operational Excellence</SectionHeading>

              <SubHeading id="facility-standards">Facility Standards</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li>Refrigeration at 4°C or below, freezers at -18°C or below, hot holding at 60°C or above</li>
                <li>Temperature logs maintained and available for inspection</li>
                <li>Dedicated storage per renter — all items labelled (name, date, contents)</li>
                <li>Raw foods below ready-to-eat foods — always. FIFO rotation</li>
                <li>Hand washing basins in every prep area with soap and single-service towels</li>
              </ul>

              <SubHeading id="allergen-management">Allergen Management Program</SubHeading>
              <ol className="list-decimal pl-5 text-gray-600 space-y-2 mt-3">
                <li><strong>Disclosure:</strong> Full ingredient list with allergens before first use</li>
                <li><strong>No allergen-free claims:</strong> Labels must state shared facility processes relevant allergens</li>
                <li><strong>Scheduling by risk:</strong> Allergen-free production first, allergenic last or after sanitation</li>
                <li><strong>Storage separation:</strong> Colour-coded labels (e.g., red for nuts, blue for dairy)</li>
                <li><strong>Cleaning verification:</strong> Hot soapy water removes allergen proteins; sanitizer alone does not</li>
                <li><strong>Communication:</strong> Shared allergen register visible to all renters</li>
              </ol>

              <SubHeading id="cleaning-sanitation">Cleaning &amp; Sanitation Standards</SubHeading>
              <ResourceTable
                headers={["Solution", "Concentration", "Notes"]}
                rows={[
                  ["Chlorine (bleach)", "100 ppm (½ tsp per litre)", "Loses effectiveness after 3 hours"],
                  ["Quaternary Ammonium", "200 ppm", "Follow manufacturer directions"],
                  ["Iodine", "25 ppm", "Less common; verify with test strips"],
                ]}
              />

              <SubHeading id="preventive-maintenance">Preventive Maintenance</SubHeading>
              <ResourceTable
                headers={["Frequency", "Tasks"]}
                rows={[
                  ["Daily", "Check oil levels, wipe cook lines, verify fridge temps, empty grease traps"],
                  ["Weekly", "Clean condenser coils, inspect fryers, check hoods/filters, test safety shutoffs"],
                  ["Monthly", "Calibrate thermostats, inspect plumbing/electrical, audit storage areas"],
                  ["Semi-Annual", "Fire suppression inspection (mandatory), hood/duct cleaning"],
                  ["Annual", "Full equipment service, gas line testing, pest control assessment"],
                ]}
              />

              {/* ── Revenue & Pricing ── */}
              <SectionHeading id="revenue-pricing">Revenue &amp; Pricing Strategy</SectionHeading>

              <SubHeading id="pricing-models">Pricing Models</SubHeading>
              <p className="text-gray-600 mb-3">From the 2023 Shared Kitchen Operator Survey (The Food Corridor):</p>
              <ResourceTable
                headers={["Model", "Industry Data"]}
                rows={[
                  ["Hourly Rates", "$15–$45/hour national range. 42% charge $20–$29/hour."],
                  ["Monthly Memberships", "54% of operators offer prepaid plans. Provides predictable revenue."],
                  ["Pay-As-You-Go", "39% offer this. Best for seasonal/one-time users. Higher per-hour rate."],
                ]}
              />
              <InfoCard variant="tip">
                <strong>Best practice:</strong> Offer a combination — monthly plans for committed renters and pay-as-you-go for casual users. 45% of operators offer two or more billing options.
              </InfoCard>

              <SubHeading id="revenue-streams">Revenue Streams Beyond Kitchen Time</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Storage rentals:</strong> $10–$50 per shelf/unit. Often higher demand than kitchen time.</li>
                <li><strong>Equipment surcharges:</strong> +$5–$10/hour for specialized equipment.</li>
                <li><strong>Special events:</strong> Premium pricing for pop-ups, cooking classes ($50/hr or $500 flat daily).</li>
                <li><strong>Peak/off-peak pricing:</strong> 28% of kitchens use variable rates by time of day.</li>
              </ul>

              <SubHeading id="setting-rates">Setting Your Rates</SubHeading>
              <ol className="list-decimal pl-5 text-gray-600 space-y-1 mt-3">
                <li>Fixed costs: mortgage/rent, insurance, staff, platform fees</li>
                <li>Variable costs: utilities, maintenance, cleaning supplies, pest control</li>
                <li>Market rates: research comparable kitchens in your area</li>
                <li>Your unique value: specialized equipment, storage, location</li>
                <li>Target utilization: realistic booking hours per day/week</li>
              </ol>
              <InfoCard variant="info">
                <strong>Industry advice:</strong> Resist being the cheapest option. Low pricing creates perceptions of lower quality and attracts less serious renters. Price based on value and costs.
              </InfoCard>

              {/* ── Record Keeping ── */}
              <SectionHeading id="record-keeping">Record Keeping</SectionHeading>

              <SubHeading id="what-to-keep">What to Keep (minimum 6 years for tax records)</SubHeading>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Facility Records</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Food Establishment Licence (current + previous)</li>
                      <li>Floor plans and equipment specs</li>
                      <li>Maintenance and calibration logs</li>
                      <li>Temperature monitoring records</li>
                      <li>Cleaning checklists, pest control records</li>
                      <li>Fire suppression inspection certificates</li>
                      <li>Insurance policies, inspection reports</li>
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Per-Renter Records</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>Signed rental agreement</li>
                      <li>Food Handler Certificate with expiry</li>
                      <li>COI with additional insured verification</li>
                      <li>Business registration/licence</li>
                      <li>Risk assessment documentation</li>
                      <li>Orientation acknowledgment</li>
                      <li>Allergen declarations, incident reports</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>

              <SubHeading id="inspection-ready">Staying Inspection-Ready</SubHeading>
              <p className="text-gray-600">Monthly self-inspections using this checklist keep you prepared:</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-2">
                <li>Licence posted and visible</li>
                <li>All equipment operational and clean</li>
                <li>Temperature logs current and in range</li>
                <li>Handwash basins stocked</li>
                <li>Food stored properly (covered, labelled, raw below RTE)</li>
                <li>No pest evidence, cleaning logs up to date</li>
                <li>Fire safety equipment accessible, inspection tags current</li>
              </ul>

              {/* ── Emergency Protocols ── */}
              <SectionHeading id="emergency-protocols">Emergency Protocols</SectionHeading>
              <p className="text-gray-600 mb-4">Develop written procedures for each scenario and post them visibly:</p>
              <Accordion type="single" collapsible className="my-6">
                {[
                  { title: "Power Outage", items: ["Do not open refrigerators/freezers unnecessarily", "Food in closed fridge stays safe ~4 hours; full freezer ~48 hours", "Contact Environmental Health if outage exceeds safe limits", "Document everything"] },
                  { title: "Water Supply Disruption", items: ["Cease food preparation immediately", "Notify all booked renters", "Contact utility and Environmental Health"] },
                  { title: "Fire", items: ["Evacuate immediately, call 911", "Suppression system activates automatically", "Do not re-enter until cleared by fire department", "Document, contact insurance, notify Service NL"] },
                  { title: "Foodborne Illness Complaint", items: ["Document thoroughly", "Identify the renter responsible", "Notify Environmental Health immediately", "Preserve remaining food samples"] },
                  { title: "Equipment Failure", items: ["Remove from service immediately", "If refrigeration fails, monitor temps and relocate food", "Contact service provider, document with photos", "Notify affected renters"] },
                ].map((protocol, i) => (
                  <AccordionItem key={i} value={`protocol-${i}`}>
                    <AccordionTrigger className="text-sm font-semibold text-left">{protocol.title}</AccordionTrigger>
                    <AccordionContent>
                      <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-0.5">
                        {protocol.items.map((item, j) => <li key={j}>{item}</li>)}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>

              {/* ── Legal Considerations ── */}
              <SectionHeading id="legal-considerations">Legal Considerations</SectionHeading>

              <SubHeading id="rental-agreement">Rental Agreement Essentials</SubHeading>
              <p className="text-gray-600 mb-3">
                Have a lawyer review your agreement once ($500–$1,500). Template:{" "}
                <ExtLink href="https://www.gov.mb.ca/agriculture/food-and-ag-processing/starting-a-food-business/pubs/kitchen-rental-agreement-contract.pdf">Manitoba Agriculture Kitchen Rental Agreement</ExtLink>
              </p>
              <ol className="list-decimal pl-5 text-gray-600 space-y-1 text-sm">
                <li>Compliance with law</li>
                <li>Insurance minimums + additional insured requirement</li>
                <li>Food safety certification maintenance</li>
                <li>Indemnification</li>
                <li>Equipment use and care</li>
                <li>Cleaning standards with financial penalties</li>
                <li>Storage and labelling rules</li>
                <li>Scheduling and access</li>
                <li>Fees and payment</li>
                <li>Termination clauses</li>
              </ol>

              <SubHeading id="escalation-framework">Escalation Framework</SubHeading>
              <ResourceTable
                headers={["Issue", "Escalation Steps"]}
                rows={[
                  ["Kitchen left unclean", "1. Document with photos → 2. Cleaning fee → 3. Written warning → 4. Termination"],
                  ["Equipment damaged", "1. Document → 2. Determine cause → 3. File claim against renter coverage → 4. Charge per agreement"],
                  ["Insurance lapse", "1. Reminders at 60/30 days → 2. Suspend access on expiry → 3. No exceptions"],
                  ["Food safety violation", "1. Stop activity → 2. Document → 3. Retrain + warn → 4. Terminate if serious/repeated"],
                ]}
              />

              {/* ── Compliance Checklist ── */}
              <SectionHeading id="compliance-checklist">Master Compliance Checklist</SectionHeading>
              <InteractiveChecklist
                storageKey="kitchen-compliance-checklist"
                phases={[
                  { title: "Before Opening", items: ["Food Establishment Licence obtained", "Pre-opening inspection passed", "CGL insurance ($5M+ recommended)", "Fire suppression installed and inspected", "WorkplaceNL registered (if applicable)", "Rental agreement template lawyer-reviewed", "Allergen policy, emergency protocols, cleaning protocols documented", "Pest control contract in place", "Local Cooks profile created"] },
                  { title: "Before Each New Renter", items: ["Application reviewed", "HACCP risk assessment completed", "Food Handler Certificate verified", "COI verified (limits, coverages, additional insured)", "Rental agreement signed", "Full allergen list received", "No conflicts with existing renters", "Orientation scheduled"] },
                  { title: "Monthly", items: ["Maintenance per PM schedule", "Temperature logs reviewed", "Cleaning spot-checked", "Insurance expiry dates reviewed", "Self-inspection completed"] },
                  { title: "Semi-Annual", items: ["Fire suppression inspection", "Hood/vent professional cleaning", "Review all renter COIs"] },
                  { title: "Annual", items: ["Renew Food Establishment Licence", "Renew all insurance policies", "Collect updated COIs", "Review rental agreement terms", "Full equipment service", "WorkplaceNL statement submitted", "Review pricing"] },
                ]}
              />

              {/* ── Resources & Links ── */}
              <SectionHeading id="km-resources-links">Resources &amp; Links</SectionHeading>
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Government — Newfoundland &amp; Labrador</h4>
              <ResourceTable
                headers={["Resource", "Link"]}
                rows={[
                  ["Food Establishment Licence", "gov.nl.ca/gs/licences/env-health/food/"],
                  ["Food Premises Regulations (Full Text)", "assembly.nl.ca/legislation/sr/regulations/rc961022.htm"],
                  ["Fire Protection Services Regulations", "assembly.nl.ca/legislation/sr/regulations/rc120045.htm"],
                  ["WorkplaceNL Employer Registration", "workplacenl.ca/employers/register-my-business/"],
                ]}
              />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Industry Best Practice Guides</h4>
              <ResourceTable
                headers={["Resource", "Link"]}
                rows={[
                  ["Shared Kitchens — Owner Guidance (Ontario, 2025)", "wdgpublichealth.ca (PDF)"],
                  ["Kitchen Rental Agreement Template (Manitoba)", "gov.mb.ca (PDF)"],
                  ["Commercial Kitchen Toolkit: Managing Risk (Alberta)", "open.alberta.ca"],
                  ["The Food Corridor — Pricing Models", "thefoodcorridor.com"],
                ]}
              />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Insurance</h4>
              <ResourceTable
                headers={["Provider", "Website"]}
                rows={[
                  ["FLIP Insurance (Recommended for renters)", "fliprogram.com"],
                  ["BFL Canada", "bflcanada.ca"],
                  ["Zensurance", "zensurance.com"],
                  ["Aligned Insurance", "alignedinsurance.com"],
                ]}
              />

              {/* Disclaimer */}
              <Separator className="mt-16 mb-8" />
              <Alert className="bg-muted/30">
                <Info className="h-4 w-4" />
                <AlertTitle className="text-xs font-semibold">Last Updated: February 2026</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground leading-relaxed">
                  This guide is for informational purposes only and does not constitute legal, insurance, or professional advice. Regulations, fees, and requirements change — always verify current requirements with the official government sources linked above.
                </AlertDescription>
              </Alert>
            </div>
          </main>
        </div>
      </div>

      <Footer />
    </div>
  );
}
