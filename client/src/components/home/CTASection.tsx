import { Button } from "@/components/ui/button";
import { useApplicationStatus } from "@/hooks/use-application-status";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

export default function CTASection() {
  const [, navigate] = useLocation();
  const { user } = useFirebaseAuth();
  const { getButtonText, getNavigationPath, isLoading } = useApplicationStatus();

  const handleChefClick = () => {
    if (!user) {
      navigate(`/auth`);
    } else {
      navigate(getNavigationPath());
    }
  };

  const handleDeliveryPartnerClick = () => {
    if (!user) {
      navigate(`/driver-auth`);
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
    } else if ((user as any)?.isDeliveryPartner) {
      return "Ready to Start Delivering?";
    } else if ((user as any)?.isChef) {
      return "Ready to Start Cooking?";
    } else {
      return "Join Local Cooks";
    }
  };

  const getDescriptionText = () => {
    if (user?.role === "admin") {
      return "Manage applications, users, and platform settings from your admin dashboard.";
    } else if ((user as any)?.isDeliveryPartner) {
      return "Manage your delivery applications and documentation.";
    } else if ((user as any)?.isChef) {
      return "Manage your chef applications and start cooking.";
    } else {
      return "Start your journey as a chef with Local Cooks.";
    }
  };


  return (
    <section className="py-12 md:py-16 px-4 bg-light-gray">
      <div className="container mx-auto text-center">
        <h2 className="text-2xl md:text-3xl font-bold mb-6">{getHeadingText()}</h2>
        <p className="text-lg max-w-2xl mx-auto mb-8">
          {getDescriptionText()}
        </p>

        {/* Guest Users - Show only chef option */}
        {!user && (
          <div className="space-y-6">
            <div className="flex justify-center">
              {/* Chef Registration */}
              <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 max-w-md w-full">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 bg-orange-100 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Chef</h3>
                  <p className="text-gray-600 text-sm mb-4">Share your culinary skills with the community</p>
                  <Button
                    onClick={handleChefClick}
                    className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 px-6 rounded-full"
                  >
                    Apply as Chef
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Logged-in Users - Show personalized button */}
        {user && (
          <div className="flex justify-center gap-4 flex-wrap mb-6">
            <Button
              onClick={handleChefClick}
              disabled={isLoading}
              className="bg-primary hover:bg-opacity-90 text-white font-bold py-3 px-8 rounded-full shadow-lg hover:-translate-y-1 hover-transform hover-shadow"
            >
              {isLoading ? "Loading..." : getPrimaryButtonText()}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
