import { logger } from "./logger";
import { Express } from 'express';
// import { authRouter } from './routes/firebase/auth';
// import { usersRouter } from './routes/firebase/users';
import { applicationsRouter } from './routes/firebase/applications';
import { adminEmailRouter } from './routes/firebase/admin-email';
import { dashboardRouter } from './routes/firebase/dashboard';
import { mediaRouter } from './routes/firebase/media';
// import { microlearningRouter } from './routes/firebase/microlearning';
import { healthRouter } from './routes/firebase/health';
// import { locationsRouter } from './routes/firebase/locations';
import { platformRouter } from './routes/firebase/platform';
import { kitchenApplicationsRouter } from './routes/firebase/kitchen-applications';

export function registerFirebaseRoutes(app: Express) {
  logger.info('🔥 Registering Firebase Routes (Modular)...');

  // Base API path for Firebase routes
  const apiPrefix = '/api';

  // Mount extracted routers
  // app.use(apiPrefix, authRouter); // Handled by portal-auth and firebase-auth-middleware
  // app.use(apiPrefix, usersRouter); // Handled by userService
  app.use(apiPrefix, applicationsRouter); // Chef applications to Local Cooks
  app.use(apiPrefix, adminEmailRouter);
  app.use(apiPrefix, dashboardRouter);
  app.use(apiPrefix, mediaRouter);
  // app.use(apiPrefix, microlearningRouter); // Handled by routes/microlearning
  app.use(apiPrefix, healthRouter);
  // app.use(apiPrefix, locationsRouter); // Handled by routes/locations
  app.use(apiPrefix, platformRouter);
  app.use(apiPrefix, kitchenApplicationsRouter);

  logger.info('✅ All Firebase modules registered.');
}