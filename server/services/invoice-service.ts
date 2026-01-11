// @ts-ignore - pdfkit doesn't have type definitions
import PDFDocument from 'pdfkit';
import type { Pool } from '@neondatabase/serverless';

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
  dbPool: Pool | null
): Promise<Buffer> {
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
      
      // First, try to use stored total_price
      // Note: total_price includes service_fee, so we need to subtract service_fee to get base price
      if (booking.total_price || booking.totalPrice) {
        const totalPriceCents = booking.total_price 
          ? parseFloat(String(booking.total_price)) 
          : parseFloat(String(booking.totalPrice));
        
        // Get service_fee if available
        const serviceFeeCents = (booking.service_fee || booking.serviceFee) 
          ? parseFloat(String(booking.service_fee || booking.serviceFee))
          : 0;
        
        // Base kitchen price = total_price - service_fee (total_price already includes service_fee)
        const basePriceCents = totalPriceCents - serviceFeeCents;
        kitchenAmount = basePriceCents / 100;
        
        // Get duration and rate from stored values if available
        if (booking.duration_hours || booking.durationHours) {
          durationHours = parseFloat(String(booking.duration_hours || booking.durationHours));
        }
        if (booking.hourly_rate || booking.hourlyRate) {
          hourlyRate = parseFloat(String(booking.hourly_rate || booking.hourlyRate)) / 100;
        }
      }
      // If no stored total_price, try to calculate from hourly_rate * duration_hours
      else if ((booking.hourly_rate || booking.hourlyRate) && (booking.duration_hours || booking.durationHours)) {
        const hourlyRateCents = parseFloat(String(booking.hourly_rate || booking.hourlyRate));
        durationHours = parseFloat(String(booking.duration_hours || booking.durationHours));
        hourlyRate = hourlyRateCents / 100;
        kitchenAmount = (hourlyRateCents * durationHours) / 100;
      }
      // Fall back to recalculating from pricing service
      else if (dbPool && startTime && endTime) {
        const { calculateKitchenBookingPrice } = await import('./pricing-service');
        const kitchenPricing = await calculateKitchenBookingPrice(
          kitchenId,
          startTime,
          endTime,
          dbPool
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
  // Use stored total_price if available (total_price is the BASE price in cents, service_fee is stored separately)
  // Otherwise calculate from listing base_price
  if (storageBookings && storageBookings.length > 0) {
    for (const storageBooking of storageBookings) {
      try {
        let storageAmount = 0;
        let basePrice = 0;
        let days = 0;
        
        // Use stored total_price if available
        // Note: total_price is stored as BASE price in cents (without service fee)
        // service_fee is stored separately in cents
        if (storageBooking.total_price || storageBooking.totalPrice) {
          const basePriceCents = parseFloat(String(storageBooking.total_price || storageBooking.totalPrice));
          storageAmount = basePriceCents / 100; // Convert cents to dollars
          
          const startDate = new Date(storageBooking.startDate || storageBooking.start_date);
          const endDate = new Date(storageBooking.endDate || storageBooking.end_date);
          days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          basePrice = days > 0 ? storageAmount / days : 0;
        } else if (dbPool) {
          // Fall back to calculating from listing
          const result = await dbPool.query(
            'SELECT base_price FROM storage_listings WHERE id = $1',
            [storageBooking.storageListingId || storageBooking.storage_listing_id]
          );
          if (result.rows.length > 0) {
            basePrice = parseFloat(String(result.rows[0].base_price)) / 100; // Convert cents to dollars
            const startDate = new Date(storageBooking.startDate || storageBooking.start_date);
            const endDate = new Date(storageBooking.endDate || storageBooking.end_date);
            days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            storageAmount = basePrice * days;
          }
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
  // Use stored total_price if available (total_price is the BASE price in cents, service_fee is stored separately)
  // Otherwise calculate from listing session_rate
  if (equipmentBookings && equipmentBookings.length > 0) {
    for (const equipmentBooking of equipmentBookings) {
      try {
        let sessionRate = 0;
        
        // Use stored total_price if available
        // Note: total_price is stored as BASE price in cents (without service fee)
        // service_fee is stored separately in cents
        if (equipmentBooking.total_price || equipmentBooking.totalPrice) {
          const basePriceCents = parseFloat(String(equipmentBooking.total_price || equipmentBooking.totalPrice));
          sessionRate = basePriceCents / 100; // Convert cents to dollars
        } else if (dbPool) {
          // Fall back to calculating from listing
          const result = await dbPool.query(
            'SELECT session_rate FROM equipment_listings WHERE id = $1',
            [equipmentBooking.equipmentListingId || equipmentBooking.equipment_listing_id]
          );
          if (result.rows.length > 0) {
            sessionRate = parseFloat(String(result.rows[0].session_rate)) / 100; // Convert cents to dollars
          }
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

  // Service fee - calculate once on subtotal (not per item)
  // This matches how Stripe charges: one service fee on the total transaction
  // All items above show base prices only (service fee already subtracted)
  let serviceFee = 0;
  let serviceFeeRate = 0.05; // Default
  
  // Get service fee rate from platform settings
  if (dbPool) {
    try {
      const { getServiceFeeRate } = await import('./pricing-service');
      serviceFeeRate = await getServiceFeeRate(dbPool);
    } catch (error) {
      console.error('Error getting service fee rate for invoice:', error);
      // Use default 5%
    }
  }
  
  // Calculate service fee once on the subtotal (sum of all base prices)
  // This matches the Stripe transaction: one service fee on the total amount
  if (totalAmount > 0) {
    serviceFee = totalAmount * serviceFeeRate;
  }
  
  const grandTotal = totalAmount + serviceFee;

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
      doc.fontSize(10).font('Helvetica').text('support@localcooks.ca', 50, leftY);
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
      
      // Subtotal
      doc.fontSize(10).font('Helvetica').text('Subtotal:', 380, currentY, { align: 'right', width: 110 });
      doc.text(`$${totalAmount.toFixed(2)}`, 500, currentY, { align: 'right', width: 50 });
      currentY += 20;
      
      // Service Fee - calculate percentage for display
      const serviceFeePercentage = totalAmount > 0 ? (serviceFee / totalAmount * 100).toFixed(1) : '5.0';
      doc.text(`Service Fee (${serviceFeePercentage}%):`, 380, currentY, { align: 'right', width: 110 });
      doc.text(`$${serviceFee.toFixed(2)}`, 500, currentY, { align: 'right', width: 50 });
      currentY += 20;
      
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
      doc.text('Payment Method: Pre-Authorized Debit', 60, currentY);
      currentY += 15;
      doc.text('Payment Status: Authorized', 60, currentY);
      currentY += 15;
      doc.fontSize(9).fillColor('#6b7280').text('Note: Payment will be processed within 3-5 business days.', 60, currentY);
      doc.fillColor('#000000');
      
      // Footer
      const pageHeight = doc.page.height;
      const footerY = pageHeight - 80;
      
      doc.moveTo(50, footerY).lineTo(550, footerY).stroke('#e5e7eb');
      doc.fontSize(9).fillColor('#6b7280').text('Thank you for your business!', 50, footerY + 15, { align: 'center', width: 500 });
      doc.text('For questions, contact support@localcooks.ca', 50, footerY + 30, { align: 'center', width: 500 });
      doc.fillColor('#000000');

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
