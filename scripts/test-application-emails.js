#!/usr/bin/env node

// Comprehensive Application Email Test Script
// Tests all application-related email functions to identify delivery issues

const path = require('path');

// Test configuration
const testConfig = {
  testEmail: process.env.TEST_EMAIL || 'your-test-email@gmail.com',
  testName: 'Test User',
  domain: 'localcook.shop'
};

console.log('🎯 LOCAL COOKS APPLICATION EMAIL COMPREHENSIVE TEST\n');
console.log('📧 Testing all application email types for delivery issues\n');

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function section(title) {
  console.log(`\n${colors.bold}${colors.cyan}=== ${title} ===${colors.reset}\n`);
}

async function testApplicationEmails() {
  try {
    // Import email functions
    section('IMPORTING EMAIL FUNCTIONS');
    const { 
      sendEmail, 
      generateApplicationWithDocumentsEmail,
      generateApplicationWithoutDocumentsEmail,
      generateStatusChangeEmail,
      generateDocumentStatusChangeEmail 
    } = await import('../server/email.js');
    
    log(colors.green, '✅ Email functions imported successfully');

    // Test 1: Application WITH Documents Email
    section('TEST 1: APPLICATION WITH DOCUMENTS EMAIL');
    try {
      const withDocsEmail = generateApplicationWithDocumentsEmail({
        fullName: testConfig.testName,
        email: testConfig.testEmail
      });
      
      log(colors.blue, `📧 Generated email content:`);
      console.log(`   To: ${withDocsEmail.to}`);
      console.log(`   Subject: ${withDocsEmail.subject}`);
      console.log(`   Has HTML: ${!!withDocsEmail.html}`);
      
      const result1 = await sendEmail(withDocsEmail, {
        trackingId: `test_with_docs_${Date.now()}`
      });
      
      if (result1) {
        log(colors.green, '✅ Application WITH documents email sent successfully');
      } else {
        log(colors.red, '❌ Application WITH documents email failed');
      }
    } catch (error) {
      log(colors.red, `❌ Application WITH documents email error: ${error.message}`);
    }

    // Test 2: Application WITHOUT Documents Email
    section('TEST 2: APPLICATION WITHOUT DOCUMENTS EMAIL');
    try {
      const withoutDocsEmail = generateApplicationWithoutDocumentsEmail({
        fullName: testConfig.testName,
        email: testConfig.testEmail
      });
      
      log(colors.blue, `📧 Generated email content:`);
      console.log(`   To: ${withoutDocsEmail.to}`);
      console.log(`   Subject: ${withoutDocsEmail.subject}`);
      console.log(`   Has HTML: ${!!withoutDocsEmail.html}`);
      
      const result2 = await sendEmail(withoutDocsEmail, {
        trackingId: `test_without_docs_${Date.now()}`
      });
      
      if (result2) {
        log(colors.green, '✅ Application WITHOUT documents email sent successfully');
      } else {
        log(colors.red, '❌ Application WITHOUT documents email failed');
      }
    } catch (error) {
      log(colors.red, `❌ Application WITHOUT documents email error: ${error.message}`);
    }

    // Test 3: Application Status Change Emails
    section('TEST 3: APPLICATION STATUS CHANGE EMAILS');
    const statuses = ['approved', 'rejected', 'under_review', 'cancelled'];
    
    for (const status of statuses) {
      try {
        const statusEmail = generateStatusChangeEmail({
          fullName: testConfig.testName,
          email: testConfig.testEmail,
          status: status
        });
        
        log(colors.blue, `📧 Testing status: ${status}`);
        console.log(`   Subject: ${statusEmail.subject}`);
        
        const result = await sendEmail(statusEmail, {
          trackingId: `test_status_${status}_${Date.now()}`
        });
        
        if (result) {
          log(colors.green, `✅ Status change email (${status}) sent successfully`);
        } else {
          log(colors.red, `❌ Status change email (${status}) failed`);
        }
        
        // Wait between emails to avoid spam detection
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        log(colors.red, `❌ Status change email (${status}) error: ${error.message}`);
      }
    }

    // Test 4: Document Status Change Emails
    section('TEST 4: DOCUMENT STATUS CHANGE EMAILS');
    const documentTypes = ['foodSafetyLicenseStatus', 'foodEstablishmentCertStatus'];
    const docStatuses = ['approved', 'rejected', 'pending'];
    
    for (const docType of documentTypes) {
      for (const status of docStatuses) {
        try {
          const docEmail = generateDocumentStatusChangeEmail({
            fullName: testConfig.testName,
            email: testConfig.testEmail,
            documentType: docType,
            status: status,
            adminFeedback: 'Test feedback message'
          });
          
          log(colors.blue, `📧 Testing document: ${docType} - ${status}`);
          console.log(`   Subject: ${docEmail.subject}`);
          
          const result = await sendEmail(docEmail, {
            trackingId: `test_doc_${docType}_${status}_${Date.now()}`
          });
          
          if (result) {
            log(colors.green, `✅ Document status email (${docType}/${status}) sent successfully`);
          } else {
            log(colors.red, `❌ Document status email (${docType}/${status}) failed`);
          }
          
          // Wait between emails
          await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (error) {
          log(colors.red, `❌ Document status email error: ${error.message}`);
        }
      }
    }

    // Summary
    section('TEST COMPLETE');
    log(colors.bold, '📊 Email Test Summary:');
    log(colors.yellow, '   Check your inbox for all test emails');
    log(colors.yellow, '   If any emails are missing, check the logs above for errors');
    log(colors.yellow, '   Application emails should arrive within 1-2 minutes');
    
    log(colors.cyan, '\n🔍 Next Steps:');
    log(colors.cyan, '1. Check your email inbox for all test messages');
    log(colors.cyan, '2. If missing, check Vercel function logs for errors');
    log(colors.cyan, '3. Verify DNS records are properly configured');
    log(colors.cyan, '4. Submit a real application to test production flow');

  } catch (error) {
    log(colors.red, `❌ CRITICAL ERROR: ${error.message}`);
    console.error('Full error:', error);
    process.exit(1);
  }
}

// Validate environment
function validateEnvironment() {
  section('ENVIRONMENT VALIDATION');
  
  const requiredVars = ['EMAIL_USER', 'EMAIL_PASS', 'EMAIL_HOST'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    log(colors.red, `❌ Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  log(colors.green, '✅ All required environment variables present');
  
  log(colors.blue, 'Email Configuration:');
  console.log(`   Host: ${process.env.EMAIL_HOST}`);
  console.log(`   Port: ${process.env.EMAIL_PORT || '587'}`);
  console.log(`   User: ${process.env.EMAIL_USER?.replace(/(.{3}).*@/, '$1***@')}`);
  console.log(`   Secure: ${process.env.EMAIL_SECURE || 'false'}`);
  console.log(`   Test Email: ${testConfig.testEmail}`);
}

// Main execution
async function main() {
  console.log(`${colors.bold}🎯 LOCAL COOKS APPLICATION EMAIL TEST${colors.reset}`);
  console.log(`${colors.cyan}Testing all application email types for: ${testConfig.testEmail}${colors.reset}\n`);
  
  validateEnvironment();
  await testApplicationEmails();
  
  log(colors.green, '\n✅ Test script completed successfully!');
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
🎯 Local Cooks Application Email Test Script

Usage: node scripts/test-application-emails.js [options]

Options:
  --help, -h          Show this help message

Environment Variables Required:
  EMAIL_USER          SMTP username
  EMAIL_PASS          SMTP password  
  EMAIL_HOST          SMTP host (default: smtp.hostinger.com)
  EMAIL_PORT          SMTP port (default: 587)
  TEST_EMAIL          Test email address (default: your-test-email@gmail.com)

Examples:
  # Basic test
  node scripts/test-application-emails.js
  
  # With custom test email
  TEST_EMAIL=admin@example.com node scripts/test-application-emails.js
  
This script will test all application email types:
- Application with documents
- Application without documents  
- Status change emails (approved, rejected, etc.)
- Document verification emails

Check your inbox after running for all test emails.
`);
  process.exit(0);
}

// Run the test
if (require.main === module) {
  main().catch(error => {
    log(colors.red, `❌ Unhandled error: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
}

module.exports = { testApplicationEmails, validateEnvironment }; 