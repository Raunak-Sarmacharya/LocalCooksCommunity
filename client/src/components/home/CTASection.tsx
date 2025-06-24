import { Button } from "@/components/ui/button";
import { useApplicationStatus } from "@/hooks/use-application-status";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

export default function CTASection() {
  const [, navigate] = useLocation();
  const { user } = useFirebaseAuth();
  const { getButtonText, getNavigationPath, isLoading } = useApplicationStatus();

  const handlePrimaryClick = () => {
    if (!user) {
      navigate(`/auth?redirect=/dashboard`);
    } else {
      navigate(getNavigationPath());
    }
  };

  const getPrimaryButtonText = () => {
    return getButtonText("Start an Application");
  };

  const getHeadingText = () => {
    if (user?.role === "admin") {
      return "Manage Local Cooks";
    } else {
      return "Ready to Start Cooking?";
    }
  };

  const getDescriptionText = () => {
    if (user?.role === "admin") {
      return "Review applications, manage documents, and oversee the Local Cooks community platform.";
    } else {
      return "Join our growing community of local cooks and share your culinary creations with food lovers in St. John's.";
    }
  };

  return (
    <section className="py-12 md:py-16 px-4 bg-light-gray">
      <div className="container mx-auto text-center">
        <h2 className="text-2xl md:text-3xl font-bold mb-6">{getHeadingText()}</h2>
        <p className="text-lg max-w-2xl mx-auto mb-8">
          {getDescriptionText()}
        </p>

        <div className="flex justify-center gap-4 flex-wrap">
          <Button
            onClick={handlePrimaryClick}
            disabled={isLoading}
            className="bg-primary hover:bg-opacity-90 text-white font-bold py-3 px-8 rounded-full shadow-lg hover:-translate-y-1 hover-transform hover-shadow"
          >
            {isLoading ? "Loading..." : getPrimaryButtonText()}
          </Button>
        </div>
      </div>
    </section>
  );
}
