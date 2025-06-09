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
         .text('LOCAL COOKS', 80, 80, {
           width: pageWidth - 160,
           align: 'center'
         });

      doc.fontSize(18)
         .font('Helvetica')
         .fillColor('#374151')
         .text('Training Record & Verification', 80, 130, {
           width: pageWidth - 160,
           align: 'center'
         });

      doc.fontSize(16)
         .font('Helvetica')
         .fillColor('#1f2937')
         .text('We hereby verify that', 80, 180, {
           width: pageWidth - 160,
           align: 'center'
         });

      doc.fontSize(32)
         .font('Helvetica-Bold')
         .fillColor('#1e40af')
         .text(certificateData.userName.toUpperCase(), 80, 220, {
           width: pageWidth - 160,
           align: 'center'
         });

      doc.fontSize(16)
         .font('Helvetica')
         .fillColor('#1f2937')
         .text('has completed the Local Cooks Food Safety Video Training Series, demonstrating dedication to professional food safety education.', 80, 270, {
           width: pageWidth - 160,
           align: 'center'
         });

      doc.fontSize(14)
         .font('Helvetica-Bold')
         .fillColor('#059669')
         .text('Completed Training Modules:', 80, 320, {
           width: pageWidth - 160,
           align: 'center'
         });

      doc.fontSize(13)
         .font('Helvetica')
         .fillColor('#374151')
         .text('Module 1: Introduction • HACCP Principles • Reducing Complexity • Personal Hygiene • Deliveries • Storage • Preparation • Regeneration • Service Start • After Service • Waste Removal • Cleaning & Maintenance • Weekly Log Sheets • Wrap Up', 80, 350, {
           width: pageWidth - 160,
           align: 'center'
         });

      doc.text('Module 2: Hand Washing • Food Prep Station Cleaning • Kitchen Utensil Cleaning • Stove Cleaning • Kitchen Floor Cleaning • Restaurant Floor Cleaning • Table & Chair Cleaning • Washroom Cleaning', 80, 390, {
           width: pageWidth - 160,
           align: 'center'
         });

      const formattedDate = new Date(certificateData.completionDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      doc.fontSize(16)
         .font('Helvetica-Bold')
         .fillColor('#1f2937')
         .text(`Completion Date: ${formattedDate}`, 80, 450, {
           width: pageWidth - 160,
           align: 'center'
         });

      doc.fontSize(12)
         .font('Helvetica')
         .fillColor('#6b7280')
         .text(`Record ID: ${certificateData.certificateId}`, 80, 480, {
           width: pageWidth - 160,
           align: 'center'
         });

      doc.fontSize(16)
         .font('Helvetica-Bold')
         .fillColor('#1e40af')
         .text('Local Cooks', 80, 510, {
           width: pageWidth - 160,
           align: 'center'
         });

      doc.fontSize(10)
         .font('Helvetica')
         .fillColor('#9ca3af')
         .text('This training record documents completion of video-based educational content and is issued by LocalCooks as a private training provider.', 80, pageHeight - 80, {
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
