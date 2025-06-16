// Uniform email styles using brand colors and assets
export const getUniformEmailStyles = () => `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Lobster&display=swap');
  
  body { 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
    line-height: 1.6; 
    color: #475569; 
    margin: 0; 
    padding: 0; 
    background: #f1f5f9;
  }
  .email-container { 
    max-width: 600px; 
    margin: 0 auto; 
    background: white; 
    border-radius: 12px; 
    overflow: hidden; 
    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  }
  .header { 
    background: linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%); 
    color: white; 
    padding: 32px 24px; 
    text-align: center; 
  }
  .logo-container {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .logo-image {
    height: 40px;
    width: auto;
  }
  .logo-text {
    font-family: 'Lobster', cursive;
    font-size: 32px;
    font-weight: normal;
    margin: 0;
    letter-spacing: -0.5px;
    color: white;
  }
  .content { 
    padding: 40px 32px; 
  }
  .greeting {
    font-size: 24px;
    font-weight: 600;
    color: #1e293b;
    margin: 0 0 16px 0;
  }
  .message {
    font-size: 16px;
    line-height: 1.6;
    color: #475569;
    margin: 0 0 24px 0;
  }
  .status-badge { 
    display: inline-block; 
    padding: 12px 20px; 
    background: linear-gradient(135deg, #fef7f7 0%, #fecaca 100%); 
    color: hsl(347, 91%, 51%); 
    border: 1px solid hsl(347, 91%, 70%);
    border-radius: 8px; 
    font-weight: 600; 
    margin: 16px 0; 
  }
  .status-badge.approved {
    background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
    color: #16a34a;
    border-color: #bbf7d0;
  }
  .status-badge.rejected {
    background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
    color: #dc2626;
    border-color: #fecaca;
  }
  .cta-button { 
    display: inline-block; 
    padding: 14px 28px; 
    background: linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%); 
    color: white !important; 
    text-decoration: none; 
    border-radius: 8px; 
    font-weight: 600;
    margin: 24px 0;
    box-shadow: 0 2px 8px hsla(347, 91%, 51%, 0.3);
    mso-hide: none;
    mso-text-raise: 0;
  }
  .info-box {
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 20px;
    margin: 24px 0;
  }
  .credentials-table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
  }
  .credentials-table td {
    padding: 12px 16px;
    background: #fff;
    border: 1px solid #e2e8f0;
  }
  .credentials-table td:first-child {
    font-weight: 600;
    color: hsl(347, 91%, 51%);
    background: #f8fafc;
  }
  .credentials-table code {
    font-family: 'Courier New', monospace;
    font-size: 14px;
    color: #1e293b;
    font-weight: 600;
  }
  .footer { 
    background: #f8fafc; 
    padding: 24px 32px; 
    text-align: center; 
    border-top: 1px solid #e2e8f0;
  }
  .footer-text {
    font-size: 14px;
    color: #64748b;
    margin: 0 0 8px 0;
  }
  .footer-links {
    font-size: 13px;
    color: #94a3b8;
  }
  .footer-links a { 
    color: hsl(347, 91%, 51%); 
    text-decoration: none;
  }
  .divider {
    height: 1px;
    background: linear-gradient(90deg, transparent 0%, #e2e8f0 50%, transparent 100%);
    margin: 24px 0;
  }
  .warning-box {
    background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
    border: 1px solid #f59e0b;
    border-radius: 8px;
    padding: 16px;
    margin: 16px 0;
  }
  .warning-text {
    font-size: 14px;
    color: #92400e;
    margin: 0;
  }
  a { color: hsl(347, 91%, 51%); text-decoration: underline; }
</style>`; 