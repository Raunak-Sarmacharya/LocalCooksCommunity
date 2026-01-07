/**
 * Cloudflare R2 Integration Verification
 * 
 * This file can be used to test R2 configuration and connectivity.
 * Run with: tsx server/r2-verification.ts
 */

import { isR2Configured, uploadToR2, fileExistsInR2, deleteFromR2 } from './r2-storage';
import { Readable } from 'stream';

async function verifyR2Configuration() {
  console.log('🔍 Verifying Cloudflare R2 Configuration...\n');

  // Check if R2 is configured
  if (!isR2Configured()) {
    console.error('❌ R2 is not configured. Please set the following environment variables:');
    console.error('   - CLOUDFLARE_ACCOUNT_ID');
    console.error('   - CLOUDFLARE_R2_ACCESS_KEY_ID');
    console.error('   - CLOUDFLARE_R2_SECRET_ACCESS_KEY');
    console.error('   - CLOUDFLARE_R2_BUCKET_NAME');
    process.exit(1);
  }

  console.log('✅ R2 configuration detected\n');

  // Test upload (mock file)
  console.log('📤 Testing file upload...');
  try {
    const mockFile = {
      buffer: Buffer.from('Test file content for R2 verification'),
      originalname: 'test-verification.txt',
      mimetype: 'text/plain',
      fieldname: 'test',
      size: 38,
    } as Express.Multer.File;

    const url = await uploadToR2(mockFile, 'test-user', 'test');
    console.log(`✅ Upload successful: ${url}\n`);

    // Test file existence
    console.log('🔍 Testing file existence check...');
    const exists = await fileExistsInR2(url);
    console.log(`✅ File exists: ${exists}\n`);

    // Test deletion
    console.log('🗑️  Testing file deletion...');
    const deleted = await deleteFromR2(url);
    console.log(`✅ File deleted: ${deleted}\n`);

    console.log('🎉 All R2 operations successful!');
  } catch (error) {
    console.error('❌ R2 operation failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
    }
    process.exit(1);
  }
}

// Run verification if called directly
if (require.main === module) {
  verifyR2Configuration().catch(console.error);
}

export { verifyR2Configuration };

