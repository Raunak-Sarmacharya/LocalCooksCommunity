import PrivacyContent from "@/components/legal/PrivacyContent";
import { LegalPage } from "@/components/legal/LegalPage";

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      description="The Local Cooks Privacy Policy: what we collect, why, who sees it, where it's stored, how long we keep it, and your rights under Canadian privacy law."
      path="/privacy"
    >
      <PrivacyContent />
    </LegalPage>
  );
}
