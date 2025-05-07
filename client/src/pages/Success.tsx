import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ProgressIndicator from "@/components/application/ProgressIndicator";

export default function Success() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  
  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <Header />
      <main className="flex-grow pt-24 pb-16">
        <div className="container mx-auto px-4 mb-8">
          <ProgressIndicator step={4} />
        </div>
        
        <div className="container mx-auto px-4">
          <Card className="max-w-2xl mx-auto bg-white shadow-lg">
            <CardContent className="p-6 md:p-8 text-center">
              <div className="slide-up">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="h-10 w-10 text-green-500" />
                </div>
                <h1 className="text-2xl md:text-3xl font-bold mb-4">Application Submitted!</h1>
                <p className="text-lg mb-8">
                  Thank you for applying to become a Local Cook. Our team will review your application 
                  and get back to you within 2-3 business days.
                </p>
                <p className="text-md mb-8">
                  If you have any questions in the meantime, please contact us at{" "}
                  <a 
                    href="mailto:support@localcooks.ca" 
                    className="text-primary hover:underline"
                  >
                    support@localcooks.ca
                  </a>
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button 
                    onClick={() => navigate("/")}
                    variant="outline"
                    className="border-primary text-primary hover:bg-primary hover:text-white"
                  >
                    Return to Home
                  </Button>
                  
                  {user && (
                    <Button 
                      onClick={() => navigate("/dashboard")}
                      className="bg-primary hover:bg-opacity-90 text-white font-bold py-3 px-8 rounded-full shadow-lg transform transition hover:-translate-y-1"
                    >
                      View My Applications
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
