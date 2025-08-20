import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle, Upload } from "lucide-react";
import { useState } from "react";
import { useDeliveryPartnerForm } from "./DeliveryPartnerFormContext";

export default function DeliveryPartnerDocumentsForm() {
  const { formData, updateFormData, goToPreviousStep } = useDeliveryPartnerForm();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileUpload = async (field: string, file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      // Get Firebase token for authentication
      const token = await auth.currentUser?.getIdToken();
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData
      });

      if (response.ok) {
        const result = await response.json();
        updateFormData({ [field]: result.url });
        toast({
          title: "Document uploaded successfully",
          description: `${file.name} has been uploaded.`,
        });
      } else {
        throw new Error('Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: "There was an error uploading your document. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleFileChange = (field: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: "Invalid file type",
          description: "Please upload a JPEG, PNG, or PDF file.",
          variant: "destructive",
        });
        return;
      }

      // Validate file size (5MB limit)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please upload a file smaller than 5MB.",
          variant: "destructive",
        });
        return;
      }

      handleFileUpload(field, file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Get Firebase token for authentication
      const token = await auth.currentUser?.getIdToken();
      
      const response = await fetch('/api/delivery-partner-applications', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        toast({
          title: "Application submitted successfully!",
          description: "We'll review your application and get back to you soon.",
        });
        // Redirect to dashboard or success page
        window.location.href = '/dashboard';
      } else {
        const error = await response.json();
        throw new Error(error.message || 'Failed to submit application');
      }
    } catch (error) {
      console.error('Submission error:', error);
      toast({
        title: "Submission failed",
        description: "There was an error submitting your application. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getFileStatus = (field: string) => {
    const url = formData[field as keyof typeof formData];
    if (url) {
      return { uploaded: true, icon: <CheckCircle className="h-4 w-4 text-green-500" /> };
    }
    return { uploaded: false, icon: <AlertCircle className="h-4 w-4 text-gray-400" /> };
  };

  const documentFields = [
    {
      key: 'driversLicenseUrl',
      label: "Driver's License",
      description: "Upload a clear photo or scan of your driver's license",
      required: true
    },
    {
      key: 'vehicleRegistrationUrl',
      label: "Vehicle Registration",
      description: "Upload your vehicle registration document",
      required: true
    },
    {
      key: 'insuranceUrl',
      label: "Vehicle Insurance",
      description: "Upload proof of vehicle insurance",
      required: true
    },
    {
      key: 'backgroundCheckUrl',
      label: "Background Check (Optional)",
      description: "Upload a recent background check if you have one",
      required: false
    }
  ];

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      <div className="space-y-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-800 mb-2">Document Requirements</h4>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• All documents must be clear and legible</li>
            <li>• Accepted formats: JPEG, PNG, PDF</li>
            <li>• Maximum file size: 5MB per document</li>
            <li>• Documents will be securely stored and encrypted</li>
          </ul>
        </div>

        {documentFields.map((field) => {
          const status = getFileStatus(field.key);
          return (
            <div key={field.key} className="space-y-2">
              <Label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                {status.icon}
                {field.label}
                {field.required && <span className="text-red-500">*</span>}
              </Label>
              <p className="text-xs text-gray-500">{field.description}</p>
              
              <div className="flex items-center gap-3">
                <Input
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf"
                  onChange={(e) => handleFileChange(field.key, e)}
                  className="flex-1"
                  disabled={status.uploaded}
                />
                {status.uploaded && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => updateFormData({ [field.key]: undefined })}
                    className="text-red-600 hover:text-red-700"
                  >
                    Remove
                  </Button>
                )}
              </div>
              
              {status.uploaded && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  Document uploaded successfully
                </div>
              )}
            </div>
          );
        })}

        <div>
          <Label htmlFor="feedback" className="text-sm font-medium text-gray-700">
            Additional Information (Optional)
          </Label>
          <Textarea
            id="feedback"
            value={formData.feedback || ""}
            onChange={(e) => updateFormData({ feedback: e.target.value })}
            placeholder="Tell us anything else we should know about your application..."
            className="mt-1"
            rows={3}
          />
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={goToPreviousStep}
          className="flex-1 border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Back to Vehicle Details
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 bg-primary hover:bg-primary/90 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
              Submitting Application...
            </>
          ) : (
            <>
              Submit Application
              <Upload className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </motion.form>
  );
}
