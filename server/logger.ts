// Simple structured logger wrapper
const isProd = process.env.NODE_ENV === 'production';

export const logger = {
    info: (msg: string, data?: object) => {
        if (!isProd) console.log(`[INFO] ${msg}`, data || '');
    },
    warn: (msg: string, data?: object) => {
        console.warn(`[WARN] ${msg}`, data || '');
    },
    error: (msg: string, error?: unknown) => {
        console.error(`[ERROR] ${msg}`, error);
    },
    debug: (msg: string, data?: object) => {
        if (!isProd) console.log(`[DEBUG] ${msg}`, data || '');
    }
};
