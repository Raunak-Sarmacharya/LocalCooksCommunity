import React from "react";
import { Sparkles, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useManagerOnboarding } from "../ManagerOnboardingContext";

export default function WelcomeStep() {
  const { handleNext } = useManagerOnboarding();

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-300">
      <Card className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-background border-primary/20">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-3xl"></div>

        <CardContent className="relative z-10 p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-primary rounded-2xl shadow-lg">
              <Sparkles className="h-8 w-8 text-primary-foreground" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-foreground">Getting Started</h3>
              <p className="text-muted-foreground mt-1">
                We&apos;ll help you set up your kitchen space so chefs can start booking
              </p>
            </div>
          </div>

          <div className="bg-background/80 backdrop-blur-sm rounded-xl p-4 mb-6 border border-primary/20">
            <p className="text-foreground font-medium">
              ⏱️ This process takes about <span className="text-primary font-semibold">5-10 minutes</span>
            </p>
          </div>

          <div className="space-y-3 mt-6">
            <StepPreview number={1} title="Location & Contact Info" desc="Tell us about your kitchen location, contact info, and upload your license (optional)" />
            <StepPreview number={2} title="Create Your Kitchen" desc="Set up your first kitchen space (you can add more later)" />
            <StepPreview number={3} title="Availability" desc="Set your opening hours" />
            <StepPreview number={4} title="Payments" desc="Connect your Stripe account to receive payouts" />
            <StepPreview number={5} title="Storage Listings" desc="Add storage options that chefs can book (Optional)" isOptional />
            <StepPreview number={6} title="Equipment Listings" desc="Add equipment options - you can skip and add these later (Optional)" isOptional />
          </div>

          <div className="mt-8 flex justify-end">
            <Button
              size="lg"
              onClick={() => handleNext()}
            >
              Start Setup <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StepPreview({ number, title, desc, isOptional }: { number: number, title: string, desc: string, isOptional?: boolean }) {
  return (
    <div className="flex items-start gap-4 p-4 bg-background/90 backdrop-blur-sm rounded-xl border border-border hover:shadow-md hover:border-primary/30 transition-all duration-200 group">
      <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-primary-foreground font-bold shadow-lg transition-transform group-hover:scale-110 ${isOptional ? 'bg-muted-foreground' : 'bg-primary'}`}>
        {number}
      </div>
      <div className="flex-1">
        <h4 className="font-bold text-foreground mb-1">
          {title} {isOptional && <span className="text-xs font-normal text-muted-foreground">(Optional)</span>}
        </h4>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}
