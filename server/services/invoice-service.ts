import { logger } from "../logger";
import PDFDocument from 'pdfkit';
import { tLocale } from "../i18n";
import { db } from "../db";
import { paymentTransactions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getStripePaymentAmounts } from "./stripe-service";
import {
  buildChefBookingReceiptBreakdown,
  buildKitchenPayoutStatementBreakdown,
} from "@shared/booking-pricing-breakdown";

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
  options?: { viewer?: 'chef' | 'manager', locale?: string }
): Promise<Buffer> {
  const invoiceViewer = options?.viewer ?? 'chef';
  const locale = options?.locale || 'en';
  // Get Stripe-synced amounts from payment_transactions if available
  let stripePlatformFee = 0; // Platform service fee (in cents)
  let stripeTotalAmount = 0; // Total amount from Stripe (in cents)
  let stripeBaseAmount = 0; // Manager gross = subtotal + tax (in cents)
  let stripeProcessingFeeCents = 0;
  let managerRevenueCents = 0;
  let storedTaxAmountCents = 0;
  let ptMetadata: Record<string, unknown> = {};

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
        stripePlatformFee = parseInt(String(paymentTransaction.serviceFee)) || 0;
        stripeBaseAmount = parseInt(String(paymentTransaction.baseAmount)) || 0;
        stripeProcessingFeeCents = parseInt(String(paymentTransaction.stripeProcessingFee || "0")) || 0;
        managerRevenueCents = parseInt(String(paymentTransaction.managerRevenue || "0")) || 0;
        storedTaxAmountCents = parseInt(String((paymentTransaction as any).taxAmount || (paymentTransaction as any).tax_amount || "0")) || 0;
        ptMetadata = paymentTransaction.metadata
          ? (typeof paymentTransaction.metadata === "string"
            ? JSON.parse(paymentTransaction.metadata)
            : (paymentTransaction.metadata as Record<string, unknown>))
          : {};
        if (storedTaxAmountCents <= 0 && ptMetadata.approvedTax != null) {
          storedTaxAmountCents = parseInt(String(ptMetadata.approvedTax)) || 0;
        }

        logger.info(`[Invoice] Using Stripe-synced amounts: total=${stripeTotalAmount}, base=${stripeBaseAmount}, platformFee=${stripePlatformFee}, stripeFee=${stripeProcessingFeeCents}, managerRevenue=${managerRevenueCents}, tax=${storedTaxAmountCents}`);
      }
    } catch (error) {
      logger.warn('[Invoice] Could not fetch payment transaction, will calculate fees:', error);
    }
  }
  // kitchen_bookings.service_fee has always represented the booking's platform
  // commission. Prefer it for legacy rows where payment_transactions.service_fee
  // may contain Stripe fee + commission from the former destination-charge model.
  const bookingPlatformFeeCents = parseInt(String(booking.serviceFee || booking.service_fee || "0")) || 0;
  if (bookingPlatformFeeCents > 0) {
    stripePlatformFee = bookingPlatformFeeCents;
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
      // FALLBACK 2: Booking total price
      // IMPORTANT: After partial capture, kb.total_price = approvedSubtotalCents which includes
      // kitchen + approved storage + approved equipment. Since storage and equipment are added
      // as separate line items below, we must subtract their amounts to get kitchen-only price.
      // This prevents double-counting.
      else if (booking.total_price || booking.totalPrice) {
         const totalPriceCents = parseFloat(String(booking.total_price || booking.totalPrice));
         
         // Subtract storage/equipment amounts that will be added separately
         let addonsCents = 0;
         if (storageBookings && storageBookings.length > 0) {
           for (const sb of storageBookings) {
             const sbPrice = parseFloat(String(sb.total_price || sb.totalPrice || 0));
             if (sbPrice > 0) addonsCents += sbPrice;
           }
         }
         if (equipmentBookings && equipmentBookings.length > 0) {
           for (const eb of equipmentBookings) {
             const ebPrice = parseFloat(String(eb.total_price || eb.totalPrice || 0));
             if (ebPrice > 0) addonsCents += ebPrice;
           }
         }
         
         const kitchenOnlyCents = Math.max(0, totalPriceCents - addonsCents);
         kitchenAmount = kitchenOnlyCents / 100;
         
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
             logger.error("Error recalculating kitchen price", e);
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
            description: tLocale(locale, "kitchenBookingWithHours", { ns: "chef", defaultValue: "Kitchen Booking ({hours} hours)", hours: durationHours.toFixed(1) }),
            quantity: durationHours,
            rate: hourlyRate,
            amount: kitchenAmount,
          });
      }
    } catch (error) {
       logger.error('Error in kitchen price calculation:', error);
    }
  }

  // Storage bookings
  if (storageBookings && storageBookings.length > 0) {
      for (const storage of storageBookings) {
          try {
             let quantity = 0;
             let rate = 0;
             
             // Calculate days from date range
             if (storage.startDate && storage.endDate) {
                 const s = new Date(storage.startDate);
                 const e = new Date(storage.endDate);
                 quantity = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 3600 * 24)));
             }
             
             // Get daily rate from listing basePrice (stored in cents)
             if (storage.listingBasePrice) {
                 rate = parseFloat(String(storage.listingBasePrice)) / 100; // Convert cents to dollars
             }
             
             // CHEF TRANSPARENCY: Calculate amount from daily rate × days
             // This ensures chef sees base price only (no service fee)
             // and correctly reflects any extensions included in the booking period
             let amount = 0;
             if (rate > 0 && quantity > 0) {
                 amount = rate * quantity; // Base price only, no service fee
             } else if (storage.total_price || storage.totalPrice) {
                 // Fallback: use total_price minus service_fee if rate not available
                 const totalPriceCents = parseFloat(String(storage.total_price || storage.totalPrice)) || 0;
                 const serviceFeeCents = parseFloat(String(storage.service_fee || storage.serviceFee || '0')) || 0;
                 amount = (totalPriceCents - serviceFeeCents) / 100;
             }
            
            if (amount > 0) {
                totalAmount += amount;
                
                // Construct detailed description with storage name and type
                let name = tLocale(locale, "storageBooking", { ns: "chef", defaultValue: "Storage Booking" });
                if (storage.storageName) {
                    name = storage.storageName;
                    if (storage.storageType) name += ` (${storage.storageType})`;
                } else if (storage.storageType) {
                    name = tLocale(locale, "storageWithType", { ns: "chef", defaultValue: "Storage - {type}", type: storage.storageType });
                }

                // Add note about extensions if booking period is longer than 1 day
                const daysNote = quantity > 1 ? tLocale(locale, "inclExtensions", { ns: "chef", defaultValue: " (incl. extensions)" }) : '';
                
                items.push({
                   description: tLocale(locale, "storageBookingWithDays", { ns: "chef", defaultValue: "{name} - {days} days{note}", name, days: quantity, note: daysNote }),
                   quantity: quantity || 1,
                   rate: rate || (amount / (quantity || 1)),
                   amount: amount
                });
            }
          } catch (e) { logger.error('[Invoice] Error processing storage booking:', e); }
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
              let name = tLocale(locale, "equipmentRental", { ns: "chef", defaultValue: "Equipment Rental" });
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

  // Tax calculation — tax is on booking subtotal (line items), not tax-inclusive reverse math
  let taxRatePercent = 0;
  if (ptMetadata.taxRatePercent != null) {
      taxRatePercent = parseFloat(String(ptMetadata.taxRatePercent)) || 0;
  } else if (kitchen && (kitchen.taxRatePercent || kitchen.tax_rate_percent)) {
      taxRatePercent = parseFloat(String(kitchen.taxRatePercent || kitchen.tax_rate_percent));
  }
  
  let taxAmount = 0;
  if (storedTaxAmountCents > 0) {
    taxAmount = storedTaxAmountCents / 100;
  } else {
    const taxCents = Math.round((totalAmount * 100 * taxRatePercent) / 100);
    taxAmount = taxCents / 100;
  }
  const taxCents = Math.round(taxAmount * 100);

  // Calculate totals
  const subtotalCents = Math.round(totalAmount * 100);
  if (ptMetadata.taxRatePercent == null && storedTaxAmountCents > 0 && subtotalCents > 0) {
    taxRatePercent = (storedTaxAmountCents * 100) / subtotalCents;
  }
  let platformFeeCents = stripePlatformFee > 0
    ? stripePlatformFee
    : Math.round((platformFee || 0) * 100);
  // The captured Stripe total is authoritative. Reconcile stale legacy fee
  // columns from: total charged = subtotal + kitchen tax + platform fee.
  if (stripeTotalAmount >= subtotalCents + taxCents) {
    platformFeeCents = stripeTotalAmount - subtotalCents - taxCents;
  }
  const platformFeeDollars = platformFeeCents / 100;

  // Chef pays subtotal + tax + service fee. Manager invoice uses earnings breakdown below.
  const chefTotalCents = subtotalCents + taxCents + platformFeeCents;
  const grandTotal = invoiceViewer === 'manager'
    ? (managerRevenueCents > 0
      ? managerRevenueCents / 100
      : (subtotalCents + taxCents - stripeProcessingFeeCents) / 100)
    : chefTotalCents / 100;

  // PARTIAL CAPTURE VERIFICATION: Cross-check invoice total with actual Stripe captured amount
  if (stripeTotalAmount > 0 && invoiceViewer === 'chef') {
    const diff = Math.abs(chefTotalCents - stripeTotalAmount);
    if (diff > 1) {
      logger.warn(`[Invoice] MISMATCH: Calculated chef total (${chefTotalCents}) differs from Stripe captured amount (${stripeTotalAmount}) by ${diff} cents. Items: ${items.length}, Subtotal: ${subtotalCents}, Tax: ${taxCents}, ServiceFee: ${platformFeeCents}`);
    }
  }

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
          // stripeNetAmount is the platform charge net in the separate-charge model;
          // it still includes our commission and is not the Connect transfer.
          stripeNetPayout: Math.max(0, subtotalCents + taxCents - stripeData.stripeProcessingFee) / 100,
          actualPlatformFee: stripeData.stripePlatformFee / 100,
          dataSource: 'stripe'
        };
        logger.info(`[Invoice] Using Stripe BalanceTransaction data: processingFee=${stripeDataForManager.stripeProcessingFee}, netPayout=${stripeDataForManager.stripeNetPayout}, platformFee=${stripeDataForManager.actualPlatformFee}`);
      }
    } catch (error) {
      logger.warn('[Invoice] Could not fetch Stripe payment amounts, will use calculated values:', error);
    }
  }

  // Now generate PDF — layout matches Local Cooks seller invoice (brand red header)
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

      const primaryColor = '#E51636';
      const textColor = '#333333';
      const grayText = '#666666';
      const contentRight = 562;
      const labelCol = 320;
      const valueCol = 450;
      const valueWidth = 100;

      const invoiceNumber = booking.reference_code || booking.referenceCode || `LC-${booking.id}-${new Date().getFullYear()}`;
      const isPayout = invoiceViewer === 'manager';
      const docTitle = isPayout
        ? tLocale(locale, "payoutStatementTitle", { ns: "chef", defaultValue: "PAYOUT STATEMENT" })
        : tLocale(locale, "invoiceTitle", { ns: "chef", defaultValue: "INVOICE" });

      const invoiceDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      });

      const bookingDateStr = booking.bookingDate
        ? new Date(booking.bookingDate).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : 'N/A';

      // Discrete non-contiguous slots when present
      const selectedSlots = booking.selectedSlots || booking.selected_slots;
      let timeDisplay = `${booking.startTime || booking.start_time || 'N/A'} - ${booking.endTime || booking.end_time || 'N/A'}`;
      if (Array.isArray(selectedSlots) && selectedSlots.length > 0) {
        const sorted = [...selectedSlots].sort((a: any, b: any) =>
          (a.startTime || a).localeCompare(b.startTime || b)
        );
        let isContiguous = true;
        for (let i = 1; i < sorted.length; i++) {
          const prevEnd = typeof sorted[i - 1] === 'string' ? sorted[i - 1] : sorted[i - 1].endTime;
          const currStart = typeof sorted[i] === 'string' ? sorted[i] : sorted[i].startTime;
          if (prevEnd !== currStart) {
            isContiguous = false;
            break;
          }
        }
        if (!isContiguous) {
          const formatSlotTime = (time: string) => {
            const [h, m] = time.split(':').map(Number);
            const ampm = h >= 12 ? 'PM' : 'AM';
            return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
          };
          timeDisplay = sorted
            .map((slot: any) =>
              typeof slot === 'string'
                ? formatSlotTime(slot)
                : `${formatSlotTime(slot.startTime)}-${formatSlotTime(slot.endTime)}`
            )
            .join(', ');
        }
      }

      const kitchenName = kitchen?.name || tLocale(locale, "kitchenDefault", { ns: "chef", defaultValue: "Kitchen" });
      const chefName = chef?.full_name || chef?.fullName || chef?.username || 'Chef';
      const feePercent = subtotalCents > 0 ? Math.round((platformFeeCents / subtotalCents) * 100) : 0;

      // Header
      doc.fontSize(28).font('Helvetica-Bold').fillColor(primaryColor).text(docTitle, 50, 50);
      doc.fontSize(14).font('Helvetica').fillColor(grayText).text(`#${invoiceNumber}`, 50, 85);
      doc.fontSize(20).font('Helvetica-Bold').fillColor(textColor).text('Local Cooks', 50, 50, { align: 'right' });
      doc.fontSize(12).font('Helvetica').fillColor(grayText).text('localcook.shop', 50, 75, { align: 'right' });

      let yPos = 120;
      doc.moveTo(50, yPos).lineTo(contentRight, yPos).lineWidth(2).strokeColor(primaryColor).stroke();
      doc.lineWidth(1).strokeColor('#000000');
      yPos += 20;

      // Two-column booking meta (only relevant kitchen fields)
      const leftCol = 50;
      const rightCol = 320;
      const metaLine = (x: number, y: number, label: string, value: string) => {
        doc.fontSize(11).font('Helvetica-Bold').fillColor(textColor).text(`${label}: `, x, y, { continued: true });
        doc.font('Helvetica').fillColor(grayText).text(value);
      };

      metaLine(leftCol, yPos, 'Date', invoiceDate);
      metaLine(rightCol, yPos, 'Kitchen', kitchenName);
      yPos += 18;
      metaLine(leftCol, yPos, 'Booking', bookingDateStr);
      if (location?.name) metaLine(rightCol, yPos, 'Location', location.name);
      yPos += 18;
      metaLine(leftCol, yPos, 'Time', timeDisplay);
      metaLine(rightCol, yPos, isPayout ? 'Chef' : 'Customer', chefName);
      yPos += 30;

      // Items table — Item / Qty / Price (seller invoice style)
      const tableWidth = contentRight - 50;
      doc.roundedRect(50, yPos, tableWidth, 30, 5).fill('#F3F4F6');
      doc.fillColor(textColor).font('Helvetica-Bold').fontSize(11);
      doc.text('Item', 65, yPos + 10);
      doc.text('Qty', 350, yPos + 10, { width: 50, align: 'center' });
      doc.text('Price', valueCol, yPos + 10, { width: valueWidth, align: 'right' });
      yPos += 40;

      doc.font('Helvetica').fontSize(11);
      for (const item of items) {
        if (yPos > 680) {
          doc.addPage();
          yPos = 50;
        }
        doc.fillColor(textColor).text(item.description, 65, yPos, { width: 270 });
        doc.text(String(item.quantity), 350, yPos, { width: 50, align: 'center' });
        doc.text(`$${item.amount.toFixed(2)}`, valueCol, yPos, { width: valueWidth, align: 'right' });
        yPos += Math.max(20, doc.heightOfString(item.description, { width: 270 }) + 6);
      }

      doc.rect(50, yPos, tableWidth, 1).fill('#E5E7EB');
      yPos += 16;

      const fmt = (amount: number, negative = false) =>
        `${negative ? '-' : ''}$${Math.abs(amount).toFixed(2)}`;

      const addRow = (label: string, amount: number, opts?: { negative?: boolean; color?: string }) => {
        doc.fontSize(11).font('Helvetica').fillColor(grayText).text(label, labelCol, yPos);
        doc.fillColor(opts?.color || textColor).text(fmt(amount, opts?.negative), valueCol, yPos, {
          width: valueWidth,
          align: 'right',
        });
        yPos += 18;
      };

      if (isPayout) {
        const payout = buildKitchenPayoutStatementBreakdown({
          kitchenBaseSubtotalCents: subtotalCents,
          kitchenHstRatePercent: taxRatePercent,
          platformFeeRate: subtotalCents > 0 ? platformFeeCents / subtotalCents : 0,
          platformFeeAmountCents: platformFeeCents,
          paymentProcessorFeeCents: stripeProcessingFeeCents,
          kitchenNetPayoutCents: managerRevenueCents,
          refundAmountCents: 0,
        });

        let stripeProcessingFee: number;
        let stripeNetPayout: number;

        if (managerRevenueCents > 0 || stripeProcessingFeeCents > 0) {
          stripeProcessingFee = stripeProcessingFeeCents / 100;
          stripeNetPayout =
            managerRevenueCents > 0 ? managerRevenueCents / 100 : payout.kitchenNetPayoutCents / 100;
        } else if (stripeDataForManager) {
          stripeProcessingFee = stripeDataForManager.stripeProcessingFee;
          stripeNetPayout =
            managerRevenueCents > 0 ? managerRevenueCents / 100 : stripeDataForManager.stripeNetPayout;
        } else {
          stripeProcessingFee = 0;
          stripeNetPayout = payout.kitchenNetPayoutCents / 100;
        }

        const chefPaid = (payout.kitchenGrossCollectedCents + payout.platformFeeAmountCents) / 100;

        addRow('Subtotal', totalAmount);
        if (payout.kitchenHstRegistered && taxAmount > 0) {
          addRow(`HST (${payout.kitchenHstRatePercent}%)`, taxAmount);
        }
        if (platformFeeDollars > 0) {
          addRow(`Service fee (${feePercent}%)`, platformFeeDollars);
        }

        doc.rect(labelCol, yPos, 230, 1).fill('#000000');
        yPos += 8;
        doc.font('Helvetica-Bold').fontSize(11).fillColor(textColor).text('Chef paid', labelCol, yPos);
        doc.text(fmt(chefPaid), valueCol, yPos, { width: valueWidth, align: 'right' });
        yPos += 20;

        if (platformFeeDollars > 0) {
          addRow('Service fee', platformFeeDollars, { negative: true });
        }
        if (stripeProcessingFee > 0) {
          addRow('Processing fee', stripeProcessingFee, { negative: true });
        }

        doc.rect(labelCol, yPos, 230, 1).fill('#000000');
        yPos += 10;
        doc.font('Helvetica-Bold').fontSize(14).fillColor(textColor).text('Net payout', labelCol, yPos);
        doc.fillColor(primaryColor).text(fmt(stripeNetPayout), valueCol, yPos, {
          width: valueWidth,
          align: 'right',
        });
        yPos += 36;
      } else {
        const receipt = buildChefBookingReceiptBreakdown({
          kitchenBaseSubtotalCents: subtotalCents,
          kitchenHstRatePercent: taxRatePercent,
          platformFeeRate: subtotalCents > 0 ? platformFeeCents / subtotalCents : 0,
          platformFeeAmountCents: platformFeeCents,
        });

        addRow('Subtotal', totalAmount);
        if (receipt.kitchenHstRegistered && receipt.kitchenHstAmountCents > 0) {
          addRow(`HST (${receipt.kitchenHstRatePercent}%)`, taxAmount);
        }
        if (platformFeeDollars > 0) {
          addRow(`Service fee (${feePercent}%)`, platformFeeDollars);
        }

        doc.rect(labelCol, yPos, 230, 1).fill('#000000');
        yPos += 10;
        doc.font('Helvetica-Bold').fontSize(14).fillColor(textColor).text('Total', labelCol, yPos);
        doc.fillColor(primaryColor).text(fmt(grandTotal), valueCol, yPos, {
          width: valueWidth,
          align: 'right',
        });
        yPos += 36;
      }

      // Payment status (seller invoice style)
      const statusBg = '#dcfce7';
      const statusBorder = '#bbf7d0';
      const statusColor = '#16a34a';
      doc.roundedRect(50, yPos, tableWidth, 40, 5).fillAndStroke(statusBg, statusBorder);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(textColor)
        .text('Payment Status: ', 70, yPos + 14, { continued: true })
        .fillColor(statusColor).text('PAID');

      doc.fontSize(10).font('Helvetica').fillColor('#9CA3AF');
      doc.text('For questions, contact support@localcook.shop', 50, doc.page.height - 60, {
        align: 'center',
        width: tableWidth,
      });

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
  options?: { viewer?: 'chef' | 'manager', locale?: string }
): Promise<Buffer> {
  const invoiceViewer = options?.viewer ?? 'chef';
  const locale = options?.locale || 'en';

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

      // Use reference_code as invoice ID when available, fallback to legacy format
      const invoiceDate = new Date(transaction.paidAt || transaction.paid_at || transaction.createdAt || transaction.created_at);
      const year = invoiceDate.getFullYear();
      const bookingIdPadded = String(storageBooking.id).padStart(6, '0');
      const isOverstayPenalty = extensionDetails?.is_overstay_penalty === true;
      const storageRefCode = storageBooking.reference_code || storageBooking.referenceCode;
      let invoiceId: string;
      if (storageRefCode) {
        invoiceId = storageRefCode;
      } else if (isOverstayPenalty) {
        invoiceId = `LC-OP-${year}-${bookingIdPadded}`;
      } else if (isExtension) {
        invoiceId = `LC-EXT-${year}-${bookingIdPadded}`;
      } else {
        invoiceId = `LC-STR-${year}-${bookingIdPadded}`;
      }

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
      
      // Subtotal (base amount before tax)
      doc.text('Subtotal (Base Amount):', 380, currentY);
      doc.text(`$${(displayBaseAmount / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
      currentY += 18;

      // Tax (if applicable) - always show tax rate for transparency
      if (displayTaxAmount > 0 && taxRatePercent > 0) {
        doc.text(`Tax (${taxRatePercent}%):`, 380, currentY);
        doc.text(`$${(displayTaxAmount / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        currentY += 18;
      } else if (displayTaxAmount > 0) {
        doc.text('Tax:', 380, currentY);
        doc.text(`$${(displayTaxAmount / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        currentY += 18;
      }

      // Separator line before total
      doc.moveTo(380, currentY - 5).lineTo(550, currentY - 5).stroke('#e5e7eb');
      currentY += 5;

      // Total
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('Total Paid:', 380, currentY);
      doc.text(`$${(displayTotalAmount / 100).toFixed(2)} CAD`, 480, currentY, { align: 'right' });
      currentY += 30;

      // MANAGER VIEW: Show earnings breakdown with tax collected and Stripe fee deduction
      if (invoiceViewer === 'manager') {
        // serviceFee = platform commission (kept by platform; chef paid it)
        // managerRevenue = Connect transfer = (subtotal+tax) − stripe fee
        const stripeProcessingFee = parseInt(String(transaction.stripeProcessingFee || transaction.stripe_processing_fee || '0')) || 0;
        const managerRevenue = parseInt(String(transaction.managerRevenue || transaction.manager_revenue || '0')) || 0;
        const serviceFee = parseInt(String(transaction.serviceFee || transaction.service_fee || '0')) || 0;

        currentY += 10;

        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1f2937');
        doc.text('EARNINGS BREAKDOWN', 60, currentY);
        currentY += 20;
        doc.fontSize(10).font('Helvetica').fillColor('#000000');

        doc.text('Base Amount:', 380, currentY);
        doc.text(`$${(displayBaseAmount / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        currentY += 18;

        if (displayTaxAmount > 0) {
          doc.text(`Tax Collected (${taxRatePercent}%):`, 380, currentY);
          doc.text(`$${(displayTaxAmount / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
          currentY += 18;
        }

        doc.moveTo(380, currentY - 5).lineTo(550, currentY - 5).stroke('#e5e7eb');
        currentY += 5;
        doc.font('Helvetica-Bold');
        doc.text('Gross Revenue:', 380, currentY);
        const managerGrossCents = displayBaseAmount + Math.max(0, displayTaxAmount);
        doc.text(`$${(managerGrossCents / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        doc.font('Helvetica');
        currentY += 20;

        doc.fontSize(10).fillColor('#6b7280');
        doc.text('Deductions:', 60, currentY);
        currentY += 18;
        doc.fillColor('#000000');

        doc.text('Stripe Fee:', 380, currentY);
        doc.fillColor('#dc2626');
        if (stripeProcessingFee > 0) {
          doc.text(`-$${(stripeProcessingFee / 100).toFixed(2)}`, 480, currentY, { align: 'right' });
        } else {
          doc.text('(pending sync)', 480, currentY, { align: 'right' });
        }
        doc.fillColor('#000000');
        currentY += 20;

        doc.moveTo(380, currentY - 5).lineTo(550, currentY - 5).stroke('#e5e7eb');
        currentY += 5;
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#059669');
        doc.text('You Receive:', 380, currentY);
        const netAmount = managerRevenue > 0
          ? managerRevenue
          : Math.max(0, managerGrossCents - stripeProcessingFee);
        doc.text(`$${(netAmount / 100).toFixed(2)} CAD`, 480, currentY, { align: 'right' });
        doc.fillColor('#000000');
        currentY += 25;

        doc.fontSize(8).fillColor('#6b7280');
        doc.text('* You Receive is the actual amount Stripe transferred to your Connect account', 60, currentY);
        currentY += 12;
        if (serviceFee > 0) {
          doc.text(`* Platform service fee ($${(serviceFee / 100).toFixed(2)}) was paid by the chef and kept by the platform`, 60, currentY);
          currentY += 12;
        }
        if (taxAmount > 0 || displayTaxAmount > 0) {
          doc.text('* Tax collected is included in your payout — remit to tax authorities', 60, currentY);
        }
        doc.fillColor('#000000').fontSize(10);
      }

      // Payment Info
      currentY += 20;
      doc.fontSize(12).font('Helvetica-Bold').text('Payment Information', 50, currentY);
      currentY += 20;
      doc.fontSize(10).font('Helvetica');
      doc.text('Payment Method: Credit/Debit Card', 60, currentY);

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
 * Generate invoice PDF for a damage claim
 * Supports both chef view (what they paid) and manager view (what they receive after fees)
 */
export async function generateDamageClaimInvoicePDF(
  claim: {
    id: number;
    referenceCode?: string | null;
    claimTitle: string;
    claimDescription: string;
    damageDate: string | Date;
    claimedAmountCents: number;
    finalAmountCents: number | null;
    chargeSucceededAt: Date | null;
    stripePaymentIntentId: string | null;
    chefId: number;
    managerId: number;
    locationId: number;
    bookingType: string;
    kitchenBookingId: number | null;
    storageBookingId: number | null;
  },
  options?: { viewer?: 'chef' | 'manager' }, locale?: string
): Promise<Buffer> {
  const invoiceViewer = options?.viewer ?? 'chef';
  
  // Import schema here to avoid circular dependencies
  const { users, locations } = await import("@shared/schema");
  
  // For manager view, try to get actual Stripe fees from payment_transactions
  // ENTERPRISE STANDARD: For Stripe Connect destination charges:
  // - serviceFee = application_fee_amount = what Stripe withheld from payout (single deduction)
  // - managerRevenue = amount - application_fee_amount = actual amount received in Stripe
  // - stripeProcessingFee = informational only (actual fee Stripe charged the platform)
  let stripeProcessingFeeCents = 0;
  let managerRevenueCents = 0;
  let serviceFeeCents = 0;

  if (invoiceViewer === 'manager' && claim.stripePaymentIntentId) {
    try {
      const [transaction] = await db
        .select({
          stripeProcessingFee: paymentTransactions.stripeProcessingFee,
          managerRevenue: paymentTransactions.managerRevenue,
          serviceFee: paymentTransactions.serviceFee,
        })
        .from(paymentTransactions)
        .where(eq(paymentTransactions.paymentIntentId, claim.stripePaymentIntentId))
        .limit(1);

      if (transaction) {
        stripeProcessingFeeCents = parseInt(String(transaction.stripeProcessingFee || '0')) || 0;
        managerRevenueCents = parseInt(String(transaction.managerRevenue || '0')) || 0;
        serviceFeeCents = parseInt(String(transaction.serviceFee || '0')) || 0;
      }
    } catch (error) {
      logger.warn('[DamageClaimInvoice] Could not fetch Stripe fees:', error);
    }
  }
  
  return new Promise(async (resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ margin: 50 });

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Get chef and location info
      const [chef] = await db
        .select()
        .from(users)
        .where(eq(users.id, claim.chefId))
        .limit(1);

      const [location] = await db
        .select()
        .from(locations)
        .where(eq(locations.id, claim.locationId))
        .limit(1);

      const chargeDate = claim.chargeSucceededAt 
        ? new Date(claim.chargeSucceededAt) 
        : new Date();
      const amountCents = claim.finalAmountCents || claim.claimedAmountCents;

      // Header
      doc.fontSize(24).font('Helvetica-Bold').text('DAMAGE CLAIM INVOICE', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('LocalCooks Platform', { align: 'center' });
      doc.fillColor('#000000');
      doc.moveDown(2);

      // Invoice details
      doc.fontSize(12).font('Helvetica-Bold').text('Invoice Details');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Invoice Number: LC-DC-${claim.id.toString().padStart(6, '0')}`);
      doc.text(`Date: ${chargeDate.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}`);
      doc.moveDown(1.5);

      // Chef info
      doc.fontSize(12).font('Helvetica-Bold').text('Billed To');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      doc.text((chef as any)?.fullName || (chef as any)?.username || 'Chef');
      doc.text((chef as any)?.email || '');
      doc.moveDown(1.5);

      // Location info
      doc.fontSize(12).font('Helvetica-Bold').text('Location');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      doc.text((location as any)?.name || 'Kitchen Location');
      doc.text((location as any)?.address || '');
      doc.moveDown(1.5);

      // Claim details
      doc.fontSize(12).font('Helvetica-Bold').text('Damage Claim Details');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Claim Title: ${claim.claimTitle}`);
      doc.text(`Booking Type: ${claim.bookingType === 'storage' ? 'Storage' : 'Kitchen'}`);
      doc.text(`Damage Date: ${new Date(claim.damageDate).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}`);
      doc.moveDown(0.5);
      
      // Description (wrapped)
      doc.text('Description:', { continued: false });
      doc.text(claim.claimDescription, { width: 450 });
      doc.moveDown(1.5);

      // Amount section
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#e5e7eb');
      doc.moveDown(0.5);

      const tableY = doc.y;
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Description', 50, tableY);
      doc.text('Amount', 450, tableY, { align: 'right', width: 100 });
      
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#e5e7eb');
      doc.moveDown(0.5);

      doc.font('Helvetica');
      const itemY = doc.y;
      doc.text('Damage Claim Payment', 50, itemY);
      doc.text(`$${(amountCents / 100).toFixed(2)} CAD`, 450, itemY, { align: 'right', width: 100 });

      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#e5e7eb');
      doc.moveDown(0.5);

      // Total
      doc.font('Helvetica-Bold');
      const totalY = doc.y;
      doc.text('Total Charged', 50, totalY);
      doc.text(`$${(amountCents / 100).toFixed(2)} CAD`, 450, totalY, { align: 'right', width: 100 });

      doc.moveDown(1.5);

      // MANAGER VIEW: Show Stripe fee deduction and net amount
      // Use serviceFee (application_fee) as the actual deduction. Fall back to amount-managerRevenue.
      const actualDeductionCents = serviceFeeCents > 0
        ? serviceFeeCents
        : (managerRevenueCents > 0 ? Math.max(0, amountCents - managerRevenueCents) : stripeProcessingFeeCents);

      if (invoiceViewer === 'manager' && actualDeductionCents > 0) {
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#e5e7eb');
        doc.moveDown(0.5);

        doc.fontSize(10).font('Helvetica').fillColor('#6b7280');
        const feeY = doc.y;
        doc.text('Stripe Fee:', 50, feeY);
        doc.fillColor('#dc2626'); // Red color for deduction
        doc.text(`-$${(actualDeductionCents / 100).toFixed(2)} CAD`, 450, feeY, { align: 'right', width: 100 });
        doc.fillColor('#000000');
        doc.moveDown(0.5);

        // Show actual processing fee as informational sub-line if it differs (international/AMEX)
        if (
          stripeProcessingFeeCents > 0 &&
          Math.abs(stripeProcessingFeeCents - actualDeductionCents) > 1
        ) {
          doc.fontSize(8).fillColor('#9ca3af').font('Helvetica-Oblique');
          doc.text(
            `(actual Stripe processing fee: $${(stripeProcessingFeeCents / 100).toFixed(2)})`,
            300,
            doc.y,
            { width: 250, align: 'right' }
          );
          doc.font('Helvetica').fontSize(10).fillColor('#000000');
          doc.moveDown(0.3);
        }

        // Net amount manager receives — actual amount in their Stripe account
        const netAmount = managerRevenueCents > 0 ? managerRevenueCents : (amountCents - actualDeductionCents);
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#059669'); // Green for net
        const netY = doc.y;
        doc.text('You Receive:', 50, netY);
        doc.text(`$${(netAmount / 100).toFixed(2)} CAD`, 450, netY, { align: 'right', width: 100 });
        doc.fillColor('#000000');
        doc.moveDown(1);
      }

      doc.moveDown(0.5);

      // Payment info
      doc.fontSize(10).font('Helvetica');
      doc.text('Payment Method: Credit/Debit Card');
      doc.text(`Transaction Date: ${chargeDate.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
      const dcRef = claim.referenceCode;
      if (dcRef) {
        doc.text(`Reference: ${dcRef}`);
      } else if (claim.stripePaymentIntentId) {
        doc.text(`Reference: ${claim.stripePaymentIntentId.slice(-8).toUpperCase()}`);
      }

      // Footer
      const dcPageHeight = doc.page.height;
      const dcFooterY = dcPageHeight - 80;

      doc.moveTo(50, dcFooterY).lineTo(550, dcFooterY).stroke('#e5e7eb');
      doc.fontSize(9).fillColor('#6b7280').text('For questions, contact support@localcook.shop', 50, dcFooterY + 15, { align: 'center', width: 500 });
      doc.fillColor('#000000');

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
