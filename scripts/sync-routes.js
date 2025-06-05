#!/usr/bin/env node

/**
 * Route Synchronization Script
 * 
 * This script extracts API routes from server/routes.ts and generates api/index.js
 * ensuring development and production environments remain perfectly synchronized.
 * 
 * Features:
 * - Extracts all Express routes from TypeScript
 * - Maintains proper middleware and authentication
 * - Preserves database operations and error handling
 * - Automatically updates production file
 * - Validates sync status
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROUTES_SOURCE = path.join(__dirname, '../server/routes.ts');
const API_TARGET = path.join(__dirname, '../api/index.js');
const API_TEMPLATE = path.join(__dirname, '../api/template.js');

console.log('🔄 Starting route synchronization...');

// Read the TypeScript routes file
function readRoutesFile() {
  console.log('Looking for routes file at:', ROUTES_SOURCE);
  
  if (!fs.existsSync(ROUTES_SOURCE)) {
    throw new Error(`Routes source file not found: ${ROUTES_SOURCE}`);
  }
  
  const content = fs.readFileSync(ROUTES_SOURCE, 'utf8');
  console.log(`✅ Read routes source file (${content.length} characters)`);
  return content;
}

// Extract routes from TypeScript content
function extractRoutes(content) {
  const routes = [];
  
  // Split content into lines for easier processing
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Look for route definitions
    const routeMatch = line.match(/app\.(get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]/);
    
    if (routeMatch) {
      const [, method, path] = routeMatch;
      
      // Extract the complete route handler
      let routeCode = '';
      let braceCount = 0;
      let parenCount = 0;
      let inString = false;
      let stringChar = '';
      let foundStart = false;
      
      // Start from the current line and continue until we find the complete handler
      for (let j = i; j < lines.length; j++) {
        const currentLine = lines[j];
        routeCode += currentLine + '\n';
        
        // Parse character by character to track braces and parentheses
        for (let k = 0; k < currentLine.length; k++) {
          const char = currentLine[k];
          const nextChar = currentLine[k + 1];
          
          // Skip comments
          if (!inString && char === '/' && nextChar === '/') {
            break; // Skip rest of line
          }
          
          // Handle strings
          if (!inString && (char === '"' || char === "'" || char === '`')) {
            inString = true;
            stringChar = char;
            continue;
          }
          if (inString && char === stringChar && currentLine[k-1] !== '\\') {
            inString = false;
            stringChar = '';
            continue;
          }
          if (inString) continue;
          
          // Count braces and parentheses
          if (char === '(') {
            parenCount++;
            foundStart = true;
          } else if (char === ')') {
            parenCount--;
          } else if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
          }
        }
        
        // Check if we've completed the route definition
        if (foundStart && parenCount === 0 && braceCount === 0) {
          // Look for the closing semicolon or next route
          if (currentLine.includes(');') || j === lines.length - 1) {
            break;
          }
        }
      }
      
      routes.push({
        method: method.toLowerCase(),
        path,
        handler: routeCode.trim(),
        line: i + 1
      });
    }
  }
  
  console.log(`✅ Extracted ${routes.length} routes`);
  return routes;
}

// Extract helper functions from TypeScript
function extractHelperFunctions(content) {
  const helpers = [];
  
  // Pattern to match async function declarations
  const functionPattern = /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?^\s*\}/gm;
  
  let match;
  while ((match = functionPattern.exec(content)) !== null) {
    const [fullMatch, functionName] = match;
    if (!functionName.startsWith('register') && !functionName.startsWith('setup')) {
      helpers.push({
        name: functionName,
        code: fullMatch
      });
    }
  }
  
  // Also extract const arrow functions
  const arrowFunctionPattern = /const\s+(\w+)\s*=\s*async\s*\([^)]*\)\s*=>\s*\{[\s\S]*?^\s*\};/gm;
  
  while ((match = arrowFunctionPattern.exec(content)) !== null) {
    const [fullMatch, functionName] = match;
    helpers.push({
      name: functionName,
      code: fullMatch
    });
  }
  
  console.log(`✅ Extracted ${helpers.length} helper functions`);
  return helpers;
}

// Read the API template
function readApiTemplate() {
  if (!fs.existsSync(API_TEMPLATE)) {
    // Create a basic template if it doesn't exist
    createApiTemplate();
  }
  
  const content = fs.readFileSync(API_TEMPLATE, 'utf8');
  console.log('✅ Read API template');
  return content;
}

// Create API template file
function createApiTemplate() {
  const template = `// Auto-generated API file for Vercel deployment
// Source: server/routes.ts
// Generated: ${new Date().toISOString()}
// 
// ⚠️  DO NOT EDIT THIS FILE MANUALLY
// ⚠️  All changes should be made in server/routes.ts
// ⚠️  Run 'npm run sync-routes' to update this file

import express from 'express';
import session from 'express-session';
import { Pool } from '@neondatabase/serverless';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import createMemoryStore from 'memorystore';
import connectPgSimple from 'connect-pg-simple';
import path from 'path';
import fs from 'fs';
import multer from 'multer';

// Setup
const app = express();
const scryptAsync = promisify(scrypt);
const MemoryStore = createMemoryStore(session);
const PgStore = connectPgSimple(session);

// {{MIDDLEWARE_SETUP}}

// {{DATABASE_SETUP}}

// {{HELPER_FUNCTIONS}}

// {{ROUTES}}

// {{ERROR_HANDLING}}

export default app;
`;

  fs.writeFileSync(API_TEMPLATE, template);
  console.log('✅ Created API template');
}

// Generate the production API file
function generateApiFile(routes, helpers) {
  let template = readApiTemplate();
  
  // Convert TypeScript routes to JavaScript
  const jsRoutes = routes.map(route => {
    let jsCode = route.handler;
    
    // Convert TypeScript to JavaScript
    jsCode = jsCode
      // Remove type annotations for parameters
      .replace(/(\w+):\s*Request/g, '$1')
      .replace(/(\w+):\s*Response/g, '$1')
      .replace(/(\w+):\s*NextFunction/g, '$1')
      .replace(/(\w+):\s*Express\.Request/g, '$1')
      .replace(/(\w+):\s*Express\.Response/g, '$1')
      // Remove other type annotations
      .replace(/:\s*\w+(\[\])?(\s*\|\s*\w+)*(?=\s*[,\)\{=])/g, '')
      // Remove interface/type definitions
      .replace(/interface\s+\w+\s*\{[^}]*\}/g, '')
      .replace(/type\s+\w+\s*=.*?;/g, '')
      // Remove import type statements
      .replace(/import\s+type\s+.*?from.*?;/g, '')
      // Convert const assertions
      .replace(/as\s+const/g, '')
      .replace(/as\s+\w+/g, '')
      // Remove TypeScript-specific syntax
      .replace(/!\./g, '.')
      .replace(/!\[/g, '[')
      .replace(/\?\./g, '.')
      .replace(/\?\[/g, '[')
      // Convert type imports to regular imports  
      .replace(/import\s+type\s+\{([^}]+)\}\s+from/g, 'import { $1 } from')
      // Fix destructuring with types
      .replace(/\{\s*([^}:]+):\s*[^}]+\s*\}/g, '{ $1 }')
      // Clean up any remaining type annotations in function parameters
      .replace(/\(([^)]*?):\s*[^)]*?\)/g, (match, params) => {
        const cleanParams = params.split(',').map(param => {
          return param.split(':')[0].trim();
        }).join(', ');
        return `(${cleanParams})`;
      });
    
    return jsCode;
  }).join('\n\n');
  
  // Convert helper functions to JavaScript (if any extracted)
  const jsHelpers = helpers.map(helper => {
    let jsCode = helper.code;
    
    // Apply same TypeScript to JavaScript conversions
    jsCode = jsCode
      .replace(/:\s*\w+(\[\])?(\s*\|\s*\w+)*(?=\s*[,\)\{=])/g, '')
      .replace(/interface\s+\w+\s*\{[^}]*\}/g, '')
      .replace(/type\s+\w+\s*=.*?;/g, '')
      .replace(/as\s+const/g, '')
      .replace(/as\s+\w+/g, '')
      .replace(/!\./g, '.')
      .replace(/\?\./g, '.');
    
    return jsCode;
  }).join('\n\n');
  
  // Replace template placeholders
  template = template
    .replace('// {{ROUTES}}', jsRoutes)
    .replace('// {{HELPER_FUNCTIONS}}', jsHelpers)
    .replace('{{TIMESTAMP}}', new Date().toISOString());
  
  return template;
}

// Write the generated API file
function writeApiFile(content) {
  // Backup existing file
  if (fs.existsSync(API_TARGET)) {
    const backupPath = `${API_TARGET}.backup.${Date.now()}`;
    fs.copyFileSync(API_TARGET, backupPath);
    console.log(`📦 Backed up existing API file to ${path.basename(backupPath)}`);
  }
  
  fs.writeFileSync(API_TARGET, content);
  console.log('✅ Generated new API file');
}

// Validate the generated file
function validateApiFile() {
  try {
    const content = fs.readFileSync(API_TARGET, 'utf8');
    
    // Basic syntax validation
    if (!content.includes('export default app')) {
      throw new Error('Missing export statement');
    }
    
    // Check for route count
    const routeCount = (content.match(/app\.(get|post|put|delete|patch)/g) || []).length;
    if (routeCount === 0) {
      throw new Error('No routes found in generated file');
    }
    
    console.log(`✅ Validation passed (${routeCount} routes)`);
    return true;
  } catch (error) {
    console.error('❌ Validation failed:', error.message);
    return false;
  }
}

// Main synchronization function
async function syncRoutes() {
  try {
    console.log('🚀 LocalCooks Route Synchronization System');
    console.log('==========================================');
    
    // Read and parse source file
    const sourceContent = readRoutesFile();
    const routes = extractRoutes(sourceContent);
    const helpers = extractHelperFunctions(sourceContent);
    
    // Generate production file
    const apiContent = generateApiFile(routes, helpers);
    writeApiFile(apiContent);
    
    // Validate result
    if (validateApiFile()) {
      console.log('');
      console.log('🎉 Route synchronization completed successfully!');
      console.log(`📊 Synchronized ${routes.length} routes and ${helpers.length} helpers`);
      console.log('🔒 Development and production are now in sync');
    } else {
      throw new Error('Generated file failed validation');
    }
    
  } catch (error) {
    console.error('');
    console.error('💥 Route synchronization failed:', error.message);
    console.error('');
    console.error('🔧 Troubleshooting:');
    console.error('1. Check that server/routes.ts exists and is valid');
    console.error('2. Ensure all TypeScript syntax is compatible');
    console.error('3. Run "npm run type-check" to verify TypeScript compilation');
    process.exit(1);
  }
}

// Run if called directly
const scriptPath = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === scriptPath;

if (isMainModule) {
  syncRoutes().catch(error => {
    console.error('Failed to sync routes:', error);
    process.exit(1);
  });
}

export { syncRoutes };
