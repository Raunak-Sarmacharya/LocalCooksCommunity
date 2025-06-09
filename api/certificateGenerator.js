import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

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
      // ESM-compatible __dirname
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      // Create a new PDF document
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 50
      });

      // Register Lobster font
      const lobsterFontPath = path.join(__dirname, '../attached_assets/Lobster-Regular.ttf');
      doc.registerFont('Lobster', lobsterFontPath);
      // Register fallback font
      doc.registerFont('Helvetica', 'Helvetica');

      // Buffer to store PDF data
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Brand color
      const brandColor = '#f51042';
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const centerX = pageWidth / 2;

      // Background and border
      doc.save();
      doc.rect(30, 30, pageWidth - 60, pageHeight - 60)
         .lineWidth(4)
         .stroke(brandColor); // Brand border
      doc.restore();

      // Logo
      const logoPath = path.join(__dirname, '../attached_assets/Logo_LocalCooks.png');
      const logoDisplayWidth = 90;
      // Calculate logo height to preserve aspect ratio (assume original is 298x128 for now)
      const logoAspectRatio = 1287 / 298; // width/height from file name, adjust if needed
      const logoDisplayHeight = logoDisplayWidth / logoAspectRatio;
      const logoY = 48;
      doc.image(logoPath, centerX - logoDisplayWidth / 2, logoY, { width: logoDisplayWidth });

      // Add vertical space below logo
      let y = logoY + logoDisplayHeight + 30;

      // (No company name in Lobster here)

      // Subtitle
      doc.font('Helvetica')
         .fontSize(20)
         .fillColor('#222')
         .text('Training Record & Verification', 0, y, { width: pageWidth, align: 'center' });
      y += 32; // 20px font + 12px spacing

      // Verification text
      doc.font('Helvetica')
         .fontSize(15)
         .fillColor('#222')
         .text('We hereby verify that', 0, y, { width: pageWidth, align: 'center' });
      y += 30;

      // Recipient name in Lobster font, brand color, large
      doc.font('Lobster')
         .fontSize(40)
         .fillColor(brandColor)
         .text(certificateData.userName, 0, y, { width: pageWidth, align: 'center' });
      y += 50;

      // Completion text
      doc.font('Helvetica')
         .fontSize(15)
         .fillColor('#222')
         .text('has completed the Local Cooks Food Safety Video Training Series, demonstrating dedication to professional food safety education.', 80, y, { width: pageWidth - 160, align: 'center' });
      y += 40;

      // Section heading
      doc.font('Helvetica-Bold')
         .fontSize(16)
         .fillColor(brandColor)
         .text('Completed Training Modules:', 80, y, { width: pageWidth - 160, align: 'center' });
      y += 25;

      // Module 1
      doc.font('Helvetica')
         .fontSize(12)
         .fillColor('#222')
         .text('Module 1: Introduction • HACCP Principles • Reducing Complexity • Personal Hygiene • Deliveries • Storage • Preparation • Regeneration • Service Start • After Service • Waste Removal • Cleaning & Maintenance • Weekly Log Sheets • Wrap Up', 80, y, { width: pageWidth - 160, align: 'center' });
      y += 28;
      // Module 2
      doc.text('Module 2: Hand Washing • Food Prep Station Cleaning • Kitchen Utensil Cleaning • Stove Cleaning • Kitchen Floor Cleaning • Restaurant Floor Cleaning • Table & Chair Cleaning • Washroom Cleaning', 80, y, { width: pageWidth - 160, align: 'center' });
      y += 40;

      // Dates and Record ID
      const formattedDate = new Date(certificateData.completionDate).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
      doc.font('Helvetica-Bold')
         .fontSize(16)
         .fillColor('#222')
         .text(`Completion Date: ${formattedDate}`, 80, y, { width: pageWidth - 160, align: 'center' });
      y += 25;
      doc.font('Helvetica')
         .fontSize(12)
         .fillColor('#444')
         .text(`Record ID: ${certificateData.certificateId}`, 80, y, { width: pageWidth - 160, align: 'center' });

      // Footer/disclaimer
      doc.font('Helvetica')
         .fontSize(11)
         .fillColor('#888')
         .text('This document confirms completion of Local Cooks educational videos and is not a professional certification.', 80, pageHeight - 80, { width: pageWidth - 160, align: 'center' });

      // Decorative corners (optional, subtle)
      doc.save();
      doc.strokeColor(brandColor).lineWidth(2);
      // Top left
      doc.moveTo(40, 40).lineTo(80, 40).stroke();
      doc.moveTo(40, 40).lineTo(40, 80).stroke();
      // Top right
      doc.moveTo(pageWidth - 40, 40).lineTo(pageWidth - 80, 40).stroke();
      doc.moveTo(pageWidth - 40, 40).lineTo(pageWidth - 40, 80).stroke();
      // Bottom left
      doc.moveTo(40, pageHeight - 40).lineTo(80, pageHeight - 40).stroke();
      doc.moveTo(40, pageHeight - 40).lineTo(40, pageHeight - 80).stroke();
      // Bottom right
      doc.moveTo(pageWidth - 40, pageHeight - 40).lineTo(pageWidth - 80, pageHeight - 40).stroke();
      doc.moveTo(pageWidth - 40, pageHeight - 40).lineTo(pageWidth - 40, pageHeight - 80).stroke();
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
