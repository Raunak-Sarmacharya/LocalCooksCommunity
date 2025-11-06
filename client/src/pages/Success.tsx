import ProgressIndicator from "@/components/application/ProgressIndicator";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { CheckCircle } from "lucide-react";
import { useLocation } from "wouter";

export default function Success() {
  const [, navigate] = useLocation();
  const { user } = useFirebaseAuth();
  
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
                <p className="text-base md:text-lg mb-4 md:mb-6">
                  Thank you for applying to become a Local Cook. Our team will review your application 
                  and get back to you within 2-3 business days.
                </p>
                
                {/* Email reminder */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 md:p-5 mb-6 md:mb-8 text-left">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-blue-900 mb-2">Check Your Email</h3>
                      <p className="text-sm md:text-base text-blue-800 mb-2">
                        We've sent you a confirmation email with important information about your application.
                      </p>
                      <p className="text-sm md:text-base text-blue-800 font-medium">
                        📧 <strong>If you don't see it in your inbox, please check your spam folder.</strong>
                      </p>
                    </div>
                  </div>
                </div>

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
