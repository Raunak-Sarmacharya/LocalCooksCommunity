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
  if (dbPool && booking.kitchenId) {
    try {
      const { calculateKitchenBookingPrice } = await import('./pricing-service');
      const kitchenPricing = await calculateKitchenBookingPrice(
        booking.kitchenId,
        booking.startTime || booking.start_time,
        booking.endTime || booking.end_time,
        dbPool
      );
      
      if (kitchenPricing.totalPriceCents > 0) {
        const durationHours = kitchenPricing.durationHours;
        const hourlyRate = kitchenPricing.hourlyRateCents / 100;
        const kitchenAmount = kitchenPricing.totalPriceCents / 100;
        totalAmount += kitchenAmount;
        
        items.push({
          description: `Kitchen Booking (${durationHours} hour${durationHours !== 1 ? 's' : ''})`,
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
  if (storageBookings && storageBookings.length > 0 && dbPool) {
    for (const storageBooking of storageBookings) {
      try {
        const result = await dbPool.query(
          'SELECT base_price FROM storage_listings WHERE id = $1',
          [storageBooking.storageListingId || storageBooking.storage_listing_id]
        );
        if (result.rows.length > 0) {
          const basePrice = parseFloat(String(result.rows[0].base_price)) / 100; // Convert cents to dollars
          const startDate = new Date(storageBooking.startDate || storageBooking.start_date);
          const endDate = new Date(storageBooking.endDate || storageBooking.end_date);
          const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          const storageAmount = basePrice * days;
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
  if (equipmentBookings && equipmentBookings.length > 0 && dbPool) {
    for (const equipmentBooking of equipmentBookings) {
      try {
        const result = await dbPool.query(
          'SELECT session_rate FROM equipment_listings WHERE id = $1',
          [equipmentBooking.equipmentListingId || equipmentBooking.equipment_listing_id]
        );
        if (result.rows.length > 0) {
          const sessionRate = parseFloat(String(result.rows[0].session_rate)) / 100; // Convert cents to dollars
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

  // Service fee (5%)
  const serviceFee = totalAmount * 0.05;
  const grandTotal = totalAmount + serviceFee;

  // Now generate PDF
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on('error', reject);

      // Header
      doc.fontSize(24).text('INVOICE', { align: 'left' });
      doc.moveDown(0.5);
      
      // Invoice details
      const invoiceDate = new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      const invoiceNumber = `LC-${booking.id}-${new Date().getFullYear()}`;
      
      doc.fontSize(10).text(`Invoice #: ${invoiceNumber}`, { align: 'right' });
      doc.text(`Date: ${invoiceDate}`, { align: 'right' });
      if (paymentIntentId) {
        doc.text(`Payment ID: ${paymentIntentId}`, { align: 'right' });
      }
      doc.moveDown(1);

      // Company info
      doc.fontSize(12).text('Local Cooks Community', { align: 'left' });
      doc.fontSize(10).text('support@localcooks.ca', { align: 'left' });
      doc.moveDown(1);

      // Bill to
      doc.fontSize(12).text('Bill To:', { align: 'left' });
      doc.fontSize(10);
      if (chef) {
        doc.text(chef.username || chef.email || 'Chef', { align: 'left' });
        if (chef.email) {
          doc.text(chef.email, { align: 'left' });
        }
      }
      doc.moveDown(1);

      // Booking details
      doc.fontSize(12).text('Booking Details:', { align: 'left' });
      doc.fontSize(10);
      
      const bookingDateStr = booking.bookingDate ? new Date(booking.bookingDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }) : 'N/A';
      
      doc.text(`Kitchen: ${kitchen?.name || 'Kitchen'}`, { align: 'left' });
      if (location?.name) {
        doc.text(`Location: ${location.name}`, { align: 'left' });
      }
      doc.text(`Date: ${bookingDateStr}`, { align: 'left' });
      doc.text(`Time: ${booking.startTime || booking.start_time || 'N/A'} - ${booking.endTime || booking.end_time || 'N/A'}`, { align: 'left' });
      doc.moveDown(1);

      // Items table
      doc.moveDown(1);
      doc.fontSize(10);
      
      // Table header
      const tableTop = doc.y;
      doc.text('Description', 50, tableTop);
      doc.text('Qty', 300, tableTop);
      doc.text('Rate', 350, tableTop, { align: 'right' });
      doc.text('Amount', 450, tableTop, { align: 'right' });
      
      // Draw line
      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
      
      let currentY = tableTop + 25;
      
      // Items
      items.forEach(item => {
        doc.text(item.description, 50, currentY, { width: 240 });
        doc.text(item.quantity.toString(), 300, currentY);
        doc.text(`$${item.rate.toFixed(2)}`, 350, currentY, { align: 'right' });
        doc.text(`$${item.amount.toFixed(2)}`, 450, currentY, { align: 'right' });
        currentY += 20;
      });
      
      // Totals
      currentY += 10;
      doc.moveTo(50, currentY).lineTo(550, currentY).stroke();
      currentY += 15;
      
      doc.text('Subtotal:', 350, currentY, { align: 'right' });
      doc.text(`$${totalAmount.toFixed(2)}`, 450, currentY, { align: 'right' });
      currentY += 20;
      
      doc.text('Service Fee (5%):', 350, currentY, { align: 'right' });
      doc.text(`$${serviceFee.toFixed(2)}`, 450, currentY, { align: 'right' });
      currentY += 20;
      
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('Total:', 350, currentY, { align: 'right' });
      doc.text(`$${grandTotal.toFixed(2)}`, 450, currentY, { align: 'right' });
      doc.font('Helvetica').fontSize(10);
      
      // Payment info
      doc.moveDown(2);
      doc.fontSize(10);
      doc.text('Payment Method: Pre-Authorized Debit', { align: 'left' });
      doc.text('Payment Status: Authorized', { align: 'left' });
      doc.text('Note: Payment will be processed within 3-5 business days.', { align: 'left' });
      
      // Footer
      doc.moveDown(2);
      doc.fontSize(8).text('Thank you for your business!', { align: 'center' });
      doc.text('For questions, contact support@localcooks.ca', { align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
