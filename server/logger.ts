// Simple structured logger wrapper
// LOW-2: Detect production via VERCEL_ENV as well as NODE_ENV
const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

export const logger = {
    info: (msg: string, data?: object) => {
        console.log(`[INFO] ${msg}`, data || '');
    },
    warn: (msg: string, data?: object) => {
        console.warn(`[WARN] ${msg}`, data || '');
    },
    error: (msg: string, error?: unknown) => {
        console.error(`[ERROR] ${msg}`, error);
    },
    debug: (msg: string, data?: object) => {
        if (!isProd) console.log(`[DEBUG] ${msg}`, data || '');
    },
    // Operational: always logs in both dev and prod (for critical business events)
    operational: (msg: string, data?: object) => {
        console.log(`[OP] ${msg}`, data || '');
    }
};
