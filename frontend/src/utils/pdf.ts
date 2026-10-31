// pdf.js is loaded when a PDF is read, not with the page: it is large, and needs a browser.
const load = async () => {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
};

/** A PDF read in the browser: its pages, its own bookmarks, a page drawn. */
export interface PdfDocument {
  pageCount: number;
  /** Its own bookmarks, the deepest of each branch, in order: what a scan made with a contents has. */
  outline: () => Promise<Array<{ title: string; page: number }>>;
  /** A page's size, in PDF points. */
  sizeOf: (page: number) => Promise<{ width: number; height: number }>;
  /** A page drawn in a canvas, at a width in CSS pixels. */
  draw: (page: number, canvas: HTMLCanvasElement, width: number) => Promise<void>;
  close: () => void;
}

type OutlineItem = { title: string; dest: string | unknown[] | null; items: OutlineItem[] };

export const openPdf = async (url: string): Promise<PdfDocument> => {
  const pdfjs = await load();
  const doc = await pdfjs.getDocument({ url }).promise;
  const pageOf = async (dest: OutlineItem['dest']): Promise<number | null> => {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit[0]) return null;
    const ref = explicit[0];
    return typeof ref === 'number' ? ref + 1 : (await doc.getPageIndex(ref as never)) + 1;
  };
  return {
    pageCount: doc.numPages,
    outline: async () => {
      const leaves: Array<{ title: string; page: number }> = [];
      const walk = async (items: OutlineItem[]) => {
        for (const item of items) {
          if (item.items?.length) { await walk(item.items); continue; }
          const page = await pageOf(item.dest).catch(() => null);
          if (page) leaves.push({ title: item.title, page });
        }
      };
      await walk(((await doc.getOutline()) || []) as OutlineItem[]);
      return leaves;
    },
    sizeOf: async number => {
      const { width, height } = (await doc.getPage(number)).getViewport({ scale: 1 });
      return { width, height };
    },
    draw: async (number, canvas, width) => {
      const page = await doc.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${viewport.height / ratio}px`;
      await page.render({ canvas, viewport }).promise;
    },
    close: () => { doc.destroy(); },
  };
};
