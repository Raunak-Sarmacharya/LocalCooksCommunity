import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import SEOHead from "@/components/SEO/SEOHead";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ChevronRight, ExternalLink, BookOpen, Shield, Building2, FileText,
  GraduationCap, Scale, Globe, ClipboardCheck, BadgeCheck, Home,
  CheckCircle2, AlertTriangle, Info, ChevronDown,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════
// SECTION DATA — All content structured as digestible chunks
// ═══════════════════════════════════════════════════════════════

interface Section {
  id: string;
  title: string;
  icon: React.ElementType;
  subsections?: { id: string; title: string }[];
}

const SECTIONS: Section[] = [
  {
    id: "regulatory-landscape",
    title: "Regulatory Landscape",
    icon: Globe,
    subsections: [
      { id: "three-levels", title: "Three Levels of Regulation" },
    ],
  },
  {
    id: "food-safety-certification",
    title: "Food Safety Certification",
    icon: GraduationCap,
    subsections: [
      { id: "skillspass-nl", title: "Free: SkillsPass NL" },
      { id: "paid-alternatives", title: "Paid Alternatives" },
    ],
  },
  {
    id: "register-your-business",
    title: "Register Your Business",
    icon: FileText,
    subsections: [
      { id: "business-structure", title: "Business Structure" },
      { id: "home-based-registration", title: "Home-Based Registration" },
      { id: "home-food-rules", title: "What You Can & Cannot Make at Home" },
    ],
  },
  {
    id: "liability-insurance",
    title: "Liability Insurance",
    icon: Shield,
    subsections: [
      { id: "coverage-requirements", title: "Coverage Requirements" },
      { id: "flip-insurance", title: "FLIP Insurance" },
      { id: "additional-insured", title: "Additional Insured" },
    ],
  },
  {
    id: "food-establishment-licence",
    title: "Food Establishment Licence",
    icon: BadgeCheck,
    subsections: [
      { id: "commercial-kitchen-users", title: "Commercial Kitchen Users" },
      { id: "home-kitchen-users", title: "Home Kitchen Users" },
    ],
  },
  {
    id: "federal-requirements",
    title: "Federal Requirements",
    icon: Scale,
    subsections: [
      { id: "cfia-licence", title: "Do You Need a CFIA Licence?" },
      { id: "traceability", title: "Traceability Best Practice" },
    ],
  },
  {
    id: "local-cooks-platform",
    title: "Your Path Through Local Cooks",
    icon: Building2,
    subsections: [
      { id: "apply-and-connect", title: "Apply & Connect" },
      { id: "book-and-operate", title: "Book & Operate" },
    ],
  },
  {
    id: "home-vs-commercial",
    title: "Home vs. Commercial Kitchen",
    icon: Home,
    subsections: [],
  },
  {
    id: "business-tax-essentials",
    title: "Business & Tax Essentials",
    icon: Scale,
    subsections: [
      { id: "gst-hst", title: "GST/HST Registration" },
      { id: "record-keeping", title: "Record Keeping" },
      { id: "workplace-nl-chef", title: "WorkplaceNL" },
    ],
  },
  {
    id: "shared-kitchen-operations",
    title: "Operating in a Shared Kitchen",
    icon: ClipboardCheck,
    subsections: [
      { id: "clean-in-clean-out", title: "Clean-In, Clean-Out" },
      { id: "allergen-responsibility", title: "Allergen Responsibility" },
      { id: "storage-protocols", title: "Storage Protocols" },
    ],
  },
  {
    id: "faq",
    title: "FAQ",
    icon: BookOpen,
    subsections: [],
  },
  {
    id: "launch-checklist",
    title: "Your Launch Checklist",
    icon: ClipboardCheck,
    subsections: [],
  },
  {
    id: "resources-links",
    title: "Resources & Links",
    icon: ExternalLink,
    subsections: [],
  },
];

// ═══════════════════════════════════════════════════════════════
// REUSABLE UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

function InfoCard({ children, variant = "info" }: { children: React.ReactNode; variant?: "info" | "warning" | "tip" }) {
  const styles = {
    info: "bg-blue-50 border-blue-200 text-blue-900",
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    tip: "bg-emerald-50 border-emerald-200 text-emerald-900",
  };
  const icons = {
    info: <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />,
    tip: <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />,
  };
  return (
    <Card className={cn("my-6", styles[variant])}>
      <CardContent className={cn("p-4 flex gap-3", styles[variant].replace(/bg-|border-/, "") === "blue-900" ? "text-blue-900" : styles[variant].includes("bg-amber") ? "text-amber-900" : "text-emerald-900")}>
        {icons[variant]}
        <div className="text-sm leading-relaxed">{children}</div>
      </CardContent>
    </Card>
  );
}

function ResourceTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <Card className="my-6 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              {headers.map((h, i) => (
                <th key={i} className="text-left px-4 py-3 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-4 py-3">{cell}</td>
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

// ═══════════════════════════════════════════════════════════════
// SIDEBAR NAVIGATION (Stripe-docs style)
// ═══════════════════════════════════════════════════════════════

function SidebarNav({ activeSection, onNavigate }: { activeSection: string; onNavigate: (id: string) => void }) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Auto-expand the section containing the active subsection
  // Computed during render to avoid setState-in-effect lint warning
  const expandedWithActive = (() => {
    let needsUpdate = false;
    const next = new Set(expandedSections);
    for (const section of SECTIONS) {
      if ((section.id === activeSection || section.subsections?.some((s) => s.id === activeSection)) && !next.has(section.id)) {
        next.add(section.id);
        needsUpdate = true;
      }
    }
    return needsUpdate ? next : expandedSections;
  })();
  if (expandedWithActive !== expandedSections) {
    setExpandedSections(expandedWithActive);
  }

  return (
    <nav className="space-y-1">
      {SECTIONS.map((section) => {
        const isActive = section.id === activeSection;
        const hasActiveSub = section.subsections?.some((s) => s.id === activeSection);
        const isExpanded = expandedSections.has(section.id) || isActive || hasActiveSub;
        const SectionIcon = section.icon;

        return (
          <div key={section.id}>
            <button
              onClick={() => {
                onNavigate(section.id);
                if (section.subsections && section.subsections.length > 0) {
                  toggleSection(section.id);
                }
              }}
              className={cn(
                "w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                isActive || hasActiveSub
                  ? "bg-primary/10 text-primary"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <SectionIcon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 truncate">{section.title}</span>
              {section.subsections && section.subsections.length > 0 && (
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform flex-shrink-0", isExpanded && "rotate-180")} />
              )}
            </button>
            {isExpanded && section.subsections && section.subsections.length > 0 && (
              <div className="ml-6 mt-1 space-y-0.5 border-l-2 border-gray-200 pl-3">
                {section.subsections.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => onNavigate(sub.id)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 rounded text-xs transition-all duration-150",
                      sub.id === activeSection
                        ? "text-primary font-medium bg-primary/5"
                        : "text-gray-500 hover:text-gray-800"
                    )}
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
// MOBILE SIDEBAR
// ═══════════════════════════════════════════════════════════════

function MobileSidebar({ activeSection, onNavigate }: { activeSection: string; onNavigate: (id: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleNavigate = (id: string) => {
    onNavigate(id);
    setIsOpen(false);
  };

  return (
    <div className="lg:hidden sticky top-[64px] z-30 bg-white border-b border-gray-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700"
      >
        <span className="flex items-center gap-2">
          <Menu className="h-4 w-4" />
          On this page
        </span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && (
        <div className="px-4 pb-4 max-h-[60vh] overflow-y-auto">
          <SidebarNav activeSection={activeSection} onNavigate={handleNavigate} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function ChefResourcesPage() {
  const [activeSection, setActiveSection] = useState("regulatory-landscape");

  // Intersection observer for active section tracking
  useEffect(() => {
    const allIds = SECTIONS.flatMap((s) => [s.id, ...(s.subsections?.map((sub) => sub.id) || [])]);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-100px 0px -60% 0px", threshold: 0 }
    );

    allIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SEOHead
        title="Chef Resources — Start Your Food Business in Canada"
        description="Complete guide to food safety certification, business registration, insurance, and licensing for food entrepreneurs in Newfoundland & Labrador and across Canada."
        canonicalUrl="/resources"
        keywords={[
          "food business Canada", "food handler certificate NL", "commercial kitchen rental",
          "food entrepreneur guide", "food safety Newfoundland", "start food business",
          "FLIP insurance", "food establishment licence", "SkillsPass NL",
        ]}
      />
      <Header />

      {/* Hero Section */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white pt-28 pb-16 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="flex items-center gap-2 text-gray-400 text-sm mb-4">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-white font-medium">Chef Resources</span>
          </div>
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4 leading-tight">
            Your Guide to Starting a Legal{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-pink-400">
              Food Business
            </span>{" "}
            in Canada
          </h1>
          <p className="text-gray-300 text-lg max-w-2xl leading-relaxed">
            Currently serving Newfoundland & Labrador — built to scale across Canada. Everything you need from food safety certification to your first kitchen booking.
          </p>
        </div>
      </div>

      {/* Mobile sidebar */}
      <MobileSidebar activeSection={activeSection} onNavigate={scrollToSection} />

      {/* Main content area */}
      <div className="container mx-auto max-w-7xl px-4 py-8 lg:py-12">
        <div className="flex gap-10">
          {/* Desktop Sidebar */}
          <aside className="hidden lg:block w-64 flex-shrink-0">
            <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 pb-8">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 px-3">On this page</p>
              <SidebarNav activeSection={activeSection} onNavigate={scrollToSection} />
            </div>
          </aside>

          {/* Content */}
          <main className="flex-1 min-w-0 max-w-3xl">
            <div className="prose-sm sm:prose prose-gray max-w-none">

              {/* ── Regulatory Landscape ── */}
              <SectionHeading id="regulatory-landscape">Regulatory Landscape</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Canada&apos;s food system operates on three levels. Knowing which ones apply to you prevents costly surprises.
              </p>
              <SubHeading id="three-levels">Three Levels of Regulation</SubHeading>
              <ResourceTable
                headers={["Level", "Regulator", "When It Applies"]}
                rows={[
                  ["Federal", "Canadian Food Inspection Agency (CFIA)", "Selling across provincial borders, importing, or exporting"],
                  ["Provincial", "Service NL (in Newfoundland & Labrador)", "All food businesses operating within the province"],
                  ["Municipal", "City of St. John&apos;s (or your municipality)", "Zoning, business permits, market vending"],
                ]}
              />
              <InfoCard variant="info">
                <strong>Most food entrepreneurs starting locally need only provincial and municipal compliance.</strong> Federal requirements kick in when you ship products across provincial borders or internationally. Each province has its own regulator — Service NL in NL, Public Health Units in Ontario, regional Health Authorities in BC. The principles are universal; the agencies differ.
              </InfoCard>

              {/* ── Food Safety Certification ── */}
              <SectionHeading id="food-safety-certification">Food Safety Certification</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                A Food Handler Certificate proves you understand temperature control, cross-contamination prevention, hygiene protocols, and safe food handling.
              </p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-3">
                <li><strong>Legal requirement.</strong> At least one certified food handler must be present during all operating hours at any food premises in NL (<em>Food Premises Regulations</em>, Section 6.1).</li>
                <li><strong>Kitchen access.</strong> Commercial kitchens require valid certification before granting access.</li>
                <li><strong>Professional credibility.</strong> Demonstrates commitment to food safety to customers and regulators.</li>
              </ul>

              <SubHeading id="skillspass-nl">Free: SkillsPass NL</SubHeading>
              <ResourceTable
                headers={["", ""]}
                rows={[
                  ["Cost", "Free"],
                  ["Provider", "Government of Newfoundland and Labrador"],
                  ["Website", "skillspassnl.com"],
                  ["Courses", "Food Safety: General Awareness · Home-Based Food Preparation · Owner & Manager"],
                  ["Format", "Online, approximately 30 minutes per module"],
                  ["Certificate", "Download immediately upon passing"],
                ]}
              />
              <p className="text-gray-600">
                <strong>How to get started:</strong> Visit{" "}
                <ExtLink href="https://skillspassnl.bluedrop.io">skillspassnl.bluedrop.io</ExtLink>, create a free account, complete the relevant modules, pass the assessment, and download your certificate. For business owners, the &ldquo;Food Safety: Owner &amp; Manager&rdquo; module is recommended — it covers legal liabilities beyond basic hygiene.
              </p>

              <SubHeading id="paid-alternatives">Paid Alternatives (Canada-Wide Recognition)</SubHeading>
              <ResourceTable
                headers={["Provider", "Validity", "Website"]}
                rows={[
                  ["ProbeIt Food Safety", "5 years, recognized across Canada", "probeit.ca"],
                  ["Canadian Food Safety Training", "Check provider", "foodsafetytraining.ca"],
                ]}
              />
              <InfoCard variant="tip">
                <strong>Moving between provinces?</strong> Newfoundland generally accepts valid certifications from other provinces (e.g., FoodSafe Level 1 from BC). Verify with your local Environmental Health Officer before relying on an out-of-province certificate.
              </InfoCard>

              {/* ── Register Your Business ── */}
              <SectionHeading id="register-your-business">Register Your Business</SectionHeading>

              <SubHeading id="business-structure">Business Structure</SubHeading>
              <ResourceTable
                headers={["Structure", "Registration", "Liability", "Best For"]}
                rows={[
                  ["Sole Proprietorship", "No provincial registration required in NL (registering a name is recommended)", "Personal liability", "Solo operators, farmers' market sellers"],
                  ["Partnership", "Register with Registry of Companies", "Shared personal liability", "Two or more partners"],
                  ["Incorporation", "File with Registry of Companies", "Limited liability protection", "Growing businesses, seeking investment"],
                ]}
              />

              <SubHeading id="home-based-registration">Home-Based Food Business Registration</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                If you plan to operate from a home kitchen, you must register with the Environmental Public Health department. Download the form from{" "}
                <ExtLink href="https://www.gov.nl.ca/hcs/files/publichealth-envhealth-home-based-food-industry.pdf">gov.nl.ca</ExtLink>, complete all sections, and submit to your nearest Government Service Centre. Registration is <strong>free</strong> and does not expire.
              </p>

              <SubHeading id="home-food-rules">What You Can & Cannot Make at Home</SubHeading>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
                <div className="border border-emerald-200 rounded-lg p-4 bg-emerald-50/50">
                  <h4 className="font-semibold text-emerald-800 mb-2 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> Permitted (low-risk)
                  </h4>
                  <ul className="text-sm text-emerald-700 space-y-1">
                    <li>Baked goods (cookies, cakes, breads, pastries)</li>
                    <li>Jams, jellies, preserves (properly acidified)</li>
                    <li>Candy and confections</li>
                    <li>Granola and cereal products</li>
                    <li>Spice blends and dry mixes</li>
                  </ul>
                </div>
                <div className="border border-red-200 rounded-lg p-4 bg-red-50/50">
                  <h4 className="font-semibold text-red-800 mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Prohibited (high-risk)
                  </h4>
                  <ul className="text-sm text-red-700 space-y-1">
                    <li>Raw meat, fish, shellfish, poultry</li>
                    <li>Cut fruits and vegetables, fresh juices</li>
                    <li>Fermented products (kimchi, kombucha)</li>
                    <li>Cream pastries, cheesecakes</li>
                    <li>Canned foods with pH ≥ 4.6</li>
                  </ul>
                </div>
              </div>
              <InfoCard variant="warning">
                <strong>If your product falls in the prohibited category, you need a commercial kitchen.</strong> Renting commercial kitchen space at $20–$50/hour is often more practical than retrofitting a home kitchen to commercial standards ($10,000–$50,000+).
              </InfoCard>

              {/* ── Liability Insurance ── */}
              <SectionHeading id="liability-insurance">Liability Insurance</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Insurance protects your business, your personal assets, and the kitchen you operate in. Nearly all commercial kitchens require proof of insurance before granting access.
              </p>

              <SubHeading id="coverage-requirements">Coverage Requirements</SubHeading>
              <ResourceTable
                headers={["Coverage", "Minimum", "Purpose"]}
                rows={[
                  ["Commercial General Liability (CGL)", "$2,000,000 aggregate", "Covers accidents, injuries, property damage"],
                  ["Product Liability", "$2,000,000 aggregate", "Covers food poisoning, allergen claims"],
                  ["Damage to Premises Rented", "$300,000", "Covers accidental damage to the kitchen"],
                  ["Additional Insured", "Kitchen named on your policy", "Extends your coverage to the kitchen"],
                ]}
              />

              <SubHeading id="flip-insurance">FLIP Insurance (Recommended)</SubHeading>
              <p className="text-gray-600">
                FLIP (Food Liability Insurance Program) specializes in affordable coverage for food businesses renting commercial kitchen space. It is the most widely used option for shared kitchen renters across Canada.
              </p>
              <ResourceTable
                headers={["", ""]}
                rows={[
                  ["Cost", "Starting at approximately $25.92/month or $299/year"],
                  ["Additional Insureds", "Free and unlimited — add kitchens at no extra cost"],
                  ["Deductible", "None on liability claims"],
                  ["Purchasing", "Instant online — certificate available immediately"],
                  ["Add-ons", "Equipment (+$8.25/mo), cyber liability (+$8.25/mo), excess liability (from $41.67/mo)"],
                  ["Website", "fliprogram.com"],
                ]}
              />

              <SubHeading id="additional-insured">Understanding &ldquo;Additional Insured&rdquo;</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                When you add a kitchen as an Additional Insured on your policy, the kitchen is covered under <strong>your</strong> insurance for claims arising from <strong>your</strong> activities. This is standard practice across the industry.
              </p>
              <InfoCard variant="info">
                <strong>Example:</strong> You prepare food in a rented kitchen. A customer experiences an allergic reaction and sues both you and the kitchen. Because the kitchen is named as an Additional Insured, your insurer covers the kitchen&apos;s legal defence for claims related to your operations.
              </InfoCard>

              {/* ── Food Establishment Licence ── */}
              <SectionHeading id="food-establishment-licence">Food Establishment Licence</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Any food business operating from a commercial kitchen must hold a Food Establishment Licence from Service NL under the <em>Food Premises Act</em>.
              </p>

              <SubHeading id="commercial-kitchen-users">For Commercial Kitchen Users</SubHeading>
              <p className="text-gray-600">You need:</p>
              <ol className="list-decimal pl-5 text-gray-600 space-y-2 mt-2">
                <li><strong>Completed licence application</strong> — download from <ExtLink href="https://www.gov.nl.ca/gs/licences/env-health/food/premises/">gov.nl.ca</ExtLink></li>
                <li><strong>Floor plan</strong> of the kitchen (the kitchen manager provides this)</li>
                <li><strong>Municipal approval</strong> if applicable — in St. John&apos;s, confirm zoning with Planning and Development</li>
                <li><strong>Proof of food safety training</strong> — your certificate from Step 1</li>
                <li><strong>Rental agreement or letter</strong> confirming your access to the licensed facility</li>
              </ol>
              <ResourceTable
                headers={["", ""]}
                rows={[
                  ["Processing time", "2–8 weeks"],
                  ["Renewal", "Annual — Service NL will notify you"],
                ]}
              />
              <InfoCard variant="info">
                <strong>Important:</strong> The kitchen&apos;s own licence covers the <em>facility</em>. If you operate as an independent business under your own brand, you likely need your own licence. Check with your local Environmental Health Officer.
              </InfoCard>

              <SubHeading id="home-kitchen-users">For Home Kitchen Users</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Your home must meet commercial standards: commercial-grade equipment, proper ventilation, adequate refrigeration, separate food prep area, two-compartment sink, screened windows, and pest control. Submit a floor plan and pass an Environmental Health inspection.
              </p>

              {/* ── Federal Requirements ── */}
              <SectionHeading id="federal-requirements">Federal Requirements</SectionHeading>

              <SubHeading id="cfia-licence">Do You Need a CFIA Licence?</SubHeading>
              <ResourceTable
                headers={["Your Activity", "Federal Licence Required?"]}
                rows={[
                  ["Sell only within your province", "No"],
                  ["Serve directly to consumers (restaurant, food truck, catering)", "No"],
                  ["Sell across provincial or territorial borders", "Yes"],
                  ["Import ingredients from outside Canada", "Yes"],
                  ["Export products internationally", "Yes"],
                ]}
              />
              <p className="text-gray-600 mt-3">
                If you need a licence: create a My CFIA account at{" "}
                <ExtLink href="https://www.inspection.gc.ca/my-cfia">inspection.gc.ca</ExtLink>, develop a Preventive Control Plan (PCP), meet traceability requirements, and submit your application. <strong>Cost: $250 for a 2-year licence.</strong>
              </p>

              <SubHeading id="traceability">Traceability Best Practice</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                Even if you don&apos;t need a federal licence, maintaining basic traceability records protects your business:
              </p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-2">
                <li><strong>One step back:</strong> Keep supplier invoices with lot numbers</li>
                <li><strong>One step forward:</strong> Keep sales records for business-to-business transactions (direct-to-consumer retail sales are exempt)</li>
              </ul>

              {/* ── Local Cooks Platform ── */}
              <SectionHeading id="local-cooks-platform">Your Path Through Local Cooks</SectionHeading>
              <p className="text-gray-600 leading-relaxed">
                Local Cooks connects food entrepreneurs with licensed commercial kitchens. Here&apos;s how the process works.
              </p>

              <SubHeading id="apply-and-connect">Apply & Connect</SubHeading>
              <div className="space-y-4 my-4">
                <div className="flex gap-4 items-start p-4 rounded-lg border border-gray-200 bg-gray-50/50">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm flex-shrink-0">1</div>
                  <div>
                    <p className="font-medium text-gray-900">Create your profile and apply</p>
                    <p className="text-sm text-gray-600 mt-1">Browse available commercial kitchens, apply to locations that match your needs, and upload your Food Handler Certificate and other documents as part of the application.</p>
                  </div>
                </div>
                <div className="flex gap-4 items-start p-4 rounded-lg border border-gray-200 bg-gray-50/50">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm flex-shrink-0">2</div>
                  <div>
                    <p className="font-medium text-gray-900">Connect with your kitchen manager</p>
                    <p className="text-sm text-gray-600 mt-1">Use the platform&apos;s built-in messaging system to exchange documentation needed for your Food Establishment Licence (kitchen address, floor plan, licence number). Provide your Certificate of Insurance with the kitchen named as Additional Insured.</p>
                  </div>
                </div>
                <div className="flex gap-4 items-start p-4 rounded-lg border border-gray-200 bg-gray-50/50">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm flex-shrink-0">3</div>
                  <div>
                    <p className="font-medium text-gray-900">Complete approval stages</p>
                    <p className="text-sm text-gray-600 mt-1">The approval process has multiple stages — managers verify your documents and qualifications before granting full booking access.</p>
                  </div>
                </div>
              </div>

              <SubHeading id="book-and-operate">Book & Operate</SubHeading>
              <p className="text-gray-600 leading-relaxed">Once fully approved:</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1 mt-2">
                <li>Book kitchen time slots directly through the platform</li>
                <li>Add storage and equipment rentals to your bookings as needed</li>
                <li>Pay securely through the platform</li>
                <li>Manage upcoming and past bookings from your dashboard</li>
              </ul>
              <InfoCard variant="tip">
                <strong>Before your first session:</strong> Coordinate with your kitchen manager for an in-person orientation. This covers equipment operation, cleaning protocols, emergency procedures, storage assignments, and facility-specific rules.
              </InfoCard>

              {/* ── Home vs Commercial ── */}
              <SectionHeading id="home-vs-commercial">Home vs. Commercial Kitchen</SectionHeading>
              <ResourceTable
                headers={["Factor", "Home-Based", "Commercial Kitchen"]}
                rows={[
                  ["Startup cost", "Low upfront, but retrofitting is expensive", "Pay-per-use — no capital investment"],
                  ["Food types", "Low-risk only (baked goods, jams, dry mixes)", "Any food product, including high-risk"],
                  ["Equipment", "Must meet commercial standards personally", "Commercial-grade equipment provided"],
                  ["Scalability", "Limited by space and regulations", "Flexible — book more hours as you grow"],
                  ["Licensing", "Home inspected and licensed separately", "Kitchen already licensed and inspected"],
                  ["Networking", "Isolated", "Work alongside other food entrepreneurs"],
                ]}
              />

              {/* ── Business & Tax ── */}
              <SectionHeading id="business-tax-essentials">Business & Tax Essentials</SectionHeading>

              <SubHeading id="gst-hst">GST/HST Registration</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Required</strong> if annual revenue exceeds $30,000 (small supplier threshold)</li>
                <li>Register through <ExtLink href="https://www.canada.ca/en/revenue-agency.html">Canada Revenue Agency</ExtLink></li>
                <li>In Newfoundland and Labrador, the combined <strong>HST rate is 15%</strong></li>
              </ul>

              <SubHeading id="record-keeping">Record Keeping</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                The Canada Revenue Agency requires you to keep business records for <strong>6 years</strong>. Track: ingredient purchases, kitchen rental payments, insurance premiums, equipment and supplies, sales revenue by channel, and transportation costs.
              </p>

              <SubHeading id="workplace-nl-chef">WorkplaceNL (Workers' Compensation)</SubHeading>
              <p className="text-gray-600 leading-relaxed">
                If you hire even one assistant — casual, part-time, or contract — you must register with <strong>WorkplaceNL</strong>. Assessment rate: $1.28 per $100 of payroll for food services (NIC&nbsp;9210).
              </p>

              {/* ── Shared Kitchen Operations ── */}
              <SectionHeading id="shared-kitchen-operations">Operating in a Shared Kitchen</SectionHeading>

              <SubHeading id="clean-in-clean-out">The Clean-In, Clean-Out Rule</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Arrival:</strong> Sanitize your station before you start. Never assume the previous user left it perfect.</li>
                <li><strong>Departure:</strong> Leave the station inspection-ready — surfaces scrubbed, sinks clean, floors swept, equipment returned.</li>
              </ul>

              <SubHeading id="allergen-responsibility">Allergen Responsibility</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li>Keep high-risk allergens in tightly sealed, clearly labelled containers</li>
                <li>Perform high-allergen tasks at the end of your session when possible</li>
                <li>Add a &ldquo;May contain traces of...&rdquo; statement to your labels</li>
                <li>Disclose all ingredients and allergens to the kitchen manager</li>
              </ul>

              <SubHeading id="storage-protocols">Storage Protocols</SubHeading>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li><strong>Label everything:</strong> Your name, product name, and date</li>
                <li><strong>The 6-inch rule:</strong> Nothing on the floor — use shelves or dunnage racks</li>
                <li><strong>No commingling:</strong> Follow the facility&apos;s vertical storage hierarchy (raw below ready-to-eat)</li>
              </ul>

              {/* ── FAQ ── */}
              <SectionHeading id="faq">Frequently Asked Questions</SectionHeading>
              <div className="space-y-4 my-6">
                {[
                  { q: "How long does it take to go from zero to first legal sale?", a: "Typically 4–10 weeks: Food Handler Certificate (1 day), insurance (instant), home business registration (1–2 weeks), Food Establishment Licence (2–8 weeks)." },
                  { q: "Can I start selling before I have all licences?", a: "No. All required certifications, registrations, and licences must be in place before you legally sell food products." },
                  { q: "Do I need a licence just for farmers&apos; markets?", a: "You need your Food Handler Certificate and business registration at minimum. Many markets also require proof of licensing and insurance. Submit documentation to organizers at least 14 days before the event (Service NL requirement)." },
                  { q: "What if I want to expand beyond Newfoundland?", a: "You will need a Safe Food for Canadians Licence from CFIA ($250 for 2 years) and must meet federal labelling, traceability, and preventive control requirements." },
                  { q: "Can I make some products at home and others in a commercial kitchen?", a: "Yes, but you need proper licensing for each location. Keep detailed records of where each product is prepared." },
                  { q: "How do I add a kitchen as Additional Insured?", a: "Through your insurance provider portal. With FLIP, this is instant and free — enter the kitchen legal business name and address, then generate an updated Certificate of Insurance." },
                ].map((item, i) => (
                  <details key={i} className="group border border-gray-200 rounded-lg">
                    <summary className="flex items-center justify-between px-4 py-3 cursor-pointer text-sm font-medium text-gray-900 hover:bg-gray-50 rounded-lg">
                      {item.q}
                      <ChevronDown className="h-4 w-4 text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" />
                    </summary>
                    <p className="px-4 pb-3 text-sm text-gray-600 leading-relaxed">{item.a}</p>
                  </details>
                ))}
              </div>

              {/* ── Launch Checklist ── */}
              <SectionHeading id="launch-checklist">Your Launch Checklist</SectionHeading>
              <div className="space-y-6 my-6">
                {[
                  { title: "Weeks 1–2: Foundation", items: ["Complete SkillsPass NL Food Handler course (free, online)", "Pass the certification exam and download your certificate", "Research which foods you want to prepare", "Decide: home-based or commercial kitchen", "Review the NL Food Premises Regulations"] },
                  { title: "Weeks 3–4: Insurance & Registration", items: ["Get a liability insurance quote from FLIP or alternative", "Purchase minimum $2M liability insurance", "Download your Certificate of Insurance", "Register home-based food business (if applicable)", "Set up a dedicated business bank account"] },
                  { title: "Weeks 5–6: Kitchen & Documentation", items: ["Browse commercial kitchens on Local Cooks", "Apply to kitchens that match your needs", "Connect with kitchen managers via messaging", "Exchange documentation (floor plans, licence info, COI)", "Add kitchen as Additional Insured on your insurance"] },
                  { title: "Weeks 7–10: Launch", items: ["Compile all documents for Food Establishment Licence", "Submit application to Service NL and pay fees", "Complete an in-person kitchen orientation", "Sign your rental agreement", "Book your first kitchen session"] },
                ].map((phase, pi) => (
                  <div key={pi}>
                    <h4 className="font-semibold text-gray-800 mb-2">{phase.title}</h4>
                    <ul className="space-y-1.5">
                      {phase.items.map((item, ii) => (
                        <li key={ii} className="flex items-start gap-2 text-sm text-gray-600">
                          <div className="w-4 h-4 rounded border border-gray-300 flex-shrink-0 mt-0.5" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* ── Resources & Links ── */}
              <SectionHeading id="resources-links">Resources & Links</SectionHeading>
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Government — Newfoundland & Labrador</h4>
              <ResourceTable
                headers={["Resource", "Link"]}
                rows={[
                  ["Food Establishment Licence", "gov.nl.ca/gs/licences/env-health/food/"],
                  ["Food Premises Regulations (Full Text)", "assembly.nl.ca/legislation/sr/regulations/rc961022.htm"],
                  ["Home-Based Food Guidelines (PDF)", "gov.nl.ca/hcs/files/publichealth-envhealth-home-based-food-industry.pdf"],
                  ["SkillsPass NL (Free Training)", "skillspassnl.com"],
                  ["WorkplaceNL", "workplacenl.ca"],
                ]}
              />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Federal / Canada-Wide</h4>
              <ResourceTable
                headers={["Resource", "Link"]}
                rows={[
                  ["CFIA Toolkit for Food Businesses", "inspection.canada.ca/food-safety-industry/toolkit-food-businesses"],
                  ["Health Canada Priority Allergens", "canada.ca/en/health-canada/services/food-nutrition/food-safety/food-allergies-intolerances.html"],
                  ["Canada Revenue Agency (GST/HST)", "canada.ca/en/revenue-agency.html"],
                  ["BizPaL Permit Checklist", "bizpal.ca"],
                ]}
              />
              <h4 className="font-semibold text-gray-800 mb-3 mt-6">Insurance</h4>
              <ResourceTable
                headers={["Provider", "Website"]}
                rows={[
                  ["FLIP Insurance (Recommended)", "fliprogram.com"],
                  ["Zensurance", "zensurance.com"],
                  ["BFL Canada", "bflcanada.ca"],
                ]}
              />

              {/* Disclaimer */}
              <div className="mt-16 pt-8 border-t border-gray-200">
                <p className="text-xs text-gray-400 leading-relaxed">
                  <strong>Last Updated:</strong> February 2026. This guide is for informational purposes only and does not constitute legal, insurance, or professional advice. Regulations, fees, and requirements change — always verify current requirements with the official government sources linked above. Consult qualified legal, insurance, and food safety professionals for advice specific to your situation.
                </p>
              </div>
            </div>
          </main>
        </div>
      </div>

      <Footer />
    </div>
  );
}
