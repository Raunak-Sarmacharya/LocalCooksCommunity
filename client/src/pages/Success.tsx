import ProgressIndicator from "@/components/application/ProgressIndicator";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { CheckCircle } from "lucide-react";
import { useLocation } from "wouter";

export default function Success() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  
  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <Header />
      <main className="flex-grow pt-20 md:pt-24 pb-12 md:pb-16">
        <div className="container mx-auto px-4 mb-6 md:mb-8">
          <ProgressIndicator step={4} />
        </div>
        
        <div className="container mx-auto px-4">
          <Card className="max-w-2xl mx-auto bg-white shadow-md md:shadow-lg">
            <CardContent className="p-5 md:p-8 text-center">
              <div className="slide-up">
                <div className="w-16 h-16 md:w-20 md:h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 md:mb-6">
                  <CheckCircle className="h-8 w-8 md:h-10 md:w-10 text-green-500" />
                </div>
                <h1 className="text-xl md:text-3xl font-bold mb-3 md:mb-4">Application Submitted!</h1>
                <p className="text-base md:text-lg mb-6 md:mb-8">
                  Thank you for applying to become a Local Cook. Our team will review your application 
                  and get back to you within 2-3 business days.
                </p>
                <p className="text-sm md:text-md mb-6 md:mb-8">
                  If you have any questions in the meantime, please contact us at{" "}
                  <a 
                    href="mailto:support@localcooks.ca" 
                    className="text-primary hover:underline hover-text"
                  >
                    support@localcooks.ca
                  </a>
                </p>
                <div className="flex flex-col sm:flex-row gap-3 md:gap-4 justify-center button-group">
                  <Button 
                    onClick={() => navigate("/")}
                    variant="outline"
                    className="border-primary text-primary hover:bg-primary hover:text-white hover-standard w-full sm:w-auto"
                  >
                    Return to Home
                  </Button>
                  
                  {user && (
                    <Button 
                      onClick={() => navigate("/dashboard")}
                      className="bg-primary hover:bg-opacity-90 text-white font-bold py-3 px-6 md:px-8 rounded-full shadow-lg hover:-translate-y-1 hover-transform hover-shadow w-full sm:w-auto"
                    >
                      Go to My Dashboard
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
