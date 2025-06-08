# 🏠 Local Cooks Community Platform

A comprehensive platform for local cooks in Newfoundland and Labrador to apply for verification, complete food safety training preparation, and participate in a trusted culinary community.

## ✨ Features

🎓 **Training & Preparation System**
- 10-module Newfoundland food safety training preparation
- Skillpass.nl exam preparation content (Health Canada + CFIA based)
- Progress tracking and completion certificates
- Mobile-responsive video learning
- Re-watch any module anytime as a refresher

> **Note**: This platform provides training preparation and guidance. For official food safety certification, visit [skillpass.nl](https://skillpass.nl) to take your certification exam.

📝 **Application Management**
- Streamlined application process with document upload
- Admin review and approval workflow
- Real-time status updates and email notifications
- Secure document storage with Vercel Blob

🔐 **Authentication & Security**
- Local account registration with secure password hashing
- Optional Google and Facebook OAuth integration
- Session-based authentication with role-based access
- Admin panel for application management

🚀 **Modern Tech Stack**
- React 18 + TypeScript + Tailwind CSS frontend
- Express.js + Node.js backend with PostgreSQL
- Serverless deployment on Vercel with auto-scaling
- Intelligent route management system

## 🚀 Quick Start

```bash
# Clone and install
git clone <your-repo-url>
cd LocalCooksCommunity
npm install

# Set up environment (copy .env.example to .env)
cp .env.example .env

# Start development server
npm run dev
```

**Access the application:**
- 🌐 Main app: http://localhost:5173
- 👤 Admin panel: http://localhost:5173/admin (admin/localcooks)
- 🎓 Training: http://localhost:5173/microlearning

## 🔄 Intelligent Route Management System

This project includes an **intelligent route management system** that ensures critical API routes are always available in production. The system focuses on maintaining the essential microlearning training routes that power the certification system.

### How It Works

- **Automatic Detection**: Scans for missing critical routes on startup
- **Smart Patching**: Adds only the routes that are missing
- **Zero Downtime**: Works with existing production code
- **Safe Backups**: Creates backups before making changes

### Available Commands

```bash
# Ensure microlearning routes are present
npm run fix-microlearning

# Advanced: Full route synchronization (experimental)
npm run sync-routes

# Validate route status
npm run validate-sync

# Check sync history
npm run sync-status
```

### Workflow Integration

1. **Development**: Routes are automatically checked on `npm run dev`
2. **Build**: Critical routes are ensured before `npm run build`
3. **Deploy**: Production deployment includes all necessary routes
4. **Monitor**: System validates route availability

## 🎓 Training System Overview

The platform includes a comprehensive microlearning training preparation system:

### **Training Modules (10 Total)**
1. **Safe Food Handling Basics** (Health Canada)
2. **Preventing Food Contamination** (CFIA)
3. **Allergen Awareness and Management** (CFIA)
4. **Temperature Danger Zone & Time Control** (NL)
5. **Personal Hygiene for Food Handlers** (NL)
6. **Cleaning and Sanitizing Procedures** (NL)
7. **HACCP Principles for Small Kitchens** (NL)
8. **Proper Food Storage & Receiving** (NL)
9. **Safe Cooking Temperatures & Methods** (NL)
10. **Health Inspection Readiness** (NL)

### **Access Levels**
- **Limited Access**: First module only (before application approval)
- **Full Access**: All 10 modules + preparation completion (after approval)
- **Progress Tracking**: Automatic save and resume functionality
- **Mobile Friendly**: Complete training on any device

## 🛠 Development Setup

### Prerequisites

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **PostgreSQL** database (or use SQLite for development)
- **Vercel account** (for production deployment)

### Environment Configuration

Create a `.env` file from the template:

```bash
# Required
DATABASE_URL=sqlite://./local.db                    # SQLite for dev
SESSION_SECRET=your-local-development-secret-key
NODE_ENV=development

# File uploads
UPLOAD_DIR=./uploads                                 # Local storage

# Optional OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
FACEBOOK_CLIENT_ID=your_facebook_client_id
FACEBOOK_CLIENT_SECRET=your_facebook_client_secret

# Optional Email
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=587
EMAIL_USER=your@email.com
EMAIL_PASS=your_password
EMAIL_FROM=Local Cooks <your@email.com>
```

### Development Commands

```bash
# Development
npm run dev                    # Start development server
npm run build                  # Build for production
npm run preview               # Preview production build

# Database
npm run db:push               # Apply schema changes
npm run db:studio             # Open database browser

# Route Management
npm run fix-microlearning     # Ensure training routes
npm run validate-sync         # Check route status
npm run sync-status          # View sync history

# Code Quality
npm run lint                  # Check linting
npm run type-check           # TypeScript validation
```

### VS Code Integration

The project includes VS Code tasks for easy route management:

- **Ctrl+Shift+P** → "Tasks: Run Task" → "Sync Routes"
- **Ctrl+Shift+P** → "Tasks: Run Task" → "Validate Route Sync"
- **Ctrl+Shift+P** → "Tasks: Run Task" → "Sync Status"

## 🚀 Production Deployment

The project is configured for seamless Vercel deployment:

### **Automatic Deployment**
1. **Push to GitHub** → Triggers Vercel build
2. **Auto-Sync** → Routes synchronized during build
3. **Deploy** → Serverless functions go live

### **Production Environment**
```bash
# Required for Production
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/db?sslmode=require
SESSION_SECRET=super-secure-production-secret-32-chars-minimum
NODE_ENV=production
VERCEL_ENV=production
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_your_production_token

# Optional Production Features
EMAIL_HOST=smtp.hostinger.com
# ... other email config
GOOGLE_CLIENT_ID=production_google_client_id
# ... other OAuth config
```

### **Production Checklist**
- ✅ Routes synchronized (`npm run validate-sync`)
- ✅ Environment variables configured in Vercel
- ✅ Neon database set up and connected
- ✅ Vercel Blob storage configured
- ✅ SSL certificates configured (automatic)

## 📊 Architecture Overview

### **Frontend Stack**
- **React 18** + TypeScript for type safety
- **Vite** for fast development and optimized builds
- **Tailwind CSS** + Radix UI for modern, accessible design
- **Wouter** for lightweight client-side routing
- **Framer Motion** for smooth animations

### **Backend Stack**
- **Express.js** + TypeScript for API development
- **PostgreSQL** (Neon) for reliable data storage
- **Session-based authentication** with Passport.js
- **Multer** + Vercel Blob for secure file uploads
- **Zod** for runtime data validation

### **Infrastructure**
- **Vercel** serverless deployment with global edge
- **Neon Database** managed PostgreSQL with connection pooling
- **Vercel Blob** CDN-backed file storage
- **Custom Route Management** for dev/prod synchronization

### **File Structure**

```
📦 LocalCooksCommunity
├── 📁 client/                     # React frontend application
│   ├── 📁 src/
│   │   ├── 📁 components/         # Reusable UI components
│   │   ├── 📁 pages/              # Page components & routes
│   │   └── 📁 utils/              # Frontend utilities
│   └── 📄 vite.config.ts          # Vite build configuration
├── 📁 server/                     # Express.js backend
│   ├── 📄 routes.ts               # 🎯 Development API routes
│   ├── 📄 storage.ts              # Database operations
│   └── 📄 index.ts                # Server entry point
├── 📁 api/                        # Vercel serverless functions
│   └── 📄 index.js                # 🚀 Production API (auto-maintained)
├── 📁 shared/                     # Shared types & schemas
├── 📁 scripts/                    # Build & maintenance scripts
│   ├── 📄 ensure-microlearning-routes.js
│   ├── 📄 sync-routes.js
│   └── 📄 validate-sync.js
├── 📁 docs/                       # Comprehensive documentation
└── 📄 package.json                # Dependencies & npm scripts
```

## 🧪 Testing the Full User Flow

### **User Journey Testing**
1. **Registration** → Go to `/apply` and create account
2. **Limited Training** → Access first module at `/microlearning`
3. **Application** → Submit application with document uploads
4. **Admin Review** → Login as admin and approve application
5. **Full Training** → Complete all 10 modules and get certificate

### **Admin Testing**
1. **Login** → Use admin/localcooks at `/login`
2. **Dashboard** → Review applications at `/admin`
3. **Document Review** → Verify uploaded certificates
4. **Status Management** → Approve/reject with feedback

## 🛠 Contributing

### **Development Workflow**
1. **Fork the repository**
2. **Create feature branch**: `git checkout -b feature/your-feature`
3. **Edit routes** in `server/routes.ts` only
4. **Run validation**: `npm run validate-sync`
5. **Test locally**: `npm run dev`
6. **Submit pull request**

### **Route Development Best Practices**
- Always edit `server/routes.ts` for new routes
- Run `npm run sync-routes` after major changes
- Test in both development and production modes
- Validate with `npm run validate-sync` before committing

## 🆘 Troubleshooting

### **Common Issues**

**🔗 Route Issues**
```bash
# Fix missing microlearning routes
npm run fix-microlearning

# Check route synchronization status
npm run validate-sync

# View sync history
npm run sync-status
```

**🗄️ Database Issues**
```bash
# Reset local database
rm -f local.db
npm run dev  # Will recreate tables
```

**📁 File Upload Issues**
- Check `BLOB_READ_WRITE_TOKEN` in production
- Verify `./uploads` directory exists in development
- Ensure file size under 10MB and correct format (PDF/JPG/PNG)

## 📚 Documentation

Comprehensive documentation is available in the `/docs` folder:

- **[Quick Start](./docs/quick-start.md)** - Get up and running fast
- **[Production Guide](./docs/production-guide.md)** - Complete deployment guide
- **[API Reference](./docs/api-reference.md)** - All endpoints documented
- **[Environment Reference](./docs/env-reference.md)** - All environment variables
- **[FAQ](./docs/faq.md)** - Common questions and solutions

## 📄 License

MIT License - see LICENSE file for details.

## 🎯 Support & Contact

- **📋 Documentation Issues**: Check the `/docs` folder first
- **🐛 Bug Reports**: Create a detailed GitHub issue
- **💡 Feature Requests**: Describe use case and implementation ideas
- **🔧 Sync Issues**: Run `npm run sync-status` for diagnostics

---

**Built for Newfoundland and Labrador's local culinary community** 🍽️  
*Empowering local cooks with training, certification, and community connection.*
