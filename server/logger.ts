// Enterprise structured logger
// Uses VERCEL_ENV to differentiate deployment targets:
//   - VERCEL_ENV='production' (main branch → chef.localcooks.ca): info suppressed, warn/error/operational always log
//   - VERCEL_ENV='preview' (dev branch → dev-chef.localcooks.ca): all levels log
//   - Local dev (no VERCEL_ENV): all levels log
const isVercelProduction = process.env.VERCEL_ENV === 'production';
const isLocalDev = process.env.NODE_ENV === 'development' && !process.env.VERCEL;

export const logger = {
    info: (msg: string, data?: object) => {
        if (!isVercelProduction) console.log(`[INFO] ${msg}`, data || '');
    },
    warn: (msg: string, data?: object) => {
        console.warn(`[WARN] ${msg}`, data || '');
    },
    error: (msg: string, error?: unknown) => {
        console.error(`[ERROR] ${msg}`, error);
    },
    debug: (msg: string, data?: object) => {
        if (isLocalDev) console.log(`[DEBUG] ${msg}`, data || '');
    },
    // Operational: ALWAYS logs regardless of environment
    // Use for critical business events (webhooks, payments, bookings)
    operational: (msg: string, data?: object) => {
        console.log(`[OPS] ${msg}`, data || '');
    }
};
