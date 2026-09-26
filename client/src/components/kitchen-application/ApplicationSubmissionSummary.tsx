import { Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  kitchenName: string;
  title: string;
  description: string;
  nextStep: string;
  actionLabel: string;
  onAction: () => void;
};

export function ApplicationSubmissionSummary({ kitchenName, title, description, nextStep, actionLabel, onAction }: Props) {
  return (
    <section className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-labelledby="application-summary-title">
      <div className="border-b border-border px-6 py-7 sm:px-8">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{kitchenName}</p>
        <h2 id="application-summary-title" className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="px-6 py-6 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What happens next</p>
        <p className="mt-2 text-sm leading-6 text-foreground">{nextStep}</p>
        <Button onClick={onAction} className="mt-6 w-full sm:w-auto">
          {actionLabel}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
