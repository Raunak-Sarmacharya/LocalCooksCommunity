# Document Upload Debugging Guide

## Issue Description
Documents are being uploaded to Vercel blob storage successfully, but the document URLs aren't being updated in the applications table of the Neon database. This prevents admins from seeing the document URLs.

## Root Cause Analysis

The issue occurs in the document upload flow:

1. ✅ **File Upload Works**: Files upload to Vercel Blob correctly via `/api/upload-file`
2. ✅ **URLs Generated**: Vercel Blob URLs are returned successfully 
3. ❌ **Database Update Fails**: URLs aren't saved to the applications table

## Enhanced Debugging

I've added comprehensive logging to track the entire flow. Look for these log patterns:

### File Upload Logs
```
🔄 === FILE UPLOAD DEBUG START ===
📤 Upload: Session data: { ... }
✅ Upload: User authenticated: [userId]
☁️ Starting Vercel Blob upload...
✅ File uploaded to Vercel Blob successfully: [filename] -> [url]
📤 Upload successful, returning response: { url: "...", ... }
🔄 === FILE UPLOAD DEBUG END (SUCCESS) ===
```

### Document Update Logs
```
=== DOCUMENT UPLOAD DEBUG START ===
✅ User authenticated with ID: [userId]
✅ Application ID parsed: [applicationId]
📊 Database query result: { found: true, applicationStatus: "approved", ... }
✅ Application is approved, proceeding with document update
📄 Adding food safety license URL: [url]
🔄 Update data prepared: { food_safety_license_url: "...", ... }
💾 Starting database update...
💾 SQL Update query: { setClause: "...", values: [...], ... }
💾 Database update result: { rowCount: 1, success: true }
✅ Application document URLs updated successfully: { ... }
🔍 Verification query result: { found: true, data: { ... } }
=== DOCUMENT UPLOAD DEBUG END (SUCCESS) ===
```

## Debug Endpoints

I've added debug endpoints to help diagnose the issue:

### Check All Applications
```bash
GET /api/debug/applications
```

Returns a list of all applications with their document status:
```json
{
  "debug": true,
  "totalApplications": 5,
  "applicationsWithDocuments": 2,
  "applications": [
    {
      "id": 1,
      "status": "approved",
      "hasDocuments": true,
      "documentUrls": {
        "foodSafetyLicense": "✅ Present",
        "foodEstablishmentCert": "❌ Missing"
      }
    }
  ]
}
```

### Check Specific Application
```bash
GET /api/debug/applications/[ID]/documents
```

Returns detailed info about a specific application's documents:
```json
{
  "debug": true,
  "application": {
    "id": 1,
    "status": "approved",
    "documentUrls": {
      "foodSafetyLicense": "https://blob.vercel-storage.com/...",
      "foodEstablishmentCert": null
    },
    "hasDocuments": true
  },
  "rawDatabaseRow": { ... }
}
```

## Testing Steps

### 1. Check Current State
```bash
# Check all applications
curl http://localhost:5000/api/debug/applications

# Check specific application (replace 1 with actual ID)
curl http://localhost:5000/api/debug/applications/1/documents
```

### 2. Test File Upload
Upload a file and note the returned URL:
```bash
curl -X POST \
  -H "X-User-ID: [USER_ID]" \
  -F "file=@test-document.pdf" \
  http://localhost:5000/api/upload-file
```

Expected response:
```json
{
  "success": true,
  "url": "https://xxx.public.blob.vercel-storage.com/...",
  "fileName": "...",
  "size": 12345,
  "type": "application/pdf"
}
```

### 3. Test Document URL Update
Use the URL from step 2 to update an application:
```bash
curl -X PATCH \
  -H "Content-Type: application/json" \
  -H "X-User-ID: [USER_ID]" \
  -d '{"foodSafetyLicenseUrl": "https://xxx.public.blob.vercel-storage.com/..."}' \
  http://localhost:5000/api/applications/[APP_ID]/documents
```

### 4. Verify Database Update
Check if the URL was saved:
```bash
curl http://localhost:5000/api/debug/applications/[APP_ID]/documents
```

## Common Issues & Solutions

### Issue 1: Authentication Problems
**Symptoms**: `❌ Authentication failed - no userId found`
**Solution**: Ensure X-User-ID header is included in requests

### Issue 2: Application Not Approved
**Symptoms**: `❌ Application not approved: [status]`
**Solution**: Admin must approve the application first via admin panel

### Issue 3: Database Connection Issues
**Symptoms**: `❌ No database pool available`
**Solution**: Check DATABASE_URL environment variable

### Issue 4: Missing Document URLs in Request
**Symptoms**: `❌ No document URLs provided in request body`
**Solution**: Ensure the frontend is sending the URLs correctly after upload

### Issue 5: Session/User Mismatch
**Symptoms**: `❌ Access denied - user doesn't own application and is not admin`
**Solution**: Verify user ID matches application owner or user is admin

## Frontend Flow Verification

The correct flow should be:

1. **Upload File**: `POST /api/upload-file` → Returns Vercel Blob URL
2. **Update Document**: `PATCH /api/applications/:id/documents` with URL
3. **Verify Update**: Check database shows the URL

### Check Frontend Network Requests

In browser dev tools, verify:

1. File upload request returns valid URL
2. Document update request includes the URL in body
3. Document update request returns success
4. Subsequent API calls show the URL in database

## Environment Variables

Ensure these are set correctly:

```bash
# Database
DATABASE_URL=postgresql://...

# Vercel Blob (Production)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...

# Environment
NODE_ENV=production  # for production
VERCEL_ENV=production  # for Vercel
```

## Next Steps

1. **Deploy the enhanced logging** to production
2. **Test the document upload flow** and check logs
3. **Use debug endpoints** to verify database state
4. **Check frontend network requests** for any errors
5. **Verify environment variables** are set correctly

## Quick Fix Commands

If you find applications with missing URLs but uploaded documents exist:

```sql
-- Check current state
SELECT id, food_safety_license_url, food_establishment_cert_url 
FROM applications 
WHERE status = 'approved';

-- Manually update if needed (replace with actual URLs)
UPDATE applications 
SET food_safety_license_url = 'https://blob.vercel-storage.com/...'
WHERE id = [APPLICATION_ID];
```

The enhanced logging will help identify exactly where the process is failing and provide actionable insights for fixing the issue. 