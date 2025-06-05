# LocalCooks Community Platform

A modern community platform for local cooks with integrated training and certification system.

## 🚀 Quick Start

```bash
npm install
npm run dev
```

## 🔄 Route Management System

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

### Workflow

1. **Development**: Routes are automatically checked on `npm run dev`
2. **Build**: Critical routes are ensured before `npm run build`
3. **Deploy**: Production deployment includes all necessary routes
4. **Monitor**: System validates route availability

### VS Code Integration

The project includes VS Code tasks for easy route management:

- **Ctrl+Shift+P** → "Tasks: Run Task" → "Sync Routes"
- **Ctrl+Shift+P** → "Tasks: Run Task" → "Validate Route Sync"
- **Ctrl+Shift+P** → "Tasks: Run Task" → "Sync Status"

### File Structure

```
├── server/routes.ts                    # 🎯 Development routes
├── api/index.js                       # 🚀 Production API (maintained)
├── scripts/
│   ├── ensure-microlearning-routes.js # 🔧 Route patching system
│   ├── sync-routes.js                 # 🔄 Full sync (experimental)
│   └── validate-sync.js               # ✅ Validation tools
└── .sync-manifest.json                # 📊 Sync history
```

### Best Practices

- ✅ **Routes are automatically managed** on startup
- 🔧 **Critical routes are always ensured** before deployment
- 📝 **Check route status** if experiencing issues
- 🚀 **Production API is safely maintained**

### Troubleshooting

**Microlearning 404 errors?**
```bash
npm run fix-microlearning
```

**Route validation issues?**
```bash
npm run validate-sync
```

**Check route status:**
```bash
npm run sync-status
```

---

## 🎓 Training System

The platform includes a comprehensive microlearning training system with:

- **10 Interactive Modules**: Video-based training content
- **Progress Tracking**: Individual module completion tracking
- **Certification**: Digital certificates upon completion
- **Access Control**: Training gated by application approval

## 🛠 Development

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Vercel account (for deployment)

### Environment Variables

Create a `.env` file:

```env
DATABASE_URL=your_database_url
SESSION_SECRET=your_session_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### Database Setup

```bash
npm run db:push
```

### Running Locally

```bash
npm run dev
```

## 🚀 Deployment

The project is configured for Vercel deployment with automatic route synchronization:

1. **Push to GitHub**
2. **Auto-Sync**: Routes are synchronized during build
3. **Deploy**: Vercel deploys the synchronized API

### Production Checklist

- [ ] Routes synchronized (`npm run validate-sync`)
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] SSL certificates configured

## 📊 Architecture

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Express.js with session-based authentication
- **Database**: PostgreSQL with connection pooling
- **Deployment**: Vercel serverless functions
- **Sync System**: Custom TypeScript → JavaScript transpilation

## 🤝 Contributing

1. **Fork the repository**
2. **Edit routes** in `server/routes.ts` only
3. **Run validation**: `npm run validate-sync`
4. **Test locally**: `npm run dev`
5. **Submit pull request**

### Route Development

When adding new routes:

1. Add to `server/routes.ts`
2. Run `npm run sync-routes`
3. Test in both development and production modes
4. Validate with `npm run validate-sync`

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

- **Sync Issues**: Check the troubleshooting section above
- **General Issues**: Create a GitHub issue
- **Route Problems**: Run `npm run sync-status` for diagnostics

---

*This project uses an advanced route synchronization system to eliminate dev/prod conflicts. Happy coding! 🎉*
