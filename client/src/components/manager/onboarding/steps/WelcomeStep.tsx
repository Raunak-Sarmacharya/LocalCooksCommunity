
import React from "react";
import { Sparkles, Info } from "lucide-react";
import { useManagerOnboarding } from "../ManagerOnboardingContext";

export default function WelcomeStep() {
  const { handleNext } = useManagerOnboarding();

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-300">
      <div className="relative bg-gradient-to-br from-[#FFE8DD] via-[#FFF8F5] to-white border-2 border-rose-200/50 rounded-2xl p-8 shadow-xl overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#F51042]/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-rose-200/20 rounded-full blur-3xl"></div>

        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-gradient-to-br from-[#F51042] to-rose-500 rounded-2xl shadow-lg shadow-[#F51042]/30">
              <Sparkles className="h-8 w-8 text-white" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900">Getting Started</h3>
              <p className="text-gray-600 mt-1">
                We'll help you set up your kitchen space so chefs can start booking
              </p>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 mb-6 border border-rose-200">
            <p className="text-gray-700 font-medium">
              ⏱️ This process takes about <span className="text-[#F51042] font-semibold">5-10 minutes</span>
            </p>
          </div>

          <div className="space-y-3 mt-6">
            <StepPreview number={1} title="Location & Contact Info" desc="Tell us about your kitchen location, contact info, and upload your license (optional)" />
            <StepPreview number={2} title="Create Your Kitchen" desc="Set up your first kitchen space (you can add more later)" />
            <StepPreview number={3} title="Storage Listings" desc="Add storage options that chefs can book (Optional)" isOptional />
            <StepPreview number={4} title="Equipment Listings" desc="Add equipment options - you can skip and add these later (Optional)" isOptional />
          </div>

          <div className="mt-6 p-5 bg-white/95 backdrop-blur-sm rounded-xl border-2 border-rose-200 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-rose-100 rounded-lg">
                <Info className="h-5 w-5 text-[#F51042] flex-shrink-0" />
              </div>
              <div className="text-sm text-gray-700">
                <p className="font-bold mb-2 text-gray-900">Understanding the Structure:</p>
                <ul className="space-y-2">
                  <StructureItem label="Location" desc='Your business address (e.g., "Downtown Kitchen")' />
                  <StructureItem label="Kitchen" desc='A specific kitchen space within your location' />
                  <StructureItem label="Listings" desc='Storage and equipment that chefs can book' />
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepPreview({ number, title, desc, isOptional }: { number: number, title: string, desc: string, isOptional?: boolean }) {
  return (
    <div className="flex items-start gap-4 p-4 bg-white/90 backdrop-blur-sm rounded-xl border border-rose-100 hover:shadow-md hover:border-rose-200 transition-all duration-200 group">
      <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold shadow-lg transition-transform group-hover:scale-110 ${isOptional ? 'bg-gradient-to-br from-gray-400 to-gray-500' : 'bg-gradient-to-br from-[#F51042] to-rose-500 shadow-[#F51042]/30'}`}>
        {number}
      </div>
      <div className="flex-1">
        <h4 className="font-bold text-gray-900 mb-1">
          {title} {isOptional && <span className="text-xs font-normal text-gray-500">(Optional)</span>}
        </h4>
        <p className="text-sm text-gray-600">{desc}</p>
      </div>
    </div>
  );
}

function StructureItem({ label, desc }: { label: string, desc: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="text-[#F51042] font-bold mt-0.5">•</span>
      <span><strong className="text-gray-900">{label}</strong> - {desc}</span>
    </li>
  );
}
