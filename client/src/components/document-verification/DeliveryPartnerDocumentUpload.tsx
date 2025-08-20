import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { DeliveryPartnerApplication } from "@shared/schema";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle, FileText, Upload, XCircle } from "lucide-react";
import { useState } from "react";

interface DeliveryPartnerDocumentUploadProps {
  application: DeliveryPartnerApplication;
  onDocumentUpdate: (field: string, url: string) => void;
}

const documentFields = [
  {
    key: 'driversLicenseUrl',
    label: 'Driver\'s License',
    description: 'Upload a clear photo or scan of your valid driver\'s license',
    required: true
  },
  {
    key: 'vehicleRegistrationUrl',
    label: 'Vehicle Registration',
    description: 'Upload your vehicle registration document',
    required: true
  },
  {
    key: 'insuranceUrl',
    label: 'Vehicle Insurance',
    description: 'Upload your vehicle insurance certificate',
    required: true
  },
  {
    key: 'backgroundCheckUrl',
    label: 'Background Check',
    description: 'Upload your background check certificate (if required)',
    required: false
  }
];

export default function DeliveryPartnerDocumentUpload({ 
  application, 
  onDocumentUpdate 
}: DeliveryPartnerDocumentUploadProps) {
  const { toast } = useToast();
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  // Initialize file upload hook
  const { uploadFile, isUploading, uploadProgress, error: uploadError } = useFileUpload({
    maxSize: 4.5 * 1024 * 1024, // 4.5MB (Vercel limit)
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    onSuccess: (response) => {
      toast({
        title: "File uploaded successfully",
        description: `${response.fileName} has been uploaded.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error,
        variant: "destructive",
      });
    }
  });

  const handleFileUpload = async (field: string, file: File) => {
    try {
      setUploadingField(field);
      
      const result = await uploadFile(file);
      
      if (result) {
        onDocumentUpdate(field, result.url);
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
    } finally {
      setUploadingField(null);
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

      // Validate file size (4.5MB limit for Vercel)
      if (file.size > 4.5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please upload a file smaller than 4.5MB.",
          variant: "destructive",
        });
        return;
      }

      handleFileUpload(field, file);
    }
  };

  const getFileStatus = (field: string) => {
    const hasFile = application[field as keyof DeliveryPartnerApplication] as string;
    const isUploading = uploadingField === field;
    
    if (isUploading) {
      return {
        icon: <Upload className="h-4 w-4 text-blue-600 animate-pulse" />,
        uploaded: false,
        uploading: true
      };
    }
    
    if (hasFile) {
      return {
        icon: <CheckCircle className="h-4 w-4 text-green-600" />,
        uploaded: true,
        uploading: false
      };
    }
    
    return {
      icon: <AlertCircle className="h-4 w-4 text-gray-400" />,
      uploaded: false,
      uploading: false
    };
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="text-sm font-medium text-blue-800 mb-2">Document Requirements</h4>
        <ul className="text-xs text-blue-700 space-y-1">
          <li>• All documents must be clear and legible</li>
          <li>• Accepted formats: JPEG, PNG, PDF</li>
          <li>• Maximum file size: 4.5MB per document</li>
          <li>• Documents will be securely stored and encrypted</li>
        </ul>
      </div>

      {documentFields.map((field) => {
        const status = getFileStatus(field.key);
        const currentUrl = application[field.key as keyof DeliveryPartnerApplication] as string;
        
        return (
          <motion.div 
            key={field.key} 
            className="space-y-3"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
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
                disabled={status.uploaded || status.uploading}
              />
              {status.uploaded && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onDocumentUpdate(field.key, '')}
                  className="text-red-600 hover:text-red-700"
                  disabled={status.uploading}
                >
                  <XCircle className="h-4 w-4" />
                  Remove
                </Button>
              )}
            </div>
            
            {status.uploaded && currentUrl && (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                <FileText className="h-4 w-4 text-green-600" />
                <a 
                  href={currentUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-green-700 hover:text-green-800 font-medium"
                >
                  View uploaded document
                </a>
              </div>
            )}
            
            {status.uploading && (
              <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <Upload className="h-4 w-4 text-blue-600 animate-spin" />
                <span className="text-sm text-blue-700">Uploading...</span>
                {uploadProgress > 0 && (
                  <div className="flex-1 bg-blue-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
