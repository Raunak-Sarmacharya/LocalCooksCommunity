import TermsContent from "@/components/legal/TermsContent";
import { LegalPage } from "@/components/legal/LegalPage";

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      description="The Local Cooks Terms of Service: how bookings, payments, cancellations, payouts and damage claims work for kitchens and the customers who book them."
      path="/terms"
    >
      <TermsContent />
    </LegalPage>
  );
}
