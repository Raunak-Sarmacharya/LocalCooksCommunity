# Local Cooks Application

A beautifully designed application for Local Cooks to collect cook applications with a responsive frontend and functional backend.

![Local Cooks Logo](./attached_assets/Logo_LocalCooks.png)

## Features

- 🏠 **Attractive Homepage**: Features a compelling hero section, benefits, how it works, and a call-to-action.
- 📝 **Multi-step Application Form**: An intuitive three-step application form with validation.
- 🔐 **Secure Admin Dashboard**: Password-protected admin area for reviewing and managing applications.
- 📱 **Fully Responsive**: Works beautifully on mobile, tablet, and desktop devices.
- 🚀 **Modern Tech Stack**: Built with React, Node.js, and PostgreSQL.

## Technology Stack

- **Frontend**: React, TailwindCSS, shadcn/ui components
- **Backend**: Node.js, Express
- **Database**: PostgreSQL with Drizzle ORM
- **Form Handling**: React Hook Form with Zod validation
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: React Query for server state

## Getting Started

### Prerequisites

- Node.js (v16+)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/local-cooks.git
   cd local-cooks
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:5000`

## Project Structure

```
├── client/                # Frontend code
│   ├── src/
│   │   ├── components/    # UI components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── lib/           # Utility functions and configurations
│   │   ├── pages/         # Page components
│   │   └── main.tsx       # Entry point
├── server/                # Backend code
│   ├── index.ts           # Server entry point
│   ├── routes.ts          # API routes
│   └── storage.ts         # Data storage logic
├── shared/                # Shared code between client and server
│   └── schema.ts          # Database schema and types
```

## Admin Access

The admin dashboard is protected with authentication:

- URL: `/admin-login`
- Username: `admin`
- Password: `localcooks`

## License

[MIT](LICENSE)

## Acknowledgements

- [Replit](https://replit.com) - Development platform
- [shadcn/ui](https://ui.shadcn.com/) - UI component library
- [TailwindCSS](https://tailwindcss.com/) - CSS framework