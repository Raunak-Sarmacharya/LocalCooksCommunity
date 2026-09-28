import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { useIsChefShell } from "@/layouts/chef-shell-context";

type Props = {
  eyebrow: string;
  title: string;
  description: string;
  onBack: () => void;
  backLabel?: string;
  showCancel?: boolean;
  compactContent?: boolean;
  imageUrl?: string | null;
  children: ReactNode;
  aside: ReactNode;
};

export default function KitchenJourneyLayout({ eyebrow, title, description, onBack, backLabel = "Cancel", showCancel = true, compactContent = false, children, aside }: Props) {
  const inChefShell = useIsChefShell();
  return (
    <div className={inChefShell ? "bg-[#FFF8F5]" : "min-h-screen bg-gradient-to-b from-[#FFF8F5] via-white to-white"}>
      {!inChefShell && <Header />}
      <main className={inChefShell ? "mx-auto max-w-4xl px-4 pb-12 pt-4 sm:px-6 sm:pt-6" : "mx-auto max-w-4xl px-4 pb-16 pt-[calc(var(--header-total)_+_1.5rem)] sm:px-6 sm:pt-[calc(var(--header-total)_+_2rem)]"}>
        <header className="flex items-start justify-between gap-6 border-b border-[#2C2C2C]/10 pb-5">
          <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
          <h1 className="mt-1 text-xl font-semibold leading-tight tracking-tight text-[#1A1A1A] sm:text-2xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B6B6B]">{description}</p>
          </div>
          {showCancel && <Button variant="ghost" className="hidden shrink-0 gap-2 text-muted-foreground lg:inline-flex" onClick={onBack}><X className="h-4 w-4" aria-hidden />{backLabel}</Button>}
        </header>
        <div className="space-y-6 pt-5 sm:space-y-7 sm:pt-6">
          <aside>
            {aside}
          </aside>
          <div className={`mx-auto w-full min-w-0 lg:rounded-2xl lg:border lg:border-[#2C2C2C]/[0.08] lg:bg-white lg:p-8 lg:shadow-[0_8px_30px_rgba(44,44,44,0.05)] ${compactContent ? "lg:max-w-[642px]" : "lg:max-w-[746px]"}`}>
            {children}
            {showCancel && <div className="mt-8 border-t border-[#2C2C2C]/10 pt-4 lg:hidden">
              <Button variant="ghost" className="-ml-3 gap-2 text-muted-foreground" onClick={onBack}>
                <X className="h-4 w-4" aria-hidden /> {backLabel}
              </Button>
            </div>}
          </div>
        </div>
      </main>
    </div>
  );
}

export function KitchenJourneySteps({ steps, current, actions = {} }: { steps: string[]; current: number; actions?: Record<number, { label: string; onClick: () => void }> }) {
  return (
    <div>
      <div className="sm:hidden" role="status" aria-label={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Step {current + 1} of {steps.length} <span className="text-muted-foreground">· {steps[current]}</span></p>
          {Object.entries(actions).map(([index, action]) => <button key={index} type="button" onClick={action.onClick} className="shrink-0 rounded px-1 py-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{action.label}</button>)}
        </div>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {steps.map((label, index) => <span key={label} className={`h-1 flex-1 rounded-full ${index <= current ? "bg-primary" : "bg-muted"}`} />)}
        </div>
      </div>
      <ol className="hidden gap-4 sm:grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Request progress">
      {steps.map((label, index) => (
        <li key={label} aria-current={index === current ? "step" : undefined} className={`flex items-center gap-2 border-b-2 pb-3 text-sm ${index <= current ? "border-primary" : "border-border"}`}>
          <span className={index < current ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-white" : index === current ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary" : "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"}>
            {index < current ? <Check className="h-4 w-4" aria-hidden /> : index + 1}
          </span>
          {actions[index] ? <button type="button" onClick={actions[index].onClick} className="rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{actions[index].label}</button> : <span className={index <= current ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>}
        </li>
      ))}
      </ol>
    </div>
  );
}
