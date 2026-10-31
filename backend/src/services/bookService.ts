
/**
 * Book Service
 * Core CRUD operations for books, orchestrating specialized services
 */

import Book from '../models/book';
import imageService from './imageService';
import configManager from '../config';
import logger from '../logger';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { BookFormatted, BookCreateData } from '../types';

// Specialized services
import bookCoverService from './bookCoverService';
import type { CoverOption } from './bookCoverService';
import bookEnrichmentService from './bookEnrichmentService';
import bookImslpService from './bookImslpService';
import bookLanguageService from './bookLanguageService';
import bookBnfService from './bookBnfService';
import scoreFilesService from './scoreFilesService';
import {
  normalizeArrayField,
  extractSeriesFromTitle,
  isMusicScore,
  detectBookType
} from './utils/bookUtils';
import type { BookType } from './utils/bookUtils';

interface BookData {
  isbn?: string | null;
  isbn13?: string | null;
  title?: string | null;
  subtitle?: string | null;
  authors?: string[] | null;
  artists?: string[] | null;
  publisher?: string | null;
  publishedYear?: number | null;
  language?: string | null;
  format?: string | null;
  series?: string | null;
  seriesNumber?: number | null;
  genres?: string[] | null;
  tags?: string[] | null;
  rating?: number | null;
  cover?: string | null;
  coverUrl?: string | null;
  availableCovers?: CoverOption[];
  owner?: string | null;
  pageCount?: number | null;
  description?: string | null;
  urls?: Record<string, string> | null;
  annotation?: string | null;
  ebookFile?: string | null;
  bookType?: BookType | string;
  [key: string]: unknown;
}

interface BatchResult {
  success: BookFormatted[];
  errors: Array<{ book: string; error: string }>;
}

interface AutocompleteRow {
  [key: string]: string | number | null;
}

class BookService {
  // ============================================
  // Basic CRUD operations
  // ============================================

  async searchBooks(query: string): Promise<BookFormatted[]> {
    try {
      return await Book.search(query);
    } catch (error) {
      console.error('Error searching books:', error);
      throw error;
    }
  }

  async getAllBooks(): Promise<BookFormatted[]> {
    try {
      return await Book.findAll();
    } catch (error) {
      console.error('Error getting all books:', error);
      throw error;
    }
  }

  async getBooksByStatus(status: string): Promise<BookFormatted[]> {
    try {
      return await Book.findByStatus(status);
    } catch (error) {
      console.error('Error getting books by status:', error);
      throw error;
    }
  }

  async getBooksBySeries(series: string): Promise<BookFormatted[]> {
    try {
      return await Book.findBySeries(series);
    } catch (error) {
      console.error('Error getting books by series:', error);
      throw error;
    }
  }

  async updateBookStatus(id: number, status: string): Promise<{ id: number; title_status: string }> {
    try {
      return await Book.updateStatus(id, status);
    } catch (error) {
      console.error('Error updating book status:', error);
      throw error;
    }
  }

  async getBookById(id: number): Promise<BookFormatted> {
    try {
      const book = await Book.findById(id);
      if (!book) {
        throw new Error('Book not found');
      }
      return book;
    } catch (error) {
      console.error('Error getting book:', error);
      throw error;
    }
  }

  // ============================================
  // Add book
  // ============================================

  async addBook(bookData: BookData): Promise<BookFormatted> {
    try {
      // Check for existing book by ISBN
      if (bookData.isbn || bookData.isbn13) {
        const existing = await Book.findByIsbn(bookData.isbn || bookData.isbn13!);
        if (existing) {
          throw new Error('Book with this ISBN already exists in collection');
        }
      }

      // Download cover
      let coverPath = await this._downloadCover(bookData);

      // Normalize array fields
      const normalizedData: BookData = {
        ...bookData,
        cover: coverPath || bookData.cover,
        tags: normalizeArrayField(bookData.tags as string[] | string | null | undefined),
        genres: normalizeArrayField(bookData.genres as string[] | string | null | undefined),
        authors: normalizeArrayField(bookData.authors as string[] | string | null | undefined),
        artists: normalizeArrayField(bookData.artists as string[] | string | null | undefined)
      };

      // Extract series from title if not provided
      const originalTitleBeforeExtraction = normalizedData.title;
      if (!normalizedData.series && normalizedData.title) {
        const extractedSeries = extractSeriesFromTitle(normalizedData.title);
        if (extractedSeries) {
          normalizedData.series = extractedSeries.series;
          normalizedData.seriesNumber = extractedSeries.seriesNumber;
          logger.info(`[AddBook] Extracted series: "${extractedSeries.series}" #${extractedSeries.seriesNumber}`);
        }
      }

      // Ensure the original title is preserved after series extraction
      if (originalTitleBeforeExtraction && normalizedData.title !== originalTitleBeforeExtraction) {
        normalizedData.title = originalTitleBeforeExtraction;
        logger.info(`[AddBook] Preserved original title after series extraction: "${originalTitleBeforeExtraction}"`);
      }

      // For music scores, enrich with IMSLP data
      if (isMusicScore(normalizedData.isbn13 || normalizedData.isbn)) {
        const enrichedData = await bookImslpService.enrichMusicScore(normalizedData as Record<string, unknown>);
        Object.assign(normalizedData, enrichedData);
      }

      // Detect book type if not provided
      if (!normalizedData.bookType) {
        const genres = normalizedData.genres || [];
        logger.info(`[AddBook] Detecting book type with genres: ${Array.isArray(genres) ? genres.join(', ') : genres}`);
        normalizedData.bookType = detectBookType(
          normalizedData.isbn13 || normalizedData.isbn,
          genres as string[]
        );
        logger.info(`[AddBook] Detected book type: ${normalizedData.bookType} (genres: ${Array.isArray(genres) ? genres.join(', ') : 'none'})`);
      }

      // Add 'score' tag for music scores
      if (normalizedData.bookType === 'score') {
        const currentTags = (normalizedData.tags || []) as string[];
        if (!currentTags.includes('score')) {
          normalizedData.tags = [...currentTags, 'score'];
          logger.info(`[AddBook] Added 'score' tag for music score`);
        }
      }

      const created = await Book.create(normalizedData as unknown as BookCreateData);
      // Its description in French or English: another language is translated, in the background.
      if (created?.id) bookLanguageService.afterAdding(created.id);
      // A French book completed from the BnF: who drew it, its series, its summary, in the background.
      if (created?.id) bookBnfService.afterAdding(created.id);
      return created;
    } catch (error) {
      console.error('Error adding book:', error);
      throw error;
    }
  }

  async addBooksBatch(booksData: BookData[]): Promise<BatchResult> {
    try {
      const results: BookFormatted[] = [];
      const errors: Array<{ book: string; error: string }> = [];

      for (const bookData of booksData) {
        try {
          const book = await this.addBook(bookData);
          results.push(book);
        } catch (error: unknown) {
          const err = error as { message: string };
          errors.push({ book: (bookData.title || bookData.isbn || 'unknown') as string, error: err.message });
        }
      }

      return { success: results, errors };
    } catch (error) {
      console.error('Error adding books batch:', error);
      throw error;
    }
  }

  // ============================================
  // Update book
  // ============================================

  async updateBook(id: number, bookData: BookData): Promise<BookFormatted> {
    try {
      const existingBook = await Book.findById(id);
      const existingCoverUrl: string | null = null; // coverUrl is not stored in DB, only used during input
      const existingCoverPath = existingBook?.cover || null;

      // Determine cover URL to use
      let coverUrlToUse = bookData.coverUrl;
      if (!coverUrlToUse && bookData.availableCovers && bookData.availableCovers.length > 0) {
        coverUrlToUse = bookCoverService.selectLargestCover(bookData.availableCovers);
        logger.info(`[UpdateBook] Using largest cover from available covers`);
      }

      // Download new cover if needed
      let coverPath: string | null | undefined = bookData.cover;
      const coverUrlChanged = coverUrlToUse && (!existingCoverUrl || coverUrlToUse !== existingCoverUrl);

      if (coverUrlToUse && coverUrlChanged) {
        try {
          const filename = `book_${id}_${Date.now()}.jpg`;
          coverPath = await imageService.downloadImageFromUrl(coverUrlToUse, 'book', filename);
          if (coverPath) {
            const downloadedFilename = coverPath.split('/').pop()!;
            const fullPath = path.join(imageService.getLocalImagesDir(), 'book', downloadedFilename);
            try {
              await imageService.resizeImage(fullPath, fullPath, 1200, 1200);
            } catch (resizeError: unknown) {
              const err = resizeError as { message: string };
              logger.warn(`Failed to resize cover: ${err.message}`);
            }
          }
        } catch (error: unknown) {
          const err = error as { message: string };
          logger.warn(`Failed to download cover: ${err.message}`);
          coverPath = existingCoverPath;
        }
      } else {
        coverPath = existingCoverPath;
      }

      // Build normalized data
      const normalizedData: BookData = {
        ...bookData,
        cover: coverPath || bookData.cover,
        coverUrl: coverUrlToUse || bookData.coverUrl || null
      };

      // Only normalize array fields if provided
      if (bookData.tags !== undefined) normalizedData.tags = normalizeArrayField(bookData.tags as string[] | string | null | undefined);
      if (bookData.genres !== undefined) normalizedData.genres = normalizeArrayField(bookData.genres as string[] | string | null | undefined);
      if (bookData.authors !== undefined) normalizedData.authors = normalizeArrayField(bookData.authors as string[] | string | null | undefined);
      if (bookData.artists !== undefined) normalizedData.artists = normalizeArrayField(bookData.artists as string[] | string | null | undefined);

      return await Book.update(id, normalizedData as unknown as BookCreateData) as unknown as BookFormatted;
    } catch (error) {
      console.error('Error updating book:', error);
      throw error;
    }
  }

  // ============================================
  // Delete book
  // ============================================

  async deleteBook(id: number): Promise<{ deleted: boolean }> {
    try {
      const book = await Book.findById(id);

      // Delete ebook file if exists
      if (book?.ebookFile) {
        let ebookDir: string;
        try {
          ebookDir = configManager.getEbooksPath();
        } catch (_error) {
          ebookDir = path.join(__dirname, '..', '..', 'data', 'ebooks');
        }
        const filePath = path.join(ebookDir, book.ebookFile);

        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            console.log(`Deleted ebook file: ${filePath}`);
          } catch (fileError: unknown) {
            const err = fileError as { message: string };
            console.warn('Failed to delete ebook file:', err.message);
          }
        }
      }

      // A score's other PDFs go with it.
      if (book?.bookType === 'score') await scoreFilesService.removeAll(id, book.ebookFile ?? null);

      return await Book.delete(id);
    } catch (error) {
      console.error('Error deleting book:', error);
      throw error;
    }
  }

  // ============================================
  // External API methods (delegated to services)
  // ============================================

  async searchExternalBooks(query: string, filters: Record<string, unknown> = {}): Promise<unknown[]> {
    return bookEnrichmentService.searchExternalBooks(query, filters);
  }

  async enrichBook(bookData: BookData): Promise<BookData> {
    const result = await bookEnrichmentService.enrichBook(bookData as unknown as Parameters<typeof bookEnrichmentService.enrichBook>[0]);
    return result as unknown as BookData;
  }

  async searchSeriesVolumes(seriesName: string, options: Record<string, unknown> = {}): Promise<unknown[]> {
    return bookEnrichmentService.searchSeriesVolumes(seriesName, options);
  }

  // ============================================
  // Autocomplete
  // ============================================

  async getAutocompleteSuggestions(field: string, value: string): Promise<AutocompleteRow[]> {
    // The keys of BookDex's search that offer values (frontend schemas/books.ts); subtitle has no column in Book.autocomplete.
    const allowedFields = ['title', 'subtitle', 'isbn', 'author', 'artist', 'series', 'publisher', 'genre', 'tag', 'language', 'owner', 'title_status', 'type', 'book_type'];
    if (!allowedFields.includes(field)) {
      throw new Error(`Invalid field: ${field}`);
    }

    if (field === 'title_status') {
      const statusOptions = ['owned', 'borrowed'];
      const matches = statusOptions.filter(status =>
        status.toLowerCase().includes((value || '').toLowerCase())
      );
      return matches.map(status => ({ title_status: status }));
    }

    if (field === 'type' || field === 'book_type') {
      const typeOptions = [
        { value: 'book', label: 'Book' },
        { value: 'graphic-novel', label: 'Graphic Novel' },
        { value: 'score', label: 'Score' }
      ];
      const matches = typeOptions.filter(opt =>
        opt.value.toLowerCase().includes((value || '').toLowerCase()) ||
        opt.label.toLowerCase().includes((value || '').toLowerCase())
      );
      return matches.map(opt => ({ type: opt.value, book_type: opt.value }));
    }

    try {
      return await Book.autocomplete(field, value);
    } catch (error) {
      console.error('Error getting autocomplete suggestions:', error);
      throw error;
    }
  }

  // ============================================
  // Private helpers
  // ============================================

  private async _downloadCover(bookData: BookData): Promise<string | null | undefined> {
    let coverPath = bookData.cover;

    // If cover is already a local path, keep it
    if (coverPath && coverPath.startsWith('/api/images/')) {
      return coverPath;
    }

    if (!coverPath && bookData.availableCovers && bookData.availableCovers.length > 0) {
      const sortedCovers = [...bookData.availableCovers]
        .filter(c => c.url && (!c.type || c.type === 'front'))
        .filter(c => !c.url.startsWith('/api/images/') && c.url.startsWith('http'))
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));

      logger.info(`[AddBook] Trying ${sortedCovers.length} cover options`);

      for (let i = 0; i < Math.min(sortedCovers.length, 5); i++) {
        const cover = sortedCovers[i];
        try {
          const filename = `book_${Date.now()}_${i}.jpg`;
          const downloadedPath = await imageService.downloadImageFromUrl(cover.url, 'book', filename);

          if (downloadedPath) {
            const downloadedFilename = downloadedPath.split('/').pop()!;
            const fullPath = path.join(imageService.getLocalImagesDir(), 'book', downloadedFilename);

            // Verify it's not a placeholder
            const stats = fs.statSync(fullPath);
            if (stats.size < 200) {
              logger.warn(`[AddBook] Cover appears to be placeholder (${stats.size} bytes), trying next`);
              fs.unlinkSync(fullPath);
              continue;
            }

            // Check for Google Books "image not available" placeholder
            if (cover.source === 'Google Books' || cover.url?.includes('books.google.com')) {
              try {
                const imageStats = await sharp(fullPath).stats();
                const isPlaceholder = imageStats.channels.every(ch =>
                  ch.mean > 240 && ch.stdev < 25
                );
                if (isPlaceholder) {
                  logger.warn(`[AddBook] Google Books "image not available" placeholder detected, trying next`);
                  fs.unlinkSync(fullPath);
                  continue;
                }
              } catch (sharpError: unknown) {
                const err = sharpError as { message: string };
                logger.warn(`[AddBook] Could not analyze image: ${err.message}`);
              }
            }

            // Resize
            try {
              await imageService.resizeImage(fullPath, fullPath, 1200, 1200);
            } catch (resizeError: unknown) {
              const err = resizeError as { message: string };
              console.warn('Failed to resize cover:', err.message);
            }

            coverPath = downloadedPath;
            logger.info(`[AddBook] Downloaded cover from ${cover.source || 'unknown'}`);
            break;
          }
        } catch (error: unknown) {
          const err = error as { message: string };
          logger.warn(`[AddBook] Cover ${i + 1} failed: ${err.message}`);
        }
      }
    } else if (!coverPath && bookData.coverUrl) {
      // If coverUrl is already a local path, use it directly
      if (bookData.coverUrl.startsWith('/api/images/')) {
        return bookData.coverUrl;
      }

      // Only download if it's a valid external URL
      if (!bookData.coverUrl.startsWith('http')) {
        return coverPath;
      }

      try {
        const filename = `book_${Date.now()}.jpg`;
        const downloadedPath = await imageService.downloadImageFromUrl(bookData.coverUrl, 'book', filename);

        if (downloadedPath) {
          const downloadedFilename = downloadedPath.split('/').pop()!;
          const fullPath = path.join(imageService.getLocalImagesDir(), 'book', downloadedFilename);

          const stats = fs.statSync(fullPath);
          let isPlaceholder = stats.size < 200;

          if (!isPlaceholder && bookData.coverUrl?.includes('books.google.com')) {
            try {
              const imageStats = await sharp(fullPath).stats();
              isPlaceholder = imageStats.channels.every(ch =>
                ch.mean > 240 && ch.stdev < 25
              );
            } catch (sharpError: unknown) {
              const err = sharpError as { message: string };
              logger.warn(`[AddBook] Could not analyze image: ${err.message}`);
            }
          }

          if (isPlaceholder) {
            logger.warn(`[AddBook] Placeholder image detected, skipping`);
            fs.unlinkSync(fullPath);
          } else {
            try {
              await imageService.resizeImage(fullPath, fullPath, 1200, 1200);
            } catch (resizeError: unknown) {
              const err = resizeError as { message: string };
              console.warn('Failed to resize cover:', err.message);
            }
            coverPath = downloadedPath;
          }
        }
      } catch (error: unknown) {
        const err = error as { message: string };
        console.warn('Failed to download cover:', err.message);
      }
    }

    return coverPath;
  }
}

export default new BookService();
