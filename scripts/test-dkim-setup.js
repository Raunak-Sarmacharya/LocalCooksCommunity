#!/usr/bin/env node

/**
 * DKIM Setup Test Script
 * Tests DKIM DNS record and email authentication
 */

import dns from 'dns';
import { promisify } from 'util';

const resolve = promisify(dns.resolve);

// Configuration
const DOMAIN = process.env.EMAIL_DOMAIN || 'yourdomain.com';
const DKIM_SELECTOR = 'hostingermail1';
const EXPECTED_DKIM_VALUE = 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzksTUDJ5tnkVYzHujmQ4pUZ9lHlJxh0UnmTJXH8rcn1j74lZClgxgAIn+aNxULISVLYLwsXDXxJxP3mYn1OOJAMXaOYEle0+liMxIShHw3u5IyxDh0IqcvQ5tGEUIVbTU84naUsadWlLUrwHNRvm3tLuxWrBzP+1AKOzX21+XykAn1y0bAX8/5eWu865CTjFI8mFKq7H06rPbUiPJP1jwSp+tsW3/UvK99ZuVspDEnKPA8ZswqUbeO23ZCX2LMI0QLvWoUc57DSLDaSSJ/+kCuQM2Xr5H2OnBdJf5goo3EuAP/uWmTGc+EUa7/vo5WoolWE6tG+vB5OSXnPSP3lnuQIDAQAB';

console.log('🔐 DKIM Setup Verification Script');
console.log('===================================\n');

async function testDKIMRecord() {
  const dkimHost = `${DKIM_SELECTOR}._domainkey.${DOMAIN}`;
  
  console.log(`📋 Testing DKIM record for: ${dkimHost}`);
  
  try {
    const records = await resolve(dkimHost, 'TXT');
    
    if (records && records.length > 0) {
      console.log('✅ DKIM record found!');
      
      // Join all parts of the TXT record (some DNS providers split long records)
      const fullRecord = records.map(record => record.join('')).join('');
      
      console.log(`📄 Record: ${fullRecord.substring(0, 100)}...`);
      
      // Check if it contains the expected DKIM value
      if (fullRecord.includes('v=DKIM1') && fullRecord.includes('p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzksTUDJ5tnkVYzHujmQ4pUZ9lHlJxh0UnmTJXH8rcn1j74lZClgxgAIn+aNxULISVLYLwsXDXxJxP3mYn1OOJAMXaOYEle0+liMxIShHw3u5IyxDh0IqcvQ5tGEUIVbTU84naUsadWlLUrwHNRvm3tLuxWrBzP+1AKOzX21+XykAn1y0bAX8/5eWu865CTjFI8mFKq7H06rPbUiPJP1jwSp+tsW3/UvK99ZuVspDEnKPA8ZswqUbeO23ZCX2LMI0QLvWoUc57DSLDaSSJ/+kCuQM2Xr5H2OnBdJf5goo3EuAP/uWmTGc+EUa7/vo5WoolWE6tG+vB5OSXnPSP3lnuQIDAQAB')) {
        console.log('✅ DKIM record matches expected Hostinger configuration!');
        return true;
      } else {
        console.log('⚠️  DKIM record found but doesn\'t match expected Hostinger configuration');
        console.log('Expected to contain: v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzksTUDJ5tnkVYzHujmQ4pUZ9lHlJxh0UnmTJXH8rcn1j74lZClgxgAIn+aNxULISVLYLwsXDXxJxP3mYn1OOJAMXaOYEle0+liMxIShHw3u5IyxDh0IqcvQ5tGEUIVbTU84naUsadWlLUrwHNRvm3tLuxWrBzP+1AKOzX21+XykAn1y0bAX8/5eWu865CTjFI8mFKq7H06rPbUiPJP1jwSp+tsW3/UvK99ZuVspDEnKPA8ZswqUbeO23ZCX2LMI0QLvWoUc57DSLDaSSJ/+kCuQM2Xr5H2OnBdJf5goo3EuAP/uWmTGc+EUa7/vo5WoolWE6tG+vB5OSXnPSP3lnuQIDAQAB...');
        return false;
      }
    } else {
      console.log('❌ No DKIM record found');
      return false;
    }
  } catch (error) {
    console.log(`❌ Error checking DKIM record: ${error.message}`);
    if (error.code === 'ENOTFOUND') {
      console.log('💡 This usually means:');
      console.log('   1. The DKIM record hasn\'t been added to DNS yet');
      console.log('   2. DNS propagation is still in progress (can take 24-48 hours)');
      console.log('   3. The domain name is incorrect');
    }
    return false;
  }
}

async function testSPFRecord() {
  console.log(`\n📋 Testing SPF record for: ${DOMAIN}`);
  
  try {
    const records = await resolve(DOMAIN, 'TXT');
    
    const spfRecord = records.find(record => 
      record.join('').includes('v=spf1')
    );
    
    if (spfRecord) {
      const spfValue = spfRecord.join('');
      console.log('✅ SPF record found!');
      console.log(`📄 Record: ${spfValue}`);
      
      if (spfValue.includes('include:_spf.hostinger.com')) {
        console.log('✅ SPF record includes Hostinger configuration!');
        return true;
      } else {
        console.log('⚠️  SPF record found but doesn\'t include Hostinger (_spf.hostinger.com)');
        return false;
      }
    } else {
      console.log('❌ No SPF record found');
      console.log('💡 Add this SPF record: v=spf1 include:_spf.hostinger.com ~all');
      return false;
    }
  } catch (error) {
    console.log(`❌ Error checking SPF record: ${error.message}`);
    return false;
  }
}

async function testDMARCRecord() {
  const dmarcHost = `_dmarc.${DOMAIN}`;
  console.log(`\n📋 Testing DMARC record for: ${dmarcHost}`);
  
  try {
    const records = await resolve(dmarcHost, 'TXT');
    
    if (records && records.length > 0) {
      const dmarcRecord = records.find(record => 
        record.join('').includes('v=DMARC1')
      );
      
      if (dmarcRecord) {
        console.log('✅ DMARC record found!');
        console.log(`📄 Record: ${dmarcRecord.join('')}`);
        return true;
      } else {
        console.log('❌ DMARC record format invalid');
        return false;
      }
    } else {
      console.log('⚠️  No DMARC record found (optional but recommended)');
      console.log('💡 Add this DMARC record: v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com');
      return false;
    }
  } catch (error) {
    console.log(`⚠️  No DMARC record found: ${error.message}`);
    console.log('💡 DMARC is optional but recommended for better deliverability');
    return false;
  }
}

function checkEnvironmentConfig() {
  console.log('\n⚙️  Checking Environment Configuration');
  console.log('=====================================');
  
  const requiredVars = [
    'EMAIL_HOST',
    'EMAIL_USER',
    'EMAIL_PASS',
    'EMAIL_FROM'
  ];
  
  const optionalVars = [
    'EMAIL_DOMAIN',
    'EMAIL_ORGANIZATION',
    'EMAIL_UNSUBSCRIBE'
  ];
  
  let allRequired = true;
  
  console.log('\n📋 Required Variables:');
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      // Don't log passwords
      const displayValue = varName === 'EMAIL_PASS' ? '****' : value;
      console.log(`✅ ${varName}: ${displayValue}`);
    } else {
      console.log(`❌ ${varName}: NOT SET`);
      allRequired = false;
    }
  });
  
  console.log('\n📋 Optional Variables (recommended):');
  optionalVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(`✅ ${varName}: ${value}`);
    } else {
      console.log(`⚠️  ${varName}: not set`);
    }
  });
  
  return allRequired;
}

function provideDKIMInstructions() {
  console.log('\n📝 DKIM Setup Instructions');
  console.log('==========================');
  console.log('\nTo set up DKIM for your domain:');
  console.log('\n1. Login to your domain registrar (where you bought your domain)');
  console.log('2. Navigate to DNS Management');
  console.log('3. Add a new TXT record:');
  console.log(`   Type: TXT`);
  console.log(`   Name/Host: hostingermail1._domainkey`);
  console.log(`   Value: v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzksTUDJ5tnkVYzHujmQ4pUZ9lHlJxh0UnmTJXH8rcn1j74lZClgxgAIn+aNxULISVLYLwsXDXxJxP3mYn1OOJAMXaOYEle0+liMxIShHw3u5IyxDh0IqcvQ5tGEUIVbTU84naUsadWlLUrwHNRvm3tLuxWrBzP+1AKOzX21+XykAn1y0bAX8/5eWu865CTjFI8mFKq7H06rPbUiPJP1jwSp+tsW3/UvK99ZuVspDEnKPA8ZswqUbeO23ZCX2LMI0QLvWoUc57DSLDaSSJ/+kCuQM2Xr5H2OnBdJf5goo3EuAP/uWmTGc+EUa7/vo5WoolWE6tG+vB5OSXnPSP3lnuQIDAQAB`);
  console.log(`   TTL: 3600 (or default)`);
  console.log('\n4. Wait 24-48 hours for DNS propagation');
  console.log('5. Run this script again to verify');
  console.log('\n🔗 Helpful links:');
  console.log('   - Mail-Tester: https://www.mail-tester.com');
  console.log('   - MXToolbox DKIM: https://mxtoolbox.com/dkim.aspx');
  console.log('   - DNS Propagation Checker: https://www.whatsmydns.net/');
}

async function main() {
  console.log(`Domain: ${DOMAIN}`);
  console.log(`DKIM Selector: ${DKIM_SELECTOR}`);
  console.log(`Full DKIM Host: ${DKIM_SELECTOR}._domainkey.${DOMAIN}\n`);
  
  // Check environment configuration
  const configOk = checkEnvironmentConfig();
  
  if (!configOk) {
    console.log('\n❌ Environment configuration incomplete!');
    console.log('💡 Please set all required environment variables before testing DKIM');
    process.exit(1);
  }
  
  // Test DNS records
  const dkimOk = await testDKIMRecord();
  const spfOk = await testSPFRecord();
  const dmarcOk = await testDMARCRecord();
  
  console.log('\n📊 Summary');
  console.log('==========');
  console.log(`DKIM Record: ${dkimOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`SPF Record: ${spfOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`DMARC Record: ${dmarcOk ? '✅ PASS' : '⚠️  MISSING (optional)'}`);
  console.log(`Environment Config: ${configOk ? '✅ PASS' : '❌ FAIL'}`);
  
  if (dkimOk && spfOk && configOk) {
    console.log('\n🎉 Congratulations! Your DKIM setup looks good!');
    console.log('💡 Next steps:');
    console.log('   1. Send a test email through your application');
    console.log('   2. Test email authentication at https://www.mail-tester.com');
    console.log('   3. Monitor email deliverability for the next 7-14 days');
  } else {
    console.log('\n⚠️  Some issues found. Please address them and run the test again.');
    
    if (!dkimOk) {
      provideDKIMInstructions();
    }
  }
  
  console.log('\n📖 For detailed setup instructions, see: DKIM_SETUP_GUIDE.md');
}

// Handle errors gracefully
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Unexpected error:', error.message);
  console.log('💡 If this persists, check your network connection and DNS settings');
  process.exit(1);
});

// Run the main function
main().catch(console.error); 