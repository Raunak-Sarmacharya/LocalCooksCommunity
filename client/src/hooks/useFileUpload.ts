import { auth } from '@/lib/firebase';
import { useState } from 'react';

interface UploadResponse {
  success: boolean;
  url: string;
  fileName: string;
  size: number;
  type: string;
}

interface UseFileUploadOptions {
  maxSize?: number; // in bytes
  allowedTypes?: string[];
  onProgress?: (progress: number) => void;
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: string) => void;
}

export const useFileUpload = (options: UseFileUploadOptions = {}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const {
    maxSize = 4.5 * 1024 * 1024, // 4.5MB default (Vercel limit)
    allowedTypes = [],
    onProgress,
    onSuccess,
    onError
  } = options;

  const validateFile = (file: File): string | null => {
    if (file.size > maxSize) {
      return `File size exceeds 4.5MB limit`;
    }

    if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
      return `File type ${file.type} is not allowed`;
    }

    return null;
  };

  const uploadFile = async (file: File): Promise<UploadResponse | null> => {
    setError(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Validate file
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        onError?.(validationError);
        return null;
      }

      // Get Firebase auth token
      const currentUser = auth.currentUser;
      if (!currentUser) {
        const errorMsg = 'Authentication required. Please log in to upload files.';
        setError(errorMsg);
        onError?.(errorMsg);
        return null;
      }

      const idToken = await currentUser.getIdToken();

      // Create form data
      const formData = new FormData();
      formData.append('file', file);

      // Upload with progress tracking
      const xhr = new XMLHttpRequest();
      
      return new Promise<UploadResponse | null>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            setUploadProgress(progress);
            onProgress?.(progress);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            try {
              const response: UploadResponse = JSON.parse(xhr.responseText);
              onSuccess?.(response);
              resolve(response);
            } catch (parseError) {
              const errorMsg = 'Failed to parse upload response';
              setError(errorMsg);
              onError?.(errorMsg);
              resolve(null);
            }
          } else {
            try {
              const errorResponse = JSON.parse(xhr.responseText);
              const errorMsg = errorResponse.error || `Upload failed with status ${xhr.status}`;
              setError(errorMsg);
              onError?.(errorMsg);
              resolve(null);
            } catch {
              const errorMsg = `Upload failed with status ${xhr.status}`;
              setError(errorMsg);
              onError?.(errorMsg);
              resolve(null);
            }
          }
        });

        xhr.addEventListener('error', () => {
          const errorMsg = 'Network error during upload';
          setError(errorMsg);
          onError?.(errorMsg);
          resolve(null);
        });

        // Use the Firebase-authenticated upload endpoint
        xhr.open('POST', '/api/firebase/upload-file');
        xhr.withCredentials = true; // Include cookies and session
        
        // Add Firebase Authorization header
        xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
        
        console.log('Uploading file with Firebase authentication');
        
        xhr.send(formData);
      });

    } catch (uploadError) {
      const errorMsg = uploadError instanceof Error ? uploadError.message : 'Upload failed';
      setError(errorMsg);
      onError?.(errorMsg);
      return null;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const uploadMultipleFiles = async (files: File[]): Promise<UploadResponse[]> => {
    const results: UploadResponse[] = [];
    
    for (const file of files) {
      const result = await uploadFile(file);
      if (result) {
        results.push(result);
      }
    }
    
    return results;
  };

  return {
    uploadFile,
    uploadMultipleFiles,
    isUploading,
    uploadProgress,
    error,
    validateFile
  };
}; 