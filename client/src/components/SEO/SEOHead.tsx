
import { Helmet } from "@dr.pogodin/react-helmet";
import {
  type SEOHeadProps,
  defaults,
  createLocalBusinessSchema,
  createWebsiteSchema,
  createWebPageSchema,
  createBreadcrumbSchema,
  createFAQSchema,
  createSiteNavigationSchema,
  getSubdomainBaseUrl,
} from "./SEOHead.utils";

/**
 * SEO Configuration for LocalCooks Community Platform
 * Enterprise-grade meta tags for local business SEO
 * Mirrors LCLanding architecture, adapted for multi-subdomain app
 *
 * This component MUST be used on every public-facing page to inject
 * correct per-subdomain canonical URLs, structured data, and meta tags.
 */

export default function SEOHead({
  title,
  description = defaults.description,
  canonicalUrl,
  image = defaults.image,
  imageAlt = defaults.imageAlt,
  type = "website",
  ogType, // Optional override/alias for type
  noIndex = false,
  keywords,
  publishedTime,
  modifiedTime,
  author,
  section,
  tags,
  showLocalBusiness = false,
  breadcrumbs,
  rating,
  faq,
  siteNavigation,
}: SEOHeadProps) {
  const baseUrl = getSubdomainBaseUrl();
  
  const pageTitle = title
    ? `${title} | LocalCooks`
    : defaults.title;

  const fullCanonicalUrl = canonicalUrl
    ? `${baseUrl}${canonicalUrl.startsWith("/") ? "" : "/"}${canonicalUrl}`
    : baseUrl;

  const fullImageUrl = image.startsWith("http")
    ? image
    : `${baseUrl}${image.startsWith("/") ? "" : "/"}${image}`;

  // Prioritize ogType if provided, otherwise fallback to type
  const actualOgType = ogType || type;

  // Generate subdomain-aware WebSite schema
  const websiteSchemaData = createWebsiteSchema(baseUrl);

  // Generate WebPage schema for this page
  const webPageSchemaData = createWebPageSchema({
    url: fullCanonicalUrl,
    name: pageTitle,
    description,
  });

  return (
    <Helmet prioritizeSeoTags>
      {/* Basic Meta Tags */}
      <html lang="en-CA" />
      <title>{pageTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={fullCanonicalUrl} />

      {/* Robots */}
      {noIndex ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        <meta
          name="robots"
          content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
        />
      )}

      {/* Geo Tags for Local SEO */}
      <meta name="geo.region" content="CA-NL" />
      <meta name="geo.placename" content="St. John's, Newfoundland" />
      <meta name="geo.position" content="47.5615;-52.7126" />
      <meta name="ICBM" content="47.5615, -52.7126" />

      {/* Keywords for Local Discovery */}
      {keywords && keywords.length > 0 ? (
        <meta name="keywords" content={keywords.join(", ")} />
      ) : (
        <meta
          name="keywords"
          content="local cooks, home chefs, homemade food, St Johns, Newfoundland, commercial kitchen rental, kitchen booking, food business, home chef compliance, food delivery NL, local chef near me, kitchen rental St Johns, food business Newfoundland, commercial kitchen NL, chef platform Canada"
        />
      )}

      {/* Open Graph Tags */}
      <meta property="og:type" content={actualOgType} />
      <meta property="og:site_name" content={defaults.siteName} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={fullCanonicalUrl} />
      <meta property="og:image" content={fullImageUrl} />
      <meta property="og:image:alt" content={imageAlt} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:locale" content={defaults.locale} />

      {/* Article-specific OG Tags */}
      {actualOgType === "article" && publishedTime && (
        <meta property="article:published_time" content={publishedTime} />
      )}
      {actualOgType === "article" && modifiedTime && (
        <meta property="article:modified_time" content={modifiedTime} />
      )}
      {actualOgType === "article" && author && (
        <meta property="article:author" content={author} />
      )}
      {actualOgType === "article" && section && (
        <meta property="article:section" content={section} />
      )}
      {actualOgType === "article" &&
        tags &&
        tags.map((tag, i) => (
          <meta key={i} property="article:tag" content={tag} />
        ))}

      {/* Twitter Card Tags */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={defaults.twitterHandle} />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={fullImageUrl} />
      <meta name="twitter:image:alt" content={imageAlt} />

      {/* Hreflang for Language/Region targeting */}
      <link rel="alternate" hrefLang="en-CA" href={fullCanonicalUrl} />
      <link rel="alternate" hrefLang="x-default" href={fullCanonicalUrl} />

      {/* Mobile & Theme */}
      <meta name="theme-color" content="#f51042" />
      <meta name="apple-mobile-web-app-title" content="LocalCooks" />
      <meta name="application-name" content="LocalCooks" />

      {/* Structured Data - WebSite Schema (subdomain-aware, always include) */}
      <script type="application/ld+json">
        {JSON.stringify(websiteSchemaData)}
      </script>

      {/* Structured Data - WebPage Schema (per-page) */}
      <script type="application/ld+json">
        {JSON.stringify(webPageSchemaData)}
      </script>

      {/* Structured Data - LocalBusiness Schema (for homepage and relevant pages) */}
      {showLocalBusiness && (
        <script type="application/ld+json">
          {JSON.stringify(createLocalBusinessSchema(rating))}
        </script>
      )}

      {/* Structured Data - SiteNavigationElement (for Google sitelinks — @graph format) */}
      {siteNavigation && siteNavigation.length > 0 && (
        <script type="application/ld+json">
          {JSON.stringify(createSiteNavigationSchema(siteNavigation))}
        </script>
      )}

      {/* Structured Data - Breadcrumb (for sub-pages) */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <script type="application/ld+json">
          {JSON.stringify(createBreadcrumbSchema(breadcrumbs))}
        </script>
      )}
      
      {/* Structured Data - FAQPage Schema */}
      {faq && faq.length > 0 && (
         <script type="application/ld+json">
           {JSON.stringify(createFAQSchema(faq))}
         </script>
      )}
    </Helmet>
  );
}
