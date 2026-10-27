import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The layout for the Terms of Service and the Privacy Policy: a title block, a plain-language summary that says it is
 * not the contract, a contents list, and numbered sections at a readable width. `page` adds a sticky contents rail on
 * wide screens; `reader` (the agree screen's side panel) drops the title block, which the panel already shows.
 */
export type LegalSection = { id: string; title: string; body: ReactNode };

export function LegalDocument({ title, updated, effective, intro, summary, sections, variant = "page" }: {
  title: string;
  updated: string;
  effective: string;
  intro: ReactNode;
  summary: string[];
  sections: LegalSection[];
  variant?: "page" | "reader";
}) {
  // Opened from a link like /terms#storage-and-equipment: land on that section (the page renders after the route's own scroll).
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (variant !== "page" || !id) return;
    const timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
    return () => window.clearTimeout(timer);
  }, [variant]);
  const contents = (
    <nav aria-label="Contents">
      <p className="text-xs font-semibold text-slate-500">Contents</p>
      <ol className="mt-3 space-y-1.5 text-[13px] leading-snug">
        {sections.map((section, index) => (
          <li key={section.id}>
            <a href={`#${section.id}`} className="flex gap-2 text-slate-600 underline-offset-4 hover:text-slate-950 hover:underline">
              <span className="w-5 shrink-0 tabular-nums text-slate-400">{index + 1}.</span>{section.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );

  return (
    <div className={cn("legal-document text-slate-700", variant === "page" && "lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12")}>
      {variant === "page" && <aside className="hidden lg:block"><div className="sticky top-[calc(var(--header-total,4rem)+2rem)] max-h-[calc(100vh-var(--header-total,4rem)-4rem)] overflow-y-auto pb-4">{contents}</div></aside>}
      <article className="min-w-0 max-w-[44rem]">
        {variant === "page" && (
          <header>
            <h1 className="text-balance text-3xl font-bold tracking-[-0.025em] text-slate-950 md:text-[2.5rem] md:leading-tight">{title}</h1>
            <p className="mt-3 text-sm text-slate-500">Last updated {updated} · In effect from {effective}</p>
          </header>
        )}
        <div className={cn("space-y-4 text-[15px] leading-7", variant === "page" && "mt-8")}>{intro}</div>

        <section aria-labelledby="legal-summary" className="mt-8 rounded-2xl bg-slate-50 px-5 py-5 ring-1 ring-slate-200/70 sm:px-6">
          <h2 id="legal-summary" className="text-[15px] font-semibold text-slate-950">The short version</h2>
          <ul className="mt-3 space-y-2 text-[14px] leading-6">
            {summary.map(point => (
              <li key={point} className="flex gap-2.5"><span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#E10939]" />{point}</li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-slate-500">This summary helps you find your way. The full text below is what applies.</p>
        </section>

        <div className={cn("mt-8", variant === "page" && "lg:hidden")}>{contents}</div>

        <div className="mt-6">
          {sections.map((section, index) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-28 border-t border-slate-200/80 pt-8 mt-10 first:mt-6">
              <h2 id={`${section.id}-title`} className="text-xl font-bold tracking-[-0.015em] text-slate-950">
                <span className="mr-2 tabular-nums text-slate-400">{index + 1}.</span>{section.title}
              </h2>
              <div className="legal-body mt-4 space-y-4 text-[15px] leading-7">{section.body}</div>
            </section>
          ))}
        </div>
      </article>
      <style>{`
        .legal-document h3 { margin-top: 1.75rem; font-size: 1rem; font-weight: 600; color: rgb(15 23 42); }
        .legal-document .legal-body ul, .legal-document .legal-body ol { padding-left: 1.25rem; }
        .legal-document .legal-body ul { list-style: disc; }
        .legal-document .legal-body ol { list-style: decimal; }
        .legal-document .legal-body li { margin-top: 0.4rem; padding-left: 0.15rem; }
        .legal-document .legal-body li::marker { color: rgb(148 163 184); }
        .legal-document strong { font-weight: 600; color: rgb(15 23 42); }
        .legal-document .legal-body a { color: #C90832; text-decoration: underline; text-underline-offset: 3px; }
        .legal-document ::selection { background: rgb(225 9 57 / 0.15); }
      `}</style>
    </div>
  );
}
