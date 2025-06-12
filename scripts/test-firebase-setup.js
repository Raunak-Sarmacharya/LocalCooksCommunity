#!/usr/bin/env node

/**
 * Test script to verify Firebase configuration
 * Run with: node scripts/test-firebase-setup.js
 */

import 'dotenv/config';

console.log('🔥 Testing Firebase Configuration...\n');

// Test Frontend Config
console.log('📱 Frontend Configuration:');
const frontendVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN', 
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID'
];

frontendVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    console.log(`✅ ${varName}: ${value.substring(0, 20)}...`);
  } else {
    console.log(`❌ ${varName}: Missing`);
  }
});

console.log('\n🔧 Backend Configuration:');
const backendVars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY'
];

backendVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    if (varName === 'FIREBASE_PRIVATE_KEY') {
      console.log(`✅ ${varName}: ${value.length} characters`);
    } else {
      console.log(`✅ ${varName}: ${value}`);
    }
  } else {
    console.log(`❌ ${varName}: Missing`);
  }
});

// Test Firebase Admin SDK initialization
console.log('\n🚀 Testing Firebase Admin SDK...');
try {
  const { initializeFirebaseAdmin } = await import('../server/firebase-admin.js');
  const app = initializeFirebaseAdmin();
  
  if (app) {
    console.log('✅ Firebase Admin SDK initialized successfully');
  } else {
    console.log('❌ Firebase Admin SDK failed to initialize');
  }
} catch (error) {
  console.log('❌ Error testing Firebase Admin SDK:', error.message);
}

console.log('\n📋 Next Steps:');
console.log('1. Start your development server: npm run dev');
console.log('2. Test authentication: http://localhost:5000/auth');
console.log('3. Check health endpoint: http://localhost:5000/api/firebase-health');
console.log('4. Monitor logs for Firebase authentication');

console.log('\n🎉 Firebase setup test complete!'); 