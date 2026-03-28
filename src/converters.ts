import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import mammoth from 'mammoth';

export async function convertImageToPdf(imageBuffer: Buffer, mimeType: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  
  let image;
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    image = await pdfDoc.embedJpg(imageBuffer);
  } else if (mimeType === 'image/png') {
    image = await pdfDoc.embedPng(imageBuffer);
  } else {
    throw new Error(`Unsupported image type: ${mimeType}`);
  }

  const page = pdfDoc.addPage();
  const { width: pageWidth, height: pageHeight } = page.getSize();
  
  const { width, height } = image.scaleToFit(pageWidth - 100, pageHeight - 100);
  
  page.drawImage(image, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

export async function convertExcelToPdf(excelBuffer: Buffer): Promise<Buffer> {
  const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
  
  const doc = new jsPDF();
  let isFirstSheet = true;

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    if (!isFirstSheet) {
      doc.addPage();
    }
    isFirstSheet = false;

    doc.setFontSize(14);
    doc.text(sheetName, 14, 15);

    if (data.length > 0) {
      (doc as any).autoTable({
        head: [data[0]],
        body: data.slice(1),
        startY: 25,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [66, 139, 202] },
      });
    }
  });

  const pdfBytes = doc.output('arraybuffer');
  return Buffer.from(pdfBytes);
}

export async function convertWordToPdf(wordBuffer: Buffer): Promise<Buffer> {
  const result = await mammoth.extractRawText({ buffer: wordBuffer });
  const text = result.value;

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const maxWidth = pageWidth - 2 * margin;

  doc.setFontSize(11);
  
  const lines = doc.splitTextToSize(text, maxWidth);
  let y = margin;
  const lineHeight = 7;
  const pageHeight = doc.internal.pageSize.getHeight();

  lines.forEach((line: string) => {
    if (y + lineHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  });

  const pdfBytes = doc.output('arraybuffer');
  return Buffer.from(pdfBytes);
}
