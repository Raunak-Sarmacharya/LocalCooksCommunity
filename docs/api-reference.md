# 🔌 API Reference

Complete API documentation for the Local Cooks application.

## 🎯 Overview

The Local Cooks API provides endpoints for:
- **Authentication** (OAuth + local accounts)
- **Application Management** (submit, review, approve)
- **File Upload** (documents, images)
- **Admin Functions** (application review, document verification)
- **User Management** (registration, login, profile)

**Base URL**: `https://your-app.vercel.app/api`  
**Authentication**: Session-based with Passport.js  
**Content-Type**: `application/json` or `multipart/form-data` (for file uploads)

---

## 🔐 Authentication Endpoints

### Login with Username/Password
```http
POST /api/login
Content-Type: application/json

{
  "username": "user@example.com",
  "password": "password123"
}
```

**Response** (200 OK):
```json
{
  "message": "Login successful",
  "user": {
    "id": 1,
    "username": "user@example.com",
    "role": "applicant",
    "isVerified": false
  }
}
```

**Error** (401 Unauthorized):
```json
{
  "message": "Invalid username or password"
}
```

### Register New Account
```http
POST /api/register
Content-Type: application/json

{
  "username": "newuser@example.com",
  "password": "password123"
}
```

**Response** (201 Created):
```json
{
  "message": "User registered successfully",
  "user": {
    "id": 2,
    "username": "newuser@example.com",
    "role": "applicant",
    "isVerified": false
  }
}
```

### Admin Login
```http
POST /api/admin-login
Content-Type: application/json

{
  "username": "admin",
  "password": "localcooks"
}
```

**Response** (200 OK):
```json
{
  "message": "Admin login successful",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "isVerified": true
  }
}
```

### OAuth Authentication

#### Google OAuth
```http
GET /api/auth/google
```
Redirects to Google OAuth consent screen.

#### Google OAuth Callback
```http
GET /api/auth/google/callback?code=...&state=...
```
Handles Google OAuth callback and creates/logs in user.

#### Facebook OAuth
```http
GET /api/auth/facebook
```
Redirects to Facebook OAuth consent screen.

#### Facebook OAuth Callback
```http
GET /api/auth/facebook/callback?code=...
```
Handles Facebook OAuth callback and creates/logs in user.

### Check User Existence
```http
GET /api/user-exists?username=user@example.com
```

**Response** (200 OK):
```json
{
  "exists": true,
  "username": "user@example.com"
}
```

---

## 📝 Application Endpoints

### Submit Application
```http
POST /api/applications
Content-Type: multipart/form-data
Authorization: Required (logged in user)

# Form fields:
fullName: John Doe
email: john@example.com
phone: +1-555-123-4567
foodSafetyLicense: yes|no|notSure
foodEstablishmentCert: yes|no|notSure
kitchenPreference: commercial|home|notSure
feedback: Optional feedback text

# File fields:
foodSafetyLicense: [PDF/Image file]
foodEstablishmentCert: [PDF/Image file]
```

**Response** (201 Created):
```json
{
  "message": "Application submitted successfully",
  "application": {
    "id": 123,
    "userId": 1,
    "fullName": "John Doe",
    "email": "john@example.com",
    "phone": "+1-555-123-4567",
    "foodSafetyLicense": "yes",
    "foodEstablishmentCert": "yes",
    "kitchenPreference": "commercial",
    "feedback": "Excited to join!",
    "status": "new",
    "foodSafetyLicenseUrl": "https://blob.vercel-storage.com/license-abc123.pdf",
    "foodEstablishmentCertUrl": "https://blob.vercel-storage.com/cert-def456.pdf",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

**Error** (400 Bad Request):
```json
{
  "message": "Validation error",
  "errors": [
    {
      "field": "email",
      "message": "Please enter a valid email address"
    }
  ]
}
```

### Get All Applications (Admin Only)
```http
GET /api/applications
Authorization: Required (admin role)
```

**Response** (200 OK):
```json
{
  "applications": [
    {
      "id": 123,
      "userId": 1,
      "fullName": "John Doe",
      "email": "john@example.com",
      "phone": "+1-555-123-4567",
      "foodSafetyLicense": "yes",
      "foodEstablishmentCert": "yes",
      "kitchenPreference": "commercial",
      "feedback": "Excited to join!",
      "status": "new",
      "foodSafetyLicenseUrl": "https://blob.vercel-storage.com/license-abc123.pdf",
      "foodEstablishmentCertUrl": "https://blob.vercel-storage.com/cert-def456.pdf",
      "foodSafetyLicenseStatus": "pending",
      "foodEstablishmentCertStatus": "pending",
      "documentsAdminFeedback": null,
      "documentsReviewedBy": null,
      "documentsReviewedAt": null,
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Get My Applications
```http
GET /api/applications/my-applications
Authorization: Required (logged in user)
```

**Response** (200 OK):
```json
{
  "applications": [
    {
      "id": 123,
      "fullName": "John Doe",
      "email": "john@example.com",
      "status": "inReview",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Get Single Application
```http
GET /api/applications/123
Authorization: Required (admin or application owner)
```

**Response** (200 OK):
```json
{
  "application": {
    "id": 123,
    "userId": 1,
    "fullName": "John Doe",
    "email": "john@example.com",
    "phone": "+1-555-123-4567",
    "foodSafetyLicense": "yes",
    "foodEstablishmentCert": "yes",
    "kitchenPreference": "commercial",
    "feedback": "Excited to join!",
    "status": "approved",
    "foodSafetyLicenseUrl": "https://blob.vercel-storage.com/license-abc123.pdf",
    "foodEstablishmentCertUrl": "https://blob.vercel-storage.com/cert-def456.pdf",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

### Update Application Status (Admin Only)
```http
PATCH /api/applications/123/status
Content-Type: application/json
Authorization: Required (admin role)

{
  "status": "approved"
}
```

**Valid Status Values**: `new`, `inReview`, `approved`, `rejected`, `cancelled`

**Response** (200 OK):
```json
{
  "message": "Application status updated successfully",
  "application": {
    "id": 123,
    "status": "approved",
    "updatedAt": "2024-01-15T11:00:00Z"
  }
}
```

### Cancel Application
```http
PATCH /api/applications/123/cancel
Authorization: Required (application owner)
```

**Response** (200 OK):
```json
{
  "message": "Application cancelled successfully",
  "application": {
    "id": 123,
    "status": "cancelled"
  }
}
```

### Update Application Documents
```http
PATCH /api/applications/123/documents
Content-Type: multipart/form-data
Authorization: Required (application owner)

# File fields:
foodSafetyLicense: [PDF/Image file]
foodEstablishmentCert: [PDF/Image file]
```

**Response** (200 OK):
```json
{
  "message": "Documents updated successfully",
  "application": {
    "id": 123,
    "foodSafetyLicenseUrl": "https://blob.vercel-storage.com/new-license-xyz789.pdf",
    "foodEstablishmentCertUrl": "https://blob.vercel-storage.com/new-cert-uvw456.pdf",
    "foodSafetyLicenseStatus": "pending",
    "foodEstablishmentCertStatus": "pending"
  }
}
```

### Update Document Verification (Admin Only)
```http
PATCH /api/applications/123/document-verification
Content-Type: application/json
Authorization: Required (admin role)

{
  "foodSafetyLicenseStatus": "approved",
  "foodEstablishmentCertStatus": "rejected",
  "documentsAdminFeedback": "Food safety license looks good. Please upload a clearer food establishment certificate."
}
```

**Valid Verification Status**: `pending`, `approved`, `rejected`

**Response** (200 OK):
```json
{
  "message": "Document verification updated successfully",
  "application": {
    "id": 123,
    "foodSafetyLicenseStatus": "approved",
    "foodEstablishmentCertStatus": "rejected",
    "documentsAdminFeedback": "Food safety license looks good. Please upload a clearer food establishment certificate.",
    "documentsReviewedBy": 1,
    "documentsReviewedAt": "2024-01-15T12:00:00Z"
  }
}
```

---

## 📁 File Upload Endpoints

### Upload Single File
```http
POST /api/upload-file
Content-Type: multipart/form-data
Authorization: Required (logged in user)

# Form field:
file: [PDF/Image file]
```

**Supported File Types**: 
- `application/pdf`
- `image/jpeg`, `image/jpg`
- `image/png`
- `image/webp`

**File Size Limit**: 10MB

**Response** (200 OK):
```json
{
  "success": true,
  "url": "https://xxx.public.blob.vercel-storage.com/filename-xyz123.pdf",
  "fileName": "filename-xyz123.pdf",
  "size": 1234567,
  "type": "application/pdf"
}
```

**Error** (400 Bad Request):
```json
{
  "message": "Invalid file type. Allowed types: PDF, JPG, PNG, WebP"
}
```

**Error** (413 Payload Too Large):
```json
{
  "message": "File too large (max 10MB)"
}
```

### Access Document (Admin Only)
```http
GET /api/files/documents/filename-xyz123.pdf
Authorization: Required (admin role)
```

**Response**: Redirects to Vercel Blob URL for direct file access.

**Error** (404 Not Found):
```json
{
  "message": "Document not found"
}
```

---

## 🧪 Testing & Development Endpoints

### Test Status Email
```http
POST /api/test-status-email
Content-Type: application/json
Authorization: Required (admin role)

{
  "applicationId": 123,
  "status": "approved"
}
```

**Response** (200 OK):
```json
{
  "message": "Test email sent successfully",
  "emailDetails": {
    "to": "john@example.com",
    "subject": "Application Status Update - Local Cooks",
    "status": "approved"
  }
}
```

---

## 📊 Response Codes & Error Handling

### HTTP Status Codes

| Code | Description | When Used |
|------|-------------|-----------|
| `200` | OK | Successful GET, PATCH operations |
| `201` | Created | Successful POST operations (registration, application submission) |
| `400` | Bad Request | Validation errors, malformed requests |
| `401` | Unauthorized | Not logged in, invalid credentials |
| `403` | Forbidden | Insufficient permissions (e.g., non-admin accessing admin endpoint) |
| `404` | Not Found | Resource doesn't exist |
| `413` | Payload Too Large | File upload exceeds size limit |
| `500` | Internal Server Error | Server-side errors |

### Error Response Format

All error responses follow this format:

```json
{
  "message": "Human-readable error description",
  "error": "Technical error details (development mode only)",
  "errors": [
    {
      "field": "fieldName",
      "message": "Field-specific error message"
    }
  ]
}
```

### Validation Errors

Form validation uses Zod schemas. Common validation errors:

```json
{
  "message": "Validation error",
  "errors": [
    {
      "field": "email",
      "message": "Please enter a valid email address"
    },
    {
      "field": "phone",
      "message": "Please enter a valid phone number"
    },
    {
      "field": "fullName",
      "message": "Name must be at least 2 characters"
    }
  ]
}
```

---

## 🎓 Microlearning & Training Endpoints

### Get User Progress
```http
GET /api/microlearning/progress/:userId
```
- Returns progress for all 22 videos (see video ID list in microlearning-system.md)
- Requires authentication

### Update Video Progress
```http
POST /api/microlearning/progress
Content-Type: application/json

{
  "userId": 1,
  "videoId": "basics-cross-contamination",
  "progress": 100,
  "completed": true,
  "watchedPercentage": 100
}
```
- Updates progress for a single video
- Enforces access control (sequential, module unlocks)
- Triggers auto-advance in the UI

### Complete All Training
```http
POST /api/microlearning/complete
Content-Type: application/json

{
  "userId": 1,
  "completionDate": "2024-06-08T12:00:00Z",
  "videoProgress": [ ... ]
}
```
- Requires all 22 videos to be completed
- Returns certificate info

### Get Certificate
```http
GET /api/microlearning/certificate/:userId
```
- Returns certificate URL if training is complete

## Performance & Bundle Optimization
- **Code Splitting**: Microlearning and admin modules are lazy-loaded
- **Manual Chunking**: Vendor libraries are split for optimal caching
- **Result**: Faster load times, no build warnings

## See also
- [microlearning-system.md](./microlearning-system.md) for full video list and access logic

### Get Application Status
```http
GET /api/application-status
Authorization: Required (User)
```

**Response** (200 OK):
```json
{
  "userId": 123,
  "hasApplication": true,
  "applicationStatus": "approved|pending|rejected|new",
  "accessLevel": "limited|full",
  "applicationInfo": {
    "id": 456,
    "status": "approved",
    "submittedAt": "2024-01-10T08:00:00Z",
    "reviewedAt": "2024-01-12T14:30:00Z"
  }
}
```

**Access Levels:**
- **Limited**: First training module only (for unapproved users)
- **Full**: All 10 training modules + preparation completion (for approved users)

**Training Modules:**

**Module 1 - Food Safety Basics (14 videos):**
1. `basics-cross-contamination` - An Introduction
2. `basics-allergen-awareness` - Basic Conditions of HACCP
3. `basics-cooking-temps` - Reducing Complexity
4. `basics-temperature-danger` - Personal Hygiene
5. `basics-personal-hygiene` - Deliveries
6. `basics-food-storage` - Storage
7. `basics-illness-reporting` - Preparation
8. `basics-food-safety-plan` - Regeneration
9. `basics-pest-control` - To Start
10. `basics-chemical-safety` - After Service
11. `basics-fifo` - Waste Removal
12. `basics-receiving` - Cleaning and Maintenance
13. `basics-cooling-reheating` - Weekly Log Sheets
14. `basics-thawing` - Wrap Up

**Module 2 - Safety & Hygiene How-To's (8 videos):**
15. `howto-handwashing` - How to Wash Your Hands
16. `howto-sanitizing` - How to clean a food preparation station
17. `howto-thermometer` - How to clean kitchen utensils
18. `howto-cleaning-schedule` - How to clean a stove
19. `howto-equipment-cleaning` - How to clean a kitchen floor
20. `howto-uniform-care` - How to clean a restaurant floor
21. `howto-wound-care` - How to clean tables and chairs
22. `howto-inspection-prep` - How to clean a washroom

---

## 🔒 Authentication & Authorization

### Session-Based Authentication

The API uses session-based authentication with cookies:

```http
Cookie: connect.sid=s%3A...
```

Sessions are automatically managed by the frontend. After login, all subsequent requests include the session cookie.

### Authorization Levels

1. **Public** - No authentication required
2. **Authenticated User** - Must be logged in
3. **Application Owner** - Must be logged in and own the resource
4. **Admin Only** - Must be logged in with admin role

### Protected Endpoints

| Endpoint | Authorization Level |
|----------|-------------------|
| `POST /api/applications` | Authenticated User |
| `GET /api/applications` | Admin Only |
| `GET /api/applications/my-applications` | Authenticated User |
| `GET /api/applications/:id` | Admin or Application Owner |
| `PATCH /api/applications/:id/status` | Admin Only |
| `PATCH /api/applications/:id/cancel` | Application Owner |
| `PATCH /api/applications/:id/documents` | Application Owner |
| `PATCH /api/applications/:id/document-verification` | Admin Only |
| `POST /api/upload-file` | Authenticated User |
| `GET /api/files/documents/:filename` | Admin Only |

---

## 🌐 CORS & Headers

### Request Headers

```http
Content-Type: application/json
# OR for file uploads:
Content-Type: multipart/form-data

# Session cookie (automatically handled by browser)
Cookie: connect.sid=s%3A...
```

### Response Headers

```http
Content-Type: application/json
Set-Cookie: connect.sid=s%3A... (for login endpoints)
Access-Control-Allow-Credentials: true
```

---

## 📈 Rate Limiting

Current implementation does not have explicit rate limiting, but consider implementing:

- **File Upload**: 5 uploads per minute per user
- **Application Submission**: 1 application per hour per user  
- **Login Attempts**: 5 attempts per 15 minutes per IP
- **OAuth Attempts**: Handled by provider rate limits

---

## 🧪 Testing Examples

### Using cURL

```bash
# Register new user
curl -X POST http://localhost:5000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test@example.com","password":"password123"}' \
  -c cookies.txt

# Login (saves session cookie)
curl -X POST http://localhost:5000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test@example.com","password":"password123"}' \
  -c cookies.txt

# Submit application with documents
curl -X POST http://localhost:5000/api/applications \
  -b cookies.txt \
  -F "fullName=John Doe" \
  -F "email=john@example.com" \
  -F "phone=555-123-4567" \
  -F "foodSafetyLicense=yes" \
  -F "foodEstablishmentCert=yes" \
  -F "kitchenPreference=commercial" \
  -F "foodSafetyLicense=@license.pdf" \
  -F "foodEstablishmentCert=@certificate.pdf"

# Get my applications
curl -X GET http://localhost:5000/api/applications/my-applications \
  -b cookies.txt
```

### Using JavaScript (Frontend)

```javascript
// Submit application with fetch
const submitApplication = async (formData) => {
  const response = await fetch('/api/applications', {
    method: 'POST',
    body: formData, // FormData object with files
    credentials: 'include' // Include cookies
  });
  
  const result = await response.json();
  if (response.ok) {
    console.log('Application submitted:', result.application);
  } else {
    console.error('Error:', result.message);
  }
};

// Get applications
const getMyApplications = async () => {
  const response = await fetch('/api/applications/my-applications', {
    credentials: 'include'
  });
  
  const result = await response.json();
  return result.applications;
};

// Admin: Update application status
const updateApplicationStatus = async (applicationId, status) => {
  const response = await fetch(`/api/applications/${applicationId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status }),
    credentials: 'include'
  });
  
  const result = await response.json();
  return result;
};
```

---

## 🎯 API Versioning

Current API version: **v1** (implicit)  
All endpoints are prefixed with `/api/`

Future versioning strategy:
- Breaking changes: `/api/v2/`
- Backward compatibility maintained for 1 major version
- Deprecation notices provided 6 months in advance

---

This API documentation covers all current endpoints and functionality. For implementation details, see the source code in `server/routes.ts`. 