# 🚚 Delivery Partner System

Complete documentation for the delivery partner onboarding and management system in the Local Cooks Community platform.

## 🎯 Overview

The delivery partner system provides a parallel onboarding experience to the chef application system, allowing users to apply as delivery partners for the Local Cooks Community. The system includes:

- **Separate Authentication Flow**: Dedicated login/registration for delivery partners
- **Multi-Step Application Process**: Comprehensive application form with document upload
- **Document Verification**: Driver's license, vehicle registration, and insurance verification
- **Admin Management**: Complete admin dashboard for delivery partner applications
- **Email Notifications**: Automated status updates and document verification emails
- **Role-Based Access**: Strict separation between chef and delivery partner experiences

---

## 🏗️ Architecture Overview

### **Authentication Separation**
```
┌─────────────────┐    ┌─────────────────┐
│   Chef Auth     │    │ Delivery Auth   │
│   (/auth)       │    │ (/driver-auth)  │
└─────────────────┘    └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│  Chef Role      │    │ Delivery Role   │
│  Assignment     │    │ Assignment      │
└─────────────────┘    └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│ Chef Dashboard  │    │ Delivery        │
│ & Training      │    │ Dashboard       │
└─────────────────┘    └─────────────────┘
```

### **Database Schema**
```
┌─────────────────┐         ┌─────────────────────────────────┐
│     users       │         │   delivery_partner_applications │
├─────────────────┤         ├─────────────────────────────────┤
│ id (PK)         │◄────────┤ userId (FK)                     │
│ username        │         │ id (PK)                         │
│ password        │         │ fullName                        │
│ role            │         │ email                           │
│ googleId        │         │ phone                           │
│ facebookId      │         │ address                         │
│ isVerified      │         │ city                            │
│ isChef          │         │ province                        │
│ isDeliveryPartner│        │ postalCode                      │
└─────────────────┘         │ vehicleType                     │
                            │ vehicleMake                     │
                            │ vehicleModel                    │
                            │ vehicleYear                     │
                            │ licensePlate                    │
                            │ driversLicenseUrl               │
                            │ vehicleRegistrationUrl          │
                            │ insuranceUrl                    │
                            │ driversLicenseStatus            │
                            │ vehicleRegistrationStatus       │
                            │ insuranceStatus                 │
                            │ documentsAdminFeedback          │
                            │ documentsReviewedBy (FK users)  │
                            │ documentsReviewedAt             │
                            │ feedback                        │
                            │ status                          │
                            │ createdAt                       │
                            └─────────────────────────────────┘
```

---

## 🔐 Authentication Flow

### **Delivery Partner Login**
- **Route**: `/driver-auth`
- **Component**: `DriverAuthPage.tsx`
- **Role Assignment**: Automatically assigns `isDeliveryPartner: true`
- **Redirect**: `/dashboard` (delivery partner dashboard)

### **Chef Login**
- **Route**: `/auth`
- **Component**: `Auth.tsx`
- **Role Assignment**: Automatically assigns `isChef: true`
- **Redirect**: `/dashboard` (chef dashboard)

### **Dual Role Support**
Users can have both `isChef: true` and `isDeliveryPartner: true` for dual role access.

---

## 📝 Application Process

### **Step 1: Personal Information**
- Full name, email, phone
- Address (street, city, province, postal code)

### **Step 2: Vehicle Information**
- Vehicle type (car, motorcycle, van, truck)
- Vehicle make, model, year
- License plate number

### **Step 3: Document Upload**
- **Driver's License**: Required for all delivery operations
- **Vehicle Registration**: Required for vehicle verification
- **Vehicle Insurance**: Required for liability coverage

### **Document Requirements**
- **Formats**: JPEG, PNG, PDF
- **Size Limit**: 4.5MB per document
- **Quality**: Clear and legible
- **Security**: Encrypted storage with secure access

---

## 🔍 Document Verification System

### **Document Status Flow**
```
Uploaded → Pending Review → Approved/Rejected
    │           │              │
    ▼           ▼              ▼
"Required" → "Pending Review" → "Approved"/"Rejected"
```

### **Admin Verification Process**
1. **Document Review**: Admin views uploaded documents
2. **Status Update**: Approve or reject each document
3. **Feedback**: Provide specific feedback for rejected documents
4. **Email Notification**: Automatic email to delivery partner
5. **Status Tracking**: Real-time status updates in dashboard

### **Document Types**
| Document | Required | Status Tracking | Admin Actions |
|----------|----------|----------------|---------------|
| Driver's License | ✅ Yes | `driversLicenseStatus` | Approve/Reject |
| Vehicle Registration | ✅ Yes | `vehicleRegistrationStatus` | Approve/Reject |
| Vehicle Insurance | ✅ Yes | `insuranceStatus` | Approve/Reject |

---

## 📊 Admin Dashboard

### **Delivery Partner Applications Tab**
- **Location**: Admin panel, separate from chef applications
- **Features**: 
  - View all delivery partner applications
  - Filter by status (inReview, approved, rejected, cancelled)
  - Document verification controls
  - Application status management
  - Email notification system

### **Document Management**
```typescript
// Admin can approve/reject documents
updateDeliveryDocumentStatusMutation.mutate({
  id: applicationId,
  field: 'driversLicenseStatus', // or 'vehicleRegistrationStatus', 'insuranceStatus'
  status: 'approved' // or 'rejected'
});
```

### **Application Status Management**
- **inReview**: Initial application status
- **approved**: Application approved, documents verified
- **rejected**: Application rejected with feedback
- **cancelled**: Application cancelled by user

---

## 📧 Email Notification System

### **Document Status Change Emails**
- **Trigger**: When admin approves/rejects documents
- **Template**: `generateDeliveryPartnerDocumentStatusChangeEmail`
- **Content**: Professional, non-promotional emails with status updates

### **Email Templates**
```typescript
// Email content generation
const emailContent = generateDeliveryPartnerDocumentStatusChangeEmail({
  fullName: "John Doe",
  email: "john@example.com",
  documentType: "driversLicense", // or "vehicleRegistration", "insurance"
  status: "approved", // or "rejected"
  adminFeedback: "Document approved successfully"
});
```

### **Email Types**
1. **Document Approved**: Congratulations message with next steps
2. **Document Rejected**: Feedback with instructions for resubmission
3. **Application Status**: Overall application status updates

---

## 🎨 User Interface Components

### **Delivery Partner Dashboard**
- **Component**: `ApplicantDashboard.tsx` (delivery partner view)
- **Features**:
  - Application status overview
  - Document verification status
  - Upload document functionality
  - Admin feedback display
  - Application management

### **Document Upload Component**
- **Component**: `DeliveryPartnerDocumentUpload.tsx`
- **Features**:
  - Drag-and-drop file upload
  - File type validation
  - Size limit enforcement
  - Progress indicators
  - Document preview

### **Application Form**
- **Component**: `DeliveryPartnerApplicationForm.tsx`
- **Features**:
  - Multi-step form process
  - Form validation
  - Progress indicators
  - Document upload integration
  - Submission handling

---

## 🔒 Security & Access Control

### **Role-Based Access**
- **Delivery Partners**: Can only access delivery partner features
- **Chefs**: Can only access chef features
- **Admins**: Can access both chef and delivery partner management
- **Dual Role**: Users can have both roles for comprehensive access

### **Authentication Separation**
- **Session Management**: Admin authentication
- **Firebase Auth**: User authentication
- **Token Validation**: Secure API access
- **Route Protection**: Role-based route access

### **Document Security**
- **Encrypted Storage**: All documents encrypted at rest
- **Secure URLs**: Time-limited access to documents
- **Access Control**: Admin-only document viewing
- **Audit Trail**: Complete access logging

---

## 🚀 API Endpoints

### **Application Management**
```http
GET /api/firebase/delivery-partner-applications/my
POST /api/firebase/delivery-partner-applications
PUT /api/firebase/delivery-partner-applications/:id
PATCH /api/delivery-partner-applications/:id/document-verification
```

### **Document Upload**
```http
POST /api/upload
Content-Type: multipart/form-data
```

### **Admin Endpoints**
```http
GET /api/delivery-partner-applications
PATCH /api/delivery-partner-applications/:id/status
```

---

## 🔧 Configuration

### **Environment Variables**
```bash
# Delivery Partner System
DELIVERY_PARTNER_ENABLED=true
DELIVERY_DOCUMENT_MAX_SIZE=4718592  # 4.5MB
DELIVERY_ALLOWED_FILE_TYPES=image/jpeg,image/png,application/pdf
```

### **Database Configuration**
```sql
-- Enable delivery partner role support
ALTER TABLE users ADD COLUMN is_delivery_partner BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN is_chef BOOLEAN DEFAULT FALSE;
```

---

## 🧪 Testing

### **Unit Tests**
- Document upload validation
- Application form validation
- Email template generation
- Role-based access control

### **Integration Tests**
- End-to-end application flow
- Document verification process
- Email notification delivery
- Admin dashboard functionality

### **Manual Testing Checklist**
- [ ] Delivery partner registration
- [ ] Application form completion
- [ ] Document upload and validation
- [ ] Admin document review
- [ ] Email notification delivery
- [ ] Dashboard status updates
- [ ] Role-based access control
- [ ] Dual role functionality

---

## 🐛 Troubleshooting

### **Common Issues**

#### **Document Upload Failures**
- **Issue**: File size exceeds 4.5MB limit
- **Solution**: Compress images or use PDF format
- **Prevention**: Client-side file size validation

#### **Email Notifications Not Sent**
- **Issue**: SMTP configuration problems
- **Solution**: Check email service configuration
- **Debug**: Review email service logs

#### **Role Assignment Issues**
- **Issue**: Users not getting correct role
- **Solution**: Check authentication flow and role assignment logic
- **Debug**: Verify user object properties

#### **Admin Dashboard Access**
- **Issue**: Admin cannot see delivery partner applications
- **Solution**: Ensure admin has proper permissions
- **Debug**: Check admin role and access controls

### **Debug Commands**
```bash
# Check delivery partner applications
curl -X GET "https://your-app.vercel.app/api/delivery-partner-applications" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Test document upload
curl -X POST "https://your-app.vercel.app/api/upload" \
  -F "file=@document.pdf" \
  -H "Authorization: Bearer YOUR_USER_TOKEN"
```

---

## 📈 Performance Considerations

### **File Upload Optimization**
- **Client-side compression**: Reduce file sizes before upload
- **Progressive uploads**: Show upload progress to users
- **CDN integration**: Fast document delivery via Vercel Blob

### **Database Optimization**
- **Indexed queries**: Fast application and document lookups
- **Connection pooling**: Efficient database connections
- **Query optimization**: Minimize database load

### **Caching Strategy**
- **Application data**: Cache user applications
- **Document URLs**: Cache secure document access URLs
- **Admin data**: Cache admin dashboard data

---

## 🔄 Future Enhancements

### **Planned Features**
- **Background Check Integration**: Third-party background check service
- **Vehicle Inspection**: Photo upload for vehicle condition
- **Insurance Verification**: Direct insurance provider integration
- **Real-time Tracking**: Live delivery partner location tracking
- **Performance Metrics**: Delivery partner performance analytics

### **Scalability Improvements**
- **Microservices**: Separate delivery partner service
- **Event-driven Architecture**: Real-time status updates
- **Advanced Analytics**: Delivery partner performance insights
- **Mobile App**: Native mobile application for delivery partners

---

## 📚 Related Documentation

- [Project Overview](./project-overview.md) - High-level system architecture
- [Database Schema](./database-schema.md) - Complete database documentation
- [API Reference](./api-reference.md) - All API endpoints
- [File Upload Guide](./file-upload-guide.md) - Document upload system
- [Session Management](./session-management.md) - Authentication system
- [FAQ](./faq.md) - Common questions and troubleshooting
