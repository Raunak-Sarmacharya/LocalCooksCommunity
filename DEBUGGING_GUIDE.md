# Document Upload Debugging Guide

## Issue Summary
Documents were being uploaded to Vercel Blob successfully, but the URLs were not being saved to NeonDB during application creation.

## Root Cause Identified
The frontend was using two different submission approaches incorrectly:
1. **File Upload Flow**: Frontend uploads files via `/api/upload-file`, gets URLs, then tries to send URLs via JSON
2. **Direct File Flow**: Frontend should send files directly via FormData to `/api/applications`

## Fix Applied

### Frontend Changes (`client/src/components/application/CertificationsForm.tsx`)
1. **Simplified submission logic**: 
   - If user selects files → Use FormData submission (backend handles blob upload)
   - If user provides URLs → Use JSON submission (backend uses provided URLs)
   - No more pre-uploading files then sending URLs

2. **Enhanced logging**: Added detailed console logs to track submission method

### Backend Changes (`server/routes.ts`)
1. **Enhanced request logging**: Added detailed logging to see what data is received
2. **Maintained existing logic**: Backend already supported both FormData and JSON submissions

## Testing Checklist

### Scenario 1: File Upload Submission
1. Go to application form (page 2)
2. Select "Yes" for Food Safety License
3. Upload a file using the file picker
4. Submit the form
5. **Expected**: Backend should log FormData submission and save blob URL to database

### Scenario 2: URL Input Submission  
1. Go to application form (page 2)
2. Select "Yes" for Food Safety License
3. Switch to "Provide URL" tab
4. Enter a URL (e.g., Google Drive link)
5. Submit the form
6. **Expected**: Backend should log JSON submission and save provided URL to database

### Scenario 3: No Documents
1. Go to application form (page 2)
2. Select "No" for both certifications
3. Submit the form
4. **Expected**: Application created without document URLs

## Debug Logs to Check

### Frontend Console
Look for these log messages:
```
🚀 Submitting application with data: {...}
📋 Submission method decision: { hasFileUploads: true/false, hasUploadedUrls: true/false, ... }
🎯 Form submission strategy: { hasFiles: true/false, hasUrls: true/false, ... }
📁 Submitting with files directly to backend  // File upload path
🔗 Submitting with pre-uploaded URLs        // URL input path
📝 Submitting without documents             // No documents path
```

### Backend Console
Look for these log messages:
```
=== APPLICATION SUBMISSION WITH DOCUMENTS ===
Request details: { method: 'POST', contentType: '...', hasFiles: true/false, ... }
📄 Uploading food safety license file...    // File upload detected
✅ Food safety license uploaded: [URL]      // Blob upload success
📄 Using provided food safety license URL: [URL]  // URL input detected
✅ Food safety license document provided, status set to pending
Final application data: { hasDocuments: true/false, documentUrls: {...} }
✅ Application created successfully: { id: X, hasDocuments: true/false }
```

## Database Verification

### Check Application Record
```sql
SELECT 
  id, 
  full_name, 
  food_safety_license,
  food_safety_license_url,
  food_safety_license_status,
  food_establishment_cert,
  food_establishment_cert_url,
  food_establishment_cert_status
FROM applications 
ORDER BY created_at DESC 
LIMIT 5;
```

### Expected Results
- Applications with file uploads should have:
  - `food_safety_license_url`: Vercel Blob URL (starts with `https://`)
  - `food_safety_license_status`: `"pending"`

## Manual Test Commands

### Test File Upload (if debugging locally)
```bash
curl -X POST http://localhost:3000/api/applications \
  -H "X-User-ID: 1" \
  -F "fullName=Test User" \
  -F "email=test@example.com" \
  -F "phone=+1234567890" \
  -F "foodSafetyLicense=yes" \
  -F "foodEstablishmentCert=no" \
  -F "kitchenPreference=commercial" \
  -F "foodSafetyLicense=@/path/to/test-document.pdf"
```

### Test URL Submission
```bash
curl -X POST http://localhost:3000/api/applications \
  -H "Content-Type: application/json" \
  -H "X-User-ID: 1" \
  -d '{
    "fullName": "Test User",
    "email": "test@example.com", 
    "phone": "+1234567890",
    "foodSafetyLicense": "yes",
    "foodEstablishmentCert": "no", 
    "kitchenPreference": "commercial",
    "foodSafetyLicenseUrl": "https://example.com/document.pdf"
  }'
```

## Success Indicators
1. ✅ Frontend logs show correct submission method
2. ✅ Backend logs show document URLs being processed
3. ✅ Database contains document URLs after submission
4. ✅ Admin interface shows documents when viewing applications
5. ✅ Quick Approve button appears for ready applications

## Common Issues
- **FormData not detected**: Check Content-Type header (should not be set manually for FormData)
- **Files not in req.files**: Ensure Multer middleware is working correctly
- **URLs not in req.body**: Check JSON parsing and Content-Type for JSON requests
- **Database not updated**: Check storage.createApplication() implementation 