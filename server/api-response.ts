import { logger } from "./logger";
import { Response } from 'express';
import { DomainError } from './shared/errors/domain-error';

export function errorResponse(res: Response, error: unknown, statusCode = 500) {
    if (error instanceof DomainError) {
        return res.status(error.statusCode).json({ ...error.details, error: error.message });
    }
    const message = process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : (error as Error)?.message || 'Unknown error';

    // Log full error server-side
    logger.error('[API Error]', error);

    return res.status(statusCode).json({ error: message });
}
