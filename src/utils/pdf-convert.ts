/**
 * Pure Node.js PDF-to-image conversion using pdf-img-convert (pdfjs-based).
 * Zero external system dependencies — no poppler, imagemagick, etc.
 *
 * For providers that don't accept PDFs (OpenAI, Groq, Mistral, Ollama),
 * we render the first page of the PDF to a PNG image.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfImgConvert = require('pdf-img-convert');

export async function ensureImageBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  // Already an image — no conversion needed
  if (mimeType.startsWith('image/')) {
    return { buffer, mimeType };
  }

  // Not a PDF — can't convert
  if (mimeType !== 'application/pdf') {
    return { buffer, mimeType };
  }

  // Convert PDF first page to PNG
  try {
    const pngBuffer = await convertPdfToPng(buffer);
    if (pngBuffer) {
      return { buffer: pngBuffer, mimeType: 'image/png' };
    }
  } catch (err) {
    console.error('[PDF Convert] Failed to convert PDF to image:', err);
  }

  // Fallback: return original PDF (works with Anthropic/Gemini natively)
  return { buffer, mimeType };
}

async function convertPdfToPng(pdfBuffer: Buffer): Promise<Buffer | null> {
  // Convert only the first page, at 2x scale for good quality
  const pages: Uint8Array[] = await pdfImgConvert.convert(pdfBuffer, {
    scale: 2.0,
    page_numbers: [1],
  });

  if (pages.length === 0) {
    return null;
  }

  return Buffer.from(pages[0]);
}
