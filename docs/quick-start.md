# Quick Start Guide

Follow these steps to get Local Cooks Community running locally:

## 1. Clone the Repository
```bash
git clone https://github.com/your-org/local-cooks-community.git
cd local-cooks-community
```

## 2. Install Dependencies
```bash
npm install
```

## 3. Set Up Environment Variables
- Copy `.env.example` to `.env.local` and fill in required values.
- For local dev, you can use SQLite or a local Postgres instance.

## 4. Run the Development Server
```bash
npm run dev
```

- The backend will start on port 5000.
- The frontend (Vite) will start on port 5173 (or as configured).

## 5. Access the App
- Visit [http://localhost:5173](http://localhost:5173) for the frontend.
- Visit [http://localhost:5000/api/health](http://localhost:5000/api/health) for backend health check.

## 6. Default Admin Login
- Username: `admin`
- Password: `localcooks`

See [env-reference.md](./env-reference.md) for all environment variables. 