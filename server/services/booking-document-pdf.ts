/**
 * Renders a stored booking document snapshot. Input is the snapshot ONLY (no database, no clock, no provider), and the
 * PDF metadata dates come from the snapshot's issue time, so the same document always renders to the same bytes.
 */
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { formatInstantDate, formatMoney, type DocLine, type DocumentSnapshot } from '@shared/booking-documents';

const INK = '#172033', MUTED = '#64748b', RULE = '#e2e8f0', RED = '#e51636', PAGE_BOTTOM = 712;

export function renderBookingDocumentPdf(snapshot: DocumentSnapshot): Promise<Buffer> {
  const timezone = snapshot.timezone || 'America/St_Johns';
  return new Promise((resolve, reject) => {
    const issued = new Date(snapshot.issuedAt);
    // Bottom margin 0: PDFKit never auto-inserts a page for the footer; pages are added explicitly below.
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, left: 50, right: 50, bottom: 0 },
      info: { Title: `${snapshot.title} ${snapshot.number}`, Author: 'Local Cooks', Creator: 'Local Cooks', Producer: 'Local Cooks', CreationDate: issued, ModDate: issued } });
    const asset = (name: string) => path.join(process.cwd(), 'server/assets', name);
    doc.registerFont('Body', asset('fonts/DejaVuSans.ttf'));
    doc.registerFont('Brand', asset('fonts/Lobster-Regular.ttf'));
    // No ligatures: copied text must read "offer", not "oﬀer".
    const rawText = doc.text.bind(doc);
    doc.text = ((value: string, x?: number, y?: number, options: Record<string, unknown> = {}) =>
      rawText(value, x, y, { ...options, features: { liga: false, clig: false } } as never)) as unknown as typeof doc.text;
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      const left = 50, right = 562, width = right - left, amountX = 452, amountW = 110, labelW = 380;
      const footer = () => {
        doc.font('Body').fontSize(8).fillColor(MUTED)
          .text(`Questions? ${snapshot.supplier.email} · ${snapshot.supplier.website}`, left, 752, { width, align: 'center', lineBreak: false });
      };
      const ensureRoom = (needed: number) => {
        if (y + needed <= PAGE_BOTTOM) return;
        footer();
        doc.addPage();
        y = 50;
      };

      // Header: brand + supplier (left), document title + number (right).
      doc.image(asset('LoCo Red.png'), left, 44, { width: 34 });
      doc.font('Brand').fontSize(20).fillColor(INK).text(snapshot.supplier.name, left + 44, 48, { lineBreak: false });
      doc.font('Body').fontSize(8).fillColor(MUTED);
      let supplierY = 84;
      for (const lineText of [snapshot.supplier.legalNote, snapshot.supplier.address, snapshot.supplier.website,
        ...(snapshot.supplier.taxNumber ? [`GST/HST registration: ${snapshot.supplier.taxNumber}`] : [])]) {
        doc.text(lineText, left, supplierY, { width: 300 });
        supplierY += 11;
      }
      doc.font('Body').fontSize(22).fillColor(RED).text(snapshot.title, 300, 46, { width: right - 300, align: 'right' });
      doc.fontSize(10).fillColor(INK).text(snapshot.number, 300, 76, { width: right - 300, align: 'right' });
      doc.fontSize(9).fillColor(MUTED).text(`Issued ${formatInstantDate(snapshot.issuedAt, timezone)}`, 300, 90, { width: right - 300, align: 'right' });
      if (snapshot.references) doc.text(`Refers to ${snapshot.references.number}`, 300, 102, { width: right - 300, align: 'right' });

      let y = Math.max(supplierY, 116) + 8;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(1.5).strokeColor(RED).stroke();
      y += 14;

      // Facts: booking (left) and parties (right).
      const fact = (x: number, top: number, label: string, value: string, detail?: string, w = 240) => {
        doc.font('Body').fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), x, top, { width: w, characterSpacing: 0.6 });
        doc.fontSize(9.5).fillColor(INK).text(value, x, top + 10, { width: w });
        let bottom = top + 10 + doc.heightOfString(value, { width: w });
        if (detail) { doc.fontSize(8.5).fillColor(MUTED).text(detail, x, bottom + 1, { width: w }); bottom += 1 + doc.heightOfString(detail, { width: w }); }
        return bottom + 7;
      };
      let leftY = y, rightY = y;
      for (const item of snapshot.meta) leftY = fact(left, leftY, item.label, item.value);
      for (const item of snapshot.parties) rightY = fact(322, rightY, item.label, item.value, item.detail);
      y = Math.max(leftY, rightY) + 6;

      // Lines.
      doc.rect(left, y, width, 22).fill('#f3f4f6');
      doc.font('Body').fontSize(8.5).fillColor(MUTED).text('DESCRIPTION', left + 10, y + 7, { characterSpacing: 0.6 })
        .text('AMOUNT', amountX, y + 7, { width: amountW - 10, align: 'right', characterSpacing: 0.6 });
      y += 30;
      const line = (item: DocLine) => {
        const subtotal = item.tone === 'subtotal';
        const labelHeight = doc.font('Body').fontSize(subtotal ? 9.5 : 10).heightOfString(item.label, { width: labelW });
        const detailHeight = item.detail ? doc.fontSize(8.5).heightOfString(item.detail, { width: labelW }) + 2 : 0;
        ensureRoom(labelHeight + detailHeight + 8);
                doc.font('Body').fontSize(subtotal ? 9.5 : 10).fillColor(subtotal ? MUTED : INK).text(item.label, left + 10, y, { width: labelW });
        if (item.amountCents !== null) doc.fillColor(item.tone === 'refund' ? '#c2410c' : subtotal ? MUTED : INK)
          .text(item.tone === 'note' && item.amountCents === 0 ? 'No charge' : formatMoney(item.amountCents), amountX, y, { width: amountW - 10, align: 'right' });
        if (item.detail) doc.fontSize(8.5).fillColor(MUTED).text(item.detail, left + 10, y + labelHeight + 1, { width: labelW });
        y += labelHeight + detailHeight + 7;
      };
      for (const section of snapshot.sections) {
        if (section.heading) {
          ensureRoom(40);
          y += 4;
          doc.font('Body').fontSize(9).fillColor(RED).text(section.heading, left + 10, y, { width: labelW });
          y += 15;
        }
        for (const item of section.lines) line(item);
        y += 2;
        doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
        y += 8;
      }

      // Total.
      ensureRoom(40);
      doc.moveTo(322, y).lineTo(right, y).lineWidth(1).strokeColor(INK).stroke();
      y += 8;
      doc.font('Body').fontSize(13).fillColor(INK).text(snapshot.total.label, 322, y, { width: 150 });
      doc.fillColor(RED).text(`${formatMoney(snapshot.total.amountCents)} ${snapshot.currency}`, 412, y, { width: right - 412, align: 'right' });
      y += Math.max(24, doc.heightOfString(snapshot.total.label, { width: 150 }) + 8);

      // Notes.
      for (const note of snapshot.notes) {
        const height = doc.font('Body').fontSize(9).heightOfString(note, { width });
        ensureRoom(height + 6);
        doc.fillColor(MUTED).text(note, left, y, { width });
        y += height + 5;
      }
      footer();
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
