#!/usr/bin/env node
// vercel-build.mjs
// Unified build script for Vercel deployment
// Replaces the old api-build.mjs + vercel-build.mjs approach

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

console.log('🔨 Building for production...');

// 1. Build frontend with Vite
console.log('Building frontend...');
runCommand('npx vite build');

// 2. Compile TypeScript server to dist/ (needed for path resolution)
console.log('Compiling server TypeScript...');
runCommand('npx tsc -p tsconfig.server.json');

// 3. Bundle for Vercel using esbuild
// This creates a single unified api/index.js from server/index.ts
// This unifies the entry point - no more dual entry points!
console.log('Bundling for serverless...');
// Create api directory if it doesn't exist
if (!fs.existsSync('api')) {
  fs.mkdirSync('api', { recursive: true });
}

// Bundle the compiled server entry point to api/index.js
// This replaces the old 25k-line api/index.js with a unified build
// Exclude Vite and Rollup (build tools) from the bundle - they have platform-specific native deps
runCommand('npx esbuild dist/server/index.js --bundle --platform=node --packages=external --format=esm --outfile=api/index.js --external:vite --external:rollup --external:@rollup/*');

// 4. Copy static assets
console.log('Copying static assets...');
if (fs.existsSync('dist/public')) {
  // Ensure dist/client exists
  if (!fs.existsSync('dist/client')) {
    fs.mkdirSync('dist/client', { recursive: true });
  }
  
  // Copy files from dist/public to dist/client
  const files = fs.readdirSync('dist/public');
  for (const file of files) {
    const srcPath = path.join('dist/public', file);
    const destPath = path.join('dist/client', file);
    
    if (fs.statSync(srcPath).isDirectory()) {
      // Copy directory recursively
      runCommand(`cp -r "${srcPath}" "${destPath}"`);
    } else {
      // Copy file
      fs.copyFileSync(srcPath, destPath);
    }
  }
} else {
  console.log('Warning: dist/public directory not found');
  
  // Create a basic index.html if it doesn't exist
  if (!fs.existsSync('dist/client')) {
    fs.mkdirSync('dist/client', { recursive: true });
  }
  
  if (!fs.existsSync('dist/client/index.html')) {
    console.log('Creating a basic index.html file');
    fs.writeFileSync(
      'dist/client/index.html',
      '<!DOCTYPE html><html><head><title>Local Cooks</title></head><body><h1>Local Cooks Application</h1></body></html>'
    );
  }
}

console.log('✅ Build complete!');