// Production Email Test Script
// Tests email delivery and authentication for Vercel deployment

const nodemailer = require('nodemailer');
const dns = require('dns').promises;

// Configuration
const config = {
  host: process.env.EMAIL_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  user: process.env.EMAIL_USER || '',
  pass: process.env.EMAIL_PASS || '',
  from: process.env.EMAIL_FROM || 'Local Cooks Community <noreply@localcook.shop>',
  domain: 'localcook.shop'
};

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

// Test DNS Records
async function testDNSRecords() {
  log(colors.blue + colors.bold, '\n🔍 TESTING DNS RECORDS');
  
  const tests = [
    {
      name: 'SPF Record',
      query: config.domain,
      type: 'TXT',
      expected: ['hostinger.com', 'mailchannels.net'],
      critical: true
    },
    {
      name: 'DMARC Record', 
      query: `_dmarc.${config.domain}`,
      type: 'TXT',
      expected: ['DMARC1'],
      critical: true
    },
    {
      name: 'MailChannels DKIM',
      query: `mailchannels._domainkey.${config.domain}`,
      type: 'TXT', 
      expected: ['DKIM1'],
      critical: true
    },
    {
      name: 'Hostinger DKIM',
      query: `hostingermail1._domainkey.${config.domain}`,
      type: 'TXT',
      expected: ['DKIM1'],
      critical: false
    }
  ];

  const results = [];
  
  for (const test of tests) {
    try {
      const records = await dns.resolveTxt(test.query);
      const recordText = records.flat().join(' ');
      
      const hasExpected = test.expected.some(exp => recordText.includes(exp));
      
      if (hasExpected) {
        log(colors.green, `✅ ${test.name}: FOUND`);
        results.push({ ...test, status: 'PASS', record: recordText });
      } else {
        log(colors.red, `❌ ${test.name}: MISSING or INCORRECT`);
        log(colors.yellow, `   Found: ${recordText}`);
        results.push({ ...test, status: 'FAIL', record: recordText });
      }
    } catch (error) {
      log(colors.red, `❌ ${test.name}: NOT FOUND`);
      log(colors.yellow, `   Error: ${error.message}`);
      results.push({ ...test, status: 'NOT_FOUND', error: error.message });
    }
  }
  
  return results;
}

// Test SMTP Connection
async function testSMTPConnection() {
  log(colors.blue + colors.bold, '\n📧 TESTING SMTP CONNECTION');
  
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });

  try {
    await transporter.verify();
    log(colors.green, '✅ SMTP Connection: SUCCESS');
    return { status: 'SUCCESS' };
  } catch (error) {
    log(colors.red, '❌ SMTP Connection: FAILED');
    log(colors.yellow, `   Error: ${error.message}`);
    return { status: 'FAILED', error: error.message };
  } finally {
    transporter.close();
  }
}

// Send Test Email
async function sendTestEmail(testEmail) {
  log(colors.blue + colors.bold, '\n✉️ SENDING TEST EMAIL');
  
  if (!testEmail) {
    log(colors.yellow, '⚠️ No test email provided, skipping email send test');
    return { status: 'SKIPPED' };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    pool: true,
    maxConnections: 1,
    maxMessages: 1
  });

  const mailOptions = {
    from: config.from,
    to: testEmail,
    subject: 'Local Cooks Email Test - Production',
    html: `
      <h2>Email Authentication Test</h2>
      <p>This is a test email to verify email delivery and authentication.</p>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      <p><strong>Environment:</strong> ${process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown'}</p>
      <p><strong>Domain:</strong> ${config.domain}</p>
      <hr>
      <p>If you received this email in your inbox (not spam), authentication is working correctly!</p>
      <p><em>Test completed by Local Cooks production email system.</em></p>
    `,
    text: `
Email Authentication Test

This is a test email to verify email delivery and authentication.

Timestamp: ${new Date().toISOString()}
Environment: ${process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown'}
Domain: ${config.domain}

If you received this email in your inbox (not spam), authentication is working correctly!

Test completed by Local Cooks production email system.
    `,
    headers: {
      'X-Test-Type': 'Production Email Authentication',
      'X-Vercel-Deployment': process.env.VERCEL_DEPLOYMENT_ID || 'local',
      'X-Vercel-URL': process.env.VERCEL_URL || 'localhost'
    }
  };

  try {
    const startTime = Date.now();
    const info = await transporter.sendMail(mailOptions);
    const executionTime = Date.now() - startTime;
    
    log(colors.green, '✅ Test Email: SENT SUCCESSFULLY');
    log(colors.blue, `   Message ID: ${info.messageId}`);
    log(colors.blue, `   Execution Time: ${executionTime}ms`);
    log(colors.blue, `   Accepted: ${info.accepted.join(', ')}`);
    
    if (info.rejected.length > 0) {
      log(colors.yellow, `   Rejected: ${info.rejected.join(', ')}`);
    }
    
    return { 
      status: 'SUCCESS', 
      messageId: info.messageId,
      executionTime,
      accepted: info.accepted,
      rejected: info.rejected
    };
  } catch (error) {
    log(colors.red, '❌ Test Email: FAILED');
    log(colors.yellow, `   Error: ${error.message}`);
    return { status: 'FAILED', error: error.message };
  } finally {
    transporter.close();
  }
}

// Generate Report
function generateReport(dnsResults, smtpResult, emailResult) {
  log(colors.blue + colors.bold, '\n📊 TEST REPORT SUMMARY');
  
  const criticalDNSFailed = dnsResults.filter(r => r.critical && r.status !== 'PASS');
  const allDNSPassed = dnsResults.filter(r => r.status === 'PASS').length === dnsResults.length;
  
  // DNS Status
  if (criticalDNSFailed.length === 0) {
    log(colors.green, '✅ DNS Configuration: READY');
  } else {
    log(colors.red, '❌ DNS Configuration: CRITICAL ISSUES');
    criticalDNSFailed.forEach(dns => {
      log(colors.red, `   Missing: ${dns.name}`);
    });
  }
  
  // SMTP Status
  if (smtpResult.status === 'SUCCESS') {
    log(colors.green, '✅ SMTP Connection: WORKING');
  } else {
    log(colors.red, '❌ SMTP Connection: FAILED');
  }
  
  // Email Status
  if (emailResult.status === 'SUCCESS') {
    log(colors.green, '✅ Email Delivery: WORKING');
  } else if (emailResult.status === 'SKIPPED') {
    log(colors.yellow, '⚠️ Email Delivery: NOT TESTED');
  } else {
    log(colors.red, '❌ Email Delivery: FAILED');
  }
  
  // Overall Status
  const overallSuccess = criticalDNSFailed.length === 0 && 
                        smtpResult.status === 'SUCCESS' && 
                        (emailResult.status === 'SUCCESS' || emailResult.status === 'SKIPPED');
  
  log(colors.blue + colors.bold, '\n🎯 OVERALL STATUS');
  if (overallSuccess) {
    log(colors.green + colors.bold, '✅ EMAIL SYSTEM: READY FOR PRODUCTION');
    log(colors.green, 'All critical components are working correctly.');
  } else {
    log(colors.red + colors.bold, '❌ EMAIL SYSTEM: NEEDS ATTENTION');
    log(colors.red, 'Critical issues found that need to be resolved.');
  }
  
  // Recommendations
  log(colors.blue + colors.bold, '\n💡 RECOMMENDATIONS');
  
  if (criticalDNSFailed.length > 0) {
    log(colors.yellow, '1. Update DNS records immediately (see VERCEL_EMAIL_FIX.md)');
    log(colors.yellow, '2. Wait 24-48 hours for DNS propagation');
  }
  
  if (smtpResult.status !== 'SUCCESS') {
    log(colors.yellow, '3. Check Vercel environment variables');
    log(colors.yellow, '4. Verify Hostinger credentials');
  }
  
  if (emailResult.status === 'FAILED') {
    log(colors.yellow, '5. Check email content and headers');
    log(colors.yellow, '6. Monitor Vercel function logs');
  }
  
  log(colors.blue, '\n📚 For detailed troubleshooting, see VERCEL_EMAIL_FIX.md');
  log(colors.blue, '🔗 Test email authentication: https://www.mail-tester.com');
}

// Main function
async function main() {
  const testEmail = process.argv[2];
  
  log(colors.blue + colors.bold, '🚀 LOCAL COOKS EMAIL PRODUCTION TEST');
  log(colors.blue, `Domain: ${config.domain}`);
  log(colors.blue, `SMTP Host: ${config.host}:${config.port}`);
  log(colors.blue, `Test Email: ${testEmail || 'Not provided'}`);
  
  if (!config.user || !config.pass) {
    log(colors.red + colors.bold, '❌ CRITICAL: EMAIL_USER and EMAIL_PASS must be set');
    process.exit(1);
  }
  
  try {
    // Run all tests
    const dnsResults = await testDNSRecords();
    const smtpResult = await testSMTPConnection();
    const emailResult = await sendTestEmail(testEmail);
    
    // Generate report
    generateReport(dnsResults, smtpResult, emailResult);
    
  } catch (error) {
    log(colors.red + colors.bold, `❌ TEST FAILED: ${error.message}`);
    process.exit(1);
  }
}

// Usage
if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
Usage: node scripts/test-email-production.js [test-email]

Options:
  test-email    Email address to send test email to (optional)
  --help, -h    Show this help message

Environment Variables Required:
  EMAIL_HOST    SMTP host (default: smtp.hostinger.com)
  EMAIL_PORT    SMTP port (default: 587)
  EMAIL_USER    SMTP username
  EMAIL_PASS    SMTP password
  EMAIL_FROM    From address

Example:
  node scripts/test-email-production.js user@gmail.com
  
This script will:
1. Check DNS records (SPF, DMARC, DKIM)
2. Test SMTP connection
3. Send test email (if email provided)
4. Generate comprehensive report
    `);
    process.exit(0);
  }
  
  main();
} 