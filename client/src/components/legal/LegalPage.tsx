import type { ReactNode } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import Header from "@/components/layout/Header";
import SEOHead from "@/components/SEO/SEOHead";

// shortcut: English only until counsel approves the October 2026 text; then add fr-CA and uk translations here.
const TRANSLATION_NOTE: Record<string, string> = {
  fr: "Ce document n'est offert qu'en anglais pour le moment. Une traduction française suivra.",
  uk: "Наразі цей документ доступний лише англійською. Український переклад з'явиться згодом.",
};

/** The public page around a legal document (Terms of Service, Privacy Policy). */
export function LegalPage({ title, description, path, children }: { title: string; description: string; path: string; children: ReactNode }) {
  const { i18n } = useTranslation();
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const note = TRANSLATION_NOTE[i18n.language.slice(0, 2)];

  return (
    <div className="flex min-h-screen flex-col bg-[#FBFAF9]">
      <SEOHead
        title={title}
        description={description}
        canonicalUrl={path}
        breadcrumbs={[
          { name: "LocalCooks", url: "https://www.localcooks.ca/" },
          { name: title, url: `https://chef.localcooks.ca${path}` },
        ]}
      />
      <Header />
      <main className="flex-grow pb-24 pt-[calc(var(--header-total)_+_3rem)]">
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
          {note && <p lang={i18n.language} className="mb-8 max-w-[44rem] rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100 lg:ml-[calc(13rem+3rem)]">{note}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
