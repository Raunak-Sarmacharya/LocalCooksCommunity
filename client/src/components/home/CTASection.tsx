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

  const handleDeliveryPartnerClick = () => {
    if (!user) {
      navigate(`/auth?redirect=/delivery-partner-apply`);
    } else {
      navigate('/delivery-partner-apply');
    }
  };

  const getPrimaryButtonText = () => {
    return getButtonText("Start an Application");
  };

  const getHeadingText = () => {
    if (user?.role === "admin") {
      return "Manage Local Cooks";
    } else if (user?.application_type === "delivery_partner") {
      return "Ready to Start Delivering?";
    } else {
      return "Ready to Start Cooking?";
    }
  };

  const getDescriptionText = () => {
    if (user?.role === "admin") {
      return "Review applications, manage documents, and oversee the Local Cooks community platform.";
    } else if (user?.application_type === "delivery_partner") {
      return "Join our delivery network and earn money while connecting local cooks with hungry customers.";
    } else {
      return "Join our growing community of local cooks and share your culinary creations with food lovers in St. John's.";
    }
  };

  const getDeliveryPartnerDescription = () => {
    if (user?.role === "admin") {
      return "Manage both chef and delivery partner applications.";
    } else {
      return "Or become a delivery partner and help bring delicious food to our community.";
    }
  };

  return (
    <section className="py-12 md:py-16 px-4 bg-light-gray">
      <div className="container mx-auto text-center">
        <h2 className="text-2xl md:text-3xl font-bold mb-6">{getHeadingText()}</h2>
        <p className="text-lg max-w-2xl mx-auto mb-8">
          {getDescriptionText()}
        </p>

        <div className="flex justify-center gap-4 flex-wrap mb-6">
          <Button
            onClick={handlePrimaryClick}
            disabled={isLoading}
            className="bg-primary hover:bg-opacity-90 text-white font-bold py-3 px-8 rounded-full shadow-lg hover:-translate-y-1 hover-transform hover-shadow"
          >
            {isLoading ? "Loading..." : getPrimaryButtonText()}
          </Button>
        </div>

        {/* Delivery Partner CTA - Only show for non-admin users */}
        {user?.role !== "admin" && (
          <div className="mt-8">
            <p className="text-sm text-gray-600 mb-4 max-w-lg mx-auto">
              {getDeliveryPartnerDescription()}
            </p>
            <Button
              onClick={handleDeliveryPartnerClick}
              variant="outline"
              className="border-2 border-primary text-primary hover:bg-primary hover:text-white font-bold py-3 px-8 rounded-full shadow-lg hover:-translate-y-1 hover-transform hover-shadow transition-all duration-300"
            >
              Become a Delivery Partner
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
