# 🚀 Quick Start Guide

Get Local Cooks Community running locally in minutes with these step-by-step instructions.

## 📋 Prerequisites

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **Git** - For cloning the repository
- **PostgreSQL** (optional) - Or use the provided development database

## 🔧 Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/your-org/local-cooks-community.git
cd local-cooks-community
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables
Create a `.env` file from the example:
```bash
cp .env.example .env
```

**Minimal `.env` for local development:**
```bash
# Database (uses in-memory SQLite by default)
DATABASE_URL=sqlite://./local.db

# Session security
SESSION_SECRET=your-local-development-secret-key-here

# Environment
NODE_ENV=development

# File uploads (local storage)
UPLOAD_DIR=./uploads

# Optional: OAuth (leave blank to skip)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=

# Optional: Email (leave blank to skip)
EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASS=
EMAIL_FROM=
```

### 4. Run the Development Server
```bash
npm run dev
```

This will:
- ✅ Automatically ensure microlearning routes are present
- 🗄️ Create database tables if they don't exist
- 🚀 Start the backend server on port 5000
- ⚡ Start the Vite frontend server on port 5173
- 🔄 Enable hot reloading for both frontend and backend

### 5. Access the Application

**Frontend Application:**
- 🌐 **Main App**: [http://localhost:5173](http://localhost:5173)
- 📝 **Apply Page**: [http://localhost:5173/apply](http://localhost:5173/apply)
- 👤 **Admin Panel**: [http://localhost:5173/admin](http://localhost:5173/admin)
- 🎓 **Training**: [http://localhost:5173/microlearning](http://localhost:5173/microlearning)

**Backend API:**
- ✅ **Health Check**: [http://localhost:5000/api/health](http://localhost:5000/api/health)
- 📊 **Debug Applications**: [http://localhost:5000/api/debug/applications](http://localhost:5000/api/debug/applications)

## 👤 Default Admin Access

**Login Credentials:**
- **Username**: `admin`
- **Password**: `localcooks`

**Admin Features:**
- View and manage applications
- Approve/reject applications with feedback
- Verify uploaded documents
- Send status update emails
- Monitor user training progress

## 🎯 Test the Full Flow

### User Registration & Application
1. Go to [http://localhost:5173/apply](http://localhost:5173/apply)
2. Create a new user account
3. Fill out the application form
4. Upload test documents (PDF, JPG, PNG supported)
5. Submit the application

### Training Access (Before Approval)
1. After registration, go to [http://localhost:5173/microlearning](http://localhost:5173/microlearning)
2. You'll see limited access (first module only)
3. Notice the interactive progress system showing next steps

### Admin Review
1. Login as admin at [http://localhost:5173/login](http://localhost:5173/login)
2. Go to [http://localhost:5173/admin](http://localhost:5173/admin)
3. Review the submitted application
4. Approve the application

### Full Training Access (After Approval)
1. Login as the user again
2. Go to [http://localhost:5173/microlearning](http://localhost:5173/microlearning)
3. Now you have access to all 10 training modules
4. Complete modules to track progress

## 🛠️ Development Commands

```bash
# Start development server (auto-fixes routes)
npm run dev

# Build for production
npm run build

# Type checking
npm run type-check

# Linting
npm run lint

# Route management
npm run fix-microlearning      # Ensure training routes
npm run validate-sync          # Check route status
npm run sync-status           # View sync history

# Database operations
npm run db:push               # Apply schema changes
npm run db:studio             # Open database browser
```

## 🐛 Troubleshooting

### Common Issues

**Port already in use:**
```bash
# Kill processes using ports 5000 or 5173
npx kill-port 5000 5173
npm run dev
```

**Database connection issues:**
```bash
# Reset local database
rm -f local.db
npm run dev  # Will recreate tables
```

**Missing microlearning routes:**
```bash
# Fix route issues
npm run fix-microlearning
npm run validate-sync
```

**File upload not working:**
- Check that `./uploads` directory is created
- Verify file permissions
- Check file size (10MB limit)

### Environment Issues

**OAuth not working:**
- OAuth is optional in development
- Login with local accounts works without OAuth setup

**Email not working:**
- Email notifications are optional
- Application flow works without email configuration

## 📁 Project Structure

```
📦 local-cooks-community
├── 📁 client/                 # React frontend
│   ├── 📁 src/
│   │   ├── 📁 components/     # UI components
│   │   ├── 📁 pages/          # Page components
│   │   └── 📁 utils/          # Helper functions
│   └── 📄 vite.config.ts      # Vite configuration
├── 📁 server/                 # Express backend
│   ├── 📄 routes.ts           # API routes (development)
│   ├── 📄 storage.ts          # Database operations
│   └── 📄 index.ts            # Server entry point
├── 📁 api/                    # Serverless functions (production)
│   └── 📄 index.js            # Production API
├── 📁 shared/                 # Shared types and schemas
├── 📁 docs/                   # Documentation
├── 📁 scripts/                # Build and maintenance scripts
└── 📄 package.json            # Dependencies and scripts
```

## 🔗 Next Steps

- **Production Deployment**: See [Production Guide](./production-guide.md)
- **Environment Variables**: See [Environment Reference](./env-reference.md)
- **File Upload Setup**: See [File Upload Guide](./file-upload-guide.md)
- **OAuth Configuration**: See [OAuth Setup Guide](./oauth-setup.md)
- **API Documentation**: See [API Reference](./api-reference.md)

---

**Need help?** Check the [FAQ](./faq.md) or create an issue on GitHub. 