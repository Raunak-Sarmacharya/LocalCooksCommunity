import React from 'react';
import { useTranslation } from "react-i18next";
import { Calendar, ClipboardList, Check, Clock, Building2, CheckCircle2 } from "lucide-react";

export function KitchenNextStepsDescription({ type = "book" }: { type?: "book" | "tour" | "apply" }) {
  const { t } = useTranslation("kitchen");
  
  const isTour = type === "tour";
  
  const step1 = isTour ? { title: "1. Schedule", desc: "Pick a time to visit the kitchen." } : { title: "1. Apply", desc: "Submit basic details to the kitchen manager." };
  const step2 = isTour ? { title: "2. Confirm", desc: "The manager will confirm your tour request." } : { title: "2. Approval", desc: "Wait for the manager to review and approve you." };
  const step3 = isTour ? { title: "3. Visit", desc: "Check out the equipment and space in person." } : { title: "3. Book", desc: "Finalize your selected dates and pay." };

  return (
    <div className="space-y-6 mt-4">
      <p className="text-gray-600 text-[15px]">
        {t("authModalNextStepsFriendly", "We just need a few quick details to share with our kitchen partners so they can best accommodate your request. Here's a look at what happens next:")}
      </p>
      
      <div className="space-y-5">
        <div className="flex gap-4 items-start">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 border border-blue-100">
            {isTour ? <Calendar className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
          </div>
          <div>
            <h4 className="font-semibold text-gray-900">{step1.title}</h4>
            <p className="text-sm text-gray-500 mt-1">{step1.desc}</p>
          </div>
        </div>
        
        <div className="flex gap-4 items-start">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 border border-amber-100">
            {isTour ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          </div>
          <div>
            <h4 className="font-semibold text-gray-900">{step2.title}</h4>
            <p className="text-sm text-gray-500 mt-1">{step2.desc}</p>
          </div>
        </div>
        
        <div className="flex gap-4 items-start">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-600 border border-green-100">
            {isTour ? <Building2 className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          </div>
          <div>
            <h4 className="font-semibold text-gray-900">{step3.title}</h4>
            <p className="text-sm text-gray-500 mt-1">{step3.desc}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
