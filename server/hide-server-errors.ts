import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger.js';

export const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again in a moment.';

/**
 * A 5xx never shows the user an internal message (e.g. "Failed query: delete from …"): the error is logged and the
 * response says it's on our side, so the page can offer Try again. 4xx messages are written for people and pass through.
 */
export function hideServerErrors(req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 500 && body && typeof body === 'object' && !Array.isArray(body)) {
      const { error, message, details, stack, ...rest } = body as Record<string, unknown>;
      if (error !== undefined || message !== undefined || details !== undefined || stack !== undefined) {
        logger.error('[API 5xx]', { method: req.method, path: req.originalUrl, error, message, details });
        return json({ ...rest, error: SERVER_ERROR_MESSAGE });
      }
    }
    return json(body);
  }) as Response['json'];
  next();
}
