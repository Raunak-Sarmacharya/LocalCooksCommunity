#!/usr/bin/env node

/**
 * OAuth Test Script for Local Cooks
 * Tests OAuth endpoints and configuration
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const BASE_URL = 'http://localhost:5000';

async function testOAuthEndpoints() {
  console.log('🔍 Testing OAuth Configuration for Local Cooks\n');

  // Test environment variables
  console.log('📋 Environment Variables:');
  console.log(`✅ Google Client ID: ${process.env.GOOGLE_CLIENT_ID ? 'Configured' : '❌ Missing'}`);
  console.log(`✅ Google Client Secret: ${process.env.GOOGLE_CLIENT_SECRET ? 'Configured' : '❌ Missing'}`);
  console.log(`✅ Facebook Client ID: ${process.env.FACEBOOK_CLIENT_ID ? 'Configured' : '❌ Missing'}`);
  console.log(`✅ Facebook Client Secret: ${process.env.FACEBOOK_CLIENT_SECRET ? 'Configured' : '❌ Missing'}`);
  console.log('');

  // Test OAuth endpoints
  console.log('🔗 Testing OAuth Endpoints:');

  try {
    // Test Google OAuth endpoint
    console.log('Testing Google OAuth endpoint...');
    const googleResponse = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'HEAD',
      redirect: 'manual'
    });
    console.log(`✅ Google OAuth: ${googleResponse.status} ${googleResponse.statusText}`);

    // Test Facebook OAuth endpoint
    console.log('Testing Facebook OAuth endpoint...');
    const facebookResponse = await fetch(`${BASE_URL}/api/auth/facebook`, {
      method: 'HEAD',
      redirect: 'manual'
    });
    console.log(`✅ Facebook OAuth: ${facebookResponse.status} ${facebookResponse.statusText}`);

    console.log('\n🎉 OAuth Configuration Test Complete!');
    console.log('\n📝 Next Steps:');
    console.log('1. Visit http://localhost:5000/auth to test OAuth login');
    console.log('2. Click "Continue with Google" or "Continue with Facebook"');
    console.log('3. Complete the OAuth flow');
    console.log('4. Check server logs for authentication success');

  } catch (error) {
    console.error('❌ Error testing OAuth endpoints:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure the development server is running: npm run dev');
    console.log('2. Check environment variables are loaded');
    console.log('3. Verify OAuth credentials are correct');
  }
}

// Run the test
testOAuthEndpoints(); 