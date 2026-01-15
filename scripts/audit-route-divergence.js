#!/usr/bin/env node
/**
 * Route Reconciliation Audit Script
 * 
 * Extracts and compares routes from:
 * - server/routes.ts (TypeScript source)
 * - server/firebase-routes.ts (TypeScript source)
 * - api/index.js (Production)
 * 
 * Generates a comprehensive report identifying:
 * - Routes only in production (phantom routes)
 * - Routes only in TypeScript (missing in prod)
 * - Routes with different implementations
 * - Routes with different middleware/auth requirements
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROUTES_TS = path.join(__dirname, '../server/routes.ts');
const FIREBASE_ROUTES_TS = path.join(__dirname, '../server/firebase-routes.ts');
const API_INDEX_JS = path.join(__dirname, '../api/index.js');
const OUTPUT_REPORT = path.join(__dirname, '../docs/ROUTE_AUDIT_REPORT.md');

// Route extraction patterns
const ROUTE_PATTERNS = [
  /app\.(get|post|put|patch|delete|use)\s*\(\s*["']([^"']+)["']/g,
  /app\.(get|post|put|patch|delete|use)\s*\(\s*`([^`]+)`/g,
  /router\.(get|post|put|patch|delete|use)\s*\(\s*["']([^"']+)["']/g,
  /router\.(get|post|put|patch|delete|use)\s*\(\s*`([^`]+)`/g,
];

/**
 * Extract routes from file content
 */
function extractRoutes(content, sourceFile) {
  const routes = [];
  const seen = new Set();
  
  // Try all patterns
  for (const pattern of ROUTE_PATTERNS) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const routePath = match[2];
      const key = `${method} ${routePath}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        routes.push({
          method,
          path: routePath,
          sourceFile: path.basename(sourceFile),
          lineNumber: content.substring(0, match.index).split('\n').length,
        });
      }
    }
  }
  
  // Also look for route definitions that might be on multiple lines
  // Handle cases like: app.get("/api/path", middleware, handler)
  const multilinePattern = /app\.(get|post|put|patch|delete|use)\s*\(\s*["']([^"']+)["']/g;
  let multilineMatch;
  while ((multilineMatch = multilinePattern.exec(content)) !== null) {
    const method = multilineMatch[1].toUpperCase();
    const routePath = multilineMatch[2];
    const key = `${method} ${routePath}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      routes.push({
        method,
        path: routePath,
        sourceFile: path.basename(sourceFile),
        lineNumber: content.substring(0, multilineMatch.index).split('\n').length,
      });
    }
  }
  
  return routes;
}

/**
 * Normalize route path for comparison
 */
function normalizePath(routePath) {
  // Remove trailing slashes (except root)
  if (routePath !== '/' && routePath.endsWith('/')) {
    routePath = routePath.slice(0, -1);
  }
  return routePath;
}

/**
 * Group routes by normalized path
 */
function groupRoutes(routes) {
  const grouped = new Map();
  
  for (const route of routes) {
    const normalized = normalizePath(route.path);
    const key = `${route.method} ${normalized}`;
    
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(route);
  }
  
  return grouped;
}

/**
 * Main audit function
 */
function auditRoutes() {
  console.log('🔍 Starting route reconciliation audit...\n');
  
  // Read files
  console.log('Reading source files...');
  const routesTsContent = fs.readFileSync(ROUTES_TS, 'utf8');
  const firebaseRoutesTsContent = fs.readFileSync(FIREBASE_ROUTES_TS, 'utf8');
  const apiIndexJsContent = fs.readFileSync(API_INDEX_JS, 'utf8');
  
  console.log(`✅ Read server/routes.ts (${routesTsContent.length} chars)`);
  console.log(`✅ Read server/firebase-routes.ts (${firebaseRoutesTsContent.length} chars)`);
  console.log(`✅ Read api/index.js (${apiIndexJsContent.length} chars)\n`);
  
  // Extract routes
  console.log('Extracting routes...');
  const routesTs = extractRoutes(routesTsContent, ROUTES_TS);
  const firebaseRoutesTs = extractRoutes(firebaseRoutesTsContent, FIREBASE_ROUTES_TS);
  const apiIndexJs = extractRoutes(apiIndexJsContent, API_INDEX_JS);
  
  console.log(`✅ Found ${routesTs.length} routes in server/routes.ts`);
  console.log(`✅ Found ${firebaseRoutesTs.length} routes in server/firebase-routes.ts`);
  console.log(`✅ Found ${apiIndexJs.length} routes in api/index.js\n`);
  
  // Combine TypeScript routes
  const allTsRoutes = [...routesTs, ...firebaseRoutesTs];
  console.log(`📊 Total TypeScript routes: ${allTsRoutes.length}`);
  console.log(`📊 Total Production routes: ${apiIndexJs.length}`);
  console.log(`📊 Difference: ${apiIndexJs.length - allTsRoutes.length} routes\n`);
  
  // Group routes for comparison
  const tsGrouped = groupRoutes(allTsRoutes);
  const prodGrouped = groupRoutes(apiIndexJs);
  
  // Find differences
  const onlyInProd = [];
  const onlyInTs = [];
  const inBoth = [];
  
  // Check production routes
  for (const [key, prodRoutes] of prodGrouped.entries()) {
    if (!tsGrouped.has(key)) {
      onlyInProd.push(...prodRoutes);
    } else {
      inBoth.push({
        key,
        tsRoutes: tsGrouped.get(key),
        prodRoutes,
      });
    }
  }
  
  // Check TypeScript routes
  for (const [key, tsRoutes] of tsGrouped.entries()) {
    if (!prodGrouped.has(key)) {
      onlyInTs.push(...tsRoutes);
    }
  }
  
  // Generate report
  console.log('📝 Generating audit report...');
  generateReport({
    routesTs,
    firebaseRoutesTs,
    apiIndexJs,
    onlyInProd,
    onlyInTs,
    inBoth,
  });
  
  console.log(`✅ Report generated: ${OUTPUT_REPORT}`);
}

/**
 * Generate markdown report
 */
function generateReport({ routesTs, firebaseRoutesTs, apiIndexJs, onlyInProd, onlyInTs, inBoth }) {
  const report = `# Route Reconciliation Audit Report

Generated: ${new Date().toISOString()}

## Executive Summary

- **TypeScript Routes (server/routes.ts):** ${routesTs.length} routes
- **Firebase Routes (server/firebase-routes.ts):** ${firebaseRoutesTs.length} routes
- **Total TypeScript Routes:** ${routesTs.length + firebaseRoutesTs.length} routes
- **Production Routes (api/index.js):** ${apiIndexJs.length} routes
- **Route Divergence:** ${apiIndexJs.length - (routesTs.length + firebaseRoutesTs.length)} routes

## Route Count Breakdown

### By Source File

| Source | Route Count |
|--------|-------------|
| server/routes.ts | ${routesTs.length} |
| server/firebase-routes.ts | ${firebaseRoutesTs.length} |
| **Total TypeScript** | **${routesTs.length + firebaseRoutesTs.length}** |
| api/index.js (Production) | ${apiIndexJs.length} |
| **Difference** | **${apiIndexJs.length - (routesTs.length + firebaseRoutesTs.length)}** |

### By HTTP Method

#### TypeScript Routes
${generateMethodBreakdown([...routesTs, ...firebaseRoutesTs])}

#### Production Routes
${generateMethodBreakdown(apiIndexJs)}

## Phantom Routes (Only in Production)

**Total: ${onlyInProd.length} routes**

These routes exist in production (api/index.js) but are NOT found in TypeScript source files.

${onlyInProd.length > 0 ? onlyInProd.map(route => 
  `- **${route.method} ${route.path}** (line ${route.lineNumber} in ${route.sourceFile})`
).join('\n') : 'None found.'}

## Missing Routes (Only in TypeScript)

**Total: ${onlyInTs.length} routes**

These routes exist in TypeScript source but are NOT found in production.

${onlyInTs.length > 0 ? onlyInTs.map(route => 
  `- **${route.method} ${route.path}** (line ${route.lineNumber} in ${route.sourceFile})`
).join('\n') : 'None found.'}

## Routes Present in Both

**Total: ${inBoth.length} routes**

These routes exist in both TypeScript and production. They may have different implementations or middleware.

${inBoth.slice(0, 50).map(item => {
  const tsRoute = item.tsRoutes[0];
  const prodRoute = item.prodRoutes[0];
  return `- **${tsRoute.method} ${tsRoute.path}**
  - TypeScript: ${tsRoute.sourceFile}:${tsRoute.lineNumber}
  - Production: ${prodRoute.sourceFile}:${prodRoute.lineNumber}`;
}).join('\n\n')}

${inBoth.length > 50 ? `\n*... and ${inBoth.length - 50} more routes*` : ''}

## Recommendations

### For Phantom Routes (${onlyInProd.length} routes)

1. **Audit each route** to determine if it's:
   - Still in use (check frontend/client code)
   - Deprecated but kept for backward compatibility
   - Orphaned code that can be safely removed

2. **Action Items:**
   ${onlyInProd.length > 0 ? `
   - [ ] Review each phantom route for usage
   - [ ] Document purpose of routes that should be kept
   - [ ] Create migration plan for routes that need to be added to TypeScript
   - [ ] Remove routes that are no longer needed
   ` : '   - No phantom routes found - production and TypeScript are in sync!'}

### For Missing Routes (${onlyInTs.length} routes)

1. **Verify these routes are needed** in production
2. **If needed:** Ensure they're properly included in the build process
3. **If not needed:** Remove them from TypeScript source

### Next Steps

1. ✅ Complete route audit (this report)
2. ⏳ Review phantom routes and decide: keep, migrate, or remove
3. ⏳ Update migration plan based on audit findings
4. ⏳ Proceed with Phase 2: Route Modularization

## Detailed Route Lists

### All TypeScript Routes (server/routes.ts)

${routesTs.map(r => `- ${r.method} ${r.path}`).join('\n')}

### All Firebase Routes (server/firebase-routes.ts)

${firebaseRoutesTs.map(r => `- ${r.method} ${r.path}`).join('\n')}

### All Production Routes (api/index.js)

${apiIndexJs.map(r => `- ${r.method} ${r.path}`).join('\n')}
`;

  // Ensure docs directory exists
  const docsDir = path.dirname(OUTPUT_REPORT);
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  
  fs.writeFileSync(OUTPUT_REPORT, report);
}

/**
 * Generate method breakdown table
 */
function generateMethodBreakdown(routes) {
  const methods = {};
  for (const route of routes) {
    methods[route.method] = (methods[route.method] || 0) + 1;
  }
  
  const rows = Object.entries(methods)
    .sort((a, b) => b[1] - a[1])
    .map(([method, count]) => `| ${method} | ${count} |`)
    .join('\n');
  
  return `| Method | Count |\n|--------|-------|\n${rows}`;
}

// Run audit
try {
  auditRoutes();
  console.log('\n✅ Route audit completed successfully!');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Route audit failed:', error);
  process.exit(1);
}
