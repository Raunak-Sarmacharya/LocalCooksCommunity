import ReactPDF, { Document, Font, Image, Page, StyleSheet, Text, View, Svg, Path, LinearGradient, Stop, Defs, Rect, Circle } from '@react-pdf/renderer';
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

// Create modern styles for the certificate
const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    padding: 40,
    fontFamily: 'Helvetica',
    position: 'relative',
  },
  
  // Decorative border frame
  decorativeBorder: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    bottom: 20,
    border: '3px solid #f51042',
    borderRadius: 15,
  },
  
  innerBorder: {
    position: 'absolute',
    top: 35,
    left: 35,
    right: 35,
    bottom: 35,
    border: '1px solid #e2e8f0',
    borderRadius: 10,
  },
  
  // Header with centered logo
  header: {
    alignItems: 'center',
    marginBottom: 30,
    marginTop: 20,
  },
  
  logo: {
    width: 80,
    height: 80,
    marginBottom: 15,
  },
  
  // Main content container
  certificateContainer: {
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 60,
  },
  
  // Modern certificate title with gradient-like effect
  certificateTitle: {
    backgroundColor: '#f51042',
    borderRadius: 30,
    paddingVertical: 20,
    paddingHorizontal: 40,
    marginBottom: 25,
    width: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  
  titleText: {
    color: 'white',
    fontSize: 28,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 5,
  },
  
  subtitleText: {
    color: 'white',
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.9,
  },
  
  // Elegant verification section
  verificationSection: {
    alignItems: 'center',
    marginBottom: 25,
  },
  
  verificationText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  
  recipientName: {
    fontSize: 32,
    color: '#1e293b',
    textAlign: 'center',
    marginBottom: 20,
    fontFamily: 'Lobster',
    borderBottom: '2px solid #f51042',
    paddingBottom: 10,
    paddingHorizontal: 20,
  },
  
  completionText: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 1.5,
    maxWidth: 500,
  },
  
  // Training standards section
  standardsSection: {
    backgroundColor: '#f8fafc',
    borderRadius: 15,
    padding: 20,
    marginBottom: 25,
    border: '1px solid #e2e8f0',
    width: 500,
  },
  
  modulesHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#f51042',
    textAlign: 'center',
    marginBottom: 15,
    fontFamily: 'Helvetica-Bold',
  },
  
  safetyStandards: {
    fontSize: 11,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 1.4,
  },
  
  // Certificate details
  detailsSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    paddingHorizontal: 60,
  },
  
  detailBox: {
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    minWidth: 150,
  },
  
  detailLabel: {
    fontSize: 10,
    color: '#64748b',
    marginBottom: 5,
    fontWeight: 'bold',
  },
  
  detailValue: {
    fontSize: 12,
    color: '#1e293b',
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
  },
  
  // Decorative elements
  leftDecoration: {
    position: 'absolute',
    left: 50,
    top: 200,
    opacity: 0.1,
  },
  
  rightDecoration: {
    position: 'absolute',
    right: 50,
    top: 200,
    opacity: 0.1,
  },
  
  // Footer with elegant spacing
  footer: {
    position: 'absolute',
    bottom: 70,
    left: 60,
    right: 60,
    alignItems: 'center',
  },
  
  disclaimer: {
    fontSize: 9,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 1.4,
    fontStyle: 'italic',
    maxWidth: 600,
  },
});

// Decorative SVG component
const DecorationSvg = () => (
  React.createElement(Svg, { width: 60, height: 60, viewBox: "0 0 60 60" },
    React.createElement(Defs, {},
      React.createElement(LinearGradient, { id: "grad1", x1: "0%", y1: "0%", x2: "100%", y2: "100%" },
        React.createElement(Stop, { offset: "0%", stopColor: "#f51042", stopOpacity: 0.8 }),
        React.createElement(Stop, { offset: "100%", stopColor: "#f51042", stopOpacity: 0.3 })
      )
    ),
    React.createElement(Circle, { cx: 30, cy: 30, r: 25, fill: "url(#grad1)" }),
    React.createElement(Circle, { cx: 30, cy: 30, r: 15, fill: "none", stroke: "#f51042", strokeWidth: 2, opacity: 0.6 }),
    React.createElement(Circle, { cx: 30, cy: 30, r: 8, fill: "#f51042", opacity: 0.4 })
  )
);

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
      
      // Decorative borders
      React.createElement(View, { style: styles.decorativeBorder }),
      React.createElement(View, { style: styles.innerBorder }),
      
      // Left decorative element
      React.createElement(View, { style: styles.leftDecoration },
        React.createElement(DecorationSvg)
      ),
      
      // Right decorative element  
      React.createElement(View, { style: styles.rightDecoration },
        React.createElement(DecorationSvg)
      ),
      
      // Header with centered logo
      React.createElement(View, { style: styles.header },
        React.createElement(Image, { style: styles.logo, src: logoPath })
      ),

      // Certificate Content
      React.createElement(View, { style: styles.certificateContainer },
        // Modern certificate title
        React.createElement(View, { style: styles.certificateTitle },
          React.createElement(Text, { style: styles.titleText }, 'Certificate of Completion'),
          React.createElement(Text, { style: styles.subtitleText }, 'Food Safety Training Program')
        ),

        // Verification section
        React.createElement(View, { style: styles.verificationSection },
          React.createElement(Text, { style: styles.verificationText }, 'This is to certify that'),
          React.createElement(Text, { style: styles.recipientName }, certificateData.userName),
          React.createElement(Text, { style: styles.completionText }, 
            'has successfully completed the comprehensive Local Cooks Food Safety Video Training Series, demonstrating dedication to professional culinary safety standards and best practices.'
          )
        ),

        // Training standards section
        React.createElement(View, { style: styles.standardsSection },
          React.createElement(Text, { style: styles.modulesHeader }, 'Food Safety Standards Mastered'),
          React.createElement(Text, { style: styles.safetyStandards }, 
            'HACCP Principles • Personal Hygiene Protocols • Temperature Control Systems • Cross-Contamination Prevention • Food Storage Standards • Sanitation Procedures • Equipment Maintenance • Health & Safety Compliance'
          )
        )
      ),

      // Certificate details
      React.createElement(View, { style: styles.detailsSection },
        React.createElement(View, { style: styles.detailBox },
          React.createElement(Text, { style: styles.detailLabel }, 'COMPLETION DATE'),
          React.createElement(Text, { style: styles.detailValue }, formattedDate)
        ),
        React.createElement(View, { style: styles.detailBox },
          React.createElement(Text, { style: styles.detailLabel }, 'CERTIFICATE ID'),
          React.createElement(Text, { style: styles.detailValue }, certificateData.certificateId)
        )
      ),

      // Footer
      React.createElement(View, { style: styles.footer },
        React.createElement(Text, { style: styles.disclaimer }, 
          'This certificate acknowledges the completion of educational training materials provided by Local Cooks Community and serves as a record of professional development in food safety practices.'
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

