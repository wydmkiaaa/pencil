import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ExtractedPdfResult {
  fileName: string;
  pageCount: number;
  text: string;
}

export async function extractPdfTextInBrowser(
  file: File,
  onProgress?: (page: number, totalPages: number) => void,
): Promise<ExtractedPdfResult> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];
  const totalPages = pdf.numPages;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean);
    pageTexts.push(strings.join(' '));
    onProgress?.(pageNum, totalPages);
  }

  return {
    fileName: file.name,
    pageCount: totalPages,
    text: pageTexts.join('\n\n').replace(/\s+/g, ' ').trim(),
  };
}
