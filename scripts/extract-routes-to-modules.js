#!/usr/bin/env node
/**
 * Route Extraction Helper Script
 * 
 * Helps identify route boundaries in routes.ts for modularization
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROUTES_FILE = path.join(__dirname, '../server/routes.ts');

// Route categories and their patterns
const ROUTE_CATEGORIES = {
  auth: ['/api/auth/', '/api/register', '/api/admin-login', '/api/user-exists'],
  applications: ['/api/applications', '/api/delivery-partner-applications'],
  users: ['/api/get-users', '/api/user/'],
  bookings: ['/api/bookings', '/api/kitchen-bookings', '/api/storage-bookings', '/api/equipment-bookings'],
  kitchens: ['/api/kitchens', '/api/public/kitchens'],
  payments: ['/api/payments', '/api/webhooks/stripe'],
  admin: ['/api/admin/'],
  manager: ['/api/manager/'],
  chef: ['/api/chef/', '/api/chef-kitchen-access'],
  files: ['/api/files/', '/api/upload', '/api/images/'],
  storage: ['/api/storage'],
  equipment: ['/api/equipment'],
  public: ['/api/public/', '/api/unsubscribe', '/api/vehicles/'],
};

function analyzeRoutes() {
  const content = fs.readFileSync(ROUTES_FILE, 'utf8');
  const lines = content.split('\n');
  
  const routeMap = new Map();
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Find route definitions
    const routeMatch = line.match(/app\.(get|post|put|patch|delete|use)\s*\(\s*["']([^"']+)["']/);
    if (routeMatch) {
      const method = routeMatch[1];
      const routePath = routeMatch[2];
      
      // Categorize route
      let category = 'other';
      for (const [cat, patterns] of Object.entries(ROUTE_CATEGORIES)) {
        if (patterns.some(pattern => routePath.includes(pattern))) {
          category = cat;
          break;
        }
      }
      
      if (!routeMap.has(category)) {
        routeMap.set(category, []);
      }
      
      routeMap.get(category).push({
        method,
        path: routePath,
        line: i + 1,
      });
    }
  }
  
  // Print summary
  console.log('Route Analysis Summary:\n');
  for (const [category, routes] of routeMap.entries()) {
    console.log(`${category}: ${routes.length} routes`);
  }
  
  console.log('\nDetailed breakdown:');
  for (const [category, routes] of routeMap.entries()) {
    console.log(`\n${category.toUpperCase()} (${routes.length} routes):`);
    routes.forEach(r => {
      console.log(`  ${r.method.toUpperCase()} ${r.path} (line ${r.line})`);
    });
  }
}

analyzeRoutes();
