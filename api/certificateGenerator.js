import PDFDocument from 'pdfkit';

/**
 * Generate a professional food safety certificate PDF
 * @param {Object} certificateData - Certificate information
 * @param {string} certificateData.userName - Name of the certificate recipient
 * @param {string} certificateData.completionDate - Date of completion
 * @param {string} certificateData.certificateId - Unique certificate ID
 * @param {number} certificateData.userId - User ID
 * @returns {Buffer} PDF buffer
 */
function generateCertificatePDF(certificateData) {
  return new Promise((resolve, reject) => {
    try {
      // Create a new PDF document
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 50
      });

      // Buffer to store PDF data
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Certificate styling
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const centerX = pageWidth / 2;

      // Background and border
      doc.rect(30, 30, pageWidth - 60, pageHeight - 60)
         .lineWidth(3)
         .stroke('#2563eb'); // Blue border

      doc.rect(40, 40, pageWidth - 80, pageHeight - 80)
         .lineWidth(1)
         .stroke('#e5e7eb'); // Gray inner border

      // Header - Certificate Title
      doc.fontSize(36)
         .font('Helvetica-Bold')
         .fillColor('#1e40af')
         .text('CERTIFICATE OF COMPLETION', 80, 80, {
           width: pageWidth - 160,
           align: 'center'
         });

      // Subtitle
      doc.fontSize(18)
         .font('Helvetica')
         .fillColor('#374151')
         .text('Food Safety Handler Training', 80, 130, {
           width: pageWidth - 160,
           align: 'center'
         });

      // Main content area
      doc.fontSize(16)
         .font('Helvetica')
         .fillColor('#1f2937')
         .text('This is to certify that', 80, 200, {
           width: pageWidth - 160,
           align: 'center'
         });

      // Recipient name (large and prominent)
      doc.fontSize(32)
         .font('Helvetica-Bold')
         .fillColor('#1e40af')
         .text(certificateData.userName.toUpperCase(), 80, 240, {
           width: pageWidth - 160,
           align: 'center'
         });

      // Completion text
      doc.fontSize(16)
         .font('Helvetica')
         .fillColor('#1f2937')
         .text('has successfully completed the comprehensive', 80, 300, {
           width: pageWidth - 160,
           align: 'center'
         });

      // Course title
      doc.fontSize(20)
         .font('Helvetica-Bold')
         .fillColor('#059669')
         .text('Newfoundland & Labrador Food Safety Training Program', 80, 330, {
           width: pageWidth - 160,
           align: 'center'
         });

      // Training details
      doc.fontSize(14)
         .font('Helvetica')
         .fillColor('#6b7280')
         .text('Including: Personal Hygiene • Temperature Control • Cross-Contamination Prevention', 80, 370, {
           width: pageWidth - 160,
           align: 'center'
         });

      doc.text('Allergen Awareness • Food Storage • Sanitation Procedures • HACCP Principles', 80, 390, {
         width: pageWidth - 160,
         align: 'center'
       });

      // Completion date
      const formattedDate = new Date(certificateData.completionDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      doc.fontSize(16)
         .font('Helvetica-Bold')
         .fillColor('#1f2937')
         .text(`Date of Completion: ${formattedDate}`, 80, 450, {
           width: pageWidth - 160,
           align: 'center'
         });

      // Certificate ID
      doc.fontSize(12)
         .font('Helvetica')
         .fillColor('#6b7280')
         .text(`Certificate ID: ${certificateData.certificateId}`, 80, 480, {
           width: pageWidth - 160,
           align: 'center'
         });

      // Footer section with signatures/seals
      const footerY = 520;
      
      // Left side - Authority
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .fillColor('#1f2937')
         .text('LocalCooks Community', 100, footerY);
      
      doc.fontSize(12)
         .font('Helvetica')
         .fillColor('#6b7280')
         .text('Authorized Training Provider', 100, footerY + 20);

      // Center - Compliance
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .fillColor('#059669')
         .text('✓ Health Canada Compliant', centerX - 80, footerY);
      
      doc.text('✓ CFIA Approved Standards', centerX - 80, footerY + 20);

      // Right side - Validity
      doc.fontSize(12)
         .font('Helvetica')
         .fillColor('#6b7280')
         .text('Valid for Employment in', pageWidth - 200, footerY);
      
      doc.text('Newfoundland & Labrador', pageWidth - 200, footerY + 20);

      // Bottom disclaimer
      doc.fontSize(10)
         .font('Helvetica')
         .fillColor('#9ca3af')
         .text('This certificate confirms completion of LocalCooks Community food safety training preparation. ' +
               'Complete your official provincial certification at skillpass.nl', 
               80, pageHeight - 80, {
                 width: pageWidth - 160,
                 align: 'center'
               });

      // Decorative elements
      // Add some corner decorations
      doc.save();
      doc.strokeColor('#e5e7eb');
      doc.lineWidth(2);
      
      // Top left corner
      doc.moveTo(60, 60).lineTo(100, 60).stroke();
      doc.moveTo(60, 60).lineTo(60, 100).stroke();
      
      // Top right corner  
      doc.moveTo(pageWidth - 60, 60).lineTo(pageWidth - 100, 60).stroke();
      doc.moveTo(pageWidth - 60, 60).lineTo(pageWidth - 60, 100).stroke();
      
      // Bottom left corner
      doc.moveTo(60, pageHeight - 60).lineTo(100, pageHeight - 60).stroke();
      doc.moveTo(60, pageHeight - 60).lineTo(60, pageHeight - 100).stroke();
      
      // Bottom right corner
      doc.moveTo(pageWidth - 60, pageHeight - 60).lineTo(pageWidth - 100, pageHeight - 60).stroke();
      doc.moveTo(pageWidth - 60, pageHeight - 60).lineTo(pageWidth - 60, pageHeight - 100).stroke();
      
      doc.restore();

      // Finalize the PDF
      doc.end();

    } catch (error) {
      reject(error);
    }
  });
}

export {
    generateCertificatePDF
};
