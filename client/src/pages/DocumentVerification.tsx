import DocumentUpload from "@/components/document-verification/DocumentUpload";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Shield
} from "lucide-react";
import { Link } from "wouter";

export default function DocumentVerification() {
  const { user } = useFirebaseAuth();

  // Authentication guard
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50">
        <Header />
        <main className="flex-grow container max-w-4xl mx-auto px-4 pt-28 pb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <div className="w-16 h-16 mx-auto mb-6 bg-primary/10 rounded-full flex items-center justify-center">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-4 text-gray-900">Authentication Required</h1>
            <p className="text-gray-600 mb-6">
              You need to be logged in to access document verification.
            </p>
            <Button asChild className="rounded-xl">
              <Link href="/auth">Login</Link>
            </Button>
          </motion.div>
        </main>
        <Footer />
      </div>
    );
  }

  // Admin access guard
  if (user.role === "admin") {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50">
        <Header />
        <main className="flex-grow container max-w-4xl mx-auto px-4 pt-28 pb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <div className="w-16 h-16 mx-auto mb-6 bg-primary/10 rounded-full flex items-center justify-center">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-4 text-gray-900">Admin Access</h1>
            <p className="text-gray-600 mb-6">
              Administrators cannot upload documents as applicants. Use the admin dashboard to manage document verification for users.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild className="rounded-xl">
                <Link href="/admin">Go to Admin Dashboard</Link>
              </Button>
              <Button variant="outline" asChild className="rounded-xl">
                <Link href="/">Return to Home</Link>
              </Button>
            </div>
          </motion.div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50">
      <Header />
      <main className="flex-grow container max-w-4xl mx-auto px-4 pt-28 pb-8">
        {/* Back button */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-6"
        >
          <Button variant="outline" size="sm" asChild className="rounded-xl">
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Link>
          </Button>
        </motion.div>

        {/* Use the new DocumentUpload component */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <DocumentUpload forceShowForm={true} />
        </motion.div>
      </main>
      <Footer />
    </div>
  );
} 