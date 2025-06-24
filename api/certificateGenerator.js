import ReactPDF, { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import path from 'path';
import React from 'react';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register custom font
const currentDir = __dirname;
const lobsterFontPath = path.join(currentDir, '..', 'attached_assets', 'Lobster-Regular.ttf');
const logoPath = path.join(currentDir, '..', 'attached_assets', 'Logo_LocalCooks.png');

try {
  Font.register({
    family: 'Lobster',
    src: lobsterFontPath,
  });
} catch (error) {
  console.log('Lobster font not found, using default');
}

// Create styles
const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    padding: 40,
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 60,
  },
  logo: {
    width: 55,
    height: 55,
  },
  brandText: {
    textAlign: 'right',
  },
  brandTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#f51042',
    fontFamily: 'Helvetica-Bold',
  },
  brandSubtitle: {
    fontSize: 8,
    color: '#6c757d',
    marginTop: 4,
  },
  certificateContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  organicBlob: {
    backgroundColor: '#f51042',
    borderRadius: 50,
    width: 380,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
  },
  blobText: {
    color: 'white',
    textAlign: 'center',
    fontFamily: 'Helvetica-Bold',
  },
  blobMainText: {
    fontSize: 20,
    marginBottom: 4,
  },
  blobSubText: {
    fontSize: 24,
  },
  subtitle: {
    fontSize: 11,
    color: '#6c757d',
    textAlign: 'center',
    marginBottom: 18,
  },
  verificationText: {
    fontSize: 13,
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 18,
  },
  recipientName: {
    fontSize: 30,
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 22,
    fontFamily: 'Lobster',
  },
  completionText: {
    fontSize: 12,
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 1.4,
  },
  modulesHeader: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#f51042',
    textAlign: 'center',
    marginBottom: 20,
    fontFamily: 'Helvetica-Bold',
  },
  modulesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 20,
  },
  moduleBox: {
    flex: 1,
    border: '2px solid rgba(245, 16, 66, 0.2)',
    backgroundColor: 'rgba(245, 16, 66, 0.05)',
    padding: 10,
    minHeight: 60,
  },
  moduleTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 4,
    fontFamily: 'Helvetica-Bold',
  },
  moduleVideos: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: 'Helvetica-Bold',
  },
  moduleContent: {
    fontSize: 8,
    color: '#2c3e50',
    textAlign: 'center',
    lineHeight: 1.2,
  },
  completionDate: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 18,
    fontFamily: 'Helvetica-Bold',
  },
  recordId: {
    fontSize: 10,
    color: '#6c757d',
    textAlign: 'center',
    marginBottom: 40,
  },
  footer: {
    position: 'absolute',
    bottom: 80,
    left: 40,
    right: 40,
  },
  disclaimer: {
    fontSize: 8,
    color: '#6c757d',
    textAlign: 'center',
    lineHeight: 1.3,
  },
  wave: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 40,
    backgroundColor: '#f51042',
    opacity: 0.6,
  },
});

// Certificate Document Component using React.createElement
const CertificateDocument = ({ certificateData }) => {
  const completionDate = new Date(certificateData.completionDate);
  const formattedDate = completionDate.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return React.createElement(Document, null,
    React.createElement(Page, { size: 'A4', style: styles.page },
      // Header
      React.createElement(View, { style: styles.header },
        React.createElement(Image, { style: styles.logo, src: logoPath }),
        React.createElement(View, { style: styles.brandText },
          React.createElement(Text, { style: styles.brandTitle }, 'Local Cooks'),
          React.createElement(Text, { style: styles.brandSubtitle }, 'Food Safety Training')
        )
      ),

      // Certificate Content
      React.createElement(View, { style: styles.certificateContainer },
        // Organic Blob
        React.createElement(View, { style: styles.organicBlob },
          React.createElement(Text, { style: [styles.blobText, styles.blobMainText] }, 'Certificate of'),
          React.createElement(Text, { style: [styles.blobText, styles.blobSubText] }, 'Completion')
        ),

        // Content
        React.createElement(Text, { style: styles.subtitle }, 'Training Record & Verification'),
        React.createElement(Text, { style: styles.verificationText }, 'We hereby verify that'),
        React.createElement(Text, { style: styles.recipientName }, certificateData.userName),
        React.createElement(Text, { style: styles.completionText }, 
          'has completed the Local Cooks Food Safety Video Training Series,\n' +
          'demonstrating dedication to professional food safety education.'
        ),

        // Training Modules
        React.createElement(Text, { style: styles.modulesHeader }, 'Completed Training Modules:'),
        
        React.createElement(View, { style: styles.modulesContainer },
          // Module 1
          React.createElement(View, { style: styles.moduleBox },
            React.createElement(Text, { style: styles.moduleTitle }, 'Module 1: Food Safety Basics'),
            React.createElement(Text, { style: styles.moduleVideos }, '(14 Videos)'),
            React.createElement(Text, { style: styles.moduleContent }, 
              'Introduction • HACCP Principles • Reducing Complexity • Personal Hygiene • ' +
              'Deliveries • Storage • Preparation • Regeneration • Service Start • ' +
              'After Service • Waste Removal • Cleaning & Maintenance • Weekly Log Sheets • Wrap Up'
            )
          ),

          // Module 2
          React.createElement(View, { style: styles.moduleBox },
            React.createElement(Text, { style: styles.moduleTitle }, 'Module 2: Safety & Hygiene How-To\'s'),
            React.createElement(Text, { style: styles.moduleVideos }, '(8 Videos)'),
            React.createElement(Text, { style: styles.moduleContent }, 
              'Hand Washing • Food Prep Station Cleaning • Kitchen Utensil Cleaning • ' +
              'Stove Cleaning • Kitchen Floor Cleaning • Restaurant Floor Cleaning • ' +
              'Table & Chair Cleaning • Washroom Cleaning'
            )
          )
        ),

        // Completion Info
        React.createElement(Text, { style: styles.completionDate }, `Completion Date: ${formattedDate}`),
        React.createElement(Text, { style: styles.recordId }, `Record ID: ${certificateData.certificateId}`)
      ),

      // Footer
      React.createElement(View, { style: styles.footer },
        React.createElement(Text, { style: styles.disclaimer }, 
          'This document confirms completion of Local Cooks educational videos and is not a professional certification.\n' +
          'Complete your official certification at skillpass.nl'
        )
      ),

      // Simple Wave
      React.createElement(View, { style: styles.wave })
    )
  );
};

// Export function to generate certificate
export const generateCertificate = async (certificateData) => {
  try {
    return await ReactPDF.renderToStream(
      React.createElement(CertificateDocument, { certificateData })
    );
  } catch (error) {
    console.error('Error generating certificate:', error);
    throw error;
  }
};

