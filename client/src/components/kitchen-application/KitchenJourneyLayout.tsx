import type { ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { useIsChefShell } from "@/layouts/chef-shell-context";

type Props = {
  eyebrow: string;
  title: string;
  description: string;
  onBack: () => void;
  imageUrl?: string | null;
  children: ReactNode;
  aside: ReactNode;
};

export default function KitchenJourneyLayout({ eyebrow, title, description, onBack, imageUrl, children, aside }: Props) {
  const inChefShell = useIsChefShell();
  return (
    <div className={inChefShell ? "bg-background rounded-[1.75rem]" : "min-h-screen bg-background"}>
      {!inChefShell && <Header />}
      <main className={inChefShell ? "mx-auto max-w-7xl px-4 pb-12 pt-4 sm:px-6 sm:pt-6 lg:px-10" : "mx-auto max-w-7xl px-4 pb-20 pt-24 sm:px-6 sm:pt-28 lg:px-10"}>
        <header className="relative isolate overflow-hidden rounded-[1.75rem] border border-primary/10 bg-gradient-to-br from-[#fff0f4] via-white to-[#fff9fa]">
          {imageUrl && <img src={imageUrl} alt="" className="absolute inset-y-0 right-0 hidden h-full w-[38%] object-cover lg:block" />}
          <div className={imageUrl ? "absolute inset-0 hidden bg-gradient-to-r from-[#fff0f4] via-white to-transparent lg:block" : "absolute -right-16 -top-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl"} aria-hidden />
          <div className="relative max-w-3xl px-6 py-9 sm:px-10 sm:py-11 lg:px-12">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{description}</p>
          </div>
        </header>
        <div className="grid gap-10 pt-10 lg:grid-cols-[minmax(270px,0.42fr)_minmax(0,1fr)] lg:gap-20 lg:pt-12">
          <aside className="h-fit border-t pt-8 lg:sticky lg:top-28 lg:border-t-0 lg:pr-10 lg:pt-0">
            {aside}
            <Button variant="ghost" className="-ml-3 mt-6 gap-2 text-muted-foreground" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back to kitchen details
            </Button>
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </main>
      
    </div>
  );
}

export function KitchenJourneySteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="space-y-3" aria-label="Request progress">
      {steps.map((label, index) => (
        <li key={label} className="flex items-center gap-3 text-sm">
          <span className={index < current ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white" : index === current ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary/10 font-semibold text-primary" : "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"}>
            {index < current ? <Check className="h-4 w-4" aria-hidden /> : index + 1}
          </span>
          <span className={index <= current ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
