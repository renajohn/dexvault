import { BOOK_RATED_EVENT } from './ratedEvents';
interface ExternalBookFilters {
  isbn?: string;
  asin?: string;
  amazonUrl?: string;
  author?: string;
  title?: string;
  limit?: string | number;
  language?: string;
}

interface SeriesSearchOptions {
  language?: string;
  maxVolumes?: string | number;
}

/** What a book's photographs say, as the server reads them. */
export interface BookPhotosDraft {
  title: string | null;
  subtitle: string | null;
  authors: string[];
  artists: string[];
  translators: string[];
  series: string | null;
  seriesNumber: number | null;
  publisher: string | null;
  isbn13: string | null;
  description: string | null;
  language: string | null;
  bookType: 'book' | 'graphic-novel' | 'score' | null;
  /** From the BnF, when the draft was completed there. */
  publishedYear?: number | null;
  pageCount?: number | null;
  bnf?: string | null;
}

class BookService {
  async getBaseUrl(): Promise<string> {
    return '/api';
  }

  async getAllBooks(): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching books:', error);
      throw error;
    }
  }

  async getBooksByStatus(status: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books/status/${status}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching books by status:', error);
      throw error;
    }
  }

  async updateBookStatus(id: number | string, status: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error updating book status:', error);
      throw error;
    }
  }

  // A wish already taken care of (ordered, a bid made, a gift to come)
  async setBookSpokenFor(id: number | string, spokenFor: boolean): Promise<unknown> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/books/${id}/spoken-for`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spokenFor }),
    });
    if (!response.ok) {
      throw new Error(`Failed to mark the book as spoken for: ${response.status}`);
    }
    return await response.json();
  }

  async getBookById(id: number | string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books/${id}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching book:', error);
      throw error;
    }
  }

  async searchBooks(query: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error searching books:', error);
      throw error;
    }
  }

  async searchExternalBooks(query: string, filters: ExternalBookFilters = {}): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const params = new URLSearchParams();
      if (query) params.append('q', query);
      if (filters.isbn) params.append('isbn', filters.isbn);
      if (filters.asin) params.append('asin', filters.asin);
      if (filters.amazonUrl) params.append('amazonUrl', filters.amazonUrl);
      if (filters.author) params.append('author', filters.author);
      if (filters.title) params.append('title', filters.title);
      if (filters.limit) params.append('limit', String(filters.limit));
      if (filters.language) params.append('language', filters.language);

      const response = await fetch(`${baseUrl}/books/search/external?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error searching external books:', error);
      throw error;
    }
  }

  async searchSeriesVolumes(seriesName: string, options: SeriesSearchOptions = {}): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const params = new URLSearchParams();
      params.append('series', seriesName);
      if (options.language) params.append('language', options.language);
      if (options.maxVolumes) params.append('maxVolumes', String(options.maxVolumes));

      const response = await fetch(`${baseUrl}/books/search/series?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error searching series volumes:', error);
      throw error;
    }
  }

  async getBooksBySeries(seriesName: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const params = new URLSearchParams();
      params.append('series', seriesName);

      const response = await fetch(`${baseUrl}/books/series?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error getting books by series:', error);
      throw error;
    }
  }

  async enrichBook(bookData: Record<string, unknown>): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books/enrich`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bookData),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error enriching book:', error);
      // Return original book if enrichment fails
      return bookData;
    }
  }

  async addBook(bookData: Record<string, unknown>): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bookData),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
        const errorMessage = (errorData.error as string) || `HTTP error! status: ${response.status}`;
        throw new Error(errorMessage);
      }
      return await response.json();
    } catch (error) {
      console.error('Error adding book:', error);
      throw error;
    }
  }

  async addBooksBatch(booksData: Record<string, unknown>[]): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ books: booksData }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error adding books batch:', error);
      throw error;
    }
  }

  async updateBook(id: number | string, bookData: Record<string, unknown>): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bookData),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const saved = await response.json();
      // Its stars perhaps changed: the books' spread is read again.
      window.dispatchEvent(new Event(BOOK_RATED_EVENT));
      return saved;
    } catch (error) {
      console.error('Error updating book:', error);
      throw error;
    }
  }

  /** How many books on the shelves hold each number of stars, halves apart. */
  async getRatingCounts(): Promise<Array<{ stars: number; count: number }>> {
    const baseUrl = await this.getBaseUrl();
    const response = await fetch(`${baseUrl}/books/ratings/counts`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return (await response.json()).counts;
  }

  async deleteBook(id: number | string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error deleting book:', error);
      throw error;
    }
  }

  async getAutocompleteSuggestions(filterType: string, filterValue: string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(
        `${baseUrl}/books/autocomplete?field=${encodeURIComponent(filterType)}&value=${encodeURIComponent(filterValue)}`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching autocomplete suggestions:', error);
      throw error;
    }
  }

  async uploadEbook(bookId: number | string, file: File): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const formData = new FormData();
      formData.append('ebook', file);

      const response = await fetch(`${baseUrl}/books/${bookId}/upload-ebook`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to upload ebook' })) as Record<string, unknown>;
        throw new Error((errorData.error as string) || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error uploading ebook:', error);
      throw error;
    }
  }

  async getEbookInfo(bookId: number | string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books/${bookId}/ebook/info`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error getting ebook info:', error);
      throw error;
    }
  }

  async downloadEbook(bookId: number | string): Promise<void> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books/${bookId}/ebook/download`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `book_${bookId}.epub`;
      if (contentDisposition) {
        // Try to match quoted filename first: filename="something"
        let filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
        if (!filenameMatch) {
          // Fallback to unquoted: filename=something
          filenameMatch = contentDisposition.match(/filename=([^;]+)/i);
        }
        if (filenameMatch) {
          filename = filenameMatch[1].trim();
        }
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading ebook:', error);
      throw error;
    }
  }

  async deleteEbook(bookId: number | string): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/books/${bookId}/ebook`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to delete ebook' })) as Record<string, unknown>;
        throw new Error((errorData.error as string) || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error deleting ebook:', error);
      throw error;
    }
  }

  /** A book's photographs read: its front names it, its back holds its blurb, its ISBN, its publisher. */
  async readPhotos(photos: { front?: { base64: string; mimeType: string }; back?: { base64: string; mimeType: string } }, options: { complete?: boolean } = {}): Promise<{ draft: BookPhotosDraft; sources: { front: boolean; back: boolean }; truncated: boolean }> {
    const baseUrl = await this.getBaseUrl();
    const body: Record<string, unknown> = {};
    if (photos.front) body.front = { image: photos.front.base64, mimeType: photos.front.mimeType };
    if (photos.back) body.back = { image: photos.back.base64, mimeType: photos.back.mimeType };
    // For a form to fill: what the photos do not give, the BnF completes.
    if (options.complete) body.complete = true;
    const response = await fetch(`${baseUrl}/books/read-photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(data.error || `HTTP error! status: ${response.status}`);
    return { ...(data as { draft: BookPhotosDraft; sources: { front: boolean; back: boolean } }), truncated: false };
  }

  /** The photograph of a book's back, its blurb. */
  async uploadBackCover(bookId: number | string, file: File): Promise<unknown> {
    const baseUrl = await this.getBaseUrl();
    const formData = new FormData();
    formData.append('cover', file);
    const response = await fetch(`${baseUrl}/books/${bookId}/upload-back-cover`, { method: 'POST', body: formData });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }

  async uploadCover(bookId: number | string, file: File): Promise<unknown> {
    try {
      const baseUrl = await this.getBaseUrl();
      const formData = new FormData();
      formData.append('cover', file);

      const response = await fetch(`${baseUrl}/books/${bookId}/upload-cover`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error uploading cover:', error);
      throw error;
    }
  }

  /**
   * Get the full URL for an image path
   */
  getImageUrl(imagePath: string | null | undefined): string | null {
    if (!imagePath) return null;

    // Already a full URL
    if (imagePath.startsWith('http')) {
      return imagePath;
    }

    // Local paths are served as-is
    if (imagePath.startsWith('/api/images/') || imagePath.startsWith('/images/')) {
      return imagePath;
    }

    // Default: prepend /api/images/
    return `/api/images/${imagePath}`;
  }

}

const bookServiceInstance = new BookService();
export default bookServiceInstance;
