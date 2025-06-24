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
    padding: 30,
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 40,
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
    marginBottom: 20,
  },
  organicBlob: {
    backgroundColor: '#f51042',
    borderRadius: 25,
    width: 320,
    height: 85,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
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
    fontSize: 10,
    color: '#6c757d',
    textAlign: 'center',
    marginBottom: 12,
  },
  verificationText: {
    fontSize: 12,
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 12,
  },
  recipientName: {
    fontSize: 26,
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 15,
    fontFamily: 'Lobster',
  },
  completionText: {
    fontSize: 11,
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 15,
    lineHeight: 1.3,
  },
  modulesHeader: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#f51042',
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'Helvetica-Bold',
  },
  safetyStandards: {
    fontSize: 10,
    color: '#2c3e50',
    textAlign: 'center',
    lineHeight: 1.3,
    marginBottom: 15,
    paddingHorizontal: 30,
  },
  completionDate: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'Helvetica-Bold',
  },
  recordId: {
    fontSize: 9,
    color: '#6c757d',
    textAlign: 'center',
    marginBottom: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 60,
    left: 30,
    right: 30,
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
    React.createElement(Page, { size: 'A4', orientation: 'landscape', style: styles.page },
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

        // Training Overview
        React.createElement(Text, { style: styles.modulesHeader }, 'Food Safety Standards Completed:'),
        React.createElement(Text, { style: styles.safetyStandards }, 
          'HACCP Principles • Personal Hygiene • Temperature Control • Cross-Contamination Prevention • Food Storage Protocols • Sanitation Procedures • Equipment Maintenance • Health & Safety Compliance'
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

