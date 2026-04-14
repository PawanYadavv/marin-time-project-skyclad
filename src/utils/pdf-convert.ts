/**
 * PDF-to-image conversion using pdfjs-dist v3 + node-canvas.
 *
 * For providers that don't accept PDFs (OpenAI, Groq, Mistral, Ollama),
 * we render the first page of the PDF to a PNG image.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const { createCanvas } = require('canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// Disable worker thread — run rendering on main thread
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

/**
 * Custom canvas factory for pdfjs-dist to use node-canvas.
 */
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }
  reset(canvasAndContext: { canvas: { width: number; height: number }; context: unknown }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: { canvas: null | unknown; context: null | unknown }) {
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

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
  const data = new Uint8Array(pdfBuffer);
  const doc = await pdfjsLib.getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const page = await doc.getPage(1);

  // Render at 2x scale for good quality
  const scale = 2.0;
  const viewport = page.getViewport({ scale });
  const canvasFactory = new NodeCanvasFactory();
  const { canvas, context } = canvasFactory.create(
    Math.floor(viewport.width),
    Math.floor(viewport.height)
  );

  await page.render({
    canvasContext: context,
    viewport,
    canvasFactory,
  }).promise;

  // Export canvas to PNG buffer
  const pngBuffer: Buffer = canvas.toBuffer('image/png');
  doc.destroy();
  return pngBuffer;
}
