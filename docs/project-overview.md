# 🏠 Project Overview

**Local Cooks Community** is a comprehensive platform for local cooks in Newfoundland and Labrador to apply for certification, complete food safety training, and participate in a trusted culinary community. The platform combines application management with an integrated training and certification system.

## 🎯 Core Features

### **Application System**
- **User Registration**: Local accounts with Google/Facebook OAuth options
- **Application Management**: Multi-step application form with document upload
- **Admin Dashboard**: Comprehensive review and approval workflow
- **Document Verification**: Secure file upload with admin verification tools
- **Status Notifications**: Email updates for application status changes

### **Training & Certification System**
- **Microlearning Platform**: 10-module Newfoundland food safety training
- **Government-Approved Content**: Official Health Canada and CFIA materials
- **Progress Tracking**: Real-time completion tracking across all modules
- **Interactive Unlock System**: Guided progression from registration to full access
- **Digital Certificates**: Official completion certificates for certification preparation
- **Mobile Responsive**: Complete training on any device

### **Access Control & UX**
- **Tiered Access**: Limited access until application approval, then full training access
- **Interactive Progress**: Visual progress indicators and next-step guidance
- **Session Management**: Secure authentication with automatic route management
- **Modern UI/UX**: Responsive design with Tailwind CSS and Radix UI components

## 🏗️ Technical Architecture

### **Frontend Stack**
- **React 18** with TypeScript for type safety
- **Vite** for fast development and optimized builds
- **Tailwind CSS** for modern, responsive styling
- **Radix UI** for accessible component primitives
- **Framer Motion** for smooth animations
- **Wouter** for lightweight client-side routing
- **React Query** for server state management

### **Backend Stack**
- **Express.js** with TypeScript for API development
- **PostgreSQL** via Neon for reliable database hosting
- **Drizzle ORM** for type-safe database operations
- **Session-based authentication** with Passport.js
- **Multer** for file upload handling
- **Zod** for runtime data validation

### **Infrastructure & Deployment**
- **Vercel** for serverless deployment and hosting
- **Vercel Blob** for scalable file storage with global CDN
- **Neon Database** for managed PostgreSQL with connection pooling
- **Route Management System** for development/production synchronization
- **Automatic table creation** and database migration handling

### **Development Tools**
- **TypeScript** for full-stack type safety
- **ESLint & Prettier** for code quality
- **VS Code integration** with custom tasks
- **NPM scripts** for automated route management
- **Environment-based configuration** for local/production differences

## 🎓 Training System Details

### **Curriculum Coverage**
- **Federal Requirements**: Health Canada and CFIA standards
- **Provincial Compliance**: Newfoundland Food Premises Regulations
- **Certification Preparation**: Food Handler Certification readiness
- **Practical Application**: Real-world food safety scenarios

### **Learning Features**
- **Video-based learning** with 90% completion requirements
- **Self-paced progression** with automatic save functionality
- **Mobile optimization** for learning on-the-go
- **Progress visualization** with completion tracking
- **Certificate generation** upon full completion

## 🔄 User Journey

### **New User Experience**
1. **Registration** → Create account (20% progress)
2. **Application** → Submit application with documents (50% progress)
3. **Review** → Admin review and approval (75% progress)
4. **Training** → Access full 10-module training system (100% progress)
5. **Certification** → Complete training and receive digital certificate

### **Admin Experience**
1. **Dashboard Access** → Comprehensive application management
2. **Document Review** → Verify uploaded certifications
3. **Status Management** → Approve/reject with feedback
4. **Email Notifications** → Automated status update emails
5. **Progress Monitoring** → Track user training completion

## 🚀 Deployment Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│                 │    │                  │    │                 │
│   Vercel App    │────│  Neon Database   │    │  Vercel Blob    │
│   (Frontend +   │    │  (PostgreSQL)    │    │  (File Storage) │
│    Serverless   │    │  (Connection     │    │  (Global CDN)   │
│    Functions)   │    │   Pooling)       │    │                 │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 📊 Key Benefits

### **For Users**
- **Clear Path**: Visual progress system eliminates confusion
- **Comprehensive Training**: Government-approved Newfoundland-specific content
- **Mobile Friendly**: Complete training anywhere, anytime
- **Certification Ready**: Prepare for official Food Handler Certification

### **For Administrators**
- **Streamlined Review**: Efficient application and document management
- **Automated Notifications**: Reduced manual communication overhead
- **Detailed Tracking**: Monitor user progress and completion rates
- **Secure Storage**: Reliable document storage with backup

### **For Developers**
- **Type Safety**: Full TypeScript coverage prevents runtime errors
- **Modern Stack**: Latest React and Node.js ecosystem tools
- **Easy Deployment**: One-click Vercel deployment with automatic scaling
- **Maintainable Code**: Clean architecture with separation of concerns

---

**Next Steps**: See [Quick Start Guide](./quick-start.md) for local development or [Production Guide](./production-guide.md) for deployment instructions. 