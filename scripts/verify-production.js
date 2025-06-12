#!/usr/bin/env node

/**
 * Production Verification Script for Firebase Auth
 * Tests Firebase endpoints on deployed production server
 */

import https from 'https';
import { URL } from 'url';

const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://your-app.vercel.app';

console.log('🔍 Verifying Production Firebase Setup\n');
console.log(`🌐 Testing URL: ${PRODUCTION_URL}\n`);

// Test endpoint function
function testEndpoint(url, expectedStatus = 200) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'GET',
      headers: {
        'User-Agent': 'Production-Verification-Script'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            status: res.statusCode,
            data: jsonData,
            success: res.statusCode === expectedStatus
          });
        } catch (error) {
          resolve({
            status: res.statusCode,
            data: data,
            success: res.statusCode === expectedStatus,
            parseError: true
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

// Test endpoints
async function runTests() {
  const tests = [
    {
      name: 'Firebase Health Check',
      url: `${PRODUCTION_URL}/api/firebase-health`,
      expectedStatus: 200
    },
    {
      name: 'General API Health',
      url: `${PRODUCTION_URL}/api/health`,
      expectedStatus: 200
    },
    {
      name: 'Frontend Index',
      url: `${PRODUCTION_URL}/`,
      expectedStatus: 200
    }
  ];

  console.log('🧪 Running Production Tests...\n');

  for (const test of tests) {
    try {
      console.log(`🔍 Testing: ${test.name}`);
      console.log(`   URL: ${test.url}`);
      
      const result = await testEndpoint(test.url, test.expectedStatus);
      
      if (result.success) {
        console.log(`   ✅ PASS (${result.status})`);
        
        // Show Firebase health details
        if (test.name === 'Firebase Health Check' && result.data) {
          console.log(`   📊 Firebase Status: ${result.data.status}`);
          console.log(`   🔥 Firebase Configured: ${result.data.auth?.firebaseConfigured}`);
          console.log(`   🗄️  Neon Configured: ${result.data.auth?.neonConfigured}`);
          console.log(`   🔒 Session Free: ${result.data.auth?.sessionFree}`);
          console.log(`   🏗️  Architecture: ${result.data.architecture}`);
        }
      } else {
        console.log(`   ❌ FAIL (${result.status})`);
        if (result.data) {
          console.log(`   📄 Response: ${JSON.stringify(result.data, null, 2)}`);
        }
      }
      
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
    }
    
    console.log();
  }
}

// Test Firebase Auth endpoints (these should return 401 without auth)
async function testAuthEndpoints() {
  console.log('🔐 Testing Firebase Auth Endpoints (should return 401)...\n');
  
  const authTests = [
    {
      name: 'User Profile (requires auth)',
      url: `${PRODUCTION_URL}/api/user/profile`,
      expectedStatus: 401
    },
    {
      name: 'Firebase Dashboard (requires auth)',
      url: `${PRODUCTION_URL}/api/firebase/dashboard`,
      expectedStatus: 401
    },
    {
      name: 'Firebase Applications (requires auth)',
      url: `${PRODUCTION_URL}/api/firebase/applications/my`,
      expectedStatus: 401
    }
  ];

  for (const test of authTests) {
    try {
      console.log(`🔍 Testing: ${test.name}`);
      console.log(`   URL: ${test.url}`);
      
      const result = await testEndpoint(test.url, test.expectedStatus);
      
      if (result.success) {
        console.log(`   ✅ PASS (${result.status}) - Correctly requires authentication`);
      } else {
        console.log(`   ❌ FAIL (${result.status}) - Should return 401`);
        if (result.data) {
          console.log(`   📄 Response: ${JSON.stringify(result.data, null, 2)}`);
        }
      }
      
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
    }
    
    console.log();
  }
}

// Main verification function
async function verify() {
  try {
    await runTests();
    await testAuthEndpoints();
    
    console.log('🎉 Production verification complete!\n');
    
    console.log('📋 Manual Testing Checklist:');
    console.log('1. Visit your site in a browser');
    console.log('2. Try to register a new account');
    console.log('3. Try to log in with existing account');
    console.log('4. Test Firebase auth token persistence');
    console.log('5. Test API calls with Firebase auth');
    console.log('6. Check browser console for errors');
    console.log('7. Monitor Vercel function logs');
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  }
}

// Usage
if (process.argv.length > 2) {
  const customUrl = process.argv[2];
  if (customUrl.startsWith('http')) {
    console.log(`🔧 Using custom URL: ${customUrl}`);
    process.env.PRODUCTION_URL = customUrl;
  } else {
    console.log('❌ Please provide a valid URL starting with http or https');
    process.exit(1);
  }
}

verify(); 