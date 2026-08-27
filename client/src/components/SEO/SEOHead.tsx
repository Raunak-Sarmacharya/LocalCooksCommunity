import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getOgLocale,
  isAppLocale,
  withLocalePrefix,
  type AppLocale,
} from "@shared/i18n";
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
 * Enterprise-grade meta tags for local business SEO.
 * Locale-aware: lang, og:locale, hreflang alternates, inLanguage.
 */

export default function SEOHead({
  title,
  description = defaults.description,
  canonicalUrl,
  image = defaults.image,
  imageAlt = defaults.imageAlt,
  type = "website",
  ogType,
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
  const { i18n } = useTranslation();
  const locale: AppLocale = isAppLocale(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : isAppLocale(i18n.language)
      ? i18n.language
      : DEFAULT_LOCALE;

  const baseUrl = getSubdomainBaseUrl();

  const pageTitle = title ? `${title} | LocalCooks` : defaults.title;

  const pathForAlternates = canonicalUrl
    ? canonicalUrl.startsWith("/")
      ? canonicalUrl
      : `/${canonicalUrl}`
    : "/";

  const localizedPath = withLocalePrefix(pathForAlternates, locale);
  const fullCanonicalUrl = `${baseUrl}${localizedPath}`;

  const fullImageUrl = image.startsWith("http")
    ? image
    : `${baseUrl}${image.startsWith("/") ? "" : "/"}${image}`;

  const actualOgType = ogType || type;

  const websiteSchemaData = createWebsiteSchema(baseUrl);

  const webPageSchemaData = {
    ...createWebPageSchema({
      url: fullCanonicalUrl,
      name: pageTitle,
      description,
    }),
    inLanguage: locale,
  };

  return (
    <Helmet prioritizeSeoTags>
      <html lang={locale} />
      <title>{pageTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={fullCanonicalUrl} />

      {noIndex ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        <meta
          name="robots"
          content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
        />
      )}

      <meta name="geo.region" content="CA-NL" />
      <meta name="geo.placename" content="St. John's, Newfoundland" />
      <meta name="geo.position" content="47.5615;-52.7126" />
      <meta name="ICBM" content="47.5615, -52.7126" />

      {keywords && keywords.length > 0 ? (
        <meta name="keywords" content={keywords.join(", ")} />
      ) : (
        <meta
          name="keywords"
          content="local cooks, home chefs, homemade food, St Johns, Newfoundland, commercial kitchen rental, kitchen booking, food business, home chef compliance, food delivery NL, local chef near me, kitchen rental St Johns, food business Newfoundland, commercial kitchen NL, chef platform Canada"
        />
      )}

      <meta property="og:type" content={actualOgType} />
      <meta property="og:site_name" content={defaults.siteName} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={fullCanonicalUrl} />
      <meta property="og:image" content={fullImageUrl} />
      <meta property="og:image:alt" content={imageAlt} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:locale" content={getOgLocale(locale)} />
      {SUPPORTED_LOCALES.filter((l) => l !== locale).map((alt) => (
        <meta
          key={alt}
          property="og:locale:alternate"
          content={getOgLocale(alt)}
        />
      ))}

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

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={defaults.twitterHandle} />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={fullImageUrl} />
      <meta name="twitter:image:alt" content={imageAlt} />

      {SUPPORTED_LOCALES.map((alt) => (
        <link
          key={alt}
          rel="alternate"
          hrefLang={alt}
          href={`${baseUrl}${withLocalePrefix(pathForAlternates, alt)}`}
        />
      ))}
      <link
        rel="alternate"
        hrefLang="x-default"
        href={`${baseUrl}${withLocalePrefix(pathForAlternates, DEFAULT_LOCALE)}`}
      />

      <meta name="theme-color" content="#f51042" />
      <meta name="apple-mobile-web-app-title" content="LocalCooks" />
      <meta name="application-name" content="LocalCooks" />

      <script type="application/ld+json">
        {JSON.stringify(websiteSchemaData)}
      </script>

      <script type="application/ld+json">
        {JSON.stringify(webPageSchemaData)}
      </script>

      {showLocalBusiness && (
        <script type="application/ld+json">
          {JSON.stringify(createLocalBusinessSchema(rating))}
        </script>
      )}

      {siteNavigation && siteNavigation.length > 0 && (
        <script type="application/ld+json">
          {JSON.stringify(createSiteNavigationSchema(siteNavigation))}
        </script>
      )}

      {breadcrumbs && breadcrumbs.length > 0 && (
        <script type="application/ld+json">
          {JSON.stringify(createBreadcrumbSchema(breadcrumbs))}
        </script>
      )}

      {faq && faq.length > 0 && (
        <script type="application/ld+json">
          {JSON.stringify(createFAQSchema(faq))}
        </script>
      )}
    </Helmet>
  );
}
