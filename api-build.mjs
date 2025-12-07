#!/usr/bin/env node
// api-build.mjs - Script to prepare the API files for Vercel serverless deployment

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

console.log('Preparing API files for serverless deployment...');

// Create the api directory if it doesn't exist
if (!fs.existsSync('api')) {
  fs.mkdirSync('api', { recursive: true });
}

// Make a temporary server directory for processing
const tempServerDir = path.join('api', 'server');
if (!fs.existsSync(tempServerDir)) {
  fs.mkdirSync(tempServerDir, { recursive: true });
}

// Make a temporary shared directory for processing
const tempSharedDir = path.join('api', 'shared');
if (!fs.existsSync(tempSharedDir)) {
  fs.mkdirSync(tempSharedDir, { recursive: true });
}

// Copy the necessary TS files to the temp directories with .js extension
console.log('Copying server files for the API function...');

// Process server files
const serverFiles = [
  'storage.ts',
  'storage-firebase.ts',
  'auth.ts',
  'routes.ts',
  'db.ts',
];

serverFiles.forEach(file => {
  const srcPath = path.join('server', file);
  const destPath = path.join(tempServerDir, file.replace('.ts', '.js'));
  
  if (fs.existsSync(srcPath)) {
    console.log(`Processing ${srcPath}...`);
    
    // Read the TypeScript file
    let content = fs.readFileSync(srcPath, 'utf8');
    
    // Convert TypeScript imports to JavaScript
    content = content.replace(/from ["'](.+)\.ts["'];/g, 'from "$1.js";');
    content = content.replace(/import\s+{([^}]+)}\s+from\s+["']@shared\/schema["'];/g, 'import {$1} from "../shared/schema.js";');
    
    // Write the modified content to the destination
    fs.writeFileSync(destPath, content);
  }
});

// Process schema file
const schemaFile = path.join('shared', 'schema.ts');
const schemaDestPath = path.join(tempSharedDir, 'schema.js');

if (fs.existsSync(schemaFile)) {
  console.log(`Processing ${schemaFile}...`);
  
  // Read the TypeScript file
  let content = fs.readFileSync(schemaFile, 'utf8');
  
  // Convert TypeScript imports to JavaScript
  content = content.replace(/from ["'](.+)\.ts["'];/g, 'from "$1.js";');
  
  // Write the modified content to the destination
  fs.writeFileSync(schemaDestPath, content);
}

// Copy subdomain-utils.js file
const subdomainUtilsFile = path.join('shared', 'subdomain-utils.js');
const subdomainUtilsDestPath = path.join(tempSharedDir, 'subdomain-utils.js');

if (fs.existsSync(subdomainUtilsFile)) {
  console.log(`Copying ${subdomainUtilsFile}...`);
  fs.copyFileSync(subdomainUtilsFile, subdomainUtilsDestPath);
} else {
  console.log(`Warning: ${subdomainUtilsFile} not found, trying TypeScript version...`);
  // Try TypeScript version if JS doesn't exist
  const subdomainUtilsTsFile = path.join('shared', 'subdomain-utils.ts');
  if (fs.existsSync(subdomainUtilsTsFile)) {
    console.log(`Processing ${subdomainUtilsTsFile}...`);
    let content = fs.readFileSync(subdomainUtilsTsFile, 'utf8');
    // Remove TypeScript type annotations (simplified conversion)
    content = content.replace(/:\s*SubdomainType/g, '');
    content = content.replace(/:\s*string/g, '');
    content = content.replace(/:\s*Record<string, string \| string\[\] \| undefined>/g, '');
    content = content.replace(/:\s*boolean/g, '');
    content = content.replace(/export type SubdomainType[^;]+;/g, '');
    // Convert TypeScript imports to JavaScript
    content = content.replace(/from ["'](.+)\.ts["'];/g, 'from "$1.js";');
    fs.writeFileSync(subdomainUtilsDestPath, content);
  } else {
    console.error(`Error: Neither ${subdomainUtilsFile} nor ${subdomainUtilsTsFile} found!`);
  }
}

// No need to copy vercel-server.js anymore since we've integrated it into api/index.js
console.log('Using simplified API implementation for better serverless support...');

console.log('API file preparation completed!');