# 📁 File Upload Guide - Vercel Blob Storage

This guide explains how file uploads work in the Local Cooks application using **Vercel Blob Storage**, and how to implement the complete end-to-end file upload and document verification workflow.

## 🎯 Overview

The application handles **two types of file uploads**:

1. **Document Uploads** (during application submission)
   - Food Safety License certificates
   - Food Establishment certificates
   - Stored in Vercel Blob with admin access

2. **General File Uploads** (API endpoint for future expansion)
   - Generic file upload endpoint
   - Can be used for profile pictures, additional documents, etc.

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│                 │    │                  │    │                 │
│   Client Form   │────│  Express Server  │────│  Vercel Blob    │
│   (File Input)  │    │  (Multer +       │    │  (File Storage) │
│                 │    │   File Upload)   │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │                  │
                       │  Neon Database   │
                       │  (File URLs +    │
                       │   Metadata)      │
                       └──────────────────┘
```

**Flow:**
1. User selects files in form
2. Files uploaded to temporary server storage (Multer)
3. Files moved to Vercel Blob Storage
4. Blob URLs saved to database
5. Temporary files cleaned up

## ⚙️ Setup Instructions

### 1. Install Dependencies

```bash
npm install @vercel/blob multer
npm install -D @types/multer
```

### 2. Environment Configuration

Add to your `.env` file:

```bash
# Vercel Blob Storage
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_your_token_here

# Optional: Configure upload limits
MAX_FILE_SIZE=10485760  # 10MB in bytes
ALLOWED_FILE_TYPES=application/pdf,image/jpeg,image/jpg,image/png,image/webp
```

### 3. Get Vercel Blob Token

```bash
# Method 1: Vercel CLI
vercel blob create

# Method 2: Vercel Dashboard
# 1. Go to https://vercel.com/dashboard
# 2. Select your project
# 3. Go to Storage → Blob
# 4. Create new store or use existing
# 5. Copy the Read/Write Token
```

## 🔧 Implementation Details

### File Upload Endpoint (`/api/upload-file`)

```typescript
app.post("/api/upload-file",
  upload.single('file'),  // Multer middleware
  async (req: Request, res: Response) => {
    try {
      // 1. Authentication check
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // 2. File validation
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // 3. File type validation
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({ message: "Invalid file type" });
      }

      // 4. File size validation (10MB limit)
      if (req.file.size > 10 * 1024 * 1024) {
        return res.status(400).json({ message: "File too large (max 10MB)" });
      }

      // 5. Upload to Vercel Blob
      const fileBuffer = fs.readFileSync(req.file.path);
      const blob = await put(req.file.filename, fileBuffer, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN
      });

      // 6. Clean up temporary file
      fs.unlinkSync(req.file.path);

      // 7. Return blob URL
      res.json({
        success: true,
        url: blob.url,
        fileName: req.file.filename,
        size: req.file.size,
        type: req.file.mimetype
      });

    } catch (error) {
      // Error handling and cleanup
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ message: "Upload failed", error: error.message });
    }
  }
);
```

### Application Document Upload (During Form Submission)

```typescript
app.post("/api/applications", 
  upload.fields([
    { name: 'foodSafetyLicense', maxCount: 1 },
    { name: 'foodEstablishmentCert', maxCount: 1 }
  ]), 
  async (req: Request, res: Response) => {
    try {
      // 1. Validate form data
      const parsedData = insertApplicationSchema.safeParse(req.body);
      
      // 2. Handle uploaded files
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const documentUrls: { [key: string]: string } = {};

      if (files) {
        // Upload each document to Vercel Blob
        for (const [fieldName, fileArray] of Object.entries(files)) {
          if (fileArray && fileArray.length > 0) {
            const file = fileArray[0];
            
            // Upload to blob
            const fileBuffer = fs.readFileSync(file.path);
            const blob = await put(file.filename, fileBuffer, {
              access: 'public',
              token: process.env.BLOB_READ_WRITE_TOKEN
            });
            
            documentUrls[`${fieldName}Url`] = blob.url;
            
            // Clean up temp file
            fs.unlinkSync(file.path);
          }
        }
      }

      // 3. Save application with document URLs
      const applicationData = {
        ...parsedData.data,
        userId: req.user!.id,
        ...documentUrls  // Add document URLs
      };

      const [application] = await storage.insert(applications).values(applicationData).returning();
      
      res.status(201).json({
        message: "Application submitted successfully",
        application: application
      });

    } catch (error) {
      // Cleanup uploaded files on error
      if (req.files) {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        Object.values(files).flat().forEach(file => {
          try {
            fs.unlinkSync(file.path);
          } catch (e) {
            console.error('Error cleaning up file:', e);
          }
        });
      }
      
      res.status(500).json({ message: "Submission failed", error: error.message });
    }
  }
);
```

## 🛡️ Security Considerations

### File Type Validation

```typescript
const allowedMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/jpg', 
  'image/png',
  'image/webp'
];

// Validate MIME type
if (!allowedMimeTypes.includes(file.mimetype)) {
  throw new Error('Invalid file type');
}

// Additional extension check
const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
const fileExtension = path.extname(file.originalname).toLowerCase();
if (!allowedExtensions.includes(fileExtension)) {
  throw new Error('Invalid file extension');
}
```

### File Size Limits

```typescript
// In multer configuration
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 2 // Maximum 2 files per request
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});
```

### Authentication & Authorization

```typescript
// All file upload endpoints require authentication
if (!req.isAuthenticated()) {
  return res.status(401).json({ message: "Authentication required" });
}

// Admin-only endpoints (for file management)
if (req.user?.role !== 'admin') {
  return res.status(403).json({ message: "Admin access required" });
}
```

## 📱 Frontend Integration

### File Upload Component

```typescript
// File upload with progress
const uploadFile = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/upload-file', {
      method: 'POST',
      body: formData,
      credentials: 'include' // Include session cookies
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.url; // Vercel Blob URL
    
  } catch (error) {
    console.error('Upload error:', error);
    throw error;
  }
};
```

### Form Integration (Application Submission)

```typescript
// In application form component
const handleSubmit = async (formData: FormData) => {
  // Files are automatically handled by the form
  // Just ensure form has correct enctype
  
  const response = await fetch('/api/applications', {
    method: 'POST',
    body: formData, // Includes files + form data
    credentials: 'include'
  });

  if (response.ok) {
    const result = await response.json();
    console.log('Application submitted:', result.application);
  }
};
```

## 🔍 Admin File Access

### Document Verification

```typescript
// Admin can view uploaded documents
app.get("/api/files/documents/:filename", async (req: Request, res: Response) => {
  try {
    // 1. Admin authentication check
    if (!req.isAuthenticated() || req.user?.role !== 'admin') {
      return res.status(403).json({ message: "Admin access required" });
    }

    // 2. Find application with this document
    const application = await storage.select()
      .from(applications)
      .where(or(
        like(applications.foodSafetyLicenseUrl, `%${req.params.filename}%`),
        like(applications.foodEstablishmentCertUrl, `%${req.params.filename}%`)
      ))
      .limit(1);

    if (application.length === 0) {
      return res.status(404).json({ message: "Document not found" });
    }

    // 3. Get the blob URL and redirect
    const app = application[0];
    const documentUrl = app.foodSafetyLicenseUrl?.includes(req.params.filename) 
      ? app.foodSafetyLicenseUrl 
      : app.foodEstablishmentCertUrl;

    if (documentUrl) {
      res.redirect(documentUrl); // Redirect to Vercel Blob URL
    } else {
      res.status(404).json({ message: "Document URL not found" });
    }

  } catch (error) {
    res.status(500).json({ message: "Error accessing document", error: error.message });
  }
});
```

## 🐛 Troubleshooting

### Common Issues

#### 1. **"BLOB_READ_WRITE_TOKEN not found"**
```bash
# Solution: Set the environment variable
export BLOB_READ_WRITE_TOKEN=vercel_blob_rw_your_token_here

# For production, set in Vercel dashboard:
# Project Settings → Environment Variables
```

#### 2. **"Upload failed: File too large"**
```bash
# Check file size limits
echo "Current limit: 10MB"

# Increase limit in environment:
MAX_FILE_SIZE=20971520  # 20MB
```

#### 3. **"Invalid file type"**
```bash
# Check allowed types in code:
const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

# Common MIME type issues:
# - .jpg files might be 'image/jpeg'
# - Some PDFs might be 'application/octet-stream'
```

#### 4. **"Temporary files not cleaned up"**
```bash
# Check uploads directory
ls -la uploads/

# Manual cleanup (if needed)
rm -rf uploads/*

# This happens when error occurs before cleanup
# The code includes try/catch with cleanup
```

#### 5. **"Document not accessible in admin panel"**
```bash
# Check if Vercel Blob URLs are public
curl -I https://your-blob-url

# Should return 200 OK, not 403 Forbidden
# Ensure 'access: public' is set in put() call
```

### Debug Mode

```typescript
// Add debug logging
console.log('File received:', {
  filename: req.file?.filename,
  size: req.file?.size,
  mimetype: req.file?.mimetype
});

console.log('Blob upload result:', {
  url: blob.url,
  pathname: blob.pathname
});
```

### Testing File Upload

```bash
# Test with curl
curl -X POST \
  -H "Cookie: connect.sid=your-session-cookie" \
  -F "file=@test-document.pdf" \
  http://localhost:5000/api/upload-file

# Expected response:
{
  "success": true,
  "url": "https://xxx.public.blob.vercel-storage.com/test-document-xyz.pdf",
  "fileName": "test-document-xyz.pdf",
  "size": 12345,
  "type": "application/pdf"
}
```

## 📊 Monitoring & Analytics

### File Upload Metrics

```typescript
// Track upload metrics
const uploadMetrics = {
  totalUploads: 0,
  totalSize: 0,
  successRate: 0,
  averageSize: 0
};

// Log upload events
console.log('Upload successful:', {
  userId: req.user?.id,
  fileName: file.filename,
  size: file.size,
  type: file.mimetype,
  timestamp: new Date().toISOString()
});
```

### Vercel Blob Analytics

- Monitor storage usage in Vercel dashboard
- Track bandwidth usage
- Review access patterns
- Monitor costs

## 🎯 Best Practices

1. **Always validate file types** on both client and server
2. **Set reasonable file size limits** (10MB is good for documents)
3. **Clean up temporary files** in error scenarios
4. **Use authentication** for all upload endpoints
5. **Log upload events** for monitoring
6. **Test upload flow** thoroughly before deployment
7. **Monitor storage costs** in production
8. **Use public access** for documents that admins need to view
9. **Implement proper error handling** with user-friendly messages
10. **Consider file naming conventions** to avoid conflicts

---

## ✅ Quick Reference

### Upload a file via API:
```bash
curl -X POST -F "file=@document.pdf" \
  -H "Cookie: connect.sid=your-session" \
  /api/upload-file
```

### Submit application with documents:
```html
<form action="/api/applications" method="POST" enctype="multipart/form-data">
  <input type="file" name="foodSafetyLicense" accept=".pdf,.jpg,.png">
  <input type="file" name="foodEstablishmentCert" accept=".pdf,.jpg,.png">
  <!-- other form fields -->
  <button type="submit">Submit Application</button>
</form>
```

### View document (admin only):
```
GET /api/files/documents/{filename}
```

Your file upload system is now fully configured with Vercel Blob Storage! 🎉 