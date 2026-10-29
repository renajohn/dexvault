import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bookService from '../services/bookService';
import imageService from '../services/imageService';
import configManager from '../config';
import Book from '../models/book';
import logger from '../logger';
import coverScanService from '../services/coverScanService';
import bookLanguageService from '../services/bookLanguageService';
import bookBnfService, { completeDraft } from '../services/bookBnfService';
import { searchAmazonProducts } from '../services/amazonSearchService';

// Helper function to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

// Configure multer for cover uploads
const storage = multer.diskStorage({
  destination: (req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    const customCoverDir = path.join(imageService.getLocalImagesDir(), 'book', 'custom');
    // Ensure directory exists
    if (!fs.existsSync(customCoverDir)) {
      fs.mkdirSync(customCoverDir, { recursive: true });
    }
    cb(null, customCoverDir);
  },
  filename: (req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const bookId = (req as Request).params.id;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `book_${bookId}_${timestamp}${ext}`);
  }
});

const coverUpload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  },
  fileFilter: (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // Accept images only
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  }
});

// Configure multer for ebook uploads
const ebookStorage = multer.diskStorage({
  destination: (req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    let ebookDir: string;
    try {
      ebookDir = configManager.getEbooksPath();
    } catch (error) {
      // Fallback to default if config not loaded
      ebookDir = path.join(__dirname, '..', '..', 'data', 'ebooks');
    }
    // Ensure directory exists
    if (!fs.existsSync(ebookDir)) {
      fs.mkdirSync(ebookDir, { recursive: true });
    }
    cb(null, ebookDir);
  },
  filename: (req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const bookId = (req as Request).params.id;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase() || path.extname(file.originalname);
    let originalName = path.basename(file.originalname, ext);
    // Remove quotes (straight, curly, or smart quotes) from start and end before sanitizing
    originalName = originalName.replace(/^[""'']+|[""'']+$/g, '').trim();
    // Sanitize filename - replace any remaining special characters with underscores
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `book_${bookId}_${timestamp}_${sanitizedName}${ext}`);
  }
});

const ebookUpload = multer({
  storage: ebookStorage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max for ebooks
  },
  fileFilter: (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // Accept common ebook formats
    const allowedTypes = [
      'application/epub+zip',
      'application/x-mobipocket-ebook',
      'application/pdf',
      'application/x-fictionbook+xml',
      'text/plain'
    ];
    const allowedExtensions = ['.epub', '.mobi', '.azw', '.pdf', '.fb2', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only EPUB, MOBI, AZW, PDF, FB2, and TXT files are allowed'));
    }
  }
});

const bookController = {
  // POST { front?, back? }: a book's photographs read, its front and its back, for a form filled from them
  readPhotos: async (req: Request, res: Response): Promise<void> => {
    try {
      const { front, back } = req.body || {};
      if (!front?.image && !back?.image) {
        res.status(400).json({ error: 'At least one photograph is required (front or back)' });
        return;
      }
      const read = await coverScanService.readBookPhotos({ front, back });
      // A form to fill from them: the BnF completes what the photos did not give.
      res.json(req.body?.complete ? { ...read, draft: await completeDraft(read.draft) } : read);
    } catch (error) {
      const message = (error as Error).message || '';
      const unreachable = /network error|no response received|econnrefused|enotfound|timed? ?out|HTTP 5\d\d/i.test(message);
      logger.error('Reading the book photographs failed:', message);
      res.status(unreachable ? 503 : 422).json({ error: unreachable ? 'Cover scan service is not available' : 'Could not read the photographs', details: message });
    }
  },

  // POST: every French book completed from the BnF's catalogue: what each gained
  enrichFromBnf: async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await bookBnfService.enrichAll());
    } catch (error) {
      logger.error('Completing the books from the BnF:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  // POST: every description in neither French nor English, translated into French by the local LLM
  translateDescriptions: async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await bookLanguageService.translateAll());
    } catch (error) {
      logger.error('Translating the descriptions:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

  // Get all books
  getAllBooks: async (req: Request, res: Response): Promise<void> => {
    try {
      const books = await bookService.getAllBooks();
      res.json(books);
    } catch (error) {
      console.error('Error getting all books:', error);
      res.status(500).json({ error: 'Failed to get books' });
    }
  },

  // Get books by status (owned, borrowed, or wish)
  getBooksByStatus: async (req: Request, res: Response): Promise<void> => {
    try {
      const status = req.params.status as string;
      if (!['owned', 'borrowed', 'wish'].includes(status)) {
        res.status(400).json({ error: 'Status must be "owned", "borrowed", or "wish"' });
        return;
      }

      const books = await bookService.getBooksByStatus(status);
      res.json(books);
    } catch (error) {
      console.error('Error getting books by status:', error);
      res.status(500).json({ error: 'Failed to get books by status' });
    }
  },

  // Update book status
  updateBookStatus: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { status } = req.body;

      if (!['owned', 'borrowed', 'wish'].includes(status)) {
        res.status(400).json({ error: 'Status must be "owned", "borrowed", or "wish"' });
        return;
      }

      const result = await bookService.updateBookStatus(id, status);
      res.json(result);
    } catch (error) {
      console.error('Error updating book status:', error);
      res.status(500).json({ error: 'Failed to update book status' });
    }
  },

  // Get book by ID
  getBookById: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const book = await bookService.getBookById(id);
      res.json(book);
    } catch (error) {
      console.error('Error getting book by ID:', error);
      if ((error as Error).message === 'Book not found') {
        res.status(404).json({ error: 'Book not found' });
      } else {
        res.status(500).json({ error: 'Failed to get book' });
      }
    }
  },

  // Add new book
  addBook: async (req: Request, res: Response): Promise<void> => {
    try {
      const bookData = req.body;
      const book = await bookService.addBook(bookData);
      res.status(201).json(book);
    } catch (error) {
      console.error('Error adding book:', error);
      if ((error as Error).message === 'Book with this ISBN already exists in collection') {
        res.status(409).json({ error: (error as Error).message });
      } else {
        res.status(500).json({ error: 'Failed to add book' });
      }
    }
  },

  // Batch add books
  addBooksBatch: async (req: Request, res: Response): Promise<void> => {
    try {
      const { books } = req.body;
      if (!Array.isArray(books) || books.length === 0) {
        res.status(400).json({ error: 'Books array is required' });
        return;
      }

      const result = await bookService.addBooksBatch(books);
      res.status(201).json(result);
    } catch (error) {
      console.error('Error adding books batch:', error);
      res.status(500).json({ error: 'Failed to add books batch' });
    }
  },

  // Update book
  updateBook: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const bookData = req.body;
      const book = await bookService.updateBook(id, bookData);
      res.json(book);
    } catch (error) {
      console.error('Error updating book:', error);
      res.status(500).json({ error: 'Failed to update book' });
    }
  },

  // Delete book
  deleteBook: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const result = await bookService.deleteBook(id);
      if (result.deleted) {
        res.json({ message: 'Book deleted successfully' });
      } else {
        res.status(404).json({ error: 'Book not found' });
      }
    } catch (error) {
      console.error('Error deleting book:', error);
      res.status(500).json({ error: 'Failed to delete book' });
    }
  },

  // Search books
  /** How the books' stars spread: how many at each half, for the dial to say where a rating stands. */
  getRatingCounts: async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({ counts: await Book.countRatings() });
    } catch (error) {
      logger.error('Error counting the books\' stars:', error);
      res.status(500).json({ error: 'Failed to count the stars' });
    }
  },

  searchBooks: async (req: Request, res: Response): Promise<void> => {
    try {
      const { q } = req.query;
      if (!q) {
        res.status(400).json({ error: 'Search query is required' });
        return;
      }

      const books = await bookService.searchBooks(q as string);
      res.json(books);
    } catch (error) {
      console.error('Error searching books:', error);
      res.status(500).json({ error: 'Failed to search books' });
    }
  },

  // Search external book APIs (Google Books, OpenLibrary)
  searchExternalBooks: async (req: Request, res: Response): Promise<void> => {
    try {
      const { q, isbn, author, title, limit, language, asin, amazonUrl } = req.query;

      if (!q && !isbn && !author && !title && !asin) {
        res.status(400).json({ error: 'Search query, ISBN, ASIN, author, or title is required' });
        return;
      }

      const filters = {
        isbn: (isbn as string) || null,
        asin: (asin as string) || null,
        amazonUrl: (amazonUrl as string) || null,
        author: (author as string) || null,
        title: (title as string) || null,
        limit: limit ? parseInt(limit as string) : 20,
        language: (language as string) || 'any'
      };

      const query = (q as string) || '';
      const books = await bookService.searchExternalBooks(query, filters);
      res.json(books);
    } catch (error) {
      console.error('Error searching external books:', error);
      res.status(500).json({ error: 'Failed to search external books' });
    }
  },

  // Search for all volumes in a series
  searchSeriesVolumes: async (req: Request, res: Response): Promise<void> => {
    try {
      const { series, language, maxVolumes } = req.query;

      if (!series) {
        res.status(400).json({ error: 'Series name is required' });
        return;
      }

      const options = {
        language: (language as string) || 'any',
        maxVolumes: maxVolumes ? parseInt(maxVolumes as string) : 50
      };

      const volumes = await bookService.searchSeriesVolumes(series as string, options);
      res.json(volumes);
    } catch (error) {
      console.error('Error searching series volumes:', error);
      res.status(500).json({ error: 'Failed to search series volumes' });
    }
  },

  // Get existing books in a series
  getBooksBySeries: async (req: Request, res: Response): Promise<void> => {
    try {
      const { series } = req.query;

      if (!series) {
        res.status(400).json({ error: 'Series name is required' });
        return;
      }

      const books = await bookService.getBooksBySeries(series as string);
      res.json(books);
    } catch (error) {
      console.error('Error getting books by series:', error);
      res.status(500).json({ error: 'Failed to get books by series' });
    }
  },

  // Get autocomplete suggestions
  getAutocompleteSuggestions: async (req: Request, res: Response): Promise<void> => {
    try {
      const { field, value } = req.query;

      if (!field) {
        res.status(400).json({ error: 'Field parameter is required' });
        return;
      }

      const suggestions = await bookService.getAutocompleteSuggestions(field as string, (value as string) || '');
      res.json(suggestions);
    } catch (error) {
      // An unknown field is the caller's mistake, not a server failure.
      if (/^Invalid field/.test((error as Error).message)) {
        res.status(400).json({ error: (error as Error).message });
        return;
      }
      console.error('Error getting autocomplete suggestions:', error);
      res.status(500).json({ error: 'Failed to get autocomplete suggestions' });
    }
  },

  // Enrich a book with OpenLibrary data
  enrichBook: async (req: Request, res: Response): Promise<void> => {
    try {
      const bookData = req.body;

      if (!bookData) {
        res.status(400).json({ error: 'Book data is required' });
        return;
      }

      const enrichedBook = await bookService.enrichBook(bookData);
      res.json(enrichedBook);
    } catch (error) {
      console.error('Error enriching book:', error);
      res.status(500).json({ error: 'Failed to enrich book' });
    }
  },

  // Re-enrich an existing book by ID
  reEnrichBook: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);

      if (isNaN(id)) {
        res.status(400).json({ error: 'Book ID is required' });
        return;
      }

      const book = await bookService.getBookById(id);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }

      const enrichedBook = await bookService.enrichBook(book as unknown as Record<string, unknown>);

      // Update the book with enriched data
      const updatedBook = await bookService.updateBook(id, enrichedBook);
      res.json(updatedBook);
    } catch (error) {
      console.error('Error re-enriching book:', error);
      res.status(500).json({ error: 'Failed to re-enrich book' });
    }
  },

  // Upload custom cover for a book
  uploadCustomCover: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const file = req.file as Express.Multer.File | undefined;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      logger.info(`Uploading custom cover for book ${id}: ${file.filename}`);

      // Resize the image to max 1200x1200
      let width = 500;
      let height = 500;

      try {
        await imageService.resizeImage(file.path, file.path, 1200, 1200);

        // Get updated dimensions after resize
        const sharp = require('sharp');
        const metadata = await sharp(file.path).metadata();
        width = metadata.width;
        height = metadata.height;
        logger.info(`Cover resized to ${width}x${height}`);
      } catch (error) {
        // If resize fails, log but continue
        logger.warn('Failed to resize cover image:', (error as Error).message);
      }

      // Construct the cover path using API endpoint
      const coverPath = `/api/images/book/custom/${file.filename}`;

      // Update only the cover field, or the back's
      if (req.path.endsWith('/upload-back-cover')) await Book.updateBackCover(id, coverPath);
      else await Book.updateCover(id, coverPath);

      res.json({
        success: true,
        // The card reads cover: without it a new cover showed as none until the page was reloaded.
        cover: coverPath,
        coverPath: coverPath,
        filename: file.filename,
        width,
        height
      });
    } catch (error) {
      logger.error('Error uploading custom cover:', error);
      res.status(500).json({ error: 'Failed to upload custom cover' });
    }
  },

  // Middleware for cover upload
  coverUploadMiddleware: coverUpload.single('cover'),

  // Upload ebook file for a book
  uploadEbook: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const bookId = parseInt(id, 10);

      if (isNaN(bookId)) {
        logger.error(`Invalid book ID: ${id}`);
        res.status(400).json({ error: 'Invalid book ID' });
        return;
      }

      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        logger.warn(`No file uploaded for book ${bookId}`);
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      logger.info(`Uploading ebook for book ${bookId}: ${file.filename}`);

      // Verify book exists first
      try {
        const existingBook = await Book.findById(bookId);
        if (!existingBook) {
          logger.error(`Book ${bookId} not found`);
          res.status(404).json({ error: 'Book not found' });
          return;
        }
        logger.info(`Book ${bookId} found, current ebook_file: ${existingBook.ebookFile || 'none'}`);
      } catch (checkError) {
        logger.error(`Error checking book ${bookId}:`, checkError);
        res.status(500).json({ error: 'Failed to verify book exists' });
        return;
      }

      // Update only the ebook_file field
      try {
        const result = await Book.updateEbookFile(bookId, file.filename);
        logger.info(`Successfully updated ebook_file for book ${bookId}: ${file.filename}`, result);

        if (result.changes === 0) {
          logger.warn(`Warning: No rows were updated for book ${bookId}`);
        }
      } catch (dbError) {
        logger.error(`Database error updating ebook_file for book ${bookId}:`, dbError);
        logger.error(`Database error stack:`, (dbError as Error).stack);
        throw dbError;
      }

      // Verify the update by fetching the book
      try {
        const updatedBook = await Book.findById(bookId);
        logger.info(`Verified update - book ${bookId} ebook_file:`, updatedBook?.ebookFile || (updatedBook as unknown as Record<string, unknown>)?.ebook_file);

        if (!updatedBook?.ebookFile && !(updatedBook as unknown as Record<string, unknown>)?.ebook_file) {
          logger.error(`Update verification failed - ebook_file is still empty for book ${bookId}`);
        }
      } catch (verifyError) {
        logger.warn(`Could not verify ebook_file update for book ${bookId}:`, (verifyError as Error).message);
      }

      res.json({
        success: true,
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype
      });
    } catch (error) {
      logger.error('Error uploading ebook:', error);
      logger.error('Error stack:', (error as Error).stack);
      res.status(500).json({ error: 'Failed to upload ebook: ' + (error as Error).message });
    }
  },

  // Get ebook file info
  getEbookInfo: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const bookId = parseInt(id, 10);

      if (isNaN(bookId)) {
        res.status(400).json({ error: 'Invalid book ID' });
        return;
      }

      const book = await Book.findById(bookId);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }

      if (!book.ebookFile) {
        res.status(404).json({ error: 'No ebook file found for this book' });
        return;
      }

      let ebookDir: string;
      try {
        ebookDir = configManager.getEbooksPath();
      } catch (error) {
        ebookDir = path.join(__dirname, '..', '..', 'data', 'ebooks');
      }
      const filePath = path.join(ebookDir, book.ebookFile);

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Ebook file not found on server' });
        return;
      }

      const stats = fs.statSync(filePath);
      const ext = path.extname(book.ebookFile).toLowerCase();
      const formatMap: Record<string, string> = {
        '.epub': 'EPUB',
        '.mobi': 'MOBI',
        '.azw': 'AZW',
        '.pdf': 'PDF',
        '.fb2': 'FB2',
        '.txt': 'TXT'
      };
      const format = formatMap[ext] || ext.toUpperCase().replace('.', '');
      // Extract original filename: format is book_{id}_{timestamp}_{originalName}
      // Split by underscore and take everything after index 3 (book, id, timestamp)
      const parts = book.ebookFile.split('_');
      let originalFilename = parts.slice(3).join('_') || book.ebookFile;
      // Remove any quotes (straight, curly, or smart quotes) from start and end
      originalFilename = originalFilename.replace(/^[""'']+|[""'']+$/g, '').trim();

      res.json({
        filename: book.ebookFile,
        originalName: originalFilename,
        format: format,
        size: stats.size,
        sizeFormatted: formatFileSize(stats.size)
      });
    } catch (error) {
      logger.error('Error getting ebook info:', error);
      res.status(500).json({ error: 'Failed to get ebook info' });
    }
  },

  // Download ebook file
  downloadEbook: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);

      // Get book to find ebook filename
      const book = await Book.findById(id);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }

      if (!book.ebookFile) {
        res.status(404).json({ error: 'No ebook file found for this book' });
        return;
      }

      let ebookDir: string;
      try {
        ebookDir = configManager.getEbooksPath();
      } catch (error) {
        // Fallback to default if config not loaded
        ebookDir = path.join(__dirname, '..', '..', 'data', 'ebooks');
      }
      const filePath = path.join(ebookDir, book.ebookFile);

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Ebook file not found on server' });
        return;
      }

      // Get original filename if available, otherwise use stored filename
      let originalFilename = book.ebookFile.split('_').slice(3).join('_') || book.ebookFile;
      // Remove any quotes (straight, curly, or smart quotes) from start and end
      originalFilename = originalFilename.replace(/^[""'']+|[""'']+$/g, '').trim();

      // Set headers for file download
      // ?inline=1: a score's PDF opened in the browser, full screen, rather than saved.
      const inline = req.query.inline === '1' && /\.pdf$/i.test(book.ebookFile);
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${originalFilename}"`);
      res.setHeader('Content-Type', inline ? 'application/pdf' : 'application/octet-stream');

      // Stream the file
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      logger.error('Error downloading ebook:', error);
      res.status(500).json({ error: 'Failed to download ebook' });
    }
  },

  // Delete ebook file
  deleteEbook: async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string, 10);

      // Get book to find ebook filename
      const book = await Book.findById(id);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }

      if (!book.ebookFile) {
        res.status(404).json({ error: 'No ebook file found for this book' });
        return;
      }

      let ebookDir: string;
      try {
        ebookDir = configManager.getEbooksPath();
      } catch (error) {
        // Fallback to default if config not loaded
        ebookDir = path.join(__dirname, '..', '..', 'data', 'ebooks');
      }
      const filePath = path.join(ebookDir, book.ebookFile);

      // Delete file if exists
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted ebook file: ${filePath}`);
      }

      // Update database to remove ebook_file
      await Book.updateEbookFile(id, null);

      res.json({ success: true, message: 'Ebook deleted successfully' });
    } catch (error) {
      logger.error('Error deleting ebook:', error);
      res.status(500).json({ error: 'Failed to delete ebook' });
    }
  },

  // Middleware for ebook upload
  ebookUploadMiddleware: ebookUpload.single('ebook'),

  // Scan a book cover image to identify a book using local LLM
  scanCover: async (req: Request, res: Response): Promise<void> => {
    try {
      const { image, mimeType } = req.body;

      if (!image) {
        res.status(400).json({ error: 'Image data is required' });
        return;
      }

      // Check LLM availability first
      const health = await coverScanService.checkHealth();
      if (!health.available) {
        res.status(503).json({ error: 'Cover scan service is not available', details: health.error });
        return;
      }

      // Analyze the book cover image
      let llmResult: Record<string, unknown>;
      try {
        llmResult = await coverScanService.analyzeBookImage(image, mimeType || 'image/jpeg') as unknown as Record<string, unknown>;
      } catch (error) {
        logger.error('LLM book analysis failed:', (error as Error).message);
        res.status(422).json({ error: 'Could not identify book from cover image', details: (error as Error).message });
        return;
      }

      // Search Amazon for the book (get all results)
      let amazonResults: Array<Record<string, unknown>> = [];
      try {
        amazonResults = await searchAmazonProducts(
          llmResult.title as string,
          llmResult.authors as string[],
          llmResult.book_type as string
        ) as unknown as Array<Record<string, unknown>>;
      } catch (error) {
        logger.error('Amazon search failed (non-fatal):', (error as Error).message);
      }

      // Build candidate searches in parallel:
      // 1. One search per Amazon ASIN
      // 2. A fallback title+author search (always, to cast a wider net)
      const searchPromises: Array<Promise<Array<Record<string, unknown>>>> = [];

      for (const amazonResult of amazonResults) {
        searchPromises.push(
          bookService.searchExternalBooks('', {
            asin: amazonResult.asin as string,
            amazonUrl: amazonResult.url as string,
            limit: 5,
            language: (llmResult.language as string) || 'any'
          }).then(r => r as Array<Record<string, unknown>>).catch((error: Error) => {
            logger.error(`Book enrichment failed for ASIN ${amazonResult.asin} (non-fatal):`, error.message);
            return [] as Array<Record<string, unknown>>;
          })
        );
      }

      // Always run title+author search in parallel
      if (llmResult.title) {
        const authors = llmResult.authors as string[] | undefined;
        const query = authors && authors.length > 0
          ? `${llmResult.title} ${authors[0]}`
          : llmResult.title as string;
        searchPromises.push(
          bookService.searchExternalBooks(query, {
            title: llmResult.title as string,
            author: authors?.[0] || null,
            limit: 10,
            language: (llmResult.language as string) || 'any'
          }).then(r => r as Array<Record<string, unknown>>).catch((error: Error) => {
            logger.error('Fallback book search failed (non-fatal):', error.message);
            return [] as Array<Record<string, unknown>>;
          })
        );
      }

      // Aggregate and deduplicate candidates by ISBN
      const allResults = await Promise.all(searchPromises);
      const seen = new Set<string>();
      const candidates: Array<Record<string, unknown>> = [];
      for (const resultSet of allResults) {
        for (const book of resultSet) {
          const key = (book.isbn13 as string) || (book.isbn as string) || (book.title as string);
          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          candidates.push(book);
        }
      }

      // Rank results and take top 10
      const rankedCandidates = coverScanService.rankBookResults(candidates as unknown as Array<Record<string, unknown> & { _score: number }>, llmResult as unknown as Parameters<typeof coverScanService.rankBookResults>[1]).slice(0, 10);
      const confidence = coverScanService.getConfidence(rankedCandidates as unknown as Array<Record<string, unknown> & { _score: number }>);

      // Strip internal _score before sending to client
      const cleanCandidates = rankedCandidates.map(({ _score, ...rest }: Record<string, unknown>) => rest);

      const firstAmazon = amazonResults.length > 0 ? amazonResults[0] : null;
      res.json({
        llmExtraction: {
          title: llmResult.title,
          authors: llmResult.authors,
          bookType: llmResult.book_type,
          language: llmResult.language
        },
        amazonResult: firstAmazon ? { url: firstAmazon.url, asin: firstAmazon.asin } : null,
        candidates: cleanCandidates,
        confidence
      });
    } catch (error) {
      logger.error('Error scanning book cover:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  },

};

export default bookController;
