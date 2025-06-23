#!/usr/bin/env node

/**
 * Email Authentication Diagnostic Script
 * Checks SPF, DKIM, and DMARC records for localcook.shop
 */

import dns from 'dns';
import { promisify } from 'util';

const resolve = promisify(dns.resolve);

const DOMAIN = 'localcook.shop';
const MAILCHANNELS_IP = '23.83.212.18';

console.log('🔍 Email Authentication Diagnostic');
console.log('==================================');
console.log(`Domain: ${DOMAIN}`);
console.log(`Problematic IP: ${MAILCHANNELS_IP} (MailChannels)`);
console.log('');

async function checkSPFRecord() {
  console.log('📋 Checking SPF Record...');
  
  try {
    const records = await resolve(DOMAIN, 'TXT');
    
    const spfRecord = records.find(record => 
      record.join('').includes('v=spf1')
    );
    
    if (spfRecord) {
      const spfValue = spfRecord.join('');
      console.log('✅ SPF record found:');
      console.log(`   ${spfValue}`);
      
      // Check if MailChannels is authorized
      if (spfValue.includes('include:relay.mailchannels.net')) {
        console.log('✅ MailChannels is authorized in SPF');
      } else {
        console.log('❌ MailChannels NOT authorized in SPF');
        console.log('💡 Add "include:relay.mailchannels.net" to your SPF record');
      }
      
      // Check if Hostinger is authorized
      if (spfValue.includes('include:_spf.hostinger.com')) {
        console.log('✅ Hostinger is authorized in SPF');
      } else {
        console.log('⚠️  Hostinger not explicitly authorized in SPF');
      }
      
      return true;
    } else {
      console.log('❌ No SPF record found');
      console.log('💡 Add SPF record: v=spf1 include:relay.mailchannels.net ~all');
      return false;
    }
  } catch (error) {
    console.log(`❌ Error checking SPF record: ${error.message}`);
    return false;
  }
}

async function checkDKIMRecord() {
  console.log('\n📋 Checking DKIM Record...');
  
  const dkimSelectors = [
    'hostingermail1',
    'default',
    'selector1',
    'selector2',
    'mail',
    'dkim'
  ];
  
  let foundDKIM = false;
  
  for (const selector of dkimSelectors) {
    const dkimHost = `${selector}._domainkey.${DOMAIN}`;
    
    try {
      const records = await resolve(dkimHost, 'TXT');
      
      if (records && records.length > 0) {
        const fullRecord = records.map(record => record.join('')).join('');
        
        if (fullRecord.includes('v=DKIM1')) {
          console.log(`✅ DKIM record found for selector "${selector}":   ${fullRecord.substring(0, 100)}...`);
          foundDKIM = true;
        }
      }
    } catch (error) {
      // Expected for non-existent selectors
    }
  }
  
  if (!foundDKIM) {
    console.log('❌ No DKIM record found');
    console.log('💡 Add DKIM record for "hostingermail1._domainkey" selector');
  }
  
  return foundDKIM;
}

async function checkDMARCRecord() {
  console.log('\n📋 Checking DMARC Record...');
  
  try {
    const records = await resolve(`_dmarc.${DOMAIN}`, 'TXT');
    
    const dmarcRecord = records.find(record => 
      record.join('').includes('v=DMARC1')
    );
    
    if (dmarcRecord) {
      const dmarcValue = dmarcRecord.join('');
      console.log('✅ DMARC record found:');
      console.log(`   ${dmarcValue}`);
      return true;
    } else {
      console.log('⚠️  No DMARC record found');
      console.log('💡 Add DMARC record: v=DMARC1; p=quarantine; rua=mailto:dmarc@localcook.shop');
      return false;
    }
  } catch (error) {
    console.log('⚠️  No DMARC record found');
    console.log('💡 Add DMARC record: v=DMARC1; p=quarantine; rua=mailto:dmarc@localcook.shop');
    return false;
  }
}

async function checkMailChannelsAuthorization() {
  console.log('\n📋 Checking MailChannels Authorization...');
  
  // Check if MailChannels IP is in any SPF includes
  try {
    const mailchannelsRecords = await resolve('relay.mailchannels.net', 'TXT');
    
    const spfRecord = mailchannelsRecords.find(record => 
      record.join('').includes('v=spf1')
    );
    
    if (spfRecord) {
      console.log('✅ MailChannels SPF record exists');
      const spfValue = spfRecord.join('');
      
      // Check if the problematic IP is included
      if (spfValue.includes('ip4:23.83.212.') || spfValue.includes('ip4:23.83.212.18')) {
        console.log('✅ MailChannels IP 23.83.212.18 is authorized');
      } else {
        console.log('⚠️  Could not verify IP 23.83.212.18 in MailChannels SPF');
      }
    }
  } catch (error) {
    console.log('⚠️  Could not check MailChannels SPF record');
  }
}

async function provideSolution() {
  console.log('\n🔧 IMMEDIATE SOLUTION');
  console.log('====================');
  console.log('');
  console.log('1. Add SPF Record:');
  console.log('   Type: TXT');
  console.log('   Name: @');
  console.log('   Value: v=spf1 include:relay.mailchannels.net include:_spf.hostinger.com ~all');
  console.log('');
  console.log('2. Add DKIM Record:');
  console.log('   Type: TXT');
  console.log('   Name: hostingermail1._domainkey');
  console.log('   Value: v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzksTUDJ5tnkVYzHujmQ4pUZ9lHlJxh0UnmTJXH8rcn1j74lZClgxgAIn+aNxULISVLYLwsXDXxJxP3mYn1OOJAMXaOYEle0+liMxIShHw3u5IyxDh0IqcvQ5tGEUIVbTU84naUsadWlLUrwHNRvm3tLuxWrBzP+1AKOzX21+XykAn1y0bAX8/5eWu865CTjFI8mFKq7H06rPbUiPJP1jwSp+tsW3/UvK99ZuVspDEnKPA8ZswqUbeO23ZCX2LMI0QLvWoUc57DSLDaSSJ/+kCuQM2Xr5H2OnBdJf5goo3EuAP/uWmTGc+EUa7/vo5WoolWE6tG+vB5OSXnPSP3lnuQIDAQAB');
  console.log('');
  console.log('3. Add DMARC Record:');
  console.log('   Type: TXT');
  console.log('   Name: _dmarc');
  console.log('   Value: v=DMARC1; p=quarantine; rua=mailto:dmarc@localcook.shop');
  console.log('');
  console.log('⏰ DNS propagation takes 24-48 hours');
  console.log('🔗 Test authentication at: https://www.mail-tester.com');
}

async function main() {
  const spfOk = await checkSPFRecord();
  const dkimOk = await checkDKIMRecord();
  const dmarcOk = await checkDMARCRecord();
  await checkMailChannelsAuthorization();
  
  console.log('\n📊 Summary');
  console.log('==========');
  console.log(`SPF Record: ${spfOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`DKIM Record: ${dkimOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`DMARC Record: ${dmarcOk ? '✅ PASS' : '⚠️  MISSING'}`);
  
  if (!spfOk || !dkimOk) {
    console.log('\n🚨 CRITICAL: Email authentication is incomplete!');
    console.log('This is why Gmail is blocking your emails.');
    await provideSolution();
  } else {
    console.log('\n🎉 Email authentication looks good!');
    console.log('If you\'re still having issues, wait for DNS propagation (24-48 hours).');
  }
  
  console.log('\n📖 For detailed instructions, see: EMAIL_AUTHENTICATION_FIX.md');
}

main().catch(console.error); 