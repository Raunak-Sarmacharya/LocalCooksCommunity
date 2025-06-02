import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Upload, FileText, CheckCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface DocumentUploadProps {
  onSuccess?: () => void;
}

export default function DocumentUpload({ onSuccess }: DocumentUploadProps) {
  const [foodSafetyFile, setFoodSafetyFile] = useState<File | null>(null);
  const [foodEstablishmentFile, setFoodEstablishmentFile] = useState<File | null>(null);
  const [foodSafetyUrl, setFoodSafetyUrl] = useState("");
  const [foodEstablishmentUrl, setFoodEstablishmentUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [uploadMethod, setUploadMethod] = useState<"file" | "url">("file");

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (data: {
      foodSafetyLicenseUrl?: string;
      foodEstablishmentCertUrl?: string;
    }) => {
      const headers: Record<string, string> = {};
      if (user?.id) {
        headers['X-User-ID'] = user.id.toString();
      }

      const response = await apiRequest("POST", "/api/document-verification", data, headers);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-verification/my-status"] });
      toast({
        title: "Documents Uploaded",
        description: "Your documents have been submitted for verification. We'll review them within 2-3 business days.",
      });
      if (onSuccess) onSuccess();
    },
    onError: (error) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload documents. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = async (file: File): Promise<string> => {
    // For now, we'll use a placeholder URL since we haven't implemented file storage
    // In a real application, you'd upload to a service like AWS S3, Cloudinary, etc.
    const mockUrl = `https://example.com/documents/${Date.now()}-${file.name}`;
    console.log(`Mock upload: ${file.name} -> ${mockUrl}`);
    return mockUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (uploadMethod === "file") {
      if (!foodSafetyFile) {
        toast({
          title: "Missing Required Document",
          description: "Food Safety License is required for verification.",
          variant: "destructive",
        });
        return;
      }

      try {
        const foodSafetyLicenseUrl = await handleFileUpload(foodSafetyFile);
        const foodEstablishmentCertUrl = foodEstablishmentFile
          ? await handleFileUpload(foodEstablishmentFile)
          : undefined;

        uploadMutation.mutate({
          foodSafetyLicenseUrl,
          foodEstablishmentCertUrl,
        });
      } catch (error) {
        toast({
          title: "File Upload Error",
          description: "Failed to upload files. Please try again.",
          variant: "destructive",
        });
      }
    } else {
      if (!foodSafetyUrl) {
        toast({
          title: "Missing Required Document",
          description: "Food Safety License URL is required for verification.",
          variant: "destructive",
        });
        return;
      }

      uploadMutation.mutate({
        foodSafetyLicenseUrl: foodSafetyUrl,
        foodEstablishmentCertUrl: foodEstablishmentUrl || undefined,
      });
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Document Verification
          </CardTitle>
          <CardDescription>
            Upload your documents to get verified and start cooking with the community.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Food Safety License</strong> is mandatory for verification.
              <br />
              <strong>Food Establishment Certificate</strong> is optional but recommended.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <Label className="text-base font-medium">Upload Method</Label>
            <div className="flex gap-4">
              <Button
                type="button"
                variant={uploadMethod === "file" ? "default" : "outline"}
                onClick={() => setUploadMethod("file")}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload Files
              </Button>
              <Button
                type="button"
                variant={uploadMethod === "url" ? "default" : "outline"}
                onClick={() => setUploadMethod("url")}
              >
                <FileText className="h-4 w-4 mr-2" />
                Provide URLs
              </Button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {uploadMethod === "file" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="foodSafetyFile" className="flex items-center gap-2">
                    <span className="text-red-500">*</span>
                    Food Safety License
                  </Label>
                  <Input
                    id="foodSafetyFile"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setFoodSafetyFile(e.target.files?.[0] || null)}
                    required
                  />
                  {foodSafetyFile && (
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      {foodSafetyFile.name}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="foodEstablishmentFile">
                    Food Establishment Certificate (Optional)
                  </Label>
                  <Input
                    id="foodEstablishmentFile"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setFoodEstablishmentFile(e.target.files?.[0] || null)}
                  />
                  {foodEstablishmentFile && (
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      {foodEstablishmentFile.name}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="foodSafetyUrl" className="flex items-center gap-2">
                    <span className="text-red-500">*</span>
                    Food Safety License URL
                  </Label>
                  <Input
                    id="foodSafetyUrl"
                    type="url"
                    placeholder="https://example.com/food-safety-license.pdf"
                    value={foodSafetyUrl}
                    onChange={(e) => setFoodSafetyUrl(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="foodEstablishmentUrl">
                    Food Establishment Certificate URL (Optional)
                  </Label>
                  <Input
                    id="foodEstablishmentUrl"
                    type="url"
                    placeholder="https://example.com/establishment-cert.pdf"
                    value={foodEstablishmentUrl}
                    onChange={(e) => setFoodEstablishmentUrl(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Additional Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Any additional information about your documents..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                "Uploading..."
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Submit Documents for Verification
                </>
              )}
            </Button>
          </form>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Accepted formats: PDF, JPG, JPEG, PNG. Maximum file size: 10MB per document.
              Make sure all text in your documents is clearly readable.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
} 