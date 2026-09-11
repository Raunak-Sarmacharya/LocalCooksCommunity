import { db } from "../db";
import { users, applications } from "@shared/schema";
import { isNotNull, eq, desc } from "drizzle-orm";
import * as phpBridge from './php-bridge-service';
import { logger } from "../logger";
import PDFDocument from 'pdfkit';
import { format } from 'date-fns';
import { sendChefReportEmail } from "../email";
import { tLocale } from "../i18n";

export interface SellerOrder {
  id: number;
  type: "order" | "pre_order";
  customer_name: string;
  items_description: string;
  shopcharge: number;
  tip_chef: number;
  tip_dboy: number;
  discount_amt: number;
  stripe_fee: number;
  commission: number;
  chef_earnings: number;
  total_price: number;
  delivery_charge: number;
  service_fee: number;
  order_method: string;
  delivery_provider: string;
  payment_status: string;
  payout_status: "due" | "paid";
  order_time: string;
}

// Helpers
function fmtDollars(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function getDeliveryLabel(method: string, provider: string, locale?: string): string {
  if (method === "pickup") return tLocale(locale, "pickup", { ns: "chef", defaultValue: "Pickup" });
  if (provider === "uber_direct") return tLocale(locale, "uberDirect", { ns: "chef", defaultValue: "Uber Direct" });
  return tLocale(locale, "inHouseDelivery", { ns: "chef", defaultValue: "In-House Delivery" });
}

function parseOrderItemsForReport(itemsStr: string | null | undefined): string {
  if (!itemsStr) return "";
  const items = itemsStr
    .split(/<br\s*\/?>|\n/i)
    .map((item) => item.trim())
    .filter(Boolean);
  
  return items.map((item) => {
    const qtyMatch = item.match(/\(x(\d+)\)/i);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

    const priceMatch = item.match(/\(\$([\d.]+)\)/) || item.match(/\$\([\d.]+\)/) || item.match(/\$([\d.]+)/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

    const cleaned = item
      .replace(/^o\s*/i, "")
      .replace(/\s*\(x\d+\)/i, "")
      .replace(/\s*\(\$[\d.]+\)/, "")
      .replace(/\s*\$\([\d.]+\)/, "")
      .replace(/\s*\$[\d.]+/, "")
      .trim();
      
    return `${qty}x ${cleaned} @ $${price.toFixed(2)}`;
  }).join("\n");
}

/**
 * Generate CSV string from orders
 */
export async function generateReportCSV(phpShopId: number, startDate: string, endDate: string, locale?: string): Promise<string> {
  const data = await phpBridge.getSellerOrders(phpShopId, {
    type: 'all',
    status: 'all',
    page: 1,
    limit: 1000,
    startDate,
    endDate
  });
  
  const orders: SellerOrder[] = data.orders || [];

  const headers = [
    tLocale(locale, "orderId", { ns: "chef", defaultValue: "Order ID" }),
    tLocale(locale, "type", { ns: "chef", defaultValue: "Type" }),
    tLocale(locale, "date", { ns: "chef", defaultValue: "Date" }),
    tLocale(locale, "customer", { ns: "chef", defaultValue: "Customer" }),
    tLocale(locale, "items", { ns: "chef", defaultValue: "Items" }),
    tLocale(locale, "shopCharge", { ns: "chef", defaultValue: "Shop Charge" }),
    tLocale(locale, "taxCollected", { ns: "chef", defaultValue: "Tax Collected" }),
    tLocale(locale, "discount", { ns: "chef", defaultValue: "Discount" }),
    tLocale(locale, "stripeFee", { ns: "chef", defaultValue: "Stripe Fee" }),
    tLocale(locale, "tipChef", { ns: "chef", defaultValue: "Tip (Chef)" }),
    tLocale(locale, "yourEarnings", { ns: "chef", defaultValue: "Your Earnings" }),
    tLocale(locale, "payoutStatus", { ns: "chef", defaultValue: "Payout Status" }),
    tLocale(locale, "deliveryMethod", { ns: "chef", defaultValue: "Delivery Method" }),
  ];

  const rows = orders.map((o) => [
    o.id,
    o.type === "pre_order" ? tLocale(locale, "preOrder", { ns: "chef", defaultValue: "Pre-Order" }) : tLocale(locale, "orderLabel", { ns: "chef", defaultValue: "Order" }),
    `"${o.order_time}"`, 
    `"${(o.customer_name || '').replace(/"/g, '""')}"`,
    `"${parseOrderItemsForReport(o.items_description).replace(/"/g, '""')}"`,
    fmtDollars(o.shopcharge),
    fmtDollars(o.commission), // This is actually Tax Collected
    fmtDollars(o.discount_amt),
    fmtDollars(o.stripe_fee),
    fmtDollars(o.tip_chef),
    fmtDollars(o.chef_earnings),
    o.payout_status,
    getDeliveryLabel(o.order_method, o.delivery_provider, locale),
  ]);

  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  return csv;
}

/**
 * Generate PDF Buffer from orders
 */
export async function generateReportPDF(phpShopId: number, shopName: string, startDate: string, endDate: string, periodType: string, locale?: string): Promise<Buffer> {
  const data = await phpBridge.getSellerOrders(phpShopId, {
    type: 'all',
    status: 'all',
    page: 1,
    limit: 1000,
    startDate,
    endDate
  });

  const orders: SellerOrder[] = data.orders || [];
  
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      
      // Header
      doc.fontSize(20).text('Local Cooks', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(16).text(tLocale(locale, "sellerStatementTitle", { ns: "chef", defaultValue: "Seller Statement: {shopName}", shopName }), { align: 'center' });
      doc.fontSize(12).text(tLocale(locale, "periodLabel", { ns: "chef", defaultValue: "Period: {startDate} to {endDate} ({periodType})", startDate, endDate, periodType }), { align: 'center' });
      doc.moveDown(2);
      
      // Summary section
      const totalOrders = orders.length;
      const totalEarnings = orders.reduce((sum, o) => sum + Number(o.chef_earnings), 0);
      const totalTips = orders.reduce((sum, o) => sum + Number(o.tip_chef), 0);
      
      // Calculate Analytics
      let totalGross = 0;
      const uniqueCustomers = new Set<string>();
      const returningCustomers = new Set<string>();
      const itemCounts: Record<string, { qty: number, revenue: number }> = {};
      
      orders.forEach(o => {
        totalGross += Number(o.shopcharge) || 0;
        
        const cname = (o.customer_name || 'Guest').trim().toLowerCase();
        if (uniqueCustomers.has(cname)) {
          returningCustomers.add(cname);
        }
        uniqueCustomers.add(cname);

        const items = (o.items_description || '')
          .split(/<br\s*\/?>|\n/i)
          .map((item) => item.trim())
          .filter(Boolean);
        
        items.forEach(itemStr => {
          const qtyMatch = itemStr.match(/\(x(\d+)\)/i);
          const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
          
          const priceMatch = itemStr.match(/\(\$([\d.]+)\)/) || itemStr.match(/\$\([\d.]+\)/) || itemStr.match(/\$([\d.]+)/);
          const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
          
          const name = itemStr.replace(/\(x\d+\)/i, '').replace(/\(\$[\d.]+\)/, '').replace(/\$[\d.]+/, '').trim();
          
          if (name) {
            if (!itemCounts[name]) itemCounts[name] = { qty: 0, revenue: 0 };
            itemCounts[name].qty += qty;
            itemCounts[name].revenue += (qty * price);
          }
        });
      });

      const aov = totalOrders > 0 ? totalGross / totalOrders : 0;
      const returningPct = uniqueCustomers.size > 0 ? (returningCustomers.size / uniqueCustomers.size) * 100 : 0;
      
      const topItems = Object.entries(itemCounts)
        .sort((a, b) => b[1].qty - a[1].qty)
        .slice(0, 5)
        .map(([name, stats]) => ({ name, ...stats }));

      doc.fontSize(14).text(tLocale(locale, "executiveSummary", { ns: "chef", defaultValue: "Executive Summary" }), { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12).text(tLocale(locale, "totalOrdersCompleted", { ns: "chef", defaultValue: "Total Orders Completed: {totalOrders}", totalOrders }));
      doc.text(tLocale(locale, "totalChefEarningsLabel", { ns: "chef", defaultValue: "Total Chef Earnings: {amount}", amount: fmtDollars(totalEarnings) }));
      doc.text(tLocale(locale, "totalChefTipsLabel", { ns: "chef", defaultValue: "Total Chef Tips Received: {amount}", amount: fmtDollars(totalTips) }));
      doc.text(tLocale(locale, "avgOrderValueLabel", { ns: "chef", defaultValue: "Average Order Value (AOV): {amount}", amount: fmtDollars(aov) }));
      doc.text(tLocale(locale, "returningCustomersPctLabel", { ns: "chef", defaultValue: "Returning Customers: {pct}%", pct: returningPct.toFixed(1) }));
      
      if (topItems.length > 0) {
        doc.moveDown(1);
        doc.font('Helvetica-Bold').text(tLocale(locale, "topSellingItemsTitle", { ns: "chef", defaultValue: "Top Selling Items:" }));
        doc.font('Helvetica');
        topItems.forEach(item => {
          doc.text(`  • ${item.name}: ${tLocale(locale, "soldWithRevenue", { ns: "chef", defaultValue: "{qty} sold ({revenue})", qty: item.qty, revenue: fmtDollars(item.revenue) })}`);
        });
      }
      doc.moveDown(2);
      
      // Breakdown Table Header
      doc.fontSize(14).text(tLocale(locale, "orderBreakdownTitle", { ns: "chef", defaultValue: "Order Breakdown" }), { underline: true });
      doc.moveDown(0.5);
      
      let yPosition = doc.y;
      doc.fontSize(10);
      
      const colId = 50;
      const colDate = 100;
      const colGross = 200;
      const colTax = 270;
      const colFee = 330;
      const colTip = 390;
      const colNet = 450;
      
      doc.font('Helvetica-Bold');
      doc.text(tLocale(locale, "orderIdShort", { ns: "chef", defaultValue: "Order ID" }), colId, yPosition);
      doc.text(tLocale(locale, "dateShort", { ns: "chef", defaultValue: "Date" }), colDate, yPosition);
      doc.text(tLocale(locale, "grossShort", { ns: "chef", defaultValue: "Gross" }), colGross, yPosition);
      doc.text(tLocale(locale, "taxShort", { ns: "chef", defaultValue: "Tax" }), colTax, yPosition);
      doc.text(tLocale(locale, "feesShort", { ns: "chef", defaultValue: "Fees" }), colFee, yPosition);
      doc.text(tLocale(locale, "tipShort", { ns: "chef", defaultValue: "Tip" }), colTip, yPosition);
      doc.text(tLocale(locale, "netEarningsShort", { ns: "chef", defaultValue: "Net Earnings" }), colNet, yPosition);
      
      doc.moveTo(50, yPosition + 15).lineTo(550, yPosition + 15).stroke();
      doc.font('Helvetica');
      
      yPosition += 25;
      
      // Rows
      for (const o of orders) {
        if (yPosition > 700) {
          doc.addPage();
          yPosition = 50;
        }
        
        doc.text(`#${o.id}`, colId, yPosition);
        const shortDate = (o.order_time || '').split(' ')[0] || o.order_time;
        doc.text(shortDate, colDate, yPosition);
        doc.text(fmtDollars(o.shopcharge), colGross, yPosition);
        doc.text(fmtDollars(o.commission), colTax, yPosition);
        
        const totalFees = Number(o.discount_amt) + Number(o.stripe_fee);
        doc.text(`-${fmtDollars(totalFees)}`, colFee, yPosition, { width: 50, align: 'right' });
        
        doc.text(fmtDollars(o.tip_chef), colTip, yPosition, { width: 40, align: 'right' });
        doc.text(fmtDollars(o.chef_earnings), colNet, yPosition, { width: 70, align: 'right' });
        
        yPosition += 20;
      }
      
      doc.moveTo(50, yPosition + 5).lineTo(550, yPosition + 5).stroke();
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

interface StructuredItem {
  name: string;
  qty: number;
  price: number;
  isAddon: boolean;
}

function parseStructuredOrderItems(itemsStr: string | null | undefined): StructuredItem[] {
  if (!itemsStr) return [];
  const items = itemsStr
    .split(/<br\s*\/?>|\n/i)
    .filter(Boolean);
  
  return items.map((item) => {
    const isAddon = /^[o+]\s/i.test(item.trim()) || item.trim().startsWith('+');
    
    const qtyMatch = item.match(/\(x(\d+)\)/i);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

    const priceMatch = item.match(/\(\$([\d.]+)\)/) || item.match(/\$\([\d.]+\)/) || item.match(/\$([\d.]+)/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

    let cleaned = item
      .replace(/^[o+]\s*/i, "")
      .replace(/\s*\(x\d+\)/i, "")
      .replace(/\s*\(\$[\d.]+\)/, "")
      .replace(/\s*\$\([\d.]+\)/, "")
      .replace(/\s*\$[\d.]+/, "")
      .trim();
      
    return { name: cleaned, qty, price, isAddon };
  });
}

/**
 * Generate PDF Buffer for a single order invoice
 */
export async function generateSingleOrderInvoicePDF(phpShopId: number, shopName: string, orderId: number, orderDate: string): Promise<Buffer> {
  const data = await phpBridge.getSellerOrders(phpShopId, {
    type: 'all',
    status: 'all',
    page: 1,
    limit: 1000,
    startDate: orderDate,
    endDate: orderDate
  });

  const orders: SellerOrder[] = data.orders || [];
  const order = orders.find(o => o.id === orderId);

  if (!order) {
    throw new Error(`Order #${orderId} not found for the given date.`);
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];
      
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      
      // Constants
      const primaryColor = '#E51636'; // Red color
      const textColor = '#333333';
      const grayText = '#666666';
      
      // Header: INVOICE and Local Cooks
      doc.fontSize(28).font('Helvetica-Bold').fillColor(primaryColor).text('INVOICE', 50, 50);
      doc.fontSize(14).font('Helvetica').fillColor(grayText).text(`#${order.id}`, 50, 85);
      
      doc.fontSize(20).font('Helvetica-Bold').fillColor(textColor).text('Local Cooks', 50, 50, { align: 'right' });
      doc.fontSize(12).font('Helvetica').fillColor(grayText).text('localcook.shop', 50, 75, { align: 'right' });
      
      // Red line separator
      doc.moveDown(2);
      let yPos = Math.max(130, doc.y);
      doc.moveTo(50, yPos).lineTo(545, yPos).lineWidth(2).strokeColor(primaryColor).stroke();
      
      // Info section
      yPos += 20;
      doc.lineWidth(1); // reset
      
      const shortDate = (order.order_time || '').split(' ')[0] || order.order_time;
      let orderTime = '';
      if (order.order_time && order.order_time.includes(' ')) {
         const parts = order.order_time.split(' ');
         if (parts.length > 1) {
            const timeStr = parts.slice(1).join(' '); // Extract time part
            try {
               orderTime = format(new Date(`2000-01-01T${timeStr}`), 'h:mm a');
            } catch (e) {
               orderTime = timeStr;
            }
         }
      }

      // Left Column
      const leftCol = 50;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(textColor).text('Date: ', leftCol, yPos, { continued: true })
         .font('Helvetica').fillColor(grayText).text(shortDate);
      
      let nextY = yPos + 20;
      if (orderTime) {
         doc.font('Helvetica-Bold').fillColor(textColor).text('Time: ', leftCol, nextY, { continued: true })
            .font('Helvetica').fillColor(grayText).text(orderTime);
         nextY += 20;
      }
      
      doc.font('Helvetica-Bold').fillColor(textColor).text('Order Type: ', leftCol, nextY, { continued: true })
         .font('Helvetica').fillColor(grayText).text(getDeliveryLabel(order.order_method, order.delivery_provider));
      nextY += 20;
      
      // Right Column
      const rightCol = 300;
      doc.font('Helvetica-Bold').fillColor(textColor).text('Restaurant: ', rightCol, yPos, { continued: true })
         .font('Helvetica').fillColor(grayText).text(shopName);
      
      doc.font('Helvetica-Bold').fillColor(textColor).text('Customer: ', rightCol, yPos + 20, { continued: true })
         .font('Helvetica').fillColor(grayText).text(order.customer_name || 'Guest');
      
      yPos = nextY + 30;

      // Table Header
      doc.roundedRect(50, yPos, 495, 30, 5).fill('#F3F4F6');
      doc.fillColor(textColor).font('Helvetica-Bold').fontSize(11);
      doc.text('Item', 65, yPos + 10);
      doc.text('Qty', 350, yPos + 10, { width: 50, align: 'center' });
      doc.text('Price', 450, yPos + 10, { width: 80, align: 'right' });
      
      yPos += 45;
      
      // Table Items
      doc.font('Helvetica').fontSize(11);
      const items = parseStructuredOrderItems(order.items_description);
      
      for (const item of items) {
          if (yPos > 650) {
              doc.addPage();
              yPos = 50;
          }
          
          if (item.isAddon) {
             doc.fillColor(grayText);
             doc.text(`+ ${item.name}`, 75, yPos);
             if (item.price > 0) {
                doc.text(fmtDollars(item.price), 450, yPos, { width: 80, align: 'right' });
             }
          } else {
             doc.fillColor(textColor);
             doc.text(item.name, 65, yPos);
             doc.text(item.qty.toString(), 350, yPos, { width: 50, align: 'center' });
             doc.text(fmtDollars(item.price), 450, yPos, { width: 80, align: 'right' });
          }
          
          yPos += doc.heightOfString(item.name, { width: 280 }) + 5;
      }
      
      // Table Footer border
      doc.rect(50, yPos, 495, 1).fill('#E5E7EB');
      yPos += 15;
      
      // Totals
      const totalColLeft = 250;
      const totalColRight = 450;
      doc.fontSize(11).font('Helvetica');
      
      doc.fillColor(grayText).text('Subtotal', totalColLeft, yPos);
      doc.fillColor(textColor).text(fmtDollars(order.shopcharge), totalColRight, yPos, { width: 80, align: 'right' });
      yPos += 20;

      if (order.commission > 0) {
        doc.fillColor(grayText).text('Tax Collected', totalColLeft, yPos);
        doc.fillColor(textColor).text(fmtDollars(order.commission), totalColRight, yPos, { width: 80, align: 'right' });
        yPos += 20;
      }

      if (order.tip_chef > 0) {
        doc.fillColor(grayText).text('Tip', totalColLeft, yPos);
        doc.fillColor(textColor).text(fmtDollars(order.tip_chef), totalColRight, yPos, { width: 80, align: 'right' });
        yPos += 20;
      }

      const deductions = Number(order.discount_amt) + Number(order.stripe_fee);
      if (deductions > 0) {
        doc.fillColor(grayText).text('Deductions', totalColLeft, yPos);
        doc.fillColor(textColor).text(`-${fmtDollars(deductions)}`, totalColRight, yPos, { width: 80, align: 'right' });
        yPos += 20;
      }

      doc.rect(totalColLeft, yPos, 280, 1).fill('#000000');
      yPos += 10;
      
      doc.font('Helvetica-Bold').fontSize(14).fillColor(textColor).text('Net Earnings', totalColLeft, yPos);
      doc.text(fmtDollars(order.chef_earnings), totalColRight, yPos, { width: 80, align: 'right' });
      yPos += 40;
      
      // Payment Status Box
      const isPaid = order.payout_status === 'paid';
      const statusColor = isPaid ? '#16a34a' : '#d97706'; // green or amber text
      const statusBg = isPaid ? '#dcfce7' : '#fef3c7'; // light green or amber bg
      const statusBorder = isPaid ? '#bbf7d0' : '#fde68a';
      
      doc.roundedRect(50, yPos, 495, 40, 5)
         .fillAndStroke(statusBg, statusBorder);
      
      doc.font('Helvetica-Bold').fontSize(12).fillColor(textColor)
         .text('Payment Status: ', 70, yPos + 14, { continued: true })
         .fillColor(statusColor).text(order.payout_status.toUpperCase());
         
      // Footer
      doc.fontSize(10).font('Helvetica').fillColor('#9CA3AF');
      doc.text('Thank you for being a Local Cooks seller!', 50, doc.page.height - 100, { align: 'center' });
      doc.text(`Generated on ${format(new Date(), 'MMM dd, yyyy \\at h:mm a')}`, 50, doc.page.height - 85, { align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Process reports and send emails for all eligible chefs via cron
 */
export async function processScheduledReports(period: 'weekly' | 'monthly'): Promise<void> {
  const now = new Date();
  let startDate = '';
  let endDate = '';
  
  if (period === 'weekly') {
    const end = new Date(now);
    end.setDate(now.getDate() - 1);
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    
    startDate = format(start, 'yyyy-MM-dd');
    endDate = format(end, 'yyyy-MM-dd');
  } else if (period === 'monthly') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0); 
    
    startDate = format(start, 'yyyy-MM-dd');
    endDate = format(end, 'yyyy-MM-dd');
  }

  logger.info(`[Seller Reports Cron] Starting ${period} reports generation for ${startDate} to ${endDate}`);

  const linkedChefs = await db
    .select({
      id: users.id,
      email: users.username,
      phpShopId: users.phpShopId,
      username: users.username,
      preferredLocale: users.preferredLocale
    })
    .from(users)
    .where(isNotNull(users.phpShopId));

  logger.info(`[Seller Reports Cron] Found ${linkedChefs.length} chefs with linked accounts.`);

  let successCount = 0;
  let failCount = 0;

  for (const chef of linkedChefs) {
    if (!chef.email || !chef.phpShopId) continue;
    
    try {
      const [app] = await db
          .select({ fullName: applications.fullName, shopName: applications.shopName })
          .from(applications)
          .where(eq(applications.userId, chef.id))
          .orderBy(desc(applications.id))
          .limit(1);

      const chefName = app?.fullName || (chef.username ? chef.username.split('@')[0] : 'Chef');
      const shopName = app?.shopName && app.shopName !== 'Shop Not Named' 
          ? app.shopName 
          : chefName + "'s Shop";

      const locale = chef.preferredLocale || 'en';
      const csvContent = await generateReportCSV(chef.phpShopId, startDate, endDate, locale);
      const pdfBuffer = await generateReportPDF(chef.phpShopId, shopName, startDate, endDate, period, locale);
      
      await sendChefReportEmail(chef.email, chefName, pdfBuffer, csvContent, period, startDate, endDate);
      successCount++;
    } catch (err) {
      logger.error(`[Seller Reports Cron] Failed to send report to ${chef.email}:`, err);
      failCount++;
    }
  }

  logger.info(`[Seller Reports Cron] Completed ${period} reports. Success: ${successCount}, Failures: ${failCount}`);
}
