# Document Verification System

## Overview

The Document Verification System allows users with approved applications to upload food safety documentation for admin review and verification. Once verified, users receive a verification badge and gain access to additional platform features.

## Features

### For Applicants
- **Document Upload**: Upload food safety license (required) and food establishment certificate (optional)
- **Multiple Upload Methods**: Support for both file uploads and URL links
- **Status Tracking**: Real-time status updates on document review process
- **Feedback System**: Receive admin feedback on document submissions
- **Verification Badge**: Display verified status across the platform

### For Administrators
- **Document Review**: Review uploaded documents with direct links
- **Individual Approval**: Approve or reject each document separately
- **Feedback System**: Provide feedback to applicants
- **Dashboard Metrics**: Track pending, approved, and rejected verifications
- **User Verification Management**: Automatically update user verification status

## Database Schema

### Document Verifications Table
```sql
CREATE TABLE "document_verifications" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "food_safety_license_url" text,
  "food_establishment_cert_url" text,
  "food_safety_license_status" document_verification_status DEFAULT 'pending',
  "food_establishment_cert_status" document_verification_status DEFAULT 'pending',
  "admin_feedback" text,
  "reviewed_by" integer REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
```

### User Verification Status
- Added `is_verified` boolean field to users table
- Automatically updated when verification requirements are met

## API Endpoints

### Document Upload
```
POST /api/document-verification
```
- Requires authenticated user with approved application
- Accepts food safety license URL (required) and food establishment certificate URL (optional)
- Creates new document verification record

### Get User Status
```
GET /api/document-verification/my-status
```
- Returns current user's document verification status
- Shows individual document statuses and admin feedback

### Admin Endpoints
```
GET /api/document-verification        # Get all verifications (admin only)
PATCH /api/document-verification/:id/status  # Update verification status (admin only)
```

## Frontend Components

### DocumentUpload.tsx
- File upload interface with drag-and-drop support
- URL input option for remote documents
- Form validation and error handling
- Mock file upload system (ready for cloud storage integration)

### DocumentStatus.tsx
- Real-time status display for document review process
- Progress indicators and status badges
- Admin feedback display
- Links to view uploaded documents

### DocumentVerification.tsx
- Main verification page with tabbed interface
- Integrates upload and status components
- Access control for users with approved applications

### VerificationBadge.tsx
- Reusable component for displaying verification status
- Multiple sizes and variants
- Tooltip with verification details

## Workflow

1. **Application Approval**: User must have an approved application
2. **Document Upload**: User uploads required food safety license and optional establishment certificate
3. **Admin Review**: Admin reviews documents and provides approval/rejection with feedback
4. **Verification Status**: User becomes verified when food safety license is approved (establishment certificate is optional)
5. **Badge Display**: Verified users receive badge across platform

## Integration Points

### ApplicantDashboard.tsx
- Shows document verification section for approved applications
- Quick access to document management
- Displays current verification status

### Admin.tsx
- Document verification tab in admin dashboard
- Metrics and overview of pending verifications
- Individual document review and approval interface

## File Upload System

Currently implements a mock file upload system for development. To integrate with real file storage:

1. **Cloud Storage**: Replace mock upload in `DocumentUpload.tsx` with actual cloud service (AWS S3, Cloudinary, etc.)
2. **File Validation**: Add server-side file validation and processing
3. **Security**: Implement file scanning and validation
4. **Storage URLs**: Update to use actual file storage URLs

## Email Notifications

The system is ready for email notifications on status changes:
- Document submission confirmation
- Approval/rejection notifications
- Admin feedback alerts

## Testing

Run the test script to verify functionality:
```bash
node test-doc-verification.js
```

Tests cover:
- Document creation and retrieval
- Status updates and verification flow
- User verification status updates
- Admin operations

## Security Considerations

- **Authentication**: All endpoints require authentication
- **Authorization**: Document access restricted to owners and admins
- **File Validation**: Implement file type and size validation
- **URL Validation**: Validate external URLs for security
- **Access Control**: Users can only access their own documents

## Future Enhancements

- **Document Expiration**: Track and notify about expiring certifications
- **Bulk Operations**: Admin bulk approval/rejection tools
- **Advanced Analytics**: Detailed reporting and analytics
- **Notification System**: Real-time notifications for status changes
- **Document History**: Track document revision history
- **Integration APIs**: External verification service integration

## Error Handling

The system includes comprehensive error handling:
- Form validation with user-friendly messages
- Network error recovery
- File upload error handling
- Database operation error handling
- Authentication error management

## Performance Considerations

- **Lazy Loading**: Components load document data only when needed
- **Caching**: Query results are cached for better performance
- **Optimistic Updates**: UI updates optimistically for better UX
- **Pagination**: Ready for pagination when document volumes grow

## Accessibility

- **Screen Reader Support**: All components are accessible
- **Keyboard Navigation**: Full keyboard support
- **Color Contrast**: Proper contrast ratios for status indicators
- **Focus Management**: Proper focus handling throughout the interface 