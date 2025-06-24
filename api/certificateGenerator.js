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

// Create modern styles for the certificate - optimized for single page
const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    padding: 25,
    fontFamily: 'Helvetica',
    position: 'relative',
  },
  
  // Elegant outer border with gradient effect
  decorativeBorder: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 20,
    background: 'linear-gradient(45deg, #f51042, #e91e63, #f51042)',
    border: '4px solid #f51042',
  },
  
  // Subtle inner frame
  innerFrame: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    bottom: 20,
    backgroundColor: '#ffffff',
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  
  // Elegant background pattern
  backgroundPattern: {
    position: 'absolute',
    top: 30,
    left: 30,
    right: 30,
    bottom: 30,
    opacity: 0.03,
  },
  
  // Header with centered logo
  header: {
    alignItems: 'center',
    marginBottom: 18,
    marginTop: 20,
    position: 'relative',
    zIndex: 10,
  },
  
  logo: {
    width: 65,
    height: 65,
    marginBottom: 8,
    borderRadius: 32.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  
  // Main content container
  certificateContainer: {
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 35,
    position: 'relative',
    zIndex: 10,
  },
  
  // Modern gradient certificate title
  certificateTitle: {
    borderRadius: 25,
    paddingVertical: 16,
    paddingHorizontal: 35,
    marginBottom: 18,
    width: 380,
    alignItems: 'center',
    backgroundColor: '#f51042',
    shadowColor: '#f51042',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  
  titleText: {
    color: 'white',
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 2,
    letterSpacing: 1,
  },
  
  subtitleText: {
    color: 'white',
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.95,
    fontWeight: '300',
  },
  
  // Elegant verification section with improved typography
  verificationSection: {
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  
  verificationText: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 8,
    fontStyle: 'italic',
    letterSpacing: 0.5,
  },
  
  // Enhanced recipient name with elegant styling
  recipientNameContainer: {
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  
  recipientName: {
    fontSize: 30,
    color: '#1e293b',
    textAlign: 'center',
    fontFamily: 'Lobster',
    marginBottom: 8,
    paddingHorizontal: 25,
  },
  
  nameUnderline: {
    width: 200,
    height: 3,
    backgroundColor: '#f51042',
    borderRadius: 2,
    marginBottom: 12,
  },
  
  completionText: {
    fontSize: 11.5,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 1.5,
    maxWidth: 480,
    fontWeight: '400',
  },
  
  // Enhanced training standards section
  standardsSection: {
    backgroundColor: '#f8fafc',
    borderRadius: 15,
    padding: 16,
    marginBottom: 16,
    border: '2px solid #e2e8f0',
    width: 480,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  
  modulesHeader: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#f51042',
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.5,
  },
  
  safetyStandards: {
    fontSize: 10,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 1.4,
    fontWeight: '400',
  },
  
  // Elegant certificate details section
  detailsSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingHorizontal: 45,
  },
  
  detailBox: {
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    border: '2px solid #f1f5f9',
    minWidth: 150,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  
  detailLabel: {
    fontSize: 9,
    color: '#64748b',
    marginBottom: 5,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.8,
  },
  
  detailValue: {
    fontSize: 11.5,
    color: '#1e293b',
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
  },
  
  // Refined footer
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 45,
    right: 45,
    alignItems: 'center',
    zIndex: 10,
  },
  
  disclaimer: {
    fontSize: 8.5,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 1.4,
    fontStyle: 'italic',
    maxWidth: 580,
    opacity: 0.8,
  },
});

// Elegant decorative SVG background pattern
const BackgroundPattern = () => (
  React.createElement(Svg, { width: "100%", height: "100%", viewBox: "0 0 800 600" },
    React.createElement(Defs, {},
      React.createElement(LinearGradient, { id: "bgGrad", x1: "0%", y1: "0%", x2: "100%", y2: "100%" },
        React.createElement(Stop, { offset: "0%", stopColor: "#f51042", stopOpacity: 0.03 }),
        React.createElement(Stop, { offset: "50%", stopColor: "#e91e63", stopOpacity: 0.02 }),
        React.createElement(Stop, { offset: "100%", stopColor: "#f51042", stopOpacity: 0.03 })
      )
    ),
    // Subtle geometric pattern
    React.createElement(Circle, { cx: 100, cy: 100, r: 40, fill: "url(#bgGrad)" }),
    React.createElement(Circle, { cx: 700, cy: 120, r: 30, fill: "url(#bgGrad)" }),
    React.createElement(Circle, { cx: 150, cy: 450, r: 35, fill: "url(#bgGrad)" }),
    React.createElement(Circle, { cx: 650, cy: 480, r: 25, fill: "url(#bgGrad)" }),
    React.createElement(Rect, { x: 50, y: 250, width: 60, height: 60, rx: 30, fill: "url(#bgGrad)", transform: "rotate(45 80 280)" }),
    React.createElement(Rect, { x: 680, y: 280, width: 50, height: 50, rx: 25, fill: "url(#bgGrad)", transform: "rotate(45 705 305)" })
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
      
      // Elegant border frame
      React.createElement(View, { style: styles.decorativeBorder }),
      React.createElement(View, { style: styles.innerFrame }),
      
      // Subtle background pattern
      React.createElement(View, { style: styles.backgroundPattern },
        React.createElement(BackgroundPattern)
      ),
      
      // Header with centered logo
      React.createElement(View, { style: styles.header },
        React.createElement(Image, { style: styles.logo, src: logoPath })
      ),

      // Certificate Content
      React.createElement(View, { style: styles.certificateContainer },
        // Modern gradient certificate title
        React.createElement(View, { style: styles.certificateTitle },
          React.createElement(Text, { style: styles.titleText }, 'Certificate of Completion'),
          React.createElement(Text, { style: styles.subtitleText }, 'Local Cooks Food Safety Training Program')
        ),

        // Elegant verification section
        React.createElement(View, { style: styles.verificationSection },
          React.createElement(Text, { style: styles.verificationText }, 'This is to certify that')
        ),
        
        // Enhanced recipient name section
        React.createElement(View, { style: styles.recipientNameContainer },
          React.createElement(Text, { style: styles.recipientName }, certificateData.userName),
          React.createElement(View, { style: styles.nameUnderline }),
          React.createElement(Text, { style: styles.completionText }, 
            'has successfully completed the comprehensive Local Cooks Food Safety Video Training Series, demonstrating dedication to professional culinary safety standards and best practices.'
          )
        ),

        // Enhanced training standards section
        React.createElement(View, { style: styles.standardsSection },
          React.createElement(Text, { style: styles.modulesHeader }, 'Food Safety Standards Mastered'),
          React.createElement(Text, { style: styles.safetyStandards }, 
            'HACCP Principles • Personal Hygiene Protocols • Temperature Control Systems • Cross-Contamination Prevention • Food Storage Standards • Sanitation Procedures • Equipment Maintenance • Health & Safety Compliance'
          )
        )
      ),

      // Elegant certificate details
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

      // Refined footer with clear disclaimer
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

