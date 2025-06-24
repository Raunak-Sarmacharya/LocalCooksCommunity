import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCertificate } from '../api/certificateGenerator.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testCertificateGeneration() {
  console.log('🧪 Testing PDF Certificate Generation...\n');

  try {
    // Test certificate data
    const testCertificateData = {
      userName: 'John Doe',
      completionDate: new Date().toISOString(),
      certificateId: 'LC-123-2025-0001',
      userId: 123
    };

    console.log('📝 Certificate Data:');
    console.log(JSON.stringify(testCertificateData, null, 2));
    console.log('\n🔄 Generating PDF...');

    // Generate PDF stream and convert to buffer
    const pdfStream = await generateCertificate(testCertificateData);
    const chunks = [];
    for await (const chunk of pdfStream) {
      chunks.push(chunk);
    }
    const pdfBuffer = Buffer.concat(chunks);

    console.log(`✅ PDF Generated Successfully!`);
    console.log(`📊 Size: ${pdfBuffer.length} bytes (${(pdfBuffer.length / 1024).toFixed(2)} KB)`);

    // Save test certificate
    const outputPath = path.join(__dirname, '..', 'test-certificate.pdf');
    fs.writeFileSync(outputPath, pdfBuffer);

    console.log(`💾 Test certificate saved to: ${outputPath}`);
    console.log('🎉 Certificate generation test completed successfully!\n');

    // Test with different names
    const testCases = [
      { userName: 'Maria Garcia-Rodriguez', completionDate: new Date().toISOString() },
      { userName: '李 Wei Chen', completionDate: new Date().toISOString() },
      { userName: 'VERY LONG NAME THAT MIGHT CAUSE LAYOUT ISSUES', completionDate: new Date().toISOString() }
    ];

    console.log('🔄 Testing edge cases...');
    for (let i = 0; i < testCases.length; i++) {
      const testCase = {
        ...testCases[i],
        certificateId: `LC-${100 + i}-2025-${String(i + 2).padStart(4, '0')}`,
        userId: 100 + i
      };

      const edgeCaseStream = await generateCertificate(testCase);
      const edgeChunks = [];
      for await (const chunk of edgeCaseStream) {
        edgeChunks.push(chunk);
      }
      const edgeCasePdf = Buffer.concat(edgeChunks);
      console.log(`✅ Edge case ${i + 1}: ${testCase.userName} - ${edgeCasePdf.length} bytes`);
    }

    console.log('\n🎯 All tests passed! PDF certificate generation is working correctly.');

  } catch (error) {
    console.error('❌ Certificate generation test failed:');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
testCertificateGeneration(); 