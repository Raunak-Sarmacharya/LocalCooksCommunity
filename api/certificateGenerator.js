import ReactPDF, { Document, Font, Image, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register custom font and logo paths
const currentDir = __dirname;
const lobsterFontPath = path.join(currentDir, '..', 'attached_assets', 'Lobster-Regular.ttf');
const logoPath = path.join(currentDir, '..', 'attached_assets', 'Logo_LocalCooks.png');

// Verify logo exists and convert to base64 for reliable embedding
let logoBase64 = null;
try {
  if (fs.existsSync(logoPath)) {
    const logoBuffer = fs.readFileSync(logoPath);
    logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
    console.log('✅ Logo loaded successfully for certificate generation');
  } else {
    console.error('❌ Logo file not found at:', logoPath);
  }
} catch (error) {
  console.error('❌ Error loading logo:', error);
}

try {
  Font.register({
    family: 'Lobster',
    src: lobsterFontPath,
  });
} catch (error) {
  console.log('Lobster font not found, using default');
}

// Modern, clean styles with wavy background elements - SINGLE PAGE with bigger bubbles and wider text
const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    padding: 20,
    fontFamily: 'Helvetica',
    position: 'relative',
  },
  
  // Background wave elements - positioned behind content
  backgroundWaves: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
    zIndex: 0,
  },
  
  // Much bigger bubbles positioned ONLY in safe zones away from all text
  bubble1: {
    position: 'absolute',
    width: 35,
    height: 35,
    borderRadius: 17.5,
    top: 20,
    left: 15,
    backgroundColor: '#e2e8f0',
    opacity: 0.7,
    zIndex: 1,
  },
  
  bubble2: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    top: 70,
    right: 15,
    backgroundColor: '#fecaca',
    opacity: 0.5,
    zIndex: 1,
  },
  
  bubble3: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    top: 450,
    left: 20,
    backgroundColor: '#cbd5e1',
    opacity: 0.6,
    zIndex: 1,
  },
  
  bubble4: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    top: 30,
    right: 50,
    backgroundColor: '#f1f5f9',
    opacity: 0.8,
    zIndex: 1,
  },
  
  bubble5: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    top: 430,
    right: 15,
    backgroundColor: '#fecaca',
    opacity: 0.4,
    zIndex: 1,
  },
  
  bubble6: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    top: 380,
    left: 15,
    backgroundColor: '#e2e8f0',
    opacity: 0.6,
    zIndex: 1,
  },
  
  bubble7: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    top: 480,
    left: 50,
    backgroundColor: '#cbd5e1',
    opacity: 0.5,
    zIndex: 1,
  },
  
  bubble8: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    top: 460,
    right: 50,
    backgroundColor: '#f8fafc',
    opacity: 0.7,
    zIndex: 1,
  },
  
  // Additional bubbles for coverage in safe edge zones only
  bubble9: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    top: 120,
    left: 10,
    backgroundColor: '#e2e8f0',
    opacity: 0.5,
    zIndex: 1,
  },
  
  bubble10: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    top: 350,
    right: 20,
    backgroundColor: '#fecaca',
    opacity: 0.6,
    zIndex: 1,
  },
  
  bubble11: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    top: 500,
    right: 30,
    backgroundColor: '#cbd5e1',
    opacity: 0.4,
    zIndex: 1,
  },
  
  bubble12: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    top: 420,
    left: 60,
    backgroundColor: '#f1f5f9',
    opacity: 0.7,
    zIndex: 1,
  },
  
  // Additional bubbles for better coverage in edge areas only
  bubble13: {
    position: 'absolute',
    width: 25,
    height: 25,
    borderRadius: 12.5,
    top: 180,
    right: 10,
    backgroundColor: '#e2e8f0',
    opacity: 0.6,
    zIndex: 1,
  },
  
  bubble14: {
    position: 'absolute',
    width: 33,
    height: 33,
    borderRadius: 16.5,
    top: 320,
    left: 10,
    backgroundColor: '#fecaca',
    opacity: 0.5,
    zIndex: 1,
  },
  
  bubble15: {
    position: 'absolute',
    width: 21,
    height: 21,
    borderRadius: 10.5,
    top: 520,
    left: 80,
    backgroundColor: '#cbd5e1',
    opacity: 0.7,
    zIndex: 1,
  },
  
  bubble16: {
    position: 'absolute',
    width: 27,
    height: 27,
    borderRadius: 13.5,
    top: 250,
    right: 12,
    backgroundColor: '#f1f5f9',
    opacity: 0.6,
    zIndex: 1,
  },
  
  // Content container - much wider layout with high z-index
  content: {
    paddingTop: 15,
    paddingHorizontal: 25,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    zIndex: 100,
    width: '100%',
  },
  
  // Logo section
  logoSection: {
    alignItems: 'center',
    marginBottom: 15,
  },
  
  logo: {
    width: 90,
    height: 90,
  },
  
  // Certificate content - much wider to prevent word wrapping
  certificationText: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 6,
    fontStyle: 'italic',
    maxWidth: 650,
    width: '100%',
  },
  
  recipientName: {
    fontSize: 22,
    color: '#1e293b',
    textAlign: 'center',
    marginBottom: 6,
    fontFamily: 'Lobster',
    maxWidth: 650,
    width: '100%',
  },
  
  nameUnderline: {
    width: 150,
    height: 2,
    backgroundColor: '#f51042',
    marginBottom: 8,
    borderRadius: 2,
  },
  
  completionDescription: {
    fontSize: 10,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 1.3,
    maxWidth: 680,
    width: '90%',
    paddingHorizontal: 6,
  },
  
  // Standards section - much wider
  standardsBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    border: '1px solid #e2e8f0',
    width: 650,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    alignItems: 'center',
  },
  
  standardsTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#f51042',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  
  standardsList: {
    fontSize: 8,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 1.2,
    paddingHorizontal: 10,
    maxWidth: 600,
  },
  
  // Details section - wider spacing for cut-off fix
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: 30,
    marginBottom: 18,
    width: 650,
    gap: 30,
  },
  
  detailItem: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    padding: 12,
    minWidth: 200,
    flex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
  },
  
  detailLabel: {
    fontSize: 9,
    color: '#64748b',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
    letterSpacing: 0,
    textAlign: 'center',
    maxWidth: '100%',
    width: '100%',
  },
  
  detailValue: {
    fontSize: 11,
    color: '#1e293b',
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    maxWidth: '100%',
    width: '100%',
  },
  
  // Footer - much further down with large spacing
  footer: {
    marginTop: 50,
    alignItems: 'center',
    zIndex: 100,
    paddingHorizontal: 25,
    position: 'relative',
  },
  
  disclaimer: {
    fontSize: 6.5,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 1.2,
    fontStyle: 'italic',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 8,
    borderRadius: 6,
    maxWidth: 600,
    border: '1px solid #e2e8f0',
  },
});

// Modern Wave Background Component - more visible waves
const WaveBackground = () => {
  return React.createElement(View, { style: styles.backgroundWaves },
    // First wave layer - more visible
    React.createElement(Svg, { 
      style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 90 },
      viewBox: "0 0 800 90",
      preserveAspectRatio: "none"
    },
      React.createElement(Path, {
        d: "M0,45 C200,15 400,75 800,30 L800,90 L0,90 Z",
        fill: "#e2e8f0",
        opacity: 0.8
      })
    ),
    
    // Second wave layer - more prominent
    React.createElement(Svg, { 
      style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 60 },
      viewBox: "0 0 800 60",
      preserveAspectRatio: "none"
    },
      React.createElement(Path, {
        d: "M0,30 C150,8 350,52 800,15 L800,60 L0,60 Z",
        fill: "#cbd5e1",
        opacity: 0.9
      })
    ),
    
    // Third wave layer - brand color accent, more visible
    React.createElement(Svg, { 
      style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 30 },
      viewBox: "0 0 800 30",
      preserveAspectRatio: "none"
    },
      React.createElement(Path, {
        d: "M0,15 C200,4 600,26 800,8 L800,30 L0,30 Z",
        fill: "#fecaca",
        opacity: 0.6
      })
    )
  );
};

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
      
      // Modern wave background
      React.createElement(WaveBackground),
      
      // Bubbles spread across the ENTIRE certificate - top, middle, bottom!
      React.createElement(View, { style: styles.bubble1 }),
      React.createElement(View, { style: styles.bubble2 }),
      React.createElement(View, { style: styles.bubble3 }),
      React.createElement(View, { style: styles.bubble4 }),
      React.createElement(View, { style: styles.bubble5 }),
      React.createElement(View, { style: styles.bubble6 }),
      React.createElement(View, { style: styles.bubble7 }),
      React.createElement(View, { style: styles.bubble8 }),
      React.createElement(View, { style: styles.bubble9 }),
      React.createElement(View, { style: styles.bubble10 }),
      React.createElement(View, { style: styles.bubble11 }),
      React.createElement(View, { style: styles.bubble12 }),
      React.createElement(View, { style: styles.bubble13 }),
      React.createElement(View, { style: styles.bubble14 }),
      React.createElement(View, { style: styles.bubble15 }),
      React.createElement(View, { style: styles.bubble16 }),
      
      // Main content
      React.createElement(View, { style: styles.content },
        
        // Logo as main header - no title text needed
        React.createElement(View, { style: styles.logoSection },
          logoBase64 ? React.createElement(Image, { style: styles.logo, src: logoBase64 }) :
          React.createElement(Text, { style: { fontSize: 16, color: '#f51042', textAlign: 'center' } }, 'LOCAL COOKS')
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

