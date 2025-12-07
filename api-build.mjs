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
  'email.ts',
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
    // Fix imports from shared directory (relative paths)
    content = content.replace(/from\s+["']\.\.\/shared\/([^"']+)["']/g, 'from "../shared/$1.js"');
    content = content.replace(/from\s+["']\.\.\/shared\/([^"']+)\.ts["']/g, 'from "../shared/$1.js"');
    
    // Remove TypeScript-specific syntax (basic cleanup for email.ts)
    if (file === 'email.ts') {
      // Remove interface declarations - need to match balanced braces
      // First, remove interfaces with nested braces by counting braces
      let interfaceRegex = /\/\/\s*Email\s+configuration\s*\n\s*interface\s+\w+\s*\{/g;
      let match;
      while ((match = interfaceRegex.exec(content)) !== null) {
        let start = match.index;
        let braceCount = 0;
        let i = match.index + match[0].length;
        let foundEnd = false;
        while (i < content.length && !foundEnd) {
          if (content[i] === '{') braceCount++;
          if (content[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              content = content.slice(0, start) + content.slice(i + 1);
              interfaceRegex.lastIndex = start;
              foundEnd = true;
            }
          }
          i++;
        }
      }
      
      // Remove EmailContent interface similarly
      interfaceRegex = /\/\/\s*Email\s+content\s*\n\s*interface\s+\w+\s*\{/g;
      while ((match = interfaceRegex.exec(content)) !== null) {
        let start = match.index;
        let braceCount = 0;
        let i = match.index + match[0].length;
        let foundEnd = false;
        while (i < content.length && !foundEnd) {
          if (content[i] === '{') braceCount++;
          if (content[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              content = content.slice(0, start) + content.slice(i + 1);
              interfaceRegex.lastIndex = start;
              foundEnd = true;
            }
          }
          i++;
        }
      }
      
      // Remove any remaining simple interfaces (no nested braces)
      content = content.replace(/export\s+interface\s+\w+\s*\{[^}]*\}/gs, '');
      content = content.replace(/interface\s+\w+\s*\{[^}]*\}/gs, '');
      // Clean up orphaned braces and fragments
      content = content.replace(/\n\s*\}\s*\n\s*\/\/\s*Email\s+content/g, '');
      content = content.replace(/\n\s*\}\s*\n/g, '\n');
      content = content.replace(/\n\s*>\s*;\s*\n/g, '\n');
      content = content.replace(/^>\s*;\s*\n/m, '');
      // Remove type annotations from function parameters and variables
      content = content.replace(/:\s*EmailConfig\s*/g, ' ');
      content = content.replace(/:\s*EmailContent\s*/g, ' ');
      content = content.replace(/:\s*string\s*(?=[,;=\)\n])/g, '');
      content = content.replace(/:\s*number\s*(?=[,;=\)\n])/g, '');
      content = content.replace(/:\s*boolean\s*(?=[,;=\)\n])/g, '');
      content = content.replace(/:\s*Date\s*(?=[,;=\)\n])/g, '');
      content = content.replace(/:\s*Record<[^>]+>\s*(?=[,;=\)\n])/g, '');
      content = content.replace(/:\s*Array<[^>]+>\s*(?=[,;=\)\n])/g, '');
      content = content.replace(/:\s*Buffer\s*(?=[,;=\)\n])/g, '');
      // Remove optional markers
      content = content.replace(/\?\s*:/g, '');
      // Remove return type annotations
      content = content.replace(/\):\s*\w+\s*\{/g, ') {');
      content = content.replace(/\):\s*Promise<\w+>\s*\{/g, ') {');
      // Remove Map type annotations
      content = content.replace(/Map<string,\s*number>/g, 'Map');
    }
    
    // Write the modified content to the destination
    fs.writeFileSync(destPath, content);
  } else {
    console.warn(`Warning: ${srcPath} not found, skipping...`);
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

// Process timezone-utils file
const timezoneUtilsFile = path.join('shared', 'timezone-utils.ts');
const timezoneUtilsDestPath = path.join(tempSharedDir, 'timezone-utils.js');

if (fs.existsSync(timezoneUtilsFile)) {
  console.log(`Processing ${timezoneUtilsFile}...`);
  
  // Read the TypeScript file
  let content = fs.readFileSync(timezoneUtilsFile, 'utf8');
  
  // Convert TypeScript imports to JavaScript
  // IMPORTANT: Keep package imports as-is (they're npm packages)
  // Only convert relative .ts imports to .js
  // Don't touch imports that start with @ or don't have .ts extension
  content = content.replace(/from\s+["']([^"']+)\.ts["']/g, 'from "$1.js"');
  
  // Remove TypeScript type annotations (be careful not to break function signatures)
  // Only remove type annotations from function parameters and return types
  // Use lookahead to avoid removing colons in other contexts
  content = content.replace(/:\s*string\s*(?=[,=\)])/g, '');
  content = content.replace(/:\s*number\s*(?=[,=\)])/g, '');
  content = content.replace(/:\s*Date\s*(?=[,=\)\s*\{])/g, '');
  content = content.replace(/:\s*boolean\s*(?=[,=\)])/g, '');
  content = content.replace(/:\s*TZDate\s*(?=[,=\)])/g, '');
  // Remove return type annotations from function declarations
  content = content.replace(/\)\s*:\s*Date\s*\{/g, ') {');
  content = content.replace(/\)\s*:\s*boolean\s*\{/g, ') {');
  content = content.replace(/\)\s*:\s*number\s*\{/g, ') {');
  content = content.replace(/\)\s*:\s*string\s*\{/g, ') {');
  content = content.replace(/\)\s*:\s*TZDate\s*\{/g, ') {');
  // Remove standalone type/interface exports
  content = content.replace(/export\s+type\s+\w+[^;]+;/g, '');
  content = content.replace(/export\s+interface\s+\w+[^}]+}/g, '');
  
  // Write the modified content to the destination
  fs.writeFileSync(timezoneUtilsDestPath, content);
  console.log(`✅ Created ${timezoneUtilsDestPath}`);
} else {
  console.error(`❌ Error: ${timezoneUtilsFile} not found!`);
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