#!/usr/bin/env node

/**
 * Production Deployment Script with Firebase Support
 * This script validates Firebase configuration before deploying to production
 */

import { exec } from 'child_process';
import 'dotenv/config';
import { promisify } from 'util';

const execAsync = promisify(exec);

console.log('🚀 Production Deployment with Firebase Auth\n');

// Required environment variables for production
const requiredVars = {
  'Database': ['DATABASE_URL'],
  'Firebase Frontend': [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID'
  ],
  'Firebase Backend': [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY'
  ],
  'Vercel': ['BLOB_READ_WRITE_TOKEN']
};

// Check environment variables
function checkEnvironmentVariables() {
  console.log('🔍 Checking Environment Variables...\n');
  
  let allValid = true;
  
  Object.entries(requiredVars).forEach(([category, vars]) => {
    console.log(`📂 ${category}:`);
    
    vars.forEach(varName => {
      const value = process.env[varName];
      if (value) {
        console.log(`  ✅ ${varName}`);
      } else {
        console.log(`  ❌ ${varName} - MISSING`);
        allValid = false;
      }
    });
    console.log();
  });
  
  return allValid;
}

// Test Firebase configuration
async function testFirebaseConfig() {
  console.log('🔥 Testing Firebase Configuration...\n');
  
  try {
    const { stdout, stderr } = await execAsync('npm run test:firebase');
    console.log(stdout);
    if (stderr) console.error(stderr);
    return true;
  } catch (error) {
    console.error('❌ Firebase configuration test failed:', error.message);
    return false;
  }
}

// Build project
async function buildProject() {
  console.log('🔨 Building Project...\n');
  
  try {
    const { stdout, stderr } = await execAsync('npm run build');
    console.log(stdout);
    if (stderr) console.error(stderr);
    return true;
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    return false;
  }
}

// Deploy to Vercel
async function deployToVercel(isPreview = false) {
  const deployCommand = isPreview ? 'vercel' : 'vercel --prod';
  console.log(`🚀 Deploying to Vercel ${isPreview ? '(Preview)' : '(Production)'}...\n`);
  
  try {
    const { stdout, stderr } = await execAsync(deployCommand);
    console.log(stdout);
    if (stderr) console.error(stderr);
    return true;
  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    return false;
  }
}

// Main deployment function
async function deploy() {
  try {
    // Step 1: Check environment variables
    if (!checkEnvironmentVariables()) {
      console.log('❌ Environment validation failed. Please set all required variables.\n');
      console.log('📋 Required variables:');
      Object.entries(requiredVars).forEach(([category, vars]) => {
        console.log(`\n${category}:`);
        vars.forEach(varName => console.log(`  - ${varName}`));
      });
      process.exit(1);
    }
    
    // Step 2: Test Firebase configuration
    if (!await testFirebaseConfig()) {
      console.log('❌ Firebase configuration test failed. Please check your Firebase setup.');
      process.exit(1);
    }
    
    // Step 3: Build project
    if (!await buildProject()) {
      console.log('❌ Build failed. Please fix build errors before deploying.');
      process.exit(1);
    }
    
    // Step 4: Deploy
    const isPreview = process.argv.includes('--preview');
    if (!await deployToVercel(isPreview)) {
      console.log('❌ Deployment failed.');
      process.exit(1);
    }
    
    console.log('\n🎉 Deployment successful!\n');
    
    if (!isPreview) {
      console.log('📋 Post-deployment checklist:');
      console.log('1. Test authentication: https://your-app.vercel.app/auth');
      console.log('2. Check Firebase health: https://your-app.vercel.app/api/firebase-health');
      console.log('3. Test user registration flow');
      console.log('4. Test application submission');
      console.log('5. Monitor logs for any errors');
    }
    
  } catch (error) {
    console.error('❌ Deployment process failed:', error.message);
    process.exit(1);
  }
}

// Run deployment
deploy(); 