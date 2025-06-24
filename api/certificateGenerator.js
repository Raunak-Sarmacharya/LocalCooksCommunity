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

// Simplified modern styles - ensuring everything fits on one page
const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    padding: 20,
    fontFamily: 'Helvetica',
  },
  
  // Simple elegant border
  outerBorder: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    bottom: 10,
    border: '3px solid #f51042',
    borderRadius: 15,
  },
  
  innerBorder: {
    position: 'absolute',
    top: 18,
    left: 18,
    right: 18,
    bottom: 18,
    border: '1px solid #e2e8f0',
    borderRadius: 10,
  },
  
  // Content container
  content: {
    paddingTop: 25,
    paddingHorizontal: 30,
    alignItems: 'center',
  },
  
  // Logo section
  logoSection: {
    alignItems: 'center',
    marginBottom: 15,
  },
  
  logo: {
    width: 60,
    height: 60,
  },
  
  // Title section
  titleSection: {
    backgroundColor: '#f51042',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 25,
    marginBottom: 15,
    alignItems: 'center',
    width: 320,
  },
  
  titleText: {
    color: 'white',
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 2,
  },
  
  subtitleText: {
    color: 'white',
    fontSize: 10,
    textAlign: 'center',
  },
  
  // Certificate content
  certificationText: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  
  recipientName: {
    fontSize: 26,
    color: '#1e293b',
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: 'Lobster',
  },
  
  nameUnderline: {
    width: 150,
    height: 2,
    backgroundColor: '#f51042',
    marginBottom: 12,
  },
  
  completionDescription: {
    fontSize: 10,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 15,
    lineHeight: 1.4,
    maxWidth: 400,
  },
  
  // Standards section
  standardsBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 15,
    border: '1px solid #e2e8f0',
    width: 400,
  },
  
  standardsTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#f51042',
    textAlign: 'center',
    marginBottom: 8,
  },
  
  standardsList: {
    fontSize: 9,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 1.3,
  },
  
  // Details section
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 15,
    paddingHorizontal: 30,
  },
  
  detailItem: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    padding: 10,
    minWidth: 130,
  },
  
  detailLabel: {
    fontSize: 8,
    color: '#64748b',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 3,
  },
  
  detailValue: {
    fontSize: 10,
    color: '#1e293b',
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
  },
  
  // Footer
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    right: 30,
    alignItems: 'center',
  },
  
  disclaimer: {
    fontSize: 7.5,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 1.3,
    fontStyle: 'italic',
  },
});

// Certificate Document Component
const CertificateDocument = ({ certificateData }) => {
  const completionDate = new Date(certificateData.completionDate);
  const formattedDate = completionDate.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return React.createElement(Document, null,
    React.createElement(Page, { size: 'A4', orientation: 'landscape', style: styles.page },
      
      // Simple borders
      React.createElement(View, { style: styles.outerBorder }),
      React.createElement(View, { style: styles.innerBorder }),
      
      // Main content
      React.createElement(View, { style: styles.content },
        
        // Logo
        React.createElement(View, { style: styles.logoSection },
          React.createElement(Image, { style: styles.logo, src: logoPath })
        ),
        
        // Title
        React.createElement(View, { style: styles.titleSection },
          React.createElement(Text, { style: styles.titleText }, 'Certificate of Completion'),
          React.createElement(Text, { style: styles.subtitleText }, 'Local Cooks Food Safety Training Program')
        ),
        
        // Certification text
        React.createElement(Text, { style: styles.certificationText }, 'This is to certify that'),
        
        // Recipient name
        React.createElement(Text, { style: styles.recipientName }, certificateData.userName),
        React.createElement(View, { style: styles.nameUnderline }),
        
        // Completion description
        React.createElement(Text, { style: styles.completionDescription }, 
          'has successfully completed the comprehensive Local Cooks Food Safety Video Training Series, demonstrating dedication to professional culinary safety standards and best practices.'
        ),
        
        // Standards section
        React.createElement(View, { style: styles.standardsBox },
          React.createElement(Text, { style: styles.standardsTitle }, 'Food Safety Standards Mastered'),
          React.createElement(Text, { style: styles.standardsList }, 
            'HACCP Principles • Personal Hygiene Protocols • Temperature Control Systems • Cross-Contamination Prevention • Food Storage Standards • Sanitation Procedures • Equipment Maintenance • Health & Safety Compliance'
          )
        ),
        
        // Details
        React.createElement(View, { style: styles.detailsRow },
          React.createElement(View, { style: styles.detailItem },
            React.createElement(Text, { style: styles.detailLabel }, 'COMPLETION DATE'),
            React.createElement(Text, { style: styles.detailValue }, formattedDate)
          ),
          React.createElement(View, { style: styles.detailItem },
            React.createElement(Text, { style: styles.detailLabel }, 'CERTIFICATE ID'),
            React.createElement(Text, { style: styles.detailValue }, certificateData.certificateId)
          )
        )
      ),
      
      // Footer
      React.createElement(View, { style: styles.footer },
        React.createElement(Text, { style: styles.disclaimer }, 
          'This is an unofficial certificate of completion for the Local Cooks Food Safety Training Program. This educational certificate acknowledges participation in training materials and is not an official professional certification. For official food safety certification, please consult certified food safety authorities.'
        )
      )
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

