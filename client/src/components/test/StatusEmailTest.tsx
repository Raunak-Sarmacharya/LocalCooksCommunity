import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, AlertCircle, CheckCircle, Clock, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function StatusEmailTest() {
  const { toast } = useToast();
  const [status, setStatus] = useState<string>("new");
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [lastSentDetails, setLastSentDetails] = useState<{
    status: string;
    email: string;
    fullName: string;
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
          "/api/test/status-email",
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

  return (
    <Card className="w-full max-w-md mx-auto my-8">
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
                <div className="flex items-center gap-2">
                  {getStatusIcon(status)}
                  <SelectValue placeholder="Select status" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new" className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  <span>New</span>
                </SelectItem>
                <SelectItem value="inReview" className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  <span>In Review</span>
                </SelectItem>
                <SelectItem value="approved" className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span>Approved</span>
                </SelectItem>
                <SelectItem value="rejected" className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span>Rejected</span>
                </SelectItem>
                <SelectItem value="cancelled" className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-gray-500" />
                  <span>Cancelled</span>
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
  );
}
