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