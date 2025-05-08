# Local Cooks Application

![Local Cooks Logo](./attached_assets/Logo_LocalCooks.png)

A professional web application that connects local cooks with potential customers. This platform enables home chefs to showcase their culinary skills, apply to join the service, and for administrators to manage applications through a secure dashboard.

## ✨ Features

- 🏠 **Modern Homepage**: Interactive sections with animations, responsive design, and compelling content
- 📝 **Multi-step Application Process**: Intuitive three-step form with smart validation
- 👨‍💼 **Applicant Dashboard**: Personal dashboard for cooks to track application status
- 🔐 **Authentication System**: Secure login/register functionality for applicants and admins
- 🛡️ **Admin Dashboard**: Comprehensive tools for reviewing and managing cook applications
- 📱 **Fully Responsive**: Optimized experience across all devices and screen sizes
- 🎨 **Premium Design**: Professional UI with modern aesthetics and smooth animations

## 🛠️ Technology Stack

### Frontend
- **React** - Component-based UI development
- **TypeScript** - Static typing for better code quality
- **TailwindCSS** - Utility-first CSS framework
- **shadcn/ui** - High-quality component library
- **Framer Motion** - Advanced animations
- **React Hook Form** - Form state management and validation
- **Zod** - Schema validation with typescript integration
- **TanStack Query** - Data fetching, caching, and state management
- **Wouter** - Lightweight client-side routing

### Backend
- **Express** - Fast, unopinionated web framework
- **Drizzle ORM** - Type-safe database toolkit
- **PostgreSQL** - Powerful, open-source relational database
- **Passport.js** - Authentication middleware
- **Express Session** - Session management

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm or yarn
- PostgreSQL database (or use the included in-memory storage for development)

### Installation

#### Running on Replit
On Replit, the environment is already fully configured with the necessary environment variables and database connection.

1. Simply click the "Run" button to start the application
2. The app will be available at the generated Replit URL

#### Running Locally

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory with the following variables:
   ```
   DATABASE_URL=postgresql://username:password@localhost:5432/localcooks
   SESSION_SECRET=yoursessionsecret
   ```
   
   Note: 
   - The SESSION_SECRET has a default fallback value for development, so it's optional
   - To use the in-memory database instead of PostgreSQL (recommended for local development):
     - Open `server/storage.ts`
     - Change `export const storage = new DatabaseStorage();` to `export const storage = new MemStorage();`
     - With this change, you won't need to set up a PostgreSQL database

4. If using PostgreSQL, create the database and run migrations:
   ```bash
   npm run db:push
   ```
   
5. Create an initial admin user (if using PostgreSQL):
   ```bash
   npm run create-admin
   ```

6. Start the development server:
   ```bash
   npm run dev
   ```
   
7. Access the application at `http://localhost:5000`

## 🗄️ Database Schema

The application uses the following main data models:

### Users
```typescript
users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role").notNull().default("applicant"),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
```

### Applications
```typescript
applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  foodSafetyLicense: certificationStatusEnum("food_safety_license").notNull(),
  foodEstablishmentCert: certificationStatusEnum("food_establishment_cert").notNull(),
  kitchenPreference: kitchenPreferenceEnum("kitchen_preference").notNull(),
  status: applicationStatusEnum("status").notNull().default("new"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
```

## 📂 Project Structure

```
├── client/                       # Frontend code
│   ├── src/
│   │   ├── components/
│   │   │   ├── application/      # Application form components
│   │   │   ├── auth/             # Authentication components
│   │   │   ├── home/             # Homepage section components
│   │   │   ├── layout/           # Layout components (Header, Footer)
│   │   │   └── ui/               # Reusable UI components
│   │   ├── hooks/                # Custom React hooks
│   │   │   ├── use-auth.tsx      # Authentication hook
│   │   │   └── use-toast.ts      # Toast notifications hook
│   │   ├── lib/                  # Utility functions
│   │   │   ├── applicationSchema.ts # Application form schemas
│   │   │   ├── protected-route.tsx  # Auth protection HOC
│   │   │   └── queryClient.ts    # API request utilities
│   │   ├── pages/                # Page components
│   │   │   ├── Admin.tsx         # Admin dashboard
│   │   │   ├── AdminLogin.tsx    # Admin login
│   │   │   ├── ApplicantDashboard.tsx # Cook dashboard
│   │   │   ├── ApplicationForm.tsx # Application form
│   │   │   ├── Home.tsx          # Homepage
│   │   │   └── auth-page.tsx     # User login/register
│   │   ├── App.tsx               # Main app component
│   │   └── main.tsx              # Entry point
├── server/                       # Backend code
│   ├── auth.ts                   # Authentication setup
│   ├── db.ts                     # Database connection
│   ├── index.ts                  # Server entry point
│   ├── routes.ts                 # API endpoints
│   ├── storage.ts                # Data access layer
│   └── vite.ts                   # Vite server integration
├── shared/                       # Shared code
│   └── schema.ts                 # Database schema and types
├── migrations/                   # Database migrations
└── scripts/                      # Utility scripts
    ├── create-admin.ts           # Create admin user
    └── migrate-db.ts             # Database migration script
```

## 🔒 Authentication System

The application uses a session-based authentication system with Passport.js. Two types of users are supported:

### User Roles
- **Admin**: Can review all applications and update their status
- **Applicant**: Can submit and track their own applications

### Authentication Endpoints
- `POST /api/register` - Register a new applicant account
- `POST /api/login` - Login as admin or applicant
- `POST /api/logout` - Log out the current user
- `GET /api/user` - Get the current logged-in user

## 📡 API Endpoints

### Application Endpoints
- `POST /api/applications` - Submit a new application
- `GET /api/applications` - Admin only: Get all applications
- `GET /api/applications/my-applications` - Get current user's applications
- `GET /api/applications/:id` - Get a specific application
- `PATCH /api/applications/:id/status` - Admin only: Update application status
- `PATCH /api/applications/:id/cancel` - Cancel an application

## 🔑 Access Information

### Admin Access
- URL: `/admin-login`
- Username: `admin`
- Password: `localcooks`

### Demo Applicant
- Username: `rsarmacharya`
- Password: `password`

## 💻 Development Guidelines

1. **Database Changes**
   - Add new models in `shared/schema.ts`
   - Run `npm run db:push` to update the database schema

2. **Backend Development**
   - Add new endpoints in `server/routes.ts`
   - Update storage interfaces in `server/storage.ts`
   - Add authentication logic in `server/auth.ts`

3. **Frontend Development**
   - Use React Query for data fetching
   - Implement protected routes with `ProtectedRoute` component
   - Use shadcn/ui components for consistent UI
   - Use Zod schemas for form validation

4. **Styling**
   - Use TailwindCSS for styling
   - Use the `cn` utility for conditional classes
   - Follow the existing color scheme and design patterns

## 🤝 Contributing

1. Fork the project
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgements

- [shadcn/ui](https://ui.shadcn.com/) - Component library
- [TailwindCSS](https://tailwindcss.com/) - CSS framework
- [Drizzle ORM](https://orm.drizzle.team/) - Database ORM
- [React Hook Form](https://react-hook-form.com/) - Form management
- [TanStack Query](https://tanstack.com/query) - Data fetching library
- [Framer Motion](https://www.framer.com/motion/) - Animation library
- [Zod](https://zod.dev/) - Schema validation