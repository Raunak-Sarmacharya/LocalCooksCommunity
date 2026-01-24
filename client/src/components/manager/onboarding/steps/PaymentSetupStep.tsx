
import React from "react";
import { Info } from "lucide-react";
import StripeConnectSetup from "@/components/manager/StripeConnectSetup";

export default function PaymentSetupStep() {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
        <h3 className="text-lg font-semibold mb-1">Payment Setup</h3>
        <p className="text-sm text-gray-600 mb-4">
          Connect your Stripe account to receive payments directly for kitchen bookings. The platform service fee will be automatically deducted.
        </p>
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-purple-900">
            <p className="font-semibold mb-1">Why set up payments now?</p>
            <p>While you can skip this step and set it up later, connecting Stripe now ensures you're ready to receive payments as soon as bookings start. The setup process takes about 5 minutes.</p>
          </div>
        </div>
      </div>

      <StripeConnectSetup />
    </div>
  );
}
