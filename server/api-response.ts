import { logger } from "./logger";
import { Response } from 'express';

export function errorResponse(res: Response, error: unknown, statusCode = 500) {
    const message = process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : (error as Error)?.message || 'Unknown error';

    // Log full error server-side
    logger.error('[API Error]', error);

    return res.status(statusCode).json({ error: message });
}
