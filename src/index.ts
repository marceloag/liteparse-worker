import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { LiteParse } from '@llamaindex/liteparse';
import { convertImageToPdf, convertExcelToPdf, convertWordToPdf } from './converters';

const app = new Hono();

app.use('/*', cors());

app.get('/', (c) => {
  return c.json({
    message: 'Document Parser Worker',
    endpoints: {
      'POST /parse': 'Upload a PDF file to parse its text content',
      'POST /parse-document': 'Upload Office files (Word, Excel, PowerPoint) or images (PNG, JPG, etc.) to parse their text content'
    }
  });
});

app.post('/parse', async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No PDF file provided. Please upload a file with key "file"' }, 400);
    }

    if (file.type !== 'application/pdf') {
      return c.json({ error: 'Invalid file type. Only PDF files are accepted' }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const parser = new LiteParse({ ocrEnabled: true });
    const result = await parser.parse(buffer);

    return c.json({
      success: true,
      filename: file.name,
      size: file.size,
      text: result.text,
      metadata: result.metadata || {}
    });

  } catch (error) {
    console.error('Error parsing PDF:', error);
    return c.json({
      error: 'Failed to parse PDF',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

app.post('/parse-document', async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file provided. Please upload a file with key "file"' }, 400);
    }

    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'application/vnd.ms-powerpoint', // .ppt
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff'
    ];

    if (!allowedTypes.includes(file.type)) {
      return c.json({ 
        error: 'Invalid file type. Supported formats: Word (.doc, .docx), Excel (.xls, .xlsx), PowerPoint (.ppt, .pptx), Images (.png, .jpg, .jpeg, .gif, .webp, .bmp, .tiff)',
        receivedType: file.type
      }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);

    // Convert to PDF first based on file type
    let convertedToPdf = false;
    
    // Images
    if (['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      console.log(`Converting image (${file.type}) to PDF...`);
      buffer = await convertImageToPdf(buffer, file.type);
      convertedToPdf = true;
    }
    // Excel files
    else if (['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'].includes(file.type)) {
      console.log(`Converting Excel (${file.type}) to PDF...`);
      buffer = await convertExcelToPdf(buffer);
      convertedToPdf = true;
    }
    // Word files
    else if (['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'].includes(file.type)) {
      console.log(`Converting Word (${file.type}) to PDF...`);
      buffer = await convertWordToPdf(buffer);
      convertedToPdf = true;
    }
    // PowerPoint - not supported yet
    else if (['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint'].includes(file.type)) {
      return c.json({
        error: 'PowerPoint conversion is not yet supported. Please convert to PDF manually or use Word/Excel/Images.',
        receivedType: file.type
      }, 400);
    }
    // Other image formats - not supported yet
    else if (['image/gif', 'image/webp', 'image/bmp', 'image/tiff'].includes(file.type)) {
      return c.json({
        error: 'This image format is not yet supported. Please use PNG or JPEG.',
        receivedType: file.type
      }, 400);
    }

    // Parse the PDF (either original or converted) with liteparse
    console.log(`Parsing ${convertedToPdf ? 'converted ' : ''}PDF with liteparse...`);
    const parser = new LiteParse({ ocrEnabled: true });
    const result = await parser.parse(buffer);

    return c.json({
      success: true,
      filename: file.name,
      size: file.size,
      type: file.type,
      convertedToPdf,
      text: result.text,
      metadata: result.metadata || {}
    });

  } catch (error) {
    console.error('Error parsing document:', error);
    return c.json({
      error: 'Failed to parse document',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

const port = process.env.PORT || 3003;

export default {
  port,
  fetch: app.fetch,
};

console.log(`🚀 Server running on http://localhost:${port}`);
