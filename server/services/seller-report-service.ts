import { db } from "../db";
import { users } from "@shared/schema";
import { isNotNull } from "drizzle-orm";
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
    "Shop Charge", "Discount", "Stripe Fee", "Commission", "Tip (Chef)",
    "Your Earnings", "Payout Status", "Delivery Method",
  ];

  const rows = orders.map((o) => [
    o.id,
    o.type === "pre_order" ? "Pre-Order" : "Order",
    `"${o.order_time}"`, 
    `"${(o.customer_name || '').replace(/"/g, '""')}"`,
    `"${(o.items_description || "").replace(/"/g, '""')}"`,
    fmtDollars(o.shopcharge),
    fmtDollars(o.discount_amt),
    fmtDollars(o.stripe_fee),
    fmtDollars(o.commission),
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
      doc.fontSize(20).text('Local Cooks Community', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(16).text(`Seller Statement: ${shopName}`, { align: 'center' });
      doc.fontSize(12).text(`Period: ${startDate} to ${endDate} (${periodType})`, { align: 'center' });
      doc.moveDown(2);
      
      // Summary section
      const totalOrders = orders.length;
      const totalEarnings = orders.reduce((sum, o) => sum + Number(o.chef_earnings), 0);
      const totalTips = orders.reduce((sum, o) => sum + Number(o.tip_chef), 0);
      const totalCommission = orders.reduce((sum, o) => sum + Number(o.commission), 0);
      
      doc.fontSize(14).text('Executive Summary', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12).text(`Total Orders Completed: ${totalOrders}`);
      doc.text(`Total Chef Earnings: ${fmtDollars(totalEarnings)}`);
      doc.text(`Total Chef Tips Received: ${fmtDollars(totalTips)}`);
      doc.text(`Platform Commission Deducted: ${fmtDollars(totalCommission)}`);
      doc.moveDown(2);
      
      // Breakdown Table Header
      doc.fontSize(14).text('Order Breakdown', { underline: true });
      doc.moveDown(0.5);
      
      let yPosition = doc.y;
      doc.fontSize(10);
      
      const colId = 50;
      const colDate = 100;
      const colGross = 250;
      const colFee = 320;
      const colTip = 380;
      const colNet = 450;
      
      doc.font('Helvetica-Bold');
      doc.text('Order ID', colId, yPosition);
      doc.text('Date', colDate, yPosition);
      doc.text('Gross', colGross, yPosition);
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
        
        const totalFees = Number(o.discount_amt) + Number(o.stripe_fee) + Number(o.commission);
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
      const chefName = chef.username ? chef.username.split('@')[0] : 'Chef';
      const shopName = chefName + "'s Shop";

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
