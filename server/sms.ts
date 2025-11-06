import twilio from 'twilio';

// SMS configuration
const getSMSConfig = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn('⚠️ Twilio configuration is missing. SMS functionality will be disabled.');
    return null;
  }

  return {
    accountSid,
    authToken,
    fromNumber,
  };
};

// Format phone number to E.164 format (required by Twilio)
export const formatPhoneNumber = (phone: string): string | null => {
  if (!phone) return null;
  
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');
  
  // If it starts with 1 and has 11 digits, it's already in US format
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }
  
  // If it has 10 digits, assume US number and add +1
  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }
  
  // If it already starts with +, return as is (assuming it's valid)
  if (phone.startsWith('+')) {
    return phone;
  }
  
  // If we can't format it, return null
  console.warn(`⚠️ Could not format phone number: ${phone}`);
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
      console.warn('⚠️ SMS not sent - Twilio configuration missing');
      return false;
    }

    // Format phone number
    const formattedPhone = formatPhoneNumber(to);
    
    if (!formattedPhone) {
      console.error(`❌ SMS not sent - Invalid phone number: ${to}`);
      return false;
    }

    // Initialize Twilio client
    const client = twilio(config.accountSid, config.authToken);

    // Send SMS
    const messageResult = await client.messages.create({
      body: message,
      from: config.fromNumber,
      to: formattedPhone,
    });

    const duration = Date.now() - startTime;
    
    console.log(`✅ SMS sent successfully:`, {
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
    
    console.error(`❌ SMS sending failed:`, {
      to,
      error: errorMessage,
      duration: `${duration}ms`,
      trackingId: options?.trackingId || `auto_${Date.now()}`,
      timestamp: new Date().toISOString(),
    });

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

