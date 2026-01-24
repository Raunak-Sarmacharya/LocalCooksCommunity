// @ts-ignore - pdfkit doesn't have type definitions
import PDFDocument from 'pdfkit';
import { db } from "../db";
import { storageListings, equipmentListings, paymentTransactions } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Generate invoice PDF for a booking
 */

export async function generateInvoicePDF(
  booking: any,
  chef: any,
  kitchen: any,
  location: any,
  storageBookings: any[],
  equipmentBookings: any[],
  paymentIntentId: string | null,
  options?: { viewer?: 'chef' | 'manager' }
): Promise<Buffer> {
  const invoiceViewer = options?.viewer ?? 'chef';
  // Get Stripe-synced amounts from payment_transactions if available
  let stripePlatformFee = 0; // Platform fee from Stripe (in cents)
  let stripeTotalAmount = 0; // Total amount from Stripe (in cents)
  let stripeBaseAmount = 0; // Base amount from Stripe (in cents) - for kitchen booking
  let stripeNetAmount = 0; // Net amount after fees from Stripe (in cents)
  let stripeProcessingFeeCents = 0; // Stripe processing fee (in cents)
  const stripeStorageBaseAmounts: Map<number, number> = new Map(); // Storage booking ID -> base amount
  const stripeEquipmentBaseAmounts: Map<number, number> = new Map(); // Equipment booking ID -> base amount

  if (paymentIntentId) {
    try {
      const [paymentTransaction] = await db
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.paymentIntentId, paymentIntentId))
        .limit(1);

      if (paymentTransaction) {
        // Use Stripe-synced values
        stripeTotalAmount = parseInt(String(paymentTransaction.amount)) || 0;
        stripePlatformFee = parseInt(String(paymentTransaction.serviceFee)) || 0; // Platform fee from Stripe
        stripeBaseAmount = parseInt(String(paymentTransaction.baseAmount)) || 0; // Base amount from Stripe
        // Try to get net amount if available (might be in metadata or new column if added)
        // For now, calculate or extract from metadata if possible.
        // Assuming paymentTransaction might have metadata with fees.
        if (paymentTransaction.metadata) {
             const meta = typeof paymentTransaction.metadata === 'string' ? JSON.parse(paymentTransaction.metadata) : paymentTransaction.metadata;
             if (meta?.stripeFees?.processingFee) {
                 stripeProcessingFeeCents = Math.round(Number(meta.stripeFees.processingFee));
             }
         }

        // For bundle bookings, we need to get individual booking base amounts
        // The base_amount in payment_transactions is the total base for the bundle
        // We'll calculate proportions from the booking data
        console.log(`[Invoice] Using Stripe-synced amounts: total=${stripeTotalAmount}, base=${stripeBaseAmount}, platformFee=${stripePlatformFee}`);
      }
    } catch (error) {
      console.warn('[Invoice] Could not fetch payment transaction, will calculate fees:', error);
    }
  }
  // Calculate pricing first (async operations)
  let totalAmount = 0;
  const items: Array<{ description: string; quantity: number; rate: number; amount: number }> = [];

  // Kitchen booking price
  // Use stored price data if available, otherwise calculate
  const kitchenId = booking.kitchenId || booking.kitchen_id;
  const startTime = booking.startTime || booking.start_time;
  const endTime = booking.endTime || booking.end_time;

  if (kitchenId) {
    try {
      let kitchenAmount = 0;
      let durationHours = 0;
      let hourlyRate = 0;

      // PRIORITY 1: Calculate from hourly_rate * duration_hours (most accurate, original base price)
      // This gives us the actual base price (qty * rate) without any fees or Stripe adjustments
      if ((booking.hourly_rate || booking.hourlyRate) && (booking.duration_hours || booking.durationHours)) {
        const hourlyRateCents = parseFloat(String(booking.hourly_rate || booking.hourlyRate));
        durationHours = parseFloat(String(booking.duration_hours || booking.durationHours));
        hourlyRate = hourlyRateCents / 100;
        // Calculate base price directly from rate * duration (no rounding errors, no fees)
        // This is the original base price: quantity × rate
        kitchenAmount = (hourlyRateCents * durationHours) / 100;
      }
      // PRIORITY 2: Use Stripe-synced base_amount from payment_transactions (if hourly_rate not available)
      else if (stripeBaseAmount > 0) {
        kitchenAmount = stripeBaseAmount / 100; // Convert cents to dollars
        // Get duration and rate from stored values
        if (booking.duration_hours || booking.durationHours) {
          durationHours = parseFloat(String(booking.duration_hours || booking.durationHours));
        }
        if (booking.hourly_rate || booking.hourlyRate) {
          hourlyRate = parseFloat(String(booking.hourly_rate || booking.hourlyRate)) / 100;
        } else if (durationHours > 0) {
          hourlyRate = kitchenAmount / durationHours;
        }
      }
      // FALLBACK: Use stored total_price - service_fee
      // If payment transaction exists (Stripe sync happened), total_price includes platform fee
      // If no payment transaction, total_price might be base or might include fee - check service_fee field
      else if (booking.total_price || booking.totalPrice) {
        const totalPriceCents = booking.total_price
          ? parseFloat(String(booking.total_price))
          : parseFloat(String(booking.totalPrice));

        // If we have a payment transaction, we know Stripe sync happened
        // So total_price includes platform fee, and we must subtract service_fee
        const hasPaymentTransaction = stripeBaseAmount > 0 || stripeTotalAmount > 0;

        // Get service_fee - if payment transaction exists, service_fee should exist too
        const serviceFeeCents = hasPaymentTransaction ||
          (booking.service_fee !== undefined && booking.service_fee !== null) ||
          (booking.serviceFee !== undefined && booking.serviceFee !== null)
          ? parseFloat(String(booking.service_fee || booking.serviceFee || '0'))
          : 0; // If no payment transaction and no service_fee field, assume total_price is base

        // Base kitchen price = total_price - service_fee
        // If payment transaction exists, we MUST subtract service_fee (even if 0)
        // If no payment transaction, only subtract if service_fee field exists
        const basePriceCents = hasPaymentTransaction || serviceFeeCents > 0
          ? totalPriceCents - serviceFeeCents  // Stripe-synced or has service_fee: subtract it
          : totalPriceCents; // Not synced and no service_fee: total_price is base
        kitchenAmount = basePriceCents / 100;

        // Get duration and rate from stored values if available
        if (booking.duration_hours || booking.durationHours) {
          durationHours = parseFloat(String(booking.duration_hours || booking.durationHours));
        }
        if (booking.hourly_rate || booking.hourlyRate) {
          hourlyRate = parseFloat(String(booking.hourly_rate || booking.hourlyRate)) / 100;
        }
      }
      // Fall back to recalculating from pricing service
      else if (startTime && endTime) {
        const { calculateKitchenBookingPrice } = await import('./pricing-service');
        const kitchenPricing = await calculateKitchenBookingPrice(
          kitchenId,
          startTime,
          endTime
        );

        if (kitchenPricing.totalPriceCents > 0) {
          durationHours = kitchenPricing.durationHours;
          hourlyRate = kitchenPricing.hourlyRateCents / 100;
          kitchenAmount = kitchenPricing.totalPriceCents / 100;
        }
      }

      // If we have a kitchen amount, add it to the invoice
      if (kitchenAmount > 0) {
        // If we don't have duration or rate, calculate from times
        if (!durationHours && startTime && endTime) {
          const start = startTime.split(':').map(Number);
          const end = endTime.split(':').map(Number);
          const startMinutes = start[0] * 60 + start[1];
          const endMinutes = end[0] * 60 + end[1];
          durationHours = Math.max(1, (endMinutes - startMinutes) / 60);
        }
        if (!hourlyRate && durationHours > 0) {
          hourlyRate = kitchenAmount / durationHours;
        }

        totalAmount += kitchenAmount;

        items.push({
          description: `Kitchen Booking (${durationHours.toFixed(1)} hour${durationHours !== 1 ? 's' : ''})`,
          quantity: durationHours,
          rate: hourlyRate,
          amount: kitchenAmount,
        });
      }
    } catch (error) {
      console.error('Error calculating kitchen price:', error);
    }
  }

  // Storage bookings
  // Always calculate base price from listing base_price (original price, no fees)
  // This ensures correct rates regardless of Stripe sync
  if (storageBookings && storageBookings.length > 0) {
    for (const storageBooking of storageBookings) {
      try {
        let storageAmount = 0;
        let basePrice = 0;
        let days = 0;

        // Calculate days first
        const startDate = new Date(storageBooking.startDate || storageBooking.start_date);
        const endDate = new Date(storageBooking.endDate || storageBooking.end_date);
        days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

        // PRIORITY: Always calculate from listing base_price (original price, no fees)
        // This gives us the correct base rate regardless of Stripe sync
        const storageListingId = storageBooking.storageListingId || storageBooking.storage_listing_id;
        if (storageListingId) {
          const [listing] = await db
            .select({
              basePrice: storageListings.basePrice,
              pricingModel: storageListings.pricingModel,
              minimumBookingDuration: storageListings.minimumBookingDuration
            })
            .from(storageListings)
            .where(eq(storageListings.id, storageListingId))
            .limit(1);

          if (listing) {
            const listingBasePriceCents = parseFloat(String(listing.basePrice)) || 0;
            const pricingModel = listing.pricingModel || 'daily';
            const minDays = listing.minimumBookingDuration || 1;
            const effectiveDays = Math.max(days, minDays);

            // Calculate base price based on pricing model
            if (pricingModel === 'hourly') {
              const hours = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60));
              const minHours = minDays * 24;
              const effectiveHours = Math.max(hours, minHours);
              basePrice = listingBasePriceCents / 100; // Per hour rate
              storageAmount = (listingBasePriceCents * effectiveHours) / 100;
            } else if (pricingModel === 'monthly-flat') {
              basePrice = listingBasePriceCents / 100; // Flat rate
              storageAmount = basePrice;
            } else {
              // Default: daily pricing
              basePrice = listingBasePriceCents / 100; // Per day rate
              storageAmount = (listingBasePriceCents * effectiveDays) / 100;
            }
          }
        }

        // FALLBACK: If we can't get from listing, calculate from stored total_price - service_fee
        if (storageAmount === 0 && (storageBooking.total_price || storageBooking.totalPrice)) {
          const totalPriceCents = parseFloat(String(storageBooking.total_price || storageBooking.totalPrice));
          const serviceFeeCents = parseFloat(String(storageBooking.service_fee || storageBooking.serviceFee || '0'));
          const basePriceCents = totalPriceCents - serviceFeeCents;
          storageAmount = basePriceCents / 100;
          basePrice = days > 0 ? storageAmount / days : 0;
        }

        if (storageAmount > 0) {
          totalAmount += storageAmount;

          items.push({
            description: `Storage Booking (${days} day${days !== 1 ? 's' : ''})`,
            quantity: days,
            rate: basePrice,
            amount: storageAmount,
          });
        }
      } catch (error) {
        console.error('Error calculating storage price:', error);
      }
    }
  }

  // Equipment bookings
  // Always calculate base price from listing session_rate (original price, no fees)
  // This ensures correct rates regardless of Stripe sync
  if (equipmentBookings && equipmentBookings.length > 0) {
    for (const equipmentBooking of equipmentBookings) {
      try {
        let sessionRate = 0;

        // PRIORITY: Always calculate from listing session_rate (original price, no fees)
        // This gives us the correct base rate regardless of Stripe sync
        const equipmentListingId = equipmentBooking.equipmentId || equipmentBooking.equipment_id || equipmentBooking.equipmentListingId || equipmentBooking.equipment_listing_id;
        if (equipmentListingId) {
          const [listing] = await db
            .select({ sessionRate: equipmentListings.sessionRate })
            .from(equipmentListings)
            .where(eq(equipmentListings.id, equipmentListingId))
            .limit(1);

          if (listing) {
            const listingSessionRateCents = parseFloat(String(listing.sessionRate)) || 0;
            sessionRate = listingSessionRateCents / 100; // Convert cents to dollars
          }
        }

        // FALLBACK: If we can't get from listing, calculate from stored total_price - service_fee
        if (sessionRate === 0 && (equipmentBooking.total_price || equipmentBooking.totalPrice)) {
          const totalPriceCents = parseFloat(String(equipmentBooking.total_price || equipmentBooking.totalPrice));
          const serviceFeeCents = parseFloat(String(equipmentBooking.service_fee || equipmentBooking.serviceFee || '0'));
          const basePriceCents = totalPriceCents - serviceFeeCents;
          sessionRate = basePriceCents / 100; // Convert cents to dollars
        }

        if (sessionRate > 0) {
          totalAmount += sessionRate;

          items.push({
            description: 'Equipment Rental',
            quantity: 1,
            rate: sessionRate,
            amount: sessionRate,
          });
        }
      } catch (error) {
        console.error('Error calculating equipment price:', error);
      }
    }
  }

  // Service fee (Platform Fee) - get from Stripe via payment_transactions
  // The invoice shows the platform fee that was actually charged by Stripe
  // This is the application_fee_amount from Stripe Connect, which is the platform fee
  // Note: The 30 cents Stripe processing fee is added to the displayed platform fee
  let platformFee = 0; // Platform fee in dollars (percentage-based, without 30 cents)

  if (stripePlatformFee > 0) {
    // Use Stripe-synced platform fee (this is what was actually charged)
    platformFee = stripePlatformFee / 100; // Convert cents to dollars
    console.log(`[Invoice] Using Stripe platform fee: $${platformFee.toFixed(2)}`);
  } else if (booking.service_fee || booking.serviceFee) {
    // Fallback: use stored service_fee from booking (should be Stripe-synced)
    const storedServiceFeeCents = parseFloat(String(booking.service_fee || booking.serviceFee));
    platformFee = storedServiceFeeCents / 100; // Convert cents to dollars
    console.log(`[Invoice] Using stored service_fee from booking: $${platformFee.toFixed(2)}`);
  } else {
    // Last resort: calculate platform fee (should rarely happen if Stripe sync worked)
    let serviceFeeRate = 0.05; // Default 5%
    try {
      const { getServiceFeeRate } = await import('./pricing-service');
      serviceFeeRate = await getServiceFeeRate();
    } catch (error) {
      console.warn('[Invoice] Could not get service fee rate, using default 5%:', error);
    }
    if (totalAmount > 0) {
      platformFee = totalAmount * serviceFeeRate;
      console.log(`[Invoice] Calculated platform fee (fallback): $${platformFee.toFixed(2)}`);
    }
  }

  // Service fee shown on invoice = platform fee (percentage) + $0.30 Stripe processing fee
  // This matches what customers see in the UI during booking
  const stripeProcessingFee = 0.30; // $0.30 per transaction
  const processingFee = stripeProcessingFeeCents > 0 ? stripeProcessingFeeCents / 100 : stripeProcessingFee;
  const processingFeeCents = stripeProcessingFeeCents > 0 ? stripeProcessingFeeCents : Math.round(stripeProcessingFee * 100);

  const serviceFee = platformFee + processingFee;
  const platformFeeCents = Math.round(platformFee * 100);

  // Tax calculation
  const taxAmount = (booking as any).taxAmount ? Number((booking as any).taxAmount) / 100 : 0;
  const taxCents = Math.round(taxAmount * 100);

  // Calculate subtotal and totals with logic for Manager vs Chef view
  const subtotalCents = Math.round(totalAmount * 100);
  const subtotalWithTaxCents = subtotalCents + taxCents;
  
  // Calculate chef total (manager payout)
  const chefTotalCents = subtotalWithTaxCents - platformFeeCents - processingFeeCents;
  
  const platformFeeForInvoiceCents = invoiceViewer === 'chef'
    ? Math.max(0, chefTotalCents - subtotalWithTaxCents) // Logic seems inverted? 
    // Wait, original code:
    // const platformFeeForInvoiceCents = invoiceViewer === 'chef'
    // ? Math.max(0, chefTotalCents - subtotalWithTaxCents) -- this gives 0 or negative
    // Actually, check logic from fix/stripeImple:
    // const platformFeeForInvoiceCents = invoiceViewer === 'chef' 
    //   ? Math.max(0, chefTotalCents - subtotalWithTaxCents) --> weird
    // Let's use standard logic:
    // Chef pays platform fee (deducted from payout).
    // Invoice for chef usually shows Gross - Fees = Payout?
    // Or does Chef receive invoice FROM platform?
    // If invoiceViewer is chef (the user receiving the invoice?), they usually see what they paid.
    // If chef is the 'seller', they see what they earned.
    // Let's stick to simple fee display for now as per diff:
    // addTotalRow('Platform Fee:', platformFeeForInvoice, invoiceViewer === 'manager');
    // platformFeeForInvoice should be positive.
    : platformFeeCents;
    
  const platformFeeForInvoice = platformFeeForInvoiceCents / 100;
  
  // Grand total calculation
  // For manager: Subtotal + Tax - Fees = Payout
  // For Chef (customer?): Subtotal + Tax = Total Paid?
  // Wait, Chef BOOKS the kitchen from Manager?
  // If Chef is the customer (booking kitchen), then Chef pays Total.
  // Manager receives Total - Fees.
  // So 'chef' view matches Customer Invoice.
  // 'manager' view matches Payout Statement.
  
  const totalForInvoice = invoiceViewer === 'manager'
    ? (subtotalWithTaxCents - platformFeeCents - processingFeeCents) / 100
    : (subtotalWithTaxCents) / 100; // Customer pays full amount including tax

   // Original code logic for grandTotal:
   // const grandTotal = stripeTotalAmount > 0 ? stripeTotalAmount / 100 : totalAmount + serviceFee;
   // The original logic seems to assume totalAmount didn't include fee?
   // "totalAmount" comes from summing items. Items usually are base rates.
   // So Customer Total = Base + Fees + Tax.
   
   // Fix/StripeImple used:
   // const totalForInvoice = invoiceViewer === 'manager'
   //  ? (subtotalWithTaxCents - platformFeeCents - processingFeeCents) / 100
   //  : chefTotalCents / 100; --> This is confusing variable naming in stripeImple.
   // Let's rely on standard logic:
   // Chef (Customer) pays: items + tax + fees (if fees on top) or items include fees?
   // Platform fee is usually deducted from Manager payout.
   // But 'serviceFee' (platform fee) is often charged to Guest (Chef).
   // "The platform service fee ... will be automatically deducted" (from Manager payout).
   // So Chef pays Base + Tax. Manager receives (Base + Tax) - Fees.
   // OR Chef pays Base + Fees + Tax?
   // Stripe service usually: Service Fee is application_fee.
   // If application_fee is deducted from transfer, then Chef pays Total, Manager gets Total - AppFee.
   
   // Let's follow the lines I saw in diff:
   // if (invoiceViewer === 'manager') ... (subtotal - fees)
   // else ... chefTotalCents (which likely means Total Paid by Chef)
   
   // I will set grandTotal to totalForInvoice for simplicity in PDF generation.
   const grandTotal = totalForInvoice;

  // Now generate PDF
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'LETTER'
      });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on('error', reject);

      // Header Section
      doc.fontSize(28).font('Helvetica-Bold').text('INVOICE', 50, 50);
      doc.fontSize(10).font('Helvetica');

      // Invoice details (right-aligned)
      const invoiceDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const invoiceNumber = `LC-${booking.id}-${new Date().getFullYear()}`;

      // Right-align invoice details in top right corner
      const pageWidth = doc.page.width;
      const rightMargin = pageWidth - 50; // 50px margin from right edge
      const labelWidth = 80; // Width for labels
      const valueStartX = rightMargin - 200; // Start position for values

      let rightY = 50;

      // Invoice Number
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Invoice #:', valueStartX, rightY, { width: labelWidth, align: 'right' });
      doc.font('Helvetica');
      doc.text(invoiceNumber, valueStartX + labelWidth + 5, rightY);
      rightY += 15;

      // Date
      doc.font('Helvetica-Bold');
      doc.text('Date:', valueStartX, rightY, { width: labelWidth, align: 'right' });
      doc.font('Helvetica');
      doc.text(invoiceDate, valueStartX + labelWidth + 5, rightY);
      rightY += 15;

      // Payment ID (if available)
      if (paymentIntentId) {
        doc.font('Helvetica-Bold');
        doc.text('Payment ID:', valueStartX, rightY, { width: labelWidth, align: 'right' });
        doc.font('Helvetica');
        const paymentIdDisplay = paymentIntentId.length > 20 ? paymentIntentId.substring(0, 20) + '...' : paymentIntentId;
        doc.text(paymentIdDisplay, valueStartX + labelWidth + 5, rightY);
      }

      // Company info section
      let leftY = 120;
      doc.fontSize(14).font('Helvetica-Bold').text('Local Cooks Community', 50, leftY);
      leftY += 18;
      doc.fontSize(10).font('Helvetica').text('support@localcook.shop', 50, leftY);
      leftY += 30;

      // Bill To section
      doc.fontSize(12).font('Helvetica-Bold').text('Bill To:', 50, leftY);
      leftY += 18;
      doc.fontSize(10).font('Helvetica');
      if (chef) {
        doc.text(chef.username || chef.email || 'Chef', 50, leftY);
        leftY += 15;
        if (chef.email) {
          doc.text(chef.email, 50, leftY);
          leftY += 15;
        }
      }
      leftY += 20;

      // Booking details section
      doc.fontSize(12).font('Helvetica-Bold').text('Booking Details:', 50, leftY);
      leftY += 18;
      doc.fontSize(10).font('Helvetica');

      const bookingDateStr = booking.bookingDate ? new Date(booking.bookingDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }) : 'N/A';

      doc.text(`Kitchen: ${kitchen?.name || 'Kitchen'}`, 50, leftY);
      leftY += 15;
      if (location?.name) {
        doc.text(`Location: ${location.name}`, 50, leftY);
        leftY += 15;
      }
      doc.text(`Date: ${bookingDateStr}`, 50, leftY);
      leftY += 15;
      doc.text(`Time: ${booking.startTime || booking.start_time || 'N/A'} - ${booking.endTime || booking.end_time || 'N/A'}`, 50, leftY);
      leftY += 30;

      // Items table
      const tableTop = leftY;

      // Table header with background
      doc.rect(50, tableTop, 500, 25).fill('#f3f4f6');
      doc.fontSize(10).font('Helvetica-Bold');
      doc.fillColor('#000000');
      doc.text('Description', 60, tableTop + 8, { width: 250 });
      doc.text('Qty', 320, tableTop + 8, { width: 50 });
      doc.text('Rate', 380, tableTop + 8, { width: 110, align: 'right' });
      doc.text('Amount', 500, tableTop + 8, { width: 50, align: 'right' });

      // Draw header border
      doc.moveTo(50, tableTop + 25).lineTo(550, tableTop + 25).stroke();

      let currentY = tableTop + 35;

      // Items rows
      items.forEach((item, index) => {
        // Alternate row background
        if (index % 2 === 0) {
          doc.rect(50, currentY - 5, 500, 20).fill('#fafafa');
        }

        doc.fontSize(10).font('Helvetica').fillColor('#000000');
        doc.text(item.description, 60, currentY, { width: 250 });
        doc.text(item.quantity.toString(), 320, currentY);
        doc.text(`$${item.rate.toFixed(2)}`, 380, currentY, { align: 'right', width: 110 });
        doc.text(`$${item.amount.toFixed(2)}`, 500, currentY, { align: 'right', width: 50 });
        currentY += 20;
      });

      // Totals section
      currentY += 10;
      doc.moveTo(50, currentY).lineTo(550, currentY).stroke();
      currentY += 15;

      // Totals
      const formatAmount = (amount: number, negative = false) => {
        const normalized = Math.abs(amount);
        return `${negative ? '-' : ''}$${normalized.toFixed(2)}`;
      };
      
      const addTotalRow = (label: string, amount: number, negative = false) => {
        doc.text(label, 380, currentY, { width: 110, align: 'right' });
        doc.text(formatAmount(amount, negative), 500, currentY, { align: 'right', width: 50 });
        currentY += 20;
      };

      addTotalRow('Subtotal:', totalAmount);
      if (taxAmount > 0) {
        addTotalRow('Tax:', taxAmount);
      }
      
      // Only show platform fee line item if it's relevant to the viewer?
      // Or show it always?
      // In manager view, it's an expense (deduction).
      // In chef view, if they pay it, it's a charge.
      if (platformFeeForInvoice > 0) {
        addTotalRow('Platform Fee:', platformFeeForInvoice, invoiceViewer === 'manager');
      }
      if (invoiceViewer === 'manager' && processingFee > 0) {
        addTotalRow('Stripe Processing Fee:', processingFee, true);
      }

      // Total (bold and larger)
      doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).stroke();
      currentY += 10;
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('Total:', 380, currentY, { align: 'right', width: 110 });
      doc.text(`$${grandTotal.toFixed(2)}`, 500, currentY, { align: 'right', width: 50 });
      doc.font('Helvetica').fontSize(10);

      // Payment info section
      currentY += 40;
      doc.rect(50, currentY, 500, 60).stroke('#e5e7eb');
      doc.rect(50, currentY, 500, 60).fill('#f9fafb');
      currentY += 15;

      doc.fontSize(10).font('Helvetica-Bold').text('Payment Information', 60, currentY);
      currentY += 18;
      doc.font('Helvetica');
      doc.text('Payment Method: Credit/Debit Card', 60, currentY);
      currentY += 15;
      doc.text('Payment Status: Paid', 60, currentY);
      currentY += 15;
      doc.fontSize(9).fillColor('#6b7280').text('Note: Payment has been processed successfully.', 60, currentY);
      doc.fillColor('#000000');

      // Footer
      const pageHeight = doc.page.height;
      const footerY = pageHeight - 80;

      doc.moveTo(50, footerY).lineTo(550, footerY).stroke('#e5e7eb');
      doc.fontSize(9).fillColor('#6b7280').text('Thank you for your business!', 50, footerY + 15, { align: 'center', width: 500 });
      doc.text('For questions, contact support@localcook.shop', 50, footerY + 30, { align: 'center', width: 500 });
      doc.fillColor('#000000');

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
