import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const RED = rgb(225 / 255, 9 / 255, 57 / 255);
const INK = rgb(0.08, 0.07, 0.07);
const MUTED = rgb(0.37, 0.35, 0.35);

/**
 * Certificate of completion for the Local Cooks food safety videos (owner, Oct 27). It says what it is and what it
 * is not: a learning record, never a food handler certificate or NL-approved training.
 */
export async function generateCertificatePDF(data: { name: string; completedAt: Date; reference: string }): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Certificate of completion · Local Cooks');
  const page = pdf.addPage([792, 612]); // US Letter, landscape
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const centre = (text: string, y: number, size: number, font = regular, color = INK) =>
    page.drawText(text, { x: (width - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });

  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: rgb(0.9, 0.88, 0.88), borderWidth: 1 });
  page.drawRectangle({ x: 24, y: height - 30, width: width - 48, height: 6, color: RED });

  centre('Local Cooks', height - 96, 22, bold, RED);
  centre('CERTIFICATE OF COMPLETION', height - 150, 13, bold, MUTED);
  const name = data.name.length > 48 ? `${data.name.slice(0, 47)}…` : data.name;
  centre(name, height - 222, 34, bold);
  centre('completed the Local Cooks food safety video course:', height - 268, 14);
  centre('22 videos from Unilever Food Solutions on food safety basics and kitchen hygiene,', height - 290, 14);
  centre('built on HACCP principles.', height - 312, 14);

  const date = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/St_Johns' }).format(data.completedAt);
  page.drawLine({ start: { x: 150, y: 196 }, end: { x: 342, y: 196 }, thickness: 0.75, color: MUTED });
  page.drawLine({ start: { x: 450, y: 196 }, end: { x: 642, y: 196 }, thickness: 0.75, color: MUTED });
  page.drawText(date, { x: 246 - regular.widthOfTextAtSize(date, 13) / 2, y: 204, size: 13, font: regular, color: INK });
  page.drawText('Completed', { x: 246 - regular.widthOfTextAtSize('Completed', 10) / 2, y: 182, size: 10, font: regular, color: MUTED });
  page.drawText(data.reference, { x: 546 - regular.widthOfTextAtSize(data.reference, 13) / 2, y: 204, size: 13, font: regular, color: INK });
  page.drawText('Reference', { x: 546 - regular.widthOfTextAtSize('Reference', 10) / 2, y: 182, size: 10, font: regular, color: MUTED });

  centre('This certificate records a learning course. It is not a food handler certificate or', 92, 10, regular, MUTED);
  centre('food safety training approved under the Newfoundland and Labrador Food Premises Regulations.', 78, 10, regular, MUTED);
  centre('localcooks.ca', 52, 10, bold, MUTED);

  return Buffer.from(await pdf.save());
}
