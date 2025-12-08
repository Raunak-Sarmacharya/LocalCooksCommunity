#!/usr/bin/env node
// vercel-build.mjs
// This file is a safer alternative to the bash script and works cross-platform
// It's called by Vercel during the build process

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function runCommand(command) {
  console.log(`Running: ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    console.error(error);
    process.exit(1);
  }
}

// Create the output directories
console.log('Creating build directories...');
fs.mkdirSync('dist/client', { recursive: true });

// Build the frontend with Vite
console.log('Building frontend with Vite...');
runCommand('npx vite build');

// Build the server files with esbuild
console.log('Building server files with esbuild...');
runCommand('npx esbuild server/**/*.ts shared/**/*.ts --platform=node --packages=external --bundle --format=esm --outdir=dist');

// Post-process esbuild output to fix timezone-utils imports
console.log('Post-processing esbuild output to fix imports...');
const distServerEmailPath = path.join('dist', 'server', 'email.js');
if (fs.existsSync(distServerEmailPath)) {
  let content = fs.readFileSync(distServerEmailPath, 'utf8');
  
  // Fix timezone-utils import to use dynamic import (same pattern as api/server/email.js)
  // Look for any import from timezone-utils
  const timezoneUtilsImportPattern = /import\s+\{[^}]*createBookingDateTime[^}]*\}\s+from\s+["']([^"']*timezone-utils[^"']*)["'];?/;
  
  if (timezoneUtilsImportPattern.test(content)) {
    console.log('Found timezone-utils import in dist/server/email.js, replacing with dynamic import...');
    const replacement = `import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

// Dynamic import for timezone-utils to handle Vercel serverless path resolution
let createBookingDateTimeCache = null;
async function getCreateBookingDateTime() {
  if (!createBookingDateTimeCache) {
    // Get the directory of the current file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    // Try multiple possible paths for timezone-utils
    // In Vercel, files are at /var/task/server/email.js and /var/task/shared/timezone-utils.js
    const possiblePaths = [
      join(__dirname, '../shared/timezone-utils.js'),  // From server/email.js to shared/timezone-utils.js (CORRECT PATH)
      join(__dirname, '../../shared/timezone-utils.js'),  // Alternative
      join(__dirname, './shared/timezone-utils.js'),  // If files are in same directory
      '/var/task/shared/timezone-utils.js',  // Absolute path for Vercel
      '/var/task/api/shared/timezone-utils.js',  // Alternative absolute path
    ];
    
    let lastError = null;
    for (const filePath of possiblePaths) {
      try {
        // Convert file path to file:// URL, ensuring .js extension is preserved
        const timezoneUtilsUrl = pathToFileURL(filePath).href;
        
        // Import the module
        const timezoneUtils = await import(timezoneUtilsUrl);
        
        if (!timezoneUtils || !timezoneUtils.createBookingDateTime) {
          throw new Error('timezone-utils module loaded but createBookingDateTime not found');
        }
        createBookingDateTimeCache = timezoneUtils.createBookingDateTime;
        console.log(\`Successfully loaded timezone-utils from: \${timezoneUtilsUrl}\`);
        break; // Success, exit loop
      } catch (error) {
        lastError = error;
        // Continue to next path
        continue;
      }
    }
    
    // If all paths failed, use fallback
    if (!createBookingDateTimeCache) {
      console.error('Failed to load timezone-utils from all attempted paths, using fallback. Last error:', lastError);
      // Fallback implementation
      createBookingDateTimeCache = (dateStr, timeStr, timezone = 'America/St_Johns') => {
        const [year, month, day] = dateStr.split('-').map(Number);
        const [hours, minutes] = timeStr.split(':').map(Number);
        return new Date(year, month - 1, day, hours, minutes);
      };
    }
  }
  return createBookingDateTimeCache;
}
async function createBookingDateTime(...args) {
  const fn = await getCreateBookingDateTime();
  return fn(...args);
}`;
    content = content.replace(timezoneUtilsImportPattern, replacement);
    fs.writeFileSync(distServerEmailPath, content);
    console.log('✅ Fixed timezone-utils import in dist/server/email.js');
  }
}

// Also ensure dist/shared/timezone-utils.js has no TypeScript syntax
const distSharedTimezoneUtilsPath = path.join('dist', 'shared', 'timezone-utils.js');
if (fs.existsSync(distSharedTimezoneUtilsPath)) {
  let content = fs.readFileSync(distSharedTimezoneUtilsPath, 'utf8');
  let modified = false;
  
  // Remove complex return type annotations if esbuild didn't remove them
  if (content.includes('): Array<')) {
    content = content.replace(/\)\s*:\s*Array<[^>]+>\s*\{/g, ') {');
    modified = true;
  }
  if (content.includes('): Promise<')) {
    content = content.replace(/\)\s*:\s*Promise<[^>]+>\s*\{/g, ') {');
    modified = true;
  }
  if (content.includes('): Record<')) {
    content = content.replace(/\)\s*:\s*Record<[^>]+>\s*\{/g, ') {');
    modified = true;
  }
  
  if (modified) {
    fs.writeFileSync(distSharedTimezoneUtilsPath, content);
    console.log('✅ Cleaned TypeScript syntax from dist/shared/timezone-utils.js');
  }
}

// Prepare API files for serverless deployment
console.log('Preparing API files for serverless deployment...');
runCommand('node api-build.mjs');

// Make sure the client directory is properly set up
if (fs.existsSync('dist/public')) {
  console.log('Moving dist/public contents to dist/client...');
  
  // Get a list of files in the public directory
  const files = fs.readdirSync('dist/public');
  
  // Copy each file to the client directory
  for (const file of files) {
    const srcPath = path.join('dist/public', file);
    const destPath = path.join('dist/client', file);
    
    if (fs.statSync(srcPath).isDirectory()) {
      // If it's a directory, copy recursively
      runCommand(`cp -r "${srcPath}" "${destPath}"`);
    } else {
      // If it's a file, copy it
      fs.copyFileSync(srcPath, destPath);
    }
  }
} else {
  console.log('Warning: dist/public directory not found');
  
  // Create a basic index.html if it doesn't exist
  if (!fs.existsSync('dist/client/index.html')) {
    console.log('Creating a basic index.html file');
    fs.writeFileSync(
      'dist/client/index.html',
      '<!DOCTYPE html><html><head><title>Local Cooks</title></head><body><h1>Local Cooks Application</h1></body></html>'
    );
  }
}

// Display directory structure for debugging
console.log('Build output structure:');
runCommand('ls -la dist/');
runCommand('ls -la dist/client/ || echo "Client directory not found or empty"');
runCommand('ls -la api/ || echo "API directory not found or empty"');

console.log('Build completed successfully!');