import { db } from "../db";
import { users, applications } from "@shared/schema";
import { isNotNull, eq, desc } from "drizzle-orm";
import * as phpBridge from './php-bridge-service';
import { logger } from "../logger";
import PDFDocument from 'pdfkit';
import { format } from 'date-fns';
import { sendChefReportEmail } from "../email";

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

function getDeliveryLabel(method: string, provider: string): string {
  if (method === "pickup") return "Pickup";
  if (provider === "uber_direct") return "Uber Direct";
  return "In-House Delivery";
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
export async function generateReportCSV(phpShopId: number, startDate: string, endDate: string): Promise<string> {
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
    "Order ID", "Type", "Date", "Customer", "Items",
    "Shop Charge", "Tax Collected", "Discount", "Stripe Fee", "Tip (Chef)",
    "Your Earnings", "Payout Status", "Delivery Method",
  ];

  const rows = orders.map((o) => [
    o.id,
    o.type === "pre_order" ? "Pre-Order" : "Order",
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
    getDeliveryLabel(o.order_method, o.delivery_provider),
  ]);

  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  return csv;
}

/**
 * Generate PDF Buffer from orders
 */
export async function generateReportPDF(phpShopId: number, shopName: string, startDate: string, endDate: string, periodType: string): Promise<Buffer> {
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
      doc.fontSize(16).text(`Seller Statement: ${shopName}`, { align: 'center' });
      doc.fontSize(12).text(`Period: ${startDate} to ${endDate} (${periodType})`, { align: 'center' });
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

      doc.fontSize(14).text('Executive Summary', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12).text(`Total Orders Completed: ${totalOrders}`);
      doc.text(`Total Chef Earnings: ${fmtDollars(totalEarnings)}`);
      doc.text(`Total Chef Tips Received: ${fmtDollars(totalTips)}`);
      doc.text(`Average Order Value (AOV): ${fmtDollars(aov)}`);
      doc.text(`Returning Customers: ${returningPct.toFixed(1)}%`);
      
      if (topItems.length > 0) {
        doc.moveDown(1);
        doc.font('Helvetica-Bold').text('Top Selling Items:');
        doc.font('Helvetica');
        topItems.forEach(item => {
          doc.text(`  • ${item.name}: ${item.qty} sold (${fmtDollars(item.revenue)})`);
        });
      }
      doc.moveDown(2);
      
      // Breakdown Table Header
      doc.fontSize(14).text('Order Breakdown', { underline: true });
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
      doc.text('Order ID', colId, yPosition);
      doc.text('Date', colDate, yPosition);
      doc.text('Gross', colGross, yPosition);
      doc.text('Tax', colTax, yPosition);
      doc.text('Fees', colFee, yPosition);
      doc.text('Tip', colTip, yPosition);
      doc.text('Net Earnings', colNet, yPosition);
      
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
      
      // Header
      doc.fontSize(22).font('Helvetica-Bold').text('Local Cooks', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(16).font('Helvetica').text(`Order Invoice`, { align: 'center' });
      doc.moveDown(2);

      // Order Info
      doc.fontSize(12).font('Helvetica');
      doc.text(`Shop: ${shopName}`);
      doc.text(`Order ID: #${order.id} (${order.type === 'pre_order' ? 'Pre-Order' : 'Order'})`);
      
      const shortDate = (order.order_time || '').split(' ')[0] || order.order_time;
      doc.text(`Order Date: ${shortDate}`);
      doc.text(`Customer: ${order.customer_name || 'Guest'}`);
      doc.text(`Delivery Method: ${getDeliveryLabel(order.order_method, order.delivery_provider)}`);
      doc.text(`Payout Status: ${order.payout_status.toUpperCase()}`);
      doc.moveDown(2);

      // Items section
      doc.fontSize(14).font('Helvetica-Bold').text('Items Ordered', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica');
      
      const itemsText = parseOrderItemsForReport(order.items_description);
      if (itemsText) {
        doc.text(itemsText, { lineGap: 4 });
      } else {
        doc.text('No items description available.');
      }
      doc.moveDown(2);

      // Revenue Breakdown
      doc.fontSize(14).font('Helvetica-Bold').text('Revenue Breakdown', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica');

      const colLeft = 50;
      const colRight = 400;

      let yPos = doc.y;

      doc.text('Shop Charge (Food Total):', colLeft, yPos);
      doc.text(fmtDollars(order.shopcharge), colRight, yPos, { width: 100, align: 'right' });
      yPos += 20;

      if (order.commission > 0) {
        doc.text('Tax Collected:', colLeft, yPos);
        doc.text(fmtDollars(order.commission), colRight, yPos, { width: 100, align: 'right' });
        yPos += 20;
      }

      if (order.tip_chef > 0) {
        doc.text('Tip (Chef):', colLeft, yPos);
        doc.text(fmtDollars(order.tip_chef), colRight, yPos, { width: 100, align: 'right' });
        yPos += 20;
      }

      const deductions = Number(order.discount_amt) + Number(order.stripe_fee);
      if (deductions > 0) {
        doc.text('Deductions (Discount & Stripe Fee):', colLeft, yPos);
        doc.text(`-${fmtDollars(deductions)}`, colRight, yPos, { width: 100, align: 'right' });
        yPos += 20;
      }

      doc.moveTo(50, yPos + 5).lineTo(500, yPos + 5).stroke();
      yPos += 15;

      doc.font('Helvetica-Bold').text('Net Earnings:', colLeft, yPos);
      doc.text(fmtDollars(order.chef_earnings), colRight, yPos, { width: 100, align: 'right' });

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
      username: users.username
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

      const csvContent = await generateReportCSV(chef.phpShopId, startDate, endDate);
      const pdfBuffer = await generateReportPDF(chef.phpShopId, shopName, startDate, endDate, period);
      
      await sendChefReportEmail(chef.email, chefName, pdfBuffer, csvContent, period, startDate, endDate);
      successCount++;
    } catch (err) {
      logger.error(`[Seller Reports Cron] Failed to send report to ${chef.email}:`, err);
      failCount++;
    }
  }

  logger.info(`[Seller Reports Cron] Completed ${period} reports. Success: ${successCount}, Failures: ${failCount}`);
}
