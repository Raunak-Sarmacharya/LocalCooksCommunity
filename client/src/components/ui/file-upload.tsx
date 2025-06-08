import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { FileText, Upload, X } from "lucide-react";
import React, { useState } from "react";

interface FileUploadProps {
  fieldName: string;
  label: string;
  required?: boolean;
  currentFile?: File | null;
  onFileChange: (file: File | null) => void;
  accept?: string;
  maxSize?: number; // in MB
  description?: string;
  className?: string;
}

export function FileUpload({
  fieldName,
  label,
  required = false,
  currentFile,
  onFileChange,
  accept = ".pdf,.jpg,.jpeg,.png,.webp",
  maxSize = 10,
  description = "PDF, JPG, PNG, WebP files",
  className = ""
}: FileUploadProps) {
  const { toast } = useToast();
  const [isDragOver, setIsDragOver] = useState(false);

  const validateFile = (file: File): boolean => {
    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: `Please upload ${description} only.`,
        variant: "destructive",
      });
      return false;
    }
    
    // Validate file size
    if (file.size > maxSize * 1024 * 1024) {
      toast({
        title: "File too large",
        description: `Please upload files smaller than 3.5MB.`,
        variant: "destructive",
      });
      return false;
    }
    
    return true;
  };

  const handleFileSelect = (file: File | null) => {
    if (file && !validateFile(file)) {
      return;
    }
    onFileChange(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  return (
    <div className={`mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <Label htmlFor={fieldName} className="text-sm font-medium text-gray-700">
          {label} {required && <span className="text-red-500">*</span>}
        </Label>
        {currentFile && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleFileSelect(null)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      
      {currentFile ? (
        <div className="flex items-center space-x-3 p-3 bg-white rounded-md border border-gray-200">
          <FileText className="h-5 w-5 text-gray-500" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {currentFile.name}
            </p>
            <p className="text-xs text-gray-500">
              {(currentFile.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
        </div>
      ) : (
        <div 
          className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
            isDragOver 
              ? 'border-primary bg-primary/5' 
              : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Input
            id={fieldName}
            type="file"
            accept={accept}
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              handleFileSelect(file);
            }}
            className="hidden"
          />
          <Label htmlFor={fieldName} className="cursor-pointer">
            <div className="flex flex-col items-center space-y-2">
              <Upload className="h-8 w-8 text-gray-400" />
              <div className="text-sm text-gray-600">
                <span className="font-medium text-primary">Click to upload</span> or drag and drop
              </div>
              <p className="text-xs text-gray-500">
                {description} (max 3.5MB)
              </p>
            </div>
          </Label>
        </div>
      )}
    </div>
  );
}

export default FileUpload; 