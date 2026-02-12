import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { 
  CheckCircle, 
  Mail, 
  Clock, 
  FileText, 
  Shield, 
  ArrowRight, 
  Home,
  LayoutDashboard,
  ChefHat,
  Sparkles
} from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { motion } from "framer-motion";

export default function Success() {
  const [, navigate] = useLocation();
  const { user } = useFirebaseAuth();

  // Scroll to top on mount - fixes the issue of page loading at bottom
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-green-50/50 via-white to-primary/5">
      <Header />
      <main className="flex-grow pt-24 md:pt-28 pb-12 md:pb-16">
        <div className="container mx-auto px-4 max-w-4xl">
          
          {/* Success Hero Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-8"
          >
            {/* Animated Success Icon */}
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="relative inline-block mb-6"
            >
              <div className="w-24 h-24 md:w-28 md:h-28 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center shadow-xl shadow-green-500/30">
                <CheckCircle className="h-12 w-12 md:h-14 md:w-14 text-white" />
              </div>
              {/* Sparkle decorations */}
              <motion.div 
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 }}
                className="absolute -top-2 -right-2"
              >
                <Sparkles className="h-6 w-6 text-yellow-500" />
              </motion.div>
              <motion.div 
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.6 }}
                className="absolute -bottom-1 -left-3"
              >
                <Sparkles className="h-5 w-5 text-yellow-400" />
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Badge variant="success" className="mb-4 px-4 py-1.5">
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                Application Received
              </Badge>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
                You're All Set!
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                Thank you for applying to become a LocalCooks chef. We're excited to review your application!
              </p>
            </motion.div>
          </motion.div>

          {/* Progress Timeline */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card className="mb-6 border-0 shadow-lg overflow-hidden">
              <div className="h-1.5 w-full bg-gradient-to-r from-green-500 via-primary to-blue-500" />
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  What Happens Next?
                </CardTitle>
                <CardDescription>Your application journey with LocalCooks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  {/* Timeline */}
                  <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-0">
                    {/* Step 1 - Completed */}
                    <div className="flex-1 relative">
                      <div className="flex md:flex-col items-start md:items-center gap-4 md:gap-3">
                        <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/30 flex-shrink-0">
                          <CheckCircle className="h-6 w-6 text-white" />
                        </div>
                        <div className="md:text-center">
                          <p className="font-semibold text-green-700">Application Submitted</p>
                          <p className="text-sm text-muted-foreground">Just now</p>
                        </div>
                      </div>
                      <div className="hidden md:block absolute top-6 left-1/2 w-full h-0.5 bg-gradient-to-r from-green-500 to-amber-400" />
                    </div>

                    {/* Step 2 - In Progress */}
                    <div className="flex-1 relative">
                      <div className="flex md:flex-col items-start md:items-center gap-4 md:gap-3">
                        <div className="w-12 h-12 rounded-full bg-amber-100 border-2 border-amber-400 flex items-center justify-center flex-shrink-0">
                          <FileText className="h-6 w-6 text-amber-600" />
                        </div>
                        <div className="md:text-center">
                          <p className="font-semibold text-amber-700">Under Review</p>
                          <p className="text-sm text-muted-foreground">2-3 business days</p>
                        </div>
                      </div>
                      <div className="hidden md:block absolute top-6 left-1/2 w-full h-0.5 bg-gradient-to-r from-amber-400 to-gray-300" />
                    </div>

                    {/* Step 3 - Pending */}
                    <div className="flex-1 relative">
                      <div className="flex md:flex-col items-start md:items-center gap-4 md:gap-3">
                        <div className="w-12 h-12 rounded-full bg-gray-100 border-2 border-gray-300 flex items-center justify-center flex-shrink-0">
                          <Shield className="h-6 w-6 text-gray-400" />
                        </div>
                        <div className="md:text-center">
                          <p className="font-semibold text-gray-500">Verification</p>
                          <p className="text-sm text-muted-foreground">Document check</p>
                        </div>
                      </div>
                      <div className="hidden md:block absolute top-6 left-1/2 w-full h-0.5 bg-gray-300" />
                    </div>

                    {/* Step 4 - Pending */}
                    <div className="flex-1">
                      <div className="flex md:flex-col items-start md:items-center gap-4 md:gap-3">
                        <div className="w-12 h-12 rounded-full bg-gray-100 border-2 border-gray-300 flex items-center justify-center flex-shrink-0">
                          <ChefHat className="h-6 w-6 text-gray-400" />
                        </div>
                        <div className="md:text-center">
                          <p className="font-semibold text-gray-500">Start Selling</p>
                          <p className="text-sm text-muted-foreground">You're live!</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Email Notification Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Card className="mb-6 border-blue-200 bg-gradient-to-r from-blue-50 to-blue-50/50">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Mail className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-blue-900 mb-1">Check Your Inbox</h3>
                    <p className="text-blue-800 mb-3">
                      We've sent a confirmation email with important details about your application and next steps.
                    </p>
                    <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-100/50 rounded-lg px-3 py-2 w-fit">
                      <Mail className="h-4 w-4" />
                      <span>Don't see it? Check your spam folder</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            {user && (
              <Button 
                size="lg"
                onClick={() => navigate("/dashboard")}
                className="rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all group"
              >
                <LayoutDashboard className="h-5 w-5 mr-2" />
                Go to My Dashboard
                <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            )}
            <Button 
              size="lg"
              variant="outline"
              onClick={() => navigate("/")}
              className="rounded-xl"
            >
              <Home className="h-5 w-5 mr-2" />
              Return to Home
            </Button>
          </motion.div>

          {/* Support Footer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="mt-8 text-center"
          >
            <Separator className="mb-6" />
            <p className="text-sm text-muted-foreground">
              Questions? Contact us at{" "}
              <a 
                href="mailto:support@localcooks.ca" 
                className="text-primary hover:underline font-medium"
              >
                support@localcooks.ca
              </a>
            </p>
          </motion.div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
