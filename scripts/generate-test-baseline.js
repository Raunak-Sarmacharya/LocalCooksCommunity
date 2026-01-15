#!/usr/bin/env node
/**
 * Test Coverage Baseline Generator
 * 
 * Scans client code to identify:
 * - All API endpoints used by frontend
 * - Which routes use Firebase auth vs session auth
 * - Environment-specific behavior
 * - Critical flows for testing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENT_DIR = path.join(__dirname, '../client');
const OUTPUT_REPORT = path.join(__dirname, '../docs/TEST_BASELINE.md');

/**
 * Find all API endpoint calls in client code
 */
function findApiEndpoints() {
  console.log('🔍 Scanning client code for API endpoints...');
  
  const endpoints = new Set();
  const endpointDetails = [];
  
  // Search for common patterns
  const patterns = [
    /fetch\s*\(\s*["']([^"']*\/api\/[^"']+)["']/g,
    /fetch\s*\(\s*`([^`]*\/api\/[^`]+)`/g,
    /apiRequest\s*\(\s*["']([A-Z]+)["']\s*,\s*["']([^"']*\/api\/[^"']+)["']/g,
    /apiRequest\s*\(\s*["']([A-Z]+)["']\s*,\s*`([^`]*\/api\/[^`]+)`/g,
    /apiGet\s*\(\s*["']([^"']*\/api\/[^"']+)["']/g,
    /apiPost\s*\(\s*["']([^"']*\/api\/[^"']+)["']/g,
    /apiPut\s*\(\s*["']([^"']*\/api\/[^"']+)["']/g,
    /apiPatch\s*\(\s*["']([^"']*\/api\/[^"']+)["']/g,
    /apiDelete\s*\(\s*["']([^"']*\/api\/[^"']+)["']/g,
  ];
  
  // Recursively find all TypeScript/TSX files
  function findFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory() && !file.includes('node_modules')) {
        findFiles(filePath, fileList);
      } else if (file.match(/\.(ts|tsx|js|jsx)$/)) {
        fileList.push(filePath);
      }
    }
    
    return fileList;
  }
  
  const files = findFiles(CLIENT_DIR);
  console.log(`📁 Found ${files.length} files to scan`);
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      
      // Try all patterns
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          let method = 'GET';
          let endpoint = '';
          
          if (match.length === 3) {
            // apiRequest pattern
            method = match[1];
            endpoint = match[2];
          } else {
            // fetch pattern
            endpoint = match[1];
            // Try to infer method from context
            const beforeMatch = content.substring(Math.max(0, match.index - 50), match.index);
            if (beforeMatch.includes('POST') || beforeMatch.includes('post')) {
              method = 'POST';
            } else if (beforeMatch.includes('PUT') || beforeMatch.includes('put')) {
              method = 'PUT';
            } else if (beforeMatch.includes('PATCH') || beforeMatch.includes('patch')) {
              method = 'PATCH';
            } else if (beforeMatch.includes('DELETE') || beforeMatch.includes('delete')) {
              method = 'DELETE';
            }
          }
          
          // Normalize endpoint
          endpoint = endpoint.split('?')[0]; // Remove query params
          endpoint = endpoint.split('#')[0]; // Remove hash
          
          if (endpoint.startsWith('/api/')) {
            const key = `${method} ${endpoint}`;
            if (!endpoints.has(key)) {
              endpoints.add(key);
              endpointDetails.push({
                method,
                endpoint,
                file: path.relative(CLIENT_DIR, file),
                line: content.substring(0, match.index).split('\n').length,
              });
            }
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Error reading ${file}:`, error.message);
    }
  }
  
  console.log(`✅ Found ${endpoints.size} unique API endpoints\n`);
  return endpointDetails.sort((a, b) => {
    if (a.endpoint !== b.endpoint) return a.endpoint.localeCompare(b.endpoint);
    return a.method.localeCompare(b.method);
  });
}

/**
 * Categorize endpoints by auth type
 */
function categorizeEndpoints(endpoints) {
  const categories = {
    firebase: [],
    session: [],
    public: [],
    unknown: [],
  };
  
  for (const ep of endpoints) {
    const endpoint = ep.endpoint.toLowerCase();
    
    if (endpoint.includes('/firebase/') || endpoint.includes('/firebase-')) {
      categories.firebase.push(ep);
    } else if (endpoint.includes('/admin-login') || 
               endpoint.includes('/manager-login') ||
               endpoint.includes('/portal-login') ||
               endpoint.includes('/user-session') ||
               endpoint.includes('/logout')) {
      categories.session.push(ep);
    } else if (endpoint.includes('/public/') ||
               endpoint.includes('/health') ||
               endpoint.includes('/unsubscribe')) {
      categories.public.push(ep);
    } else {
      categories.unknown.push(ep);
    }
  }
  
  return categories;
}

/**
 * Identify critical flows
 */
function identifyCriticalFlows(endpoints) {
  const flows = {
    'User Registration/Login': [
      '/api/firebase-register-user',
      '/api/firebase/forgot-password',
      '/api/firebase/reset-password',
      '/api/admin-login',
      '/api/manager/forgot-password',
      '/api/manager/reset-password',
      '/api/portal-login',
      '/api/portal-register',
    ],
    'Location Management': [
      '/api/locations',
      '/api/public/locations',
      '/api/portal/locations',
    ],
    'Kitchen Booking': [
      '/api/bookings',
      '/api/kitchen-bookings',
      '/api/portal/bookings',
    ],
    'Payment Processing': [
      '/api/payments',
      '/api/stripe',
      '/api/webhooks/stripe',
    ],
    'Manager Dashboard': [
      '/api/manager/dashboard',
      '/api/manager/revenue',
      '/api/manager/bookings',
    ],
    'Application Management': [
      '/api/applications',
      '/api/firebase/applications',
      '/api/delivery-partner-applications',
    ],
  };
  
  return flows;
}

/**
 * Generate markdown report
 */
function generateReport(endpoints, categories, flows) {
  const report = `# Test Coverage Baseline

Generated: ${new Date().toISOString()}

## Executive Summary

This document establishes a baseline of API endpoints used by the frontend client before the architecture migration. This baseline will be used to validate that all endpoints continue to work after the migration.

- **Total API Endpoints Found:** ${endpoints.length}
- **Firebase Auth Endpoints:** ${categories.firebase.length}
- **Session Auth Endpoints:** ${categories.session.length}
- **Public Endpoints:** ${categories.public.length}
- **Uncategorized Endpoints:** ${categories.unknown.length}

## Endpoint Categories

### Firebase Authentication Endpoints (${categories.firebase.length})

These endpoints use Firebase JWT authentication via \`Authorization: Bearer <token>\` header.

${categories.firebase.map(ep => 
  `- **${ep.method} ${ep.endpoint}** (${ep.file}:${ep.line})`
).join('\n')}

### Session Authentication Endpoints (${categories.session.length})

These endpoints use session-based authentication (cookies).

${categories.session.map(ep => 
  `- **${ep.method} ${ep.endpoint}** (${ep.file}:${ep.line})`
).join('\n')}

### Public Endpoints (${categories.public.length})

These endpoints require no authentication.

${categories.public.map(ep => 
  `- **${ep.method} ${ep.endpoint}** (${ep.file}:${ep.line})`
).join('\n')}

### Uncategorized Endpoints (${categories.unknown.length})

These endpoints need manual review to determine auth requirements.

${categories.unknown.map(ep => 
  `- **${ep.method} ${ep.endpoint}** (${ep.file}:${ep.line})`
).join('\n')}

## Critical User Flows

### 1. User Registration/Login Flow

**Endpoints:**
${flows['User Registration/Login'].map(ep => `- ${ep}`).join('\n')}

**Test Cases:**
- [ ] User can register with email/password
- [ ] User can register with Google OAuth
- [ ] User can login with email/password
- [ ] User can reset forgotten password
- [ ] Admin can login via session auth
- [ ] Manager can login via session auth
- [ ] Portal user can login/register

### 2. Location Creation Flow

**Endpoints:**
${flows['Location Management'].map(ep => `- ${ep}`).join('\n')}

**Test Cases:**
- [ ] Manager can create new location
- [ ] Manager can edit location details
- [ ] Public can view available locations
- [ ] Portal user can view locations

### 3. Kitchen Booking Flow

**Endpoints:**
${flows['Kitchen Booking'].map(ep => `- ${ep}`).join('\n')}

**Test Cases:**
- [ ] Chef can view available kitchen slots
- [ ] Chef can create kitchen booking
- [ ] Chef can cancel booking (if allowed)
- [ ] Manager can view all bookings for their location
- [ ] Manager can update booking status
- [ ] Portal user can view bookings

### 4. Payment Processing Flow

**Endpoints:**
${flows['Payment Processing'].map(ep => `- ${ep}`).join('\n')}

**Test Cases:**
- [ ] Stripe payment intent creation
- [ ] Payment confirmation
- [ ] Stripe webhook processing
- [ ] Payment history retrieval
- [ ] Refund processing

### 5. Manager Dashboard Flow

**Endpoints:**
${flows['Manager Dashboard'].map(ep => `- ${ep}`).join('\n')}

**Test Cases:**
- [ ] Manager can view dashboard overview
- [ ] Manager can view revenue reports
- [ ] Manager can view booking statistics
- [ ] Manager can manage kitchen availability

### 6. Application Management Flow

**Endpoints:**
${flows['Application Management'].map(ep => `- ${ep}`).join('\n')}

**Test Cases:**
- [ ] Chef can submit application
- [ ] Chef can upload documents
- [ ] Admin can review applications
- [ ] Admin can approve/reject applications
- [ ] Delivery partner can submit application

## All Endpoints (Complete List)

${endpoints.map(ep => 
  `- **${ep.method} ${ep.endpoint}** - ${ep.file}:${ep.line}`
).join('\n')}

## Environment-Specific Behavior

### Development Environment
- Uses local file storage for uploads
- Vite dev server for hot reloading
- Local PostgreSQL database
- Firebase emulator (if configured)

### Production Environment
- Uses Cloudflare R2 for file storage
- Static file serving
- Neon PostgreSQL database
- Production Firebase project

## Testing Strategy

### Pre-Migration Testing
1. Document current behavior of all critical flows
2. Capture response formats and status codes
3. Note any environment-specific differences

### Post-Migration Validation
1. Test all critical flows match baseline behavior
2. Verify authentication still works correctly
3. Confirm file uploads/downloads work
4. Validate payment processing unchanged
5. Check error handling consistent

## Notes

- This baseline was generated automatically by scanning client source code
- Some endpoints may be called dynamically and not captured
- Manual review recommended for critical endpoints
- Update this document after migration to reflect any changes
`;

  // Ensure docs directory exists
  const docsDir = path.dirname(OUTPUT_REPORT);
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  
  fs.writeFileSync(OUTPUT_REPORT, report);
}

// Main execution
try {
  const endpoints = findApiEndpoints();
  const categories = categorizeEndpoints(endpoints);
  const flows = identifyCriticalFlows(endpoints);
  
  generateReport(endpoints, categories, flows);
  
  console.log(`✅ Test baseline generated: ${OUTPUT_REPORT}`);
  process.exit(0);
} catch (error) {
  console.error('❌ Failed to generate test baseline:', error);
  process.exit(1);
}
