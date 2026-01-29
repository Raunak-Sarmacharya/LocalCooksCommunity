// @ts-ignore - pdfkit doesn't have type definitions
import PDFDocument from 'pdfkit';
import type { Pool } from '@neondatabase/serverless';
import Stripe from 'stripe';

/**
 * Generate payout statement PDF for a manager
 * Shows earnings breakdown for a specific payout period
 */
export async function generatePayoutStatementPDF(
  managerId: number,
  managerName: string,
  managerEmail: string,
  payout: Stripe.Payout,
  balanceTransactions: Stripe.BalanceTransaction[],
  bookings: any[]
): Promise<Buffer> {
  // Calculate totals
  let totalEarnings = 0;
  let totalPlatformFees = 0;
  const totalBookings = bookings.length;

  // Get service fee rate
  let serviceFeeRate = 0.05; // Default
  try {
    const { getServiceFeeRate } = await import('./pricing-service');
    serviceFeeRate = await getServiceFeeRate();
  } catch (error) {
    console.error('Error getting service fee rate for payout statement:', error);
  }

  // Calculate from bookings
  bookings.forEach((booking: any) => {
    const totalPrice = (booking.totalPrice || booking.total_price || 0) / 100; // Convert cents to dollars
    const serviceFee = (booking.serviceFee || booking.service_fee || 0) / 100;
    const managerRevenue = totalPrice * (1 - serviceFeeRate);

    totalEarnings += managerRevenue;
    totalPlatformFees += serviceFee;
  });

  // Payout amount from Stripe (in cents, convert to dollars)
  const payoutAmount = payout.amount / 100;
  const payoutDate = new Date(payout.created * 1000);
  const payoutStatus = payout.status;

  // Calculate period (from earliest booking to payout date)
  const periodStart = bookings.length > 0
    ? new Date(Math.min(...bookings.map((b: any) => new Date(b.booking_date || b.created_at).getTime())))
    : payoutDate;
  const periodEnd = payoutDate;

  // Generate PDF
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
      doc.fontSize(28).font('Helvetica-Bold').text('PAYOUT STATEMENT', 50, 50);
      doc.fontSize(10).font('Helvetica');

      // Statement details (right-aligned)
      const statementDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const statementNumber = `PS-${payout.id.substring(3)}-${payoutDate.getFullYear()}`;

      const pageWidth = doc.page.width;
      const rightMargin = pageWidth - 50;
      const labelWidth = 100;
      const valueStartX = rightMargin - 200;

      let rightY = 50;

      // Statement Number
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Statement #:', valueStartX, rightY, { width: labelWidth, align: 'right' });
      doc.font('Helvetica');
      doc.text(statementNumber, valueStartX + labelWidth + 5, rightY);
      rightY += 15;

      // Date
      doc.font('Helvetica-Bold');
      doc.text('Date:', valueStartX, rightY, { width: labelWidth, align: 'right' });
      doc.font('Helvetica');
      doc.text(statementDate, valueStartX + labelWidth + 5, rightY);
      rightY += 15;

      // Payout ID
      doc.font('Helvetica-Bold');
      doc.text('Payout ID:', valueStartX, rightY, { width: labelWidth, align: 'right' });
      doc.font('Helvetica');
      const payoutIdDisplay = payout.id.length > 20 ? payout.id.substring(0, 20) + '...' : payout.id;
      doc.text(payoutIdDisplay, valueStartX + labelWidth + 5, rightY);
      rightY += 15;

      // Payout Status
      doc.font('Helvetica-Bold');
      doc.text('Status:', valueStartX, rightY, { width: labelWidth, align: 'right' });
      doc.font('Helvetica');
      doc.text(payoutStatus.charAt(0).toUpperCase() + payoutStatus.slice(1), valueStartX + labelWidth + 5, rightY);
      rightY += 15;

      // Payout Date
      doc.font('Helvetica-Bold');
      doc.text('Payout Date:', valueStartX, rightY, { width: labelWidth, align: 'right' });
      doc.font('Helvetica');
      doc.text(payoutDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }), valueStartX + labelWidth + 5, rightY);

      // Company info section
      let leftY = 120;
      doc.fontSize(14).font('Helvetica-Bold').text('Local Cooks Community', 50, leftY);
      leftY += 18;
      doc.fontSize(10).font('Helvetica').text('support@localcooks.ca', 50, leftY);
      leftY += 30;

      // Pay To section
      doc.fontSize(12).font('Helvetica-Bold').text('Pay To:', 50, leftY);
      leftY += 18;
      doc.fontSize(10).font('Helvetica');
      doc.text(managerName || 'Manager', 50, leftY);
      leftY += 15;
      if (managerEmail) {
        doc.text(managerEmail, 50, leftY);
        leftY += 15;
      }

      // Period section
      leftY += 20;
      doc.fontSize(12).font('Helvetica-Bold').text('Period:', 50, leftY);
      leftY += 18;
      doc.fontSize(10).font('Helvetica');
      doc.text(
        `${periodStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
        50,
        leftY
      );

      // Summary section
      leftY += 40;
      doc.fontSize(14).font('Helvetica-Bold').text('Summary', 50, leftY);
      leftY += 25;

      const summaryItems = [
        { label: 'Total Bookings', value: totalBookings.toString() },
        { label: 'Total Revenue', value: `$${totalEarnings.toFixed(2)}` },
        { label: 'Platform Fees', value: `-$${totalPlatformFees.toFixed(2)}` },
        { label: 'Net Earnings', value: `$${totalEarnings.toFixed(2)}` },
        { label: 'Payout Amount', value: `$${payoutAmount.toFixed(2)}` },
      ];

      summaryItems.forEach((item) => {
        doc.fontSize(10).font('Helvetica');
        doc.text(item.label + ':', 50, leftY, { width: 200 });
        doc.font('Helvetica-Bold');
        doc.text(item.value, 250, leftY);
        leftY += 20;
      });

      // Booking details section
      if (bookings.length > 0) {
        leftY += 20;
        doc.fontSize(14).font('Helvetica-Bold').text('Booking Details', 50, leftY);
        leftY += 25;

        // Table header
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('Date', 50, leftY);
        doc.text('Kitchen', 120, leftY);
        doc.text('Chef', 250, leftY);
        doc.text('Amount', 350, leftY, { width: 100, align: 'right' });
        leftY += 15;
        doc.moveTo(50, leftY).lineTo(550, leftY).stroke();
        leftY += 10;

        // Booking rows
        doc.fontSize(8).font('Helvetica');
        bookings.slice(0, 30).forEach((booking: any) => {
          if (leftY > 700) {
            // New page
            doc.addPage();
            leftY = 50;
          }

          const bookingDateRaw = booking.bookingDate || booking.booking_date || booking.createdAt || booking.created_at;
          const bookingDate = new Date(bookingDateRaw);
          const dateStr = bookingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const kitchenName = (booking.kitchenName || booking.kitchen_name || 'Kitchen').substring(0, 20);
          const chefName = (booking.chefName || booking.chef_name || 'Guest').substring(0, 20);
          const amount = ((booking.totalPrice || booking.total_price || 0) / 100) * (1 - serviceFeeRate);

          doc.text(dateStr, 50, leftY);
          doc.text(kitchenName, 120, leftY, { width: 120 });
          doc.text(chefName, 250, leftY, { width: 90 });
          doc.text(`$${amount.toFixed(2)}`, 350, leftY, { width: 100, align: 'right' });
          leftY += 15;
        });

        if (bookings.length > 30) {
          leftY += 5;
          doc.fontSize(8).font('Helvetica').text(`... and ${bookings.length - 30} more bookings`, 50, leftY);
        }
      }

      // Footer
      const footerY = doc.page.height - 100;
      doc.fontSize(8).font('Helvetica');
      doc.text(
        'This is an automated payout statement from Local Cooks Community.',
        50,
        footerY,
        { align: 'center', width: doc.page.width - 100 }
      );
      doc.text(
        'For questions, contact support@localcooks.ca',
        50,
        footerY + 15,
        { align: 'center', width: doc.page.width - 100 }
      );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
