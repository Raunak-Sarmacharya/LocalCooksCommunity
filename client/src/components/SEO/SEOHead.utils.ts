
export type SubdomainType = "chef" | "kitchen" | "admin" | "main" | null;

export interface SEOHeadProps {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  image?: string;
  imageAlt?: string;
  type?: "website" | "article" | "profile";
  ogType?: "website" | "article" | "profile"; // Alias for type
  noIndex?: boolean;
  keywords?: string[];
  // Article-specific
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  section?: string;
  tags?: string[];
  // Local business specific
  showLocalBusiness?: boolean;
  // Breadcrumb items (auto-generates BreadcrumbList schema)
  breadcrumbs?: { name: string; url: string }[];
  // Rating schema (for "Amazon-style" stars)
  rating?: {
    value: number;
    count: number;
    best?: number;
    worst?: number;
  };
  // FAQ schema
  faq?: {
    question: string;
    answer: string;
  }[];
  // SiteNavigationElement items (for Google sitelinks)
  siteNavigation?: { name: string; description: string; url: string }[];
}

// ─────────────────────────────────────────────────────────────
// Subdomain-aware URL helpers
// ─────────────────────────────────────────────────────────────

/** Returns the base URL for the current subdomain */
export function getSubdomainBaseUrl(subdomain?: SubdomainType): string {
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname.startsWith("chef.")) return "https://chef.localcooks.ca";
    if (hostname.startsWith("kitchen.")) return "https://kitchen.localcooks.ca";
    if (hostname.startsWith("admin.")) return "https://admin.localcooks.ca";
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.includes("vercel.app")
    ) {
      // In dev/preview, use the explicit subdomain param or default to chef
      if (subdomain === "kitchen") return "https://kitchen.localcooks.ca";
      if (subdomain === "admin") return "https://admin.localcooks.ca";
      return "https://chef.localcooks.ca";
    }
  }
  // Fallback based on param
  if (subdomain === "kitchen") return "https://kitchen.localcooks.ca";
  if (subdomain === "admin") return "https://admin.localcooks.ca";
  return "https://chef.localcooks.ca";
}

/** Detect current subdomain from hostname */
export function detectSubdomain(): SubdomainType {
  if (typeof window === "undefined") return null;
  const hostname = window.location.hostname;
  if (hostname.startsWith("chef.")) return "chef";
  if (hostname.startsWith("kitchen.")) return "kitchen";
  if (hostname.startsWith("admin.")) return "admin";
  if (hostname === "www.localcooks.ca" || hostname === "localcooks.ca") return "main";
  return null; // localhost / dev
}

// Default SEO values
export const defaults = {
  siteName: "LocalCooks",
  get siteUrl() {
    return getSubdomainBaseUrl();
  },
  title:
    "LocalCooks | The Operating System for Local Food Businesses in St. John's, NL",
  description:
    "Launch and grow your food business with LocalCooks. Commercial kitchen booking, compliance management, payment processing, and delivery infrastructure — all in one platform. Serving St. John's, Newfoundland.",
  image: "https://www.localcooks.ca/chef.png",
  imageAlt:
    "LocalCooks platform — kitchen booking, compliance, and payments for local chefs",
  locale: "en_CA",
  twitterHandle: "@localcooksnfld",
};

// LocalBusiness structured data for Google
export const createLocalBusinessSchema = (rating?: SEOHeadProps["rating"]) => {
  const schema: any = {
    "@context": "https://schema.org",
    "@type": "FoodEstablishment",
    "@id": "https://www.localcooks.ca/#organization",
    name: "LocalCooks",
    alternateName: "Local Cooks",
    description:
      "LocalCooks is the operating system for local food businesses in St. John's, Newfoundland. Commercial kitchen booking, compliance, payments, and delivery infrastructure for home-based chefs.",
    url: "https://www.localcooks.ca",
    logo: {
      "@type": "ImageObject",
      url: "https://www.localcooks.ca/logo-lc.png",
      width: 512,
      height: 512,
    },
    image: [
      "https://www.localcooks.ca/chef.png",
      "https://www.localcooks.ca/logo-lc.png",
    ],
    telephone: "+1-709-631-8480",
    email: "admin@localcook.shop",
    address: {
      "@type": "PostalAddress",
      addressLocality: "St. John's",
      addressRegion: "NL",
      addressCountry: "CA",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 47.5615,
      longitude: -52.7126,
    },
    areaServed: {
      "@type": "City",
      name: "St. John's",
      "@id": "https://www.wikidata.org/wiki/Q2126",
    },
    servesCuisine: [
      "Homemade",
      "International",
      "Indian",
      "Asian",
      "Caribbean",
      "Middle Eastern",
      "Latin American",
      "European",
      "African",
    ],
    priceRange: "$$",
    currenciesAccepted: "CAD",
    paymentAccepted: "Credit Card, Debit Card",
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ],
        opens: "09:00",
        closes: "21:00",
      },
    ],
    sameAs: [
      "https://www.facebook.com/LocalCooks",
      "https://www.instagram.com/localcooksnfld/",
      "https://www.linkedin.com/company/local-cooks",
    ],
    potentialAction: {
      "@type": "OrderAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: "https://chef.localcooks.ca/book-kitchen",
        inLanguage: "en-CA",
        actionPlatform: [
          "http://schema.org/DesktopWebPlatform",
          "http://schema.org/MobileWebPlatform",
        ],
      },
      deliveryMethod: [
        "http://purl.org/goodrelations/v1#DeliveryModePickUp",
        "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet",
      ],
    },
  };

  if (rating) {
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: rating.value,
      reviewCount: rating.count,
      bestRating: rating.best || 5,
      worstRating: rating.worst || 1,
    };
  }

  return schema;
};

// ─────────────────────────────────────────────────────────────
// Subdomain-aware WebSite schema factory
// ─────────────────────────────────────────────────────────────
export const createWebsiteSchema = (baseUrl?: string) => {
  const url = baseUrl || getSubdomainBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${url}/#website`,
    url,
    name: "LocalCooks",
    description: defaults.description,
    publisher: {
      "@id": "https://www.localcooks.ca/#organization",
    },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${url}/book-kitchen?search={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
    inLanguage: "en-CA",
  };
};

// Keep backward-compatible static export (uses current subdomain at call time)
export const websiteSchema = createWebsiteSchema();

// ─────────────────────────────────────────────────────────────
// WebPage schema factory
// ─────────────────────────────────────────────────────────────
export const createWebPageSchema = (opts: {
  url: string;
  name: string;
  description: string;
  dateModified?: string;
}) => ({
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": `${opts.url}#webpage`,
  url: opts.url,
  name: opts.name,
  description: opts.description,
  isPartOf: {
    "@id": `${getSubdomainBaseUrl()}/#website`,
  },
  about: {
    "@id": "https://www.localcooks.ca/#organization",
  },
  inLanguage: "en-CA",
  datePublished: "2024-01-01T00:00:00+00:00",
  dateModified: opts.dateModified || new Date().toISOString().split("T")[0],
});

// ─────────────────────────────────────────────────────────────
// SiteNavigationElement schema (Google @graph format for sitelinks)
// ─────────────────────────────────────────────────────────────
export const createSiteNavigationSchema = (
  items: { name: string; description: string; url: string }[]
) => ({
  "@context": "https://schema.org",
  "@graph": items.map((item) => ({
    "@type": "SiteNavigationElement",
    name: item.name,
    description: item.description,
    url: item.url,
  })),
});

// BreadcrumbList for better navigation signals
// Per Google spec: last item must NOT have "item" URL — Google uses the containing page URL
export const createBreadcrumbSchema = (items: { name: string; url: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => {
    const isLast = index === items.length - 1;
    return {
      "@type": "ListItem" as const,
      position: index + 1,
      name: item.name,
      ...(isLast ? {} : { item: item.url }),
    };
  }),
});

// FAQ Schema
export const createFAQSchema = (faqs: SEOHeadProps["faq"]) => {
  if (!faqs || faqs.length === 0) return null;
  
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(faq => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer
      }
    }))
  };
};
