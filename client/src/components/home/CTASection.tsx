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
      return "Choose your path and start your journey with Local Cooks.";
    }
  };

  const getDeliveryPartnerDescription = () => {
    if (user?.role === "admin") {
      return "Manage both chef and delivery partner applications.";
    } else if ((user as any)?.isDeliveryPartner) {
      return "You're already a delivery partner! Manage your delivery applications and documentation.";
    } else if ((user as any)?.isChef) {
      return "You're registered as a chef. To become a delivery partner, please contact support.";
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

        {/* Guest Users - Show both options clearly */}
        {!user && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
              {/* Chef Registration */}
              <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300">
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

              {/* Delivery Partner Registration */}
              <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0M15 17a2 2 0 104 0" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Delivery Partner</h3>
                  <p className="text-gray-600 text-sm mb-4">Connect communities through reliable delivery</p>
                  <Button
                    onClick={handleDeliveryPartnerClick}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-full"
                  >
                    Apply as Driver
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
