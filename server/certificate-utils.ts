import { PDFDocument, rgb } from 'pdf-lib';
import { User } from '@shared/schema';

export async function generateCertificatePDF(user: any, course: any): Promise<Buffer> {
    // efficient stub implementation to fix build error
    // In a real implementation, this would generate a PDF with the user's name and course details
    console.log(`Generating certificate for user ${user.id} and course ${course.id}`);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);

    page.drawText('Certificate of Completion', {
        x: 50,
        y: 350,
        size: 30,
        color: rgb(0, 0, 0),
    });

    page.drawText(`Awarded to: ${user.fullName || user.username}`, {
        x: 50,
        y: 300,
        size: 20,
    });

    page.drawText(`For completing: ${course.title}`, {
        x: 50,
        y: 250,
        size: 20,
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
}
