import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Clock, Loader2, Mail, XCircle } from "lucide-react";
import { useState } from "react";

export default function StatusEmailTest() {
  const { toast } = useToast();
  const [status, setStatus] = useState<string>("inReview");
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [lastSentDetails, setLastSentDetails] = useState<{
    status: string;
    email: string;
    fullName: string;
    timestamp: string;
  } | null>(null);
  const [lastVerificationDetails, setLastVerificationDetails] = useState<{
    email: string;
    fullName: string;
    phone: string;
    timestamp: string;
  } | null>(null);

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "new": return <AlertCircle className="h-5 w-5 text-yellow-500" />;
      case "inReview": return <Clock className="h-5 w-5 text-blue-500" />;
      case "approved": return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "rejected": return <XCircle className="h-5 w-5 text-red-500" />;
      case "cancelled": return <XCircle className="h-5 w-5 text-gray-500" />;
      default: return null;
    }
  };

  // Format status for display
  const formatStatus = (status: string) => {
    switch (status) {
      case "new": return "New";
      case "inReview": return "In Review";
      case "approved": return "Approved";
      case "rejected": return "Rejected";
      case "cancelled": return "Cancelled";
      default: return status;
    }
  };

  // Mutation to test status change with email
  const testEmailMutation = useMutation({
    mutationFn: async (data: { status: string; email: string; fullName: string }) => {
      try {
        console.log("Testing status change email with:", data);
        const response = await apiRequest(
          "POST",
          "/api/test-status-email",
          data
        );
        return response.json();
      } catch (error) {
        console.error("Error testing status email:", error);
        throw error;
      }
    },
    onSuccess: (data, variables) => {
      // Store the details of the last sent email
      setLastSentDetails({
        status: variables.status,
        email: variables.email,
        fullName: variables.fullName,
        timestamp: new Date().toLocaleTimeString()
      });

      toast({
        title: "Test Email Sent",
        description: `A test email has been sent to ${variables.email} with status: ${formatStatus(variables.status)}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Error Sending Test Email",
        description: error.message || "Please check your email configuration.",
        variant: "destructive",
      });
    },
  });

  // Mutation to test full verification email
  const testVerificationEmailMutation = useMutation({
    mutationFn: async (data: { fullName: string; email: string; phone: string }) => {
      try {
        console.log("Testing full verification email with:", data);
        const response = await apiRequest(
          "POST",
          "/api/test-verification-email",
          data
        );
        return response.json();
      } catch (error) {
        console.error("Error testing verification email:", error);
        throw error;
      }
    },
    onSuccess: (data, variables) => {
      // Store the details of the last sent verification email
      setLastVerificationDetails({
        email: variables.email,
        fullName: variables.fullName,
        phone: variables.phone,
        timestamp: new Date().toLocaleTimeString()
      });

      toast({
        title: "Test Verification Email Sent",
        description: `A test verification email with vendor credentials has been sent to ${variables.email}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Error Sending Test Verification Email",
        description: error.message || "Please check your email configuration.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      toast({
        title: "Email Required",
        description: "Please enter an email address to send the test to.",
        variant: "destructive",
      });
      return;
    }

    if (!name) {
      toast({
        title: "Name Required",
        description: "Please enter a name for the test email.",
        variant: "destructive",
      });
      return;
    }

    testEmailMutation.mutate({
      status,
      email,
      fullName: name,
    });
  };

  const handleVerificationSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      toast({
        title: "Email Required",
        description: "Please enter an email address to send the test to.",
        variant: "destructive",
      });
      return;
    }

    if (!name) {
      toast({
        title: "Name Required",
        description: "Please enter a name for the test email.",
        variant: "destructive",
      });
      return;
    }

    if (!phone) {
      toast({
        title: "Phone Required",
        description: "Please enter a phone number for credential generation.",
        variant: "destructive",
      });
      return;
    }

    testVerificationEmailMutation.mutate({
      fullName: name,
      email,
      phone,
    });
  };

  return (
    <div className="space-y-8">
      {/* Status Change Email Test */}
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Test Status Change Email
          </CardTitle>
          <CardDescription>
            This tool lets you test email notifications for application status changes.
            Configure your email settings in the .env file before testing.
          </CardDescription>
        </CardHeader>

        {/* Show configuration alert */}
        <CardContent className="space-y-6">
          <Alert className="bg-amber-50 text-amber-800 border-amber-200">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Email Configuration Required</AlertTitle>
            <AlertDescription>
              Make sure you've configured the email settings in your .env file:
              <code className="block mt-2 p-2 bg-amber-100 rounded text-xs">
                EMAIL_HOST=smtp.hostinger.com<br />
                EMAIL_PORT=587<br />
                EMAIL_USER=your-email@domain.com<br />
                EMAIL_PASS=your-password
              </code>
            </AlertDescription>
          </Alert>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Test Email Address
              </label>
              <Input
                id="email"
                type="email"
                placeholder="Enter email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Recipient Name
              </label>
              <Input
                id="name"
                type="text"
                placeholder="Enter recipient name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="status" className="text-sm font-medium">
                Application Status
              </label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                      New
                    </div>
                  </SelectItem>
                  <SelectItem value="inReview">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-blue-500" />
                      In Review
                    </div>
                  </SelectItem>
                  <SelectItem value="approved">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Approved
                    </div>
                  </SelectItem>
                  <SelectItem value="rejected">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-red-500" />
                      Rejected
                    </div>
                  </SelectItem>
                  <SelectItem value="cancelled">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-gray-500" />
                      Cancelled
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={testEmailMutation.isPending}
            >
              {testEmailMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Test Email
                </>
              )}
            </Button>
          </form>
        </CardContent>

        {/* Show last sent email details */}
        {lastSentDetails && (
          <CardFooter className="flex flex-col items-start border-t pt-4">
            <h3 className="text-sm font-medium mb-2">Last Email Sent:</h3>
            <div className="bg-gray-50 p-3 rounded-md w-full text-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">Status:</span>
                <div className="flex items-center gap-1">
                  {getStatusIcon(lastSentDetails.status)}
                  <span>{formatStatus(lastSentDetails.status)}</span>
                </div>
              </div>
              <div className="mb-1">
                <span className="font-medium">To:</span> {lastSentDetails.email}
              </div>
              <div className="mb-1">
                <span className="font-medium">Name:</span> {lastSentDetails.fullName}
              </div>
              <div>
                <span className="font-medium">Time:</span> {lastSentDetails.timestamp}
              </div>
            </div>
          </CardFooter>
        )}
      </Card>

      {/* Full Verification Email Test */}
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Test Full Verification Email
          </CardTitle>
          <CardDescription>
            Test the email that sends vendor login credentials when users become fully verified.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <Alert className="bg-green-50 text-green-800 border-green-200">
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>Vendor Credentials Email</AlertTitle>
            <AlertDescription>
              This email includes auto-generated login credentials:
              <br />• Username: Phone number (digits only)
              <br />• Password: First 3 letters of name + last 4 digits of phone
            </AlertDescription>
          </Alert>

          <form onSubmit={handleVerificationSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="verification-email" className="text-sm font-medium">
                Test Email Address
              </label>
              <Input
                id="verification-email"
                type="email"
                placeholder="Enter email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="verification-name" className="text-sm font-medium">
                Full Name
              </label>
              <Input
                id="verification-name"
                type="text"
                placeholder="Enter full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="verification-phone" className="text-sm font-medium">
                Phone Number
              </label>
              <Input
                id="verification-phone"
                type="tel"
                placeholder="+1 (555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                pattern="^\+1\s[0-9\s\(\)\-\.]+$"
                title="Please enter a valid phone number in format: +1 (555) 123-4567"
                required
              />
              <p className="text-xs text-gray-500">
                Format: +1 (555) 123-4567
              </p>
            </div>

            <Button
              type="submit"
              className="w-full bg-green-600 hover:bg-green-700"
              disabled={testVerificationEmailMutation.isPending}
            >
              {testVerificationEmailMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Send Test Verification Email
                </>
              )}
            </Button>
          </form>
        </CardContent>

        {/* Show last sent verification email details */}
        {lastVerificationDetails && (
          <CardFooter className="flex flex-col items-start border-t pt-4">
            <h3 className="text-sm font-medium mb-2">Last Verification Email Sent:</h3>
            <div className="bg-green-50 p-3 rounded-md w-full text-sm">
              <div className="mb-1">
                <span className="font-medium">To:</span> {lastVerificationDetails.email}
              </div>
              <div className="mb-1">
                <span className="font-medium">Name:</span> {lastVerificationDetails.fullName}
              </div>
              <div className="mb-1">
                <span className="font-medium">Phone:</span> {lastVerificationDetails.phone}
              </div>
              <div className="mb-1">
                <span className="font-medium">Time:</span> {lastVerificationDetails.timestamp}
              </div>
              <div className="mt-2 pt-2 border-t border-green-200">
                <span className="font-medium text-green-700">Credentials Generated:</span>
                <div className="text-xs text-green-600 mt-1">
                  Username: {lastVerificationDetails.phone.replace(/[^0-9]/g, '')}
                  <br />
                  Password: {lastVerificationDetails.fullName.replace(/[^a-zA-Z]/g, '').toLowerCase().substring(0, 3)}{lastVerificationDetails.phone.replace(/[^0-9]/g, '').slice(-4)}
                </div>
              </div>
            </div>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
