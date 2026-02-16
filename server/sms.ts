import { logger } from "./logger";
import twilio from 'twilio';

// SMS configuration
const getSMSConfig = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  // Detailed logging for missing configuration
  if (!accountSid || !authToken || !fromNumber) {
    const missing = [];
    if (!accountSid) missing.push('TWILIO_ACCOUNT_SID');
    if (!authToken) missing.push('TWILIO_AUTH_TOKEN');
    if (!fromNumber) missing.push('TWILIO_PHONE_NUMBER');
    
    logger.warn('⚠️ Twilio configuration is missing. SMS functionality will be disabled.');
    logger.warn(`   Missing variables: ${missing.join(', ')}`);
    logger.warn('   Please set these environment variables to enable SMS functionality.');
    return null;
  }

  // Validate format of Twilio phone number (should be E.164 format)
  // For Canada: +1NXXNXXXXXX (e.g., +14161234567)
  // For US: +1NXXNXXXXXX (e.g., +12125551234)
  if (!fromNumber.startsWith('+')) {
    logger.warn(`⚠️ TWILIO_PHONE_NUMBER should be in E.164 format (e.g., +14161234567 for Canada, +12125551234 for US). Current value: ${fromNumber}`);
  }
  
  // Check if it's a Canadian number (starts with +1 and area code 2-9)
  if (fromNumber.startsWith('+1') && fromNumber.length === 12) {
    const areaCode = fromNumber.substring(2, 5);
    const firstDigit = parseInt(areaCode[0]);
    if (firstDigit >= 2 && firstDigit <= 9) {
      logger.info(`✅ Twilio phone number detected as North American (US/Canada): ${fromNumber}`);
    }
  }

  return {
    accountSid,
    authToken,
    fromNumber,
  };
};

// Format phone number to E.164 format (required by Twilio)
// Supports US and Canadian numbers (both use country code +1)
export const formatPhoneNumber = (phone: string | null | undefined): string | null => {
  if (!phone) return null;
  
  // Trim whitespace
  const trimmed = phone.trim();
  if (!trimmed) return null;
  
  // Remove all non-digit characters except +
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  
  // If it already starts with +, validate and return
  if (cleaned.startsWith('+')) {
    // E.164 format: + followed by 1-15 digits
    const digitsAfterPlus = cleaned.substring(1);
    if (digitsAfterPlus.length >= 1 && digitsAfterPlus.length <= 15 && /^\d+$/.test(digitsAfterPlus)) {
      return cleaned;
    }
    logger.warn(`⚠️ Invalid E.164 format (must be + followed by 1-15 digits): ${phone}`);
    return null;
  }
  
  // Remove all non-digit characters
  const digitsOnly = cleaned.replace(/\D/g, '');
  
  // If it starts with 1 and has 11 digits, it's already in North American format (US/Canada)
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }
  
  // If it has 10 digits, assume North American number (US/Canada) and add +1
  // Canadian numbers: +1NXXNXXXXXX (10 digits after +1)
  // US numbers: +1NXXNXXXXXX (10 digits after +1)
  if (digitsOnly.length === 10) {
    // Validate that it's a valid North American number format
    // First digit should be 2-9 (area code), fourth digit should be 2-9 (exchange code)
    const areaCode = digitsOnly.substring(0, 3);
    const exchangeCode = digitsOnly.substring(3, 6);
    const firstDigit = parseInt(digitsOnly[0]);
    const fourthDigit = parseInt(digitsOnly[3]);
    
    if (firstDigit >= 2 && firstDigit <= 9 && fourthDigit >= 2 && fourthDigit <= 9) {
      return `+1${digitsOnly}`;
    } else {
      logger.warn(`⚠️ Invalid North American phone number format: ${phone}`);
      logger.warn('   Area code and exchange code must start with digits 2-9');
      return null;
    }
  }
  
  // If we can't format it, return null
  logger.warn(`⚠️ Could not format phone number: ${phone} (digits only: ${digitsOnly}, length: ${digitsOnly.length})`);
  logger.warn('   Phone numbers should be in E.164 format (e.g., +14161234567 for Canada, +12125551234 for US)');
  logger.warn('   Or 10-digit North American numbers (e.g., 4161234567 for Canada, 2125551234 for US)');
  return null;
};

// Send SMS function
export const sendSMS = async (
  to: string,
  message: string,
  options?: { trackingId?: string }
): Promise<boolean> => {
  const startTime = Date.now();
  
  try {
    const config = getSMSConfig();
    
    if (!config) {
      logger.warn('⚠️ SMS not sent - Twilio configuration missing');
      return false;
    }

    // Format phone number
    const formattedPhone = formatPhoneNumber(to);
    
    if (!formattedPhone) {
      logger.error(`❌ SMS not sent - Invalid phone number: ${to}`);
      logger.error('   Phone numbers should be in E.164 format (e.g., +14161234567 for Canada, +12125551234 for US)');
      logger.error('   Or 10-digit North American numbers (e.g., 4161234567 for Canada, 2125551234 for US)');
      return false;
    }

    // Validate message length (Twilio has a 1600 character limit for single SMS)
    if (message.length > 1600) {
      logger.warn(`⚠️ SMS message is ${message.length} characters (limit: 1600). Message will be split into multiple parts.`);
    }

    // Initialize Twilio client
    const client = twilio(config.accountSid, config.authToken);

    // Validate from number format
    const formattedFrom = formatPhoneNumber(config.fromNumber);
    if (!formattedFrom) {
      logger.error(`❌ SMS not sent - Invalid TWILIO_PHONE_NUMBER format: ${config.fromNumber}`);
      logger.error('   TWILIO_PHONE_NUMBER must be in E.164 format (e.g., +1234567890)');
      return false;
    }

    // Send SMS
    const messageResult = await client.messages.create({
      body: message,
      from: formattedFrom, // Use formatted from number
      to: formattedPhone,
    });

    const duration = Date.now() - startTime;
    
    logger.info(`✅ SMS sent successfully:`, {
      to: formattedPhone,
      messageSid: messageResult.sid,
      status: messageResult.status,
      duration: `${duration}ms`,
      trackingId: options?.trackingId || `auto_${Date.now()}`,
      timestamp: new Date().toISOString(),
    });

    return true;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Enhanced error logging with Twilio-specific error details
    const errorDetails: any = {
      to,
      formattedTo: formatPhoneNumber(to),
      error: errorMessage,
      duration: `${duration}ms`,
      trackingId: options?.trackingId || `auto_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };

    // Extract Twilio-specific error information if available
    if (error && typeof error === 'object' && 'code' in error) {
      errorDetails.twilioCode = (error as any).code;
      errorDetails.twilioMessage = (error as any).message;
      errorDetails.twilioStatus = (error as any).status;
      errorDetails.twilioMoreInfo = (error as any).moreInfo;
    }

    logger.error(`❌ SMS sending failed:`, errorDetails);

    // Log specific Twilio error codes for easier debugging
    if (error && typeof error === 'object' && 'code' in error) {
      const twilioCode = (error as any).code;
      switch (twilioCode) {
        case 21211:
          logger.error('   → Invalid phone number format. Ensure phone numbers are in E.164 format (e.g., +1234567890)');
          break;
        case 21212:
          logger.error('   → Invalid phone number. The number provided is not a valid phone number.');
          break;
        case 21408:
          logger.error('   → Permission denied. Check your Twilio account permissions.');
          break;
        case 21608:
          logger.error('   → Unsubscribed recipient. The recipient has opted out of receiving messages.');
          break;
        case 21610:
          logger.error('   → Invalid "from" phone number. Check TWILIO_PHONE_NUMBER is correct and verified in Twilio.');
          break;
        case 21614:
          logger.error('   → "To" number is not a valid mobile number.');
          break;
        case 30003:
          logger.error('   → Unreachable destination. The phone number may be invalid or unreachable.');
          break;
        case 30004:
          logger.error('   → Message blocked. The message may be blocked by carrier or Twilio.');
          break;
        case 30005:
          logger.error('   → Unknown destination. The destination number is not recognized.');
          break;
        case 30006:
          logger.error('   → Landline or unreachable. The number may be a landline that cannot receive SMS.');
          break;
        default:
          logger.error(`   → Twilio error code: ${twilioCode}. Check Twilio documentation for details.`);
      }
    }

    // Don't throw - return false to allow operations to continue
    return false;
  }
};

// SMS message templates for booking notifications

// Manager notification when chef creates booking
export const generateManagerBookingSMS = (data: {
  chefName: string;
  kitchenName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
}): string => {
  const date = new Date(data.bookingDate).toLocaleDateString();
  return `New kitchen booking from ${data.chefName}:\n\nKitchen: ${data.kitchenName}\nDate: ${date}\nTime: ${data.startTime} - ${data.endTime}\n\nPlease check your dashboard to confirm or manage this booking.\n\nWe've also sent you an email. If not found, please check your spam folder.`;
};

// Manager notification when portal user creates booking
export const generateManagerPortalBookingSMS = (data: {
  portalUserName: string;
  kitchenName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
}): string => {
  const date = new Date(data.bookingDate).toLocaleDateString();
  return `New kitchen booking from portal user ${data.portalUserName}:\n\nKitchen: ${data.kitchenName}\nDate: ${date}\nTime: ${data.startTime} - ${data.endTime}\n\nPlease check your dashboard to confirm or manage this booking.\n\nWe've also sent you an email. If not found, please check your spam folder.`;
};

// Chef confirmation SMS when manager confirms booking
export const generateChefBookingConfirmationSMS = (data: {
  kitchenName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
}): string => {
  const date = new Date(data.bookingDate).toLocaleDateString();
  return `Your kitchen booking has been confirmed!\n\nKitchen: ${data.kitchenName}\nDate: ${date}\nTime: ${data.startTime} - ${data.endTime}\n\nSee you there!\n\nWe've also sent you an email. If not found, please check your spam folder.`;
};

// Chef cancellation SMS when manager cancels booking
export const generateChefBookingCancellationSMS = (data: {
  kitchenName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  reason?: string;
}): string => {
  const date = new Date(data.bookingDate).toLocaleDateString();
  const reasonText = data.reason ? `\nReason: ${data.reason}` : '';
  return `Your kitchen booking has been cancelled.\n\nKitchen: ${data.kitchenName}\nDate: ${date}\nTime: ${data.startTime} - ${data.endTime}${reasonText}\n\nPlease contact the manager if you have questions.\n\nWe've also sent you an email. If not found, please check your spam folder.`;
};

// Portal user confirmation SMS when manager confirms booking
export const generatePortalUserBookingConfirmationSMS = (data: {
  kitchenName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
}): string => {
  const date = new Date(data.bookingDate).toLocaleDateString();
  return `Your kitchen booking has been confirmed!\n\nKitchen: ${data.kitchenName}\nDate: ${date}\nTime: ${data.startTime} - ${data.endTime}\n\nSee you there!\n\nWe've also sent you an email. If not found, please check your spam folder.`;
};

// Portal user cancellation SMS when manager cancels booking
export const generatePortalUserBookingCancellationSMS = (data: {
  kitchenName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  reason?: string;
}): string => {
  const date = new Date(data.bookingDate).toLocaleDateString();
  const reasonText = data.reason ? `\nReason: ${data.reason}` : '';
  return `Your kitchen booking has been cancelled.\n\nKitchen: ${data.kitchenName}\nDate: ${date}\nTime: ${data.startTime} - ${data.endTime}${reasonText}\n\nPlease contact the manager if you have questions.\n\nWe've also sent you an email. If not found, please check your spam folder.`;
};

// Manager notification when chef cancels booking
export const generateManagerBookingCancellationSMS = (data: {
  chefName: string;
  kitchenName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
}): string => {
  const date = new Date(data.bookingDate).toLocaleDateString();
  return `Chef ${data.chefName} has cancelled their booking:\n\nKitchen: ${data.kitchenName}\nDate: ${date}\nTime: ${data.startTime} - ${data.endTime}\n\nPlease check your dashboard for details.\n\nWe've also sent you an email. If not found, please check your spam folder.`;
};

// Chef cancellation confirmation SMS (when chef cancels their own booking)
export const generateChefSelfCancellationSMS = (data: {
  kitchenName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
}): string => {
  const date = new Date(data.bookingDate).toLocaleDateString();
  return `Your kitchen booking has been cancelled:\n\nKitchen: ${data.kitchenName}\nDate: ${date}\nTime: ${data.startTime} - ${data.endTime}\n\nIf you need to book again, please visit the dashboard.\n\nWe've also sent you an email. If not found, please check your spam folder.`;
};

// Test SMS function for debugging
export const testSMS = async (to: string): Promise<{ success: boolean; message: string; details?: any }> => {
  try {
    const config = getSMSConfig();
    
    if (!config) {
      return {
        success: false,
        message: 'Twilio configuration is missing. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER environment variables.',
      };
    }

    const formattedPhone = formatPhoneNumber(to);
    if (!formattedPhone) {
      return {
        success: false,
        message: `Invalid phone number format: ${to}. Phone numbers should be in E.164 format (e.g., +14161234567 for Canada, +12125551234 for US) or 10-digit North American numbers.`,
      };
    }

    const formattedFrom = formatPhoneNumber(config.fromNumber);
    if (!formattedFrom) {
      return {
        success: false,
        message: `Invalid TWILIO_PHONE_NUMBER format: ${config.fromNumber}. Must be in E.164 format (e.g., +1234567890).`,
      };
    }

    const client = twilio(config.accountSid, config.authToken);
    
    // Test message
    const testMessage = 'Test SMS from Local Cooks Community. If you received this, SMS is working correctly!';
    
    const messageResult = await client.messages.create({
      body: testMessage,
      from: formattedFrom,
      to: formattedPhone,
    });

    return {
      success: true,
      message: 'SMS sent successfully!',
      details: {
        messageSid: messageResult.sid,
        status: messageResult.status,
        to: formattedPhone,
        from: formattedFrom,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const details: any = { error: errorMessage };
    
    if (error && typeof error === 'object' && 'code' in error) {
      details.twilioCode = (error as any).code;
      details.twilioMessage = (error as any).message;
      details.twilioStatus = (error as any).status;
    }

    return {
      success: false,
      message: `SMS test failed: ${errorMessage}`,
      details,
    };
  }
};

