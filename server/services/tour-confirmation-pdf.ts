import PDFDocument from "pdfkit";
import path from "node:path";

export type TourConfirmationDetails = {
  id: number;
  chefName: string;
  chefEmail: string;
  locationName: string;
  kitchenName: string | null;
  locationAddress: string | null;
  managerName: string | null;
  managerEmail: string | null;
  managerPhone: string | null;
  scheduledAt: Date;
  durationMinutes: number;
  submittedAt: Date;
  timezone: string;
  chefNotes: string | null;
  intakeData: Record<string, unknown> | null;
  managerNotes: string | null;
};

export function tourReference(id: number): string {
  return `TOUR-${id}`;
}

export function buildTourConfirmationPdf(tour: TourConfirmationDetails): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const notes = [tour.chefNotes?.trim() ? ["Your note to the kitchen", tour.chefNotes.trim()] : null,
      tour.managerNotes?.trim() ? ["From the kitchen manager", tour.managerNotes.trim()] : null].filter((item): item is string[] => item !== null);
    const contactHeight = 126;
    const footerY = 587 + contactHeight + notes.length * 82;
    const doc = new PDFDocument({ size: [612, 645 + contactHeight + notes.length * 82], margin: 0 });
    const asset = (name: string) => path.join(process.cwd(), "server/assets", name);
    doc.registerFont("Body", asset("fonts/DejaVuSans.ttf"));
    doc.registerFont("Brand", asset("fonts/Lobster-Regular.ttf"));
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ink = "#172033";
    const muted = "#64748b";
    const line = "#e2e8f0";
    const red = "#e51636";
    const formatDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tour.timezone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);
    const formatTime = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tour.timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(date);
    const end = new Date(tour.scheduledAt.getTime() + tour.durationMinutes * 60_000);
    const label = (value: string, x: number, y: number) => doc.font("Helvetica-Bold").fontSize(8).fillColor(muted).text(value.toUpperCase(), x, y, { characterSpacing: 1.1 });

    doc.image(asset("LoCo Red.png"), 52, 42, { width: 42 });
    doc.font("Brand").fontSize(21).fillColor(ink).text("Local Cooks", 110, 51);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(muted).text("KITCHEN TOURS", 111, 78, { characterSpacing: 1.5 });
    label("Confirmation", 454, 55);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(ink).text(tourReference(tour.id), 454, 72);
    doc.moveTo(52, 119).lineTo(560, 119).strokeColor(line).stroke();

    doc.roundedRect(52, 143, 90, 24, 12).fill("#ecfdf5");
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#047857").text("CONFIRMED", 65, 151, { characterSpacing: 0.7 });
    doc.font("Helvetica-Bold").fontSize(24).fillColor(ink).text("Your kitchen tour", 52, 184);
    doc.font("Body").fontSize(10).fillColor(muted).text("Your time, destination and contacts for the visit.", 52, 218);

    const cardY = 258;
    doc.roundedRect(52, cardY, 508, 224, 12).fill("#f8fafc");
    doc.rect(52, cardY + 14, 3, 196).fill(red);
    label("Date", 73, cardY + 24);
    doc.font("Helvetica-Bold").fontSize(15).fillColor(ink).text(formatDate(tour.scheduledAt), 73, cardY + 41, { width: 460 });
    label("Time", 73, cardY + 77);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(ink).text(`${formatTime(tour.scheduledAt)} – ${formatTime(end)}`, 73, cardY + 94);
    doc.font("Body").fontSize(9).fillColor(muted).text(`${tour.durationMinutes} minute visit`, 400, cardY + 97, { width: 135, align: "right" });
    doc.moveTo(73, cardY + 123).lineTo(539, cardY + 123).strokeColor(line).stroke();
    doc.font("Helvetica-Bold").fontSize(12).fillColor(ink).text(tour.kitchenName || tour.locationName, 73, cardY + 137, { width: 465 });
    if (tour.kitchenName && tour.kitchenName !== tour.locationName) doc.font("Body").fontSize(9).fillColor(muted).text(tour.locationName, 73, cardY + 155, { width: 465 });
    label("Address", 73, cardY + 178);
    doc.font("Body").fontSize(10).fillColor(ink).text(tour.locationAddress || "Address from kitchen manager", 73, cardY + 194, { width: 465, height: 26, ellipsis: true });

    label("Visiting chef", 52, 511);
    doc.font("Body").fontSize(10).fillColor(ink).text(tour.chefName, 52, 528, { width: 240 });
    doc.font("Body").fontSize(9).fillColor(muted).text(tour.chefEmail, 52, 546, { width: 240 });

    doc.moveTo(52, 579).lineTo(560, 579).strokeColor(line).stroke();
    label("Kitchen contact", 52, 594);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(ink).text(tour.managerName || "Kitchen manager", 52, 612, { width: 245 });
    if (tour.managerPhone) doc.font("Body").fontSize(9).fillColor(ink).text(tour.managerPhone, 52, 632, { width: 245 });
    if (tour.managerEmail) doc.font("Body").fontSize(9).fillColor(ink).text(tour.managerEmail, 52, tour.managerPhone ? 648 : 632, { width: 245 });
    if (!tour.managerPhone && !tour.managerEmail) doc.font("Body").fontSize(9).fillColor(muted).text("Contact the kitchen through Local Cooks", 52, 632, { width: 245 });
    label("Local Cooks support", 320, 594);
    doc.font("Body").fontSize(9).fillColor(ink).text("support@localcook.shop", 320, 613, { width: 240 });
    doc.font("Body").fontSize(9).fillColor(ink).text("709-631-8480", 320, 632, { width: 240 });
    doc.font("Body").fontSize(8).fillColor(muted).text(`Include ${tourReference(tour.id)} when contacting us.`, 320, 653, { width: 240 });

    let nextY = 579 + contactHeight;
    for (const [heading, value] of notes) {
      doc.moveTo(52, nextY).lineTo(560, nextY).strokeColor(line).stroke();
      label(heading, 52, nextY + 13);
      doc.font("Body").fontSize(9).fillColor(ink).text(value, 52, nextY + 29, { width: 508, height: 49, ellipsis: true });
      nextY += 82;
    }

    doc.moveTo(52, footerY).lineTo(560, footerY).strokeColor(line).stroke();
    doc.font("Body").fontSize(8).fillColor(muted).text("Need to change your tour? Manage it in My Tours in your Local Cooks account.", 52, footerY + 13, { width: 508 });
    doc.font("Helvetica").fontSize(8).fillColor(muted).text("localcooks.ca", 52, footerY + 31);
    doc.font("Helvetica").fontSize(8).fillColor(muted).text(tourReference(tour.id), 455, footerY + 31, { width: 105, align: "right" });
    doc.end();
  });
}
