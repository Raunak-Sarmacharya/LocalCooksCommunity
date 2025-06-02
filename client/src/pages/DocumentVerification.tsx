import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import DocumentStatus from "@/components/document-verification/DocumentStatus";
import DocumentUpload from "@/components/document-verification/DocumentUpload";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  AlertCircle, 
  ArrowLeft, 
  FileText, 
  Upload,
  BadgeCheck
} from "lucide-react";
import { motion } from "framer-motion";

export default function DocumentVerification() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("status");
  const { user, isLoading: authLoading } = useAuth();

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth?redirect=/document-verification");
    }
  }, [user, authLoading, navigate]);

  // Check if user has approved application
  const { data: applications, isLoading: applicationsLoading } = useQuery({
    queryKey: ["/api/applications/my-applications"],
    queryFn: async ({ queryKey }) => {
      if (!user?.id) return [];

      const headers: Record<string, string> = {
        'X-User-ID': user.id.toString()
      };

      const response = await apiRequest("GET", queryKey[0] as string, undefined, headers);
      if (!response.ok) {
        throw new Error("Failed to fetch applications");
      }
      
      return response.json();
    },
    enabled: !!user,
  });

  const hasApprovedApplication = applications?.some((app: any) => app.status === 'approved');

  if (authLoading || applicationsLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-light-gray">
        <Header />
        <main className="flex-grow pt-28 pb-16">
          <div className="container mx-auto px-4 flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!hasApprovedApplication) {
    return (
      <div className="min-h-screen flex flex-col bg-light-gray">
        <Header />
        <main className="flex-grow pt-28 pb-16">
          <div className="container mx-auto px-4 max-w-2xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Document Verification
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      You need to have an approved application before you can upload verification documents.
                      Please complete and submit your application first.
                    </AlertDescription>
                  </Alert>
                  
                  <div className="mt-6 flex gap-4">
                    <Button onClick={() => navigate("/dashboard")}>
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to Dashboard
                    </Button>
                    <Button variant="outline" onClick={() => navigate("/apply")}>
                      Apply Now
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const handleUploadSuccess = () => {
    setActiveTab("status");
  };

  const handleUploadClick = () => {
    setActiveTab("upload");
  };

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <Header />
      <main className="flex-grow pt-28 pb-16">
        <div className="container mx-auto px-4 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-6"
          >
            {/* Page Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                  <BadgeCheck className="h-8 w-8" />
                  Document Verification
                </h1>
                <p className="text-gray-600 mt-2">
                  Get verified to unlock all platform features and build trust with the community.
                </p>
              </div>
              <Button 
                variant="outline" 
                onClick={() => navigate("/dashboard")}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </div>

            {/* Verification Process */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="status" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Verification Status
                </TabsTrigger>
                <TabsTrigger value="upload" className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Upload Documents
                </TabsTrigger>
              </TabsList>

              <TabsContent value="status" className="mt-6">
                <DocumentStatus 
                  showUploadPrompt={true}
                  onUploadClick={handleUploadClick}
                />
              </TabsContent>

              <TabsContent value="upload" className="mt-6">
                <DocumentUpload onSuccess={handleUploadSuccess} />
              </TabsContent>
            </Tabs>

            {/* Information Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Why Get Verified?</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h4 className="font-medium">Build Trust</h4>
                    <p className="text-sm text-muted-foreground">
                      Show the community that you're a legitimate food professional
                    </p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium">Unlock Features</h4>
                    <p className="text-sm text-muted-foreground">
                      Access premium features and advanced cooking opportunities
                    </p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium">Safety First</h4>
                    <p className="text-sm text-muted-foreground">
                      Help maintain high food safety standards in the community
                    </p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium">Priority Support</h4>
                    <p className="text-sm text-muted-foreground">
                      Get faster response times and dedicated customer support
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </main>
      <Footer />
    </div>
  );
} 