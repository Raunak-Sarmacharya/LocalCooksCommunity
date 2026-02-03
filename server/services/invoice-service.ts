import PDFDocument from 'pdfkit';
import { db } from "../db";
import { paymentTransactions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getStripePaymentAmounts } from "./stripe-service";

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
  // Note: Stripe processing fee is handled internally by Stripe, not tracked here
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
        // Note: Stripe processing fee is handled internally by Stripe, not extracted from metadata

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
  const kitchenId = booking.kitchenId || booking.kitchen_id;
  const startTime = booking.startTime || booking.start_time;
  const endTime = booking.endTime || booking.end_time;

  if (kitchenId) {
    try {
      let kitchenAmount = 0;
      let durationHours = 0;
      let hourlyRate = 0;

      // USE PREFERABLY: Booking's stored hourly rate and duration
      if ((booking.hourly_rate || booking.hourlyRate) && (booking.duration_hours || booking.durationHours)) {
        const hourlyRateCents = parseFloat(String(booking.hourly_rate || booking.hourlyRate));
        durationHours = parseFloat(String(booking.duration_hours || booking.durationHours));
        hourlyRate = hourlyRateCents / 100;
        kitchenAmount = (hourlyRateCents * durationHours) / 100;
      }
      // FALLBACK 1: Use Stripe-synced base_amount
      else if (stripeBaseAmount > 0) {
        kitchenAmount = stripeBaseAmount / 100;
        if (booking.duration_hours || booking.durationHours) {
            durationHours = parseFloat(String(booking.duration_hours || booking.durationHours));
        }
        if (durationHours > 0) {
             hourlyRate = kitchenAmount / durationHours;
        }
      }
      // FALLBACK 2: Booking total price (assuming it is Subtotal)
      else if (booking.total_price || booking.totalPrice) {
         // Assuming totalPrice now reflects Subtotal (or Subtotal+Tax in some contexts, but let's assume Subtotal due to recent changes)
         // To be safe, if we have specific rates, calculate from them.
         // If not, usually stored total_price is the booking price (without add-ons).
         const totalPriceCents = parseFloat(String(booking.total_price || booking.totalPrice));
         kitchenAmount = totalPriceCents / 100;
         
         if (booking.duration_hours || booking.durationHours) {
            durationHours = parseFloat(String(booking.duration_hours || booking.durationHours));
            if (durationHours > 0) hourlyRate = kitchenAmount / durationHours;
         }
      }
      // FALLBACK 3: Recalculate
      else if (startTime && endTime) {
         try {
             // Basic calculation based on time difference if no other data
             const start = startTime.split(':').map(Number);
             const end = endTime.split(':').map(Number);
             const startMinutes = start[0] * 60 + start[1];
             const endMinutes = end[0] * 60 + end[1];
             durationHours = Math.max(1, (endMinutes - startMinutes) / 60);

             // Use kitchen hourly rate
             const kitchenRate = kitchen.hourlyRate ? Number(kitchen.hourlyRate) : 0;
             hourlyRate = kitchenRate / 100;
             kitchenAmount = (kitchenRate * durationHours) / 100;
         } catch (e) {
             console.error("Error recalculating kitchen price", e);
         }
      }

      if (kitchenAmount > 0) {
          if (durationHours <= 0 && startTime && endTime) {
             const start = startTime.split(':').map(Number);
             const end = endTime.split(':').map(Number);
             durationHours = Math.max(1, ((end[0] * 60 + end[1]) - (start[0] * 60 + start[1])) / 60);
          }
          if (hourlyRate <= 0 && durationHours > 0) hourlyRate = kitchenAmount / durationHours;

          totalAmount += kitchenAmount;
          items.push({
            description: `Kitchen Booking (${durationHours.toFixed(1)} hour${durationHours !== 1 ? 's' : ''})`,
            quantity: durationHours,
            rate: hourlyRate,
            amount: kitchenAmount,
          });
      }
    } catch (error) {
       console.error('Error in kitchen price calculation:', error);
    }
  }

  // Storage bookings
  if (storageBookings && storageBookings.length > 0) {
      for (const storage of storageBookings) {
          try {
             let amount = 0;
             let quantity = 0;
             let rate = 0;
             
             // Get total price from storage booking (stored in cents)
             if (storage.total_price || storage.totalPrice) {
                 amount = parseFloat(String(storage.total_price || storage.totalPrice)) / 100;
             }
             
             // Calculate days from date range
             if (storage.startDate && storage.endDate) {
                 const s = new Date(storage.startDate);
                 const e = new Date(storage.endDate);
                 quantity = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 3600 * 24)));
             }
             
             // Get daily rate from listing basePrice (stored in cents) or calculate from total
             if (storage.listingBasePrice) {
                 rate = parseFloat(String(storage.listingBasePrice)) / 100; // Convert cents to dollars
             } else if (quantity > 0 && amount > 0) {
                 rate = amount / quantity;
             }
            
            if (amount > 0) {
                totalAmount += amount;
                
                // Construct detailed description with storage name and type
                let name = 'Storage Booking';
                if (storage.storageName) {
                    name = storage.storageName;
                    if (storage.storageType) name += ` (${storage.storageType})`;
                } else if (storage.storageType) {
                    name = `Storage - ${storage.storageType}`;
                }

                items.push({
                   description: `${name} - ${quantity} day${quantity !== 1 ? 's' : ''}`,
                   quantity: quantity || 1,
                   rate: rate || amount,
                   amount: amount
                });
            }
          } catch (e) { console.error('[Invoice] Error processing storage booking:', e); }
      }
  }

  // Equipment bookings
  if (equipmentBookings && equipmentBookings.length > 0) {
      for (const eqBooking of equipmentBookings) {
          let amount = 0;
          if (eqBooking.total_price || eqBooking.totalPrice) {
              amount = parseFloat(String(eqBooking.total_price || eqBooking.totalPrice)) / 100;
          }
          if (amount > 0) {
              totalAmount += amount;
              
              // Construct detailed description
              let name = 'Equipment Rental';
              if (eqBooking.brand) {
                  name = eqBooking.brand;
                  if (eqBooking.equipmentType) name += ` (${eqBooking.equipmentType})`;
              } else if (eqBooking.equipmentType) {
                  name = eqBooking.equipmentType;
              }

              items.push({
                  description: name,
                  quantity: 1,
                  rate: amount,
                  amount: amount
              });
          }
      }
  }

  // Service Fee / Platform Fee
  // REMOVED for Customer View.
  // We only track it for Manager Payout views if needed.
  // For Invoice generation:
  // Subtotal = totalAmount
  // Tax = calculated
  // Total = Subtotal + Tax

  let platformFee = 0;
  if (stripePlatformFee > 0) platformFee = stripePlatformFee / 100;

  // Note: Stripe processing fee is handled internally by Stripe and should not be shown on invoices
  // The platform fee (service fee) is what we charge, Stripe's fees are separate

  // Tax calculation
  let taxRatePercent = 0;
  if (kitchen && (kitchen.taxRatePercent || kitchen.tax_rate_percent)) {
      taxRatePercent = parseFloat(String(kitchen.taxRatePercent || kitchen.tax_rate_percent));
  }
  
  // Try to get tax from payment metadata first
  let taxAmount = 0;
  let taxFromMetadata = false;
  
  // Try transaction metadata
  // We need to access the `paymentTransaction` object we fetched earlier.
  // It was fetched into local scope variables (stripeBaseAmount etc) but the object itself wasn't saved to a variable accessible here?
  // Re-checking the original code... 
  // Line 39: if (paymentTransaction) ... 
  // Error: I cannot access 'paymentTransaction' here if I didn't save it outside the if block.
  // But wait, the original code I am replacing ENDS at line 417. Use 'paymentTransaction' logic if I can.
  // Actually, I can calculcate tax from taxRatePercent * totalAmount.
  
  const taxCents = Math.round((totalAmount * 100 * taxRatePercent) / 100);
  taxAmount = taxCents / 100;

  // Calculate totals
  const subtotalCents = Math.round(totalAmount * 100);
  const subtotalWithTaxCents = subtotalCents + taxCents;
  
  // Platform fees for Manager Payout View
  const platformFeeCents = Math.round(platformFee * 100);
  const platformFeeForInvoice = invoiceViewer === 'manager' ? platformFee : 0;
  
  const totalForInvoice = invoiceViewer === 'manager'
    ? (subtotalWithTaxCents - platformFeeCents) / 100
    : (subtotalWithTaxCents) / 100;

  const grandTotal = totalForInvoice;

  // For manager invoices: Fetch actual Stripe fees before PDF generation
  let stripeDataForManager: {
    stripeProcessingFee: number;
    stripeNetPayout: number;
    actualPlatformFee: number;
    dataSource: 'stripe' | 'calculated';
  } | null = null;

  if (invoiceViewer === 'manager' && paymentIntentId) {
    try {
      const stripeData = await getStripePaymentAmounts(paymentIntentId);
      if (stripeData) {
        // Use actual Stripe data - all values in cents, convert to dollars
        stripeDataForManager = {
          stripeProcessingFee: stripeData.stripeProcessingFee / 100,
          stripeNetPayout: stripeData.stripeNetAmount / 100,
          actualPlatformFee: stripeData.stripePlatformFee / 100,
          dataSource: 'stripe'
        };
        console.log(`[Invoice] Using Stripe BalanceTransaction data: processingFee=${stripeDataForManager.stripeProcessingFee}, netPayout=${stripeDataForManager.stripeNetPayout}, platformFee=${stripeDataForManager.actualPlatformFee}`);
      }
    } catch (error) {
      console.warn('[Invoice] Could not fetch Stripe payment amounts, will use calculated values:', error);
    }
  }

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

      // Company info section
      let leftY = 120;
      doc.fontSize(14).font('Helvetica-Bold').text('Local Cooks Community', 50, leftY);
      leftY += 18;
      doc.fontSize(10).font('Helvetica').text('support@localcook.shop', 50, leftY);
      leftY += 30;

      // Bill To section - use fullName from chef_kitchen_applications
      doc.fontSize(12).font('Helvetica-Bold').text('Bill To:', 50, leftY);
      leftY += 18;
      doc.fontSize(10).font('Helvetica');
      if (chef) {
        // full_name comes from chef_kitchen_applications table join
        const chefName = chef.full_name || chef.fullName || chef.username || 'Chef';
        doc.text(chefName, 50, leftY);
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
      
      // Format time - show discrete slots if available and non-contiguous
      const selectedSlots = booking.selectedSlots || booking.selected_slots;
      let timeDisplay = `${booking.startTime || booking.start_time || 'N/A'} - ${booking.endTime || booking.end_time || 'N/A'}`;
      
      if (Array.isArray(selectedSlots) && selectedSlots.length > 0) {
        // Check if slots are contiguous (each slot has startTime and endTime)
        const sorted = [...selectedSlots].sort((a: any, b: any) => 
          (a.startTime || a).localeCompare(b.startTime || b)
        );
        let isContiguous = true;
        for (let i = 1; i < sorted.length; i++) {
          const prevSlot = sorted[i - 1];
          const currSlot = sorted[i];
          // Handle both old format (string) and new format (object with startTime/endTime)
          const prevEnd = typeof prevSlot === 'string' ? prevSlot : prevSlot.endTime;
          const currStart = typeof currSlot === 'string' ? currSlot : currSlot.startTime;
          if (prevEnd !== currStart) {
            isContiguous = false;
            break;
          }
        }
        
        if (!isContiguous) {
          // Show discrete slots
          const formatSlotTime = (time: string) => {
            const [h, m] = time.split(':').map(Number);
            const ampm = h >= 12 ? 'PM' : 'AM';
            const displayH = h % 12 || 12;
            return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
          };
          timeDisplay = sorted.map((slot: any) => {
            if (typeof slot === 'string') {
              return formatSlotTime(slot);
            }
            return `${formatSlotTime(slot.startTime)}-${formatSlotTime(slot.endTime)}`;
          }).join(', ');
        }
      }
      
      doc.text(`Time: ${timeDisplay}`, 50, leftY);
      leftY += 30;

      // Items table - define column positions and widths for proper table layout
      const tableTop = leftY;
      const tableLeft = 50;
      const tableWidth = 500;
      const rowHeight = 25;
      const col1Width = 280; // Description
      const col2Width = 50;  // Qty
      const col3Width = 70;  // Rate
      const col4Width = 100; // Amount
      const col1X = tableLeft;
      const col2X = tableLeft + col1Width;
      const col3X = col2X + col2Width;
      const col4X = col3X + col3Width;

      // Table Header with borders and column separators
      doc.rect(tableLeft, tableTop, tableWidth, rowHeight).fill('#f3f4f6');
      doc.rect(tableLeft, tableTop, tableWidth, rowHeight).stroke('#d1d5db');
      // Vertical column separators for header
      doc.moveTo(col2X, tableTop).lineTo(col2X, tableTop + rowHeight).stroke('#d1d5db');
      doc.moveTo(col3X, tableTop).lineTo(col3X, tableTop + rowHeight).stroke('#d1d5db');
      doc.moveTo(col4X, tableTop).lineTo(col4X, tableTop + rowHeight).stroke('#d1d5db');
      
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
      doc.text('Description', col1X + 5, tableTop + 8, { width: col1Width - 10 });
      doc.text('Qty', col2X + 5, tableTop + 8, { width: col2Width - 10, align: 'center' });
      doc.text('Rate', col3X + 5, tableTop + 8, { width: col3Width - 10, align: 'center' });
      doc.text('Amount', col4X + 5, tableTop + 8, { width: col4Width - 10, align: 'right' });

      let currentY = tableTop + rowHeight;

      // Items rows with borders and column separators
      items.forEach((item, index) => {
        // Draw row border
        doc.rect(tableLeft, currentY, tableWidth, rowHeight).stroke('#d1d5db');
        // Vertical column separators
        doc.moveTo(col2X, currentY).lineTo(col2X, currentY + rowHeight).stroke('#d1d5db');
        doc.moveTo(col3X, currentY).lineTo(col3X, currentY + rowHeight).stroke('#d1d5db');
        doc.moveTo(col4X, currentY).lineTo(col4X, currentY + rowHeight).stroke('#d1d5db');
        
        // Alternate row background
        if (index % 2 === 0) {
          doc.rect(tableLeft + 1, currentY + 1, tableWidth - 2, rowHeight - 2).fill('#fafafa');
        }

        doc.fontSize(9).font('Helvetica').fillColor('#000000');
        doc.text(item.description, col1X + 5, currentY + 8, { width: col1Width - 10 });
        doc.text(item.quantity.toString(), col2X + 5, currentY + 8, { width: col2Width - 10, align: 'center' });
        doc.text(`$${item.rate.toFixed(2)}`, col3X + 5, currentY + 8, { width: col3Width - 10, align: 'center' });
        doc.text(`$${item.amount.toFixed(2)}`, col4X + 5, currentY + 8, { width: col4Width - 10, align: 'right' });
        currentY += rowHeight;
      });

      // Totals section
      currentY += 15;

      // Totals
      const formatAmount = (amount: number, negative = false) => {
        const normalized = Math.abs(amount);
        return `${negative ? '-' : ''}$${normalized.toFixed(2)}`;
      };
      
      const addTotalRow = (label: string, amount: number, negative = false, bold = false) => {
        if (bold) {
          doc.font('Helvetica-Bold');
        } else {
          doc.font('Helvetica');
        }
        doc.text(label, 380, currentY, { width: 110, align: 'right' });
        doc.text(formatAmount(amount, negative), 500, currentY, { align: 'right', width: 50 });
        currentY += 20;
        doc.font('Helvetica');
      };

      if (invoiceViewer === 'manager') {
        // Manager Invoice: Show earnings breakdown with net revenue from Stripe
        // Use pre-fetched Stripe data or calculate fallback
        const grossRevenue = totalAmount + taxAmount; // What customer paid
        
        let stripeProcessingFee: number;
        let stripeNetPayout: number;
        let actualPlatformFee: number;
        let dataSource: 'stripe' | 'calculated' | 'pending_sync';
        
        if (stripeDataForManager) {
          // Use actual Stripe data
          stripeProcessingFee = stripeDataForManager.stripeProcessingFee;
          stripeNetPayout = stripeDataForManager.stripeNetPayout;
          actualPlatformFee = stripeDataForManager.actualPlatformFee;
          dataSource = stripeDataForManager.dataSource;
        } else {
          // ENTERPRISE STANDARD: Do not calculate fees - use actual data only
          // If Stripe data not available, fees will be synced via charge.updated webhook
          actualPlatformFee = platformFee;
          stripeProcessingFee = 0; // Will be synced via charge.updated webhook
          stripeNetPayout = grossRevenue - actualPlatformFee; // Approximate until fee is synced
          dataSource = 'pending_sync';
        }
        
        // Section header for earnings breakdown
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1f2937');
        doc.text('EARNINGS BREAKDOWN', 60, currentY);
        currentY += 25;
        doc.fontSize(10).font('Helvetica').fillColor('#000000');
        
        addTotalRow('Subtotal (Services):', totalAmount);
        if (taxAmount > 0) {
          addTotalRow('Tax Collected:', taxAmount);
        }
        
        // Gross revenue line
        doc.moveTo(380, currentY - 5).lineTo(550, currentY - 5).stroke('#e5e7eb');
        currentY += 5;
        addTotalRow('Gross Revenue:', grossRevenue, false, true);
        currentY += 5;
        
        // Deductions section
        doc.fontSize(10).fillColor('#6b7280');
        doc.text('Deductions:', 60, currentY);
        currentY += 18;
        doc.fillColor('#000000');
        
        if (actualPlatformFee > 0) {
          addTotalRow('Platform Fee:', actualPlatformFee, true);
        }
        // Show Stripe fee with source indicator
        const stripeFeeLabel = dataSource === 'stripe' 
          ? 'Stripe Processing Fee:' 
          : (dataSource === 'pending_sync' ? 'Stripe Fee (pending sync):' : 'Stripe Processing Fee:');
        addTotalRow(stripeFeeLabel, stripeProcessingFee, true);
        
        // Net payout (bold, highlighted)
        doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).stroke();
        currentY += 10;
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#059669');
        doc.text('Net Payout:', 380, currentY, { align: 'right', width: 110 });
        doc.text(`$${stripeNetPayout.toFixed(2)}`, 500, currentY, { align: 'right', width: 50 });
        doc.font('Helvetica').fontSize(10).fillColor('#000000');
        
        // Add data source note for transparency
        if (dataSource === 'stripe') {
          currentY += 20;
          doc.fontSize(8).fillColor('#6b7280');
          doc.text('* Fees retrieved from Stripe payment records', 60, currentY);
          doc.fillColor('#000000').fontSize(10);
        }
      } else {
        // Chef Invoice: Simple view (what they paid)
        addTotalRow('Subtotal:', totalAmount);
        if (taxAmount > 0) {
          addTotalRow('Tax:', taxAmount);
        }
        
        // Total (bold and larger)
        doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).stroke();
        currentY += 10;
        doc.fontSize(12).font('Helvetica-Bold');
        doc.text('Total:', 380, currentY, { align: 'right', width: 110 });
        doc.text(`$${grandTotal.toFixed(2)}`, 500, currentY, { align: 'right', width: 50 });
        doc.font('Helvetica').fontSize(10);
      }

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
      doc.fontSize(9).fillColor('#6b7280').text('For questions, contact support@localcook.shop', 50, footerY + 15, { align: 'center', width: 500 });
      doc.fillColor('#000000');

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate invoice PDF for standalone storage extension transactions
 * This is used when storage extensions are paid separately from kitchen bookings
 */
export async function generateStorageInvoicePDF(
  transaction: any,
  storageBooking: any,
  chef: any,
  extensionDetails: any,
  options?: { viewer?: 'chef' | 'manager' }
): Promise<Buffer> {
  const invoiceViewer = options?.viewer ?? 'chef';

  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ margin: 50 });

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Parse amounts - support both camelCase and snake_case for backwards compatibility
      const totalAmount = parseInt(String(transaction.amount || '0')) || 0;
      const baseAmount = parseInt(String(transaction.baseAmount || transaction.base_amount || '0')) || 0;
      const taxAmount = totalAmount - baseAmount;
      const taxRatePercent = storageBooking.taxRatePercent || 0;

      // Determine if this is an extension with proper details
      const isExtension = !!extensionDetails;
      const extensionDays = extensionDetails?.extension_days || 0;
      const extensionBasePrice = extensionDetails?.extension_base_price_cents || 0;
      const extensionTotalPrice = extensionDetails?.extension_total_price_cents || 0;
      const dailyRateCents = extensionDetails?.daily_rate_cents || 0;
      
      // Use extension values if available, otherwise fall back to transaction values
      const displayBaseAmount = extensionBasePrice || baseAmount;
      const displayTotalAmount = extensionTotalPrice || totalAmount;
      const displayTaxAmount = displayTotalAmount - displayBaseAmount;
      const displayDays = extensionDays || 1;
      const displayDailyRate = dailyRateCents || (displayDays > 0 ? Math.round(displayBaseAmount / displayDays) : displayBaseAmount);

      // Generate standardized invoice ID: LC-STR-YYYY-XXXXXX (LC = LocalCook, STR = Storage)
      const invoiceDate = new Date(transaction.paidAt || transaction.paid_at || transaction.createdAt || transaction.created_at);
      const year = invoiceDate.getFullYear();
      const bookingIdPadded = String(storageBooking.id).padStart(6, '0');
      const invoiceId = isExtension 
        ? `LC-EXT-${year}-${bookingIdPadded}`
        : `LC-STR-${year}-${bookingIdPadded}`;

      // Header
      doc.fontSize(24).font('Helvetica-Bold').text('INVOICE', 50, 50);
      doc.fontSize(12).font('Helvetica').fillColor('#6b7280');
      doc.text(`Invoice #: ${invoiceId}`, 50, 80);
      doc.text(`Date: ${invoiceDate.toLocaleDateString()}`, 50, 95);
      doc.fillColor('#000000');

      // Billing Info - use fullName from applications table
      doc.fontSize(14).font('Helvetica-Bold').text('Billed To:', 50, 130);
      doc.fontSize(11).font('Helvetica');
      if (chef) {
        // full_name comes from applications table join
        const chefName = chef.full_name || chef.fullName || chef.username || 'Chef';
        doc.text(chefName, 50, 150);
      } else {
        doc.text('Chef', 50, 150);
      }

      // Kitchen/Location Info
      doc.fontSize(14).font('Helvetica-Bold').text('From:', 350, 130);
      doc.fontSize(11).font('Helvetica');
      doc.text(storageBooking.kitchenName || 'Kitchen', 350, 150);
      doc.text(storageBooking.locationName || 'Location', 350, 165);

      // Storage Extension Details
      let currentY = 210;
      doc.fontSize(14).font('Helvetica-Bold').text(isExtension ? 'Storage Extension Details' : 'Storage Booking Details', 50, currentY);
      currentY += 25;

      // Define column positions and widths for proper table layout
      const tableLeft = 50;
      const tableWidth = 500;
      const rowHeight = 25;
      const col1Width = 280; // Description
      const col2Width = 50;  // Qty
      const col3Width = 70;  // Rate
      const col4Width = 100; // Amount
      const col1X = tableLeft;
      const col2X = tableLeft + col1Width;
      const col3X = col2X + col2Width;
      const col4X = col3X + col3Width;

      // Table Header with borders and column separators
      doc.rect(tableLeft, currentY, tableWidth, rowHeight).fill('#f3f4f6');
      doc.rect(tableLeft, currentY, tableWidth, rowHeight).stroke('#d1d5db');
      // Vertical column separators for header
      doc.moveTo(col2X, currentY).lineTo(col2X, currentY + rowHeight).stroke('#d1d5db');
      doc.moveTo(col3X, currentY).lineTo(col3X, currentY + rowHeight).stroke('#d1d5db');
      doc.moveTo(col4X, currentY).lineTo(col4X, currentY + rowHeight).stroke('#d1d5db');
      
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
      doc.text('Description', col1X + 5, currentY + 8, { width: col1Width - 10 });
      doc.text('Qty', col2X + 5, currentY + 8, { width: col2Width - 10, align: 'center' });
      doc.text('Rate', col3X + 5, currentY + 8, { width: col3Width - 10, align: 'center' });
      doc.text('Amount', col4X + 5, currentY + 8, { width: col4Width - 10, align: 'right' });
      currentY += rowHeight;

      // Item row with borders and column separators
      doc.rect(tableLeft, currentY, tableWidth, rowHeight).stroke('#d1d5db');
      // Vertical column separators for data row
      doc.moveTo(col2X, currentY).lineTo(col2X, currentY + rowHeight).stroke('#d1d5db');
      doc.moveTo(col3X, currentY).lineTo(col3X, currentY + rowHeight).stroke('#d1d5db');
      doc.moveTo(col4X, currentY).lineTo(col4X, currentY + rowHeight).stroke('#d1d5db');
      
      doc.fontSize(9).font('Helvetica');
      const storageName = extensionDetails?.storage_name || storageBooking.storageName || 'Storage';
      const description = isExtension 
        ? `Storage Ext - ${storageName} (${displayDays}d)`
        : `Storage - ${storageName}`;

      doc.text(description, col1X + 5, currentY + 8, { width: col1Width - 10 });
      doc.text(String(displayDays), col2X + 5, currentY + 8, { width: col2Width - 10, align: 'center' });
      doc.text(`$${(displayDailyRate / 100).toFixed(2)}`, col3X + 5, currentY + 8, { width: col3Width - 10, align: 'center' });
      doc.text(`$${(displayBaseAmount / 100).toFixed(2)}`, col4X + 5, currentY + 8, { width: col4Width - 10, align: 'right' });
      currentY += rowHeight + 5;

      // Totals section
      currentY += 20;
      doc.fontSize(10).font('Helvetica');
      
      // Subtotal
      doc.text('Subtotal:', 380, currentY);
      doc.text(`$${(displayBaseAmount / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
      currentY += 18;

      // Tax (if applicable)
      if (displayTaxAmount > 0 && taxRatePercent > 0) {
        doc.text(`Tax (${taxRatePercent}%):`, 380, currentY);
        doc.text(`$${(displayTaxAmount / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        currentY += 18;
      }

      // Total
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('Total:', 380, currentY);
      doc.text(`$${(displayTotalAmount / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
      currentY += 30;

      // MANAGER VIEW: Show Stripe fee deduction and net amount
      if (invoiceViewer === 'manager') {
        // Get Stripe fee from transaction
        const stripeProcessingFee = parseInt(String(transaction.stripeProcessingFee || transaction.stripe_processing_fee || '0')) || 0;
        const managerRevenue = parseInt(String(transaction.managerRevenue || transaction.manager_revenue || '0')) || 0;
        
        if (stripeProcessingFee > 0) {
          currentY += 10;
          doc.moveTo(380, currentY).lineTo(550, currentY).stroke('#e5e7eb');
          currentY += 15;
          
          doc.fontSize(10).font('Helvetica').fillColor('#6b7280');
          doc.text('Stripe Processing Fee:', 380, currentY);
          doc.fillColor('#dc2626'); // Red color for deduction
          doc.text(`-$${(stripeProcessingFee / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
          doc.fillColor('#000000');
          currentY += 18;
          
          // Net amount manager receives
          doc.fontSize(12).font('Helvetica-Bold').fillColor('#059669'); // Green for net
          doc.text('You Receive:', 380, currentY);
          const netAmount = managerRevenue > 0 ? managerRevenue : (displayTotalAmount - stripeProcessingFee);
          doc.text(`$${(netAmount / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
          doc.fillColor('#000000');
          currentY += 20;
        }
      }

      // Payment Info
      currentY += 20;
      doc.fontSize(12).font('Helvetica-Bold').text('Payment Information', 50, currentY);
      currentY += 20;
      doc.fontSize(10).font('Helvetica');
      doc.text('Payment Method: Credit/Debit Card', 60, currentY);
      currentY += 15;
      doc.text('Payment Status: Paid', 60, currentY);

      // Footer
      const pageHeight = doc.page.height;
      const footerY = pageHeight - 80;

      doc.moveTo(50, footerY).lineTo(550, footerY).stroke('#e5e7eb');
      doc.fontSize(9).fillColor('#6b7280').text('For questions, contact support@localcook.shop', 50, footerY + 15, { align: 'center', width: 500 });
      doc.fillColor('#000000');

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
