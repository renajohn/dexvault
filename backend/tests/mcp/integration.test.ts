import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import sqlite3 from 'sqlite3';
import Movie from '../../src/models/movie';
import MovieCast from '../../src/models/movieCast';
import MovieCrew from '../../src/models/movieCrew';
import Collection from '../../src/models/collection';
import MovieCollection from '../../src/models/movieCollection';
import Album from '../../src/models/album';
import Track from '../../src/models/track';
import AlbumGuide from '../../src/models/albumGuide';
import AlbumStory from '../../src/models/albumStory';
import navidromeService from '../../src/services/navidromeService';
import ripStatusService from '../../src/services/ripStatusService';
import AlbumCollection from '../../src/models/albumCollection';
import Book from '../../src/models/book';
import BookComment from '../../src/models/bookComment';
import MovieWarning from '../../src/models/movieWarning';
import MovieFilmages from '../../src/models/movieFilmages';
import { createMcpServer } from '../../src/mcp/server';

// We bypass the standard initDatabase() (which uses dynamic await import() and
// has known ts-jest interop issues in this repo). Instead we statically import
// every model and call createTable() ourselves on a fresh in-memory db, then
// inject it into the database module via getDatabase's underlying mutable `db`.
const databaseModule = require('../../src/database');

const setupDatabase = async (): Promise<void> => {
  // Reset and create a brand new in-memory db.
  const verbose = sqlite3.verbose();
  const db = new verbose.Database(':memory:');
  await new Promise<void>((resolve, reject) => {
    db.run('PRAGMA foreign_keys = ON', (err: Error | null) => (err ? reject(err) : resolve()));
  });

  // Force the database module to use our db. The module exports getDatabase,
  // which reads from a private `db` variable via closure. We need to mutate
  // that variable: do it by calling initDatabase first (which sets the db
  // variable for us via its inner sqlite3.Database constructor) then over-
  // writing via the module's internal binding.
  // The pragmatic approach: reach in via the module's compiled namespace.
  (databaseModule as { __setDb?: (d: sqlite3.Database) => void }).__setDb;
  // The database module doesn't expose __setDb. Patch it by re-implementing
  // getDatabase to return our local db until we install all tables.
  const originalGetDatabase = databaseModule.getDatabase;
  databaseModule.getDatabase = () => db;

  await Movie.createTable();
  await MovieCast.createTable();
  await MovieCrew.createTable();
  await Collection.createTable();
  await MovieCollection.createTable();
  await Album.createTable();
  await Track.createTable();
  await AlbumGuide.createTable();
  await AlbumStory.createTable();
  await AlbumCollection.createTable();
  await Book.createTable();
  await BookComment.createTable();
  await MovieWarning.createTable();
  await MovieFilmages.createTable();

  // Apply the migrations our fixtures rely on (last_watched, watch_count,
  // book_type already created by Book.createTable). The book table already
  // includes book_type in its create statement above, so no migration needed.
  await new Promise<void>((resolve) => {
    db.run(`ALTER TABLE movies ADD COLUMN last_watched DATE`, () => resolve());
  });
  await new Promise<void>((resolve) => {
    db.run(`ALTER TABLE movies ADD COLUMN watch_count INTEGER DEFAULT 0`, () => resolve());
  });
  await new Promise<void>((resolve) => {
    db.run(`ALTER TABLE movies ADD COLUMN age_source TEXT`, () => resolve());
  });
  await new Promise<void>((resolve) => {
    db.run(`ALTER TABLE books ADD COLUMN book_type TEXT DEFAULT 'book'`, () => resolve());
  });

  // Keep the patched getDatabase pointing to our db for the lifetime of the
  // test suite. (Restoring would only matter if other suites ran after.)
  void originalGetDatabase;
};

const getDatabase = (): sqlite3.Database => databaseModule.getDatabase();

const wipeAllTables = async (): Promise<void> => {
  const db = getDatabase();
  await new Promise<void>((resolve, reject) => {
    db.serialize(() => {
      const tables = ['movies', 'albums', 'books', 'tracks', 'movie_collections', 'collections', 'book_comments'];
      let pending = tables.length;
      let firstErr: Error | null = null;
      for (const t of tables) {
        db.run(`DELETE FROM ${t}`, (err: Error | null) => {
          if (err && !firstErr) firstErr = err;
          pending--;
          if (pending === 0) {
            firstErr ? reject(firstErr) : resolve();
          }
        });
      }
    });
  });
};

const seedFixtures = async () => {
  // Three movies covering: watched/unwatched, age caps, runtime cap, IMDB rating, year range, format.
  const inception = await Movie.create({
    title: 'Inception',
    original_title: 'Inception',
    original_language: 'en',
    genre: 'Sci-Fi, Action',
    director: 'Christopher Nolan',
    cast: ['Leonardo DiCaprio'],
    release_date: '2010-07-16',
    format: 'Blu-ray',
    imdb_rating: 8.8,
    rotten_tomato_rating: null,
    rotten_tomatoes_link: null,
    tmdb_rating: null,
    tmdb_id: null,
    imdb_id: null,
    price: null,
    runtime: 148,
    plot: 'A thief who steals corporate secrets through dream-sharing technology.',
    comments: null,
    never_seen: false,
    acquired_date: '2020-01-01',
    import_id: null,
    poster_path: null,
    backdrop_path: null,
    budget: null,
    revenue: null,
    trailer_key: null,
    trailer_site: null,
    status: null,
    popularity: null,
    vote_count: null,
    adult: false,
    video: false,
    media_type: 'movie',
    recommended_age: 13,
    title_status: 'owned',
  });
  // Mark Inception as watched twice.
  await Movie.markAsWatched(inception.id, '2024-04-01', true);
  await Movie.markAsWatched(inception.id, '2024-05-01', true);

  await Movie.create({
    title: 'My Neighbor Totoro',
    original_title: 'My Neighbor Totoro',
    original_language: 'ja',
    genre: 'Animation, Family',
    director: 'Hayao Miyazaki',
    cast: [],
    release_date: '1988-04-16',
    format: 'DVD',
    imdb_rating: 8.1,
    rotten_tomato_rating: null,
    rotten_tomatoes_link: null,
    tmdb_rating: null,
    tmdb_id: null,
    imdb_id: null,
    price: null,
    runtime: 86,
    plot: 'Two girls move to the country and discover forest spirits.',
    comments: null,
    never_seen: false,
    acquired_date: '2021-01-01',
    import_id: null,
    poster_path: null,
    backdrop_path: null,
    budget: null,
    revenue: null,
    trailer_key: null,
    trailer_site: null,
    status: null,
    popularity: null,
    vote_count: null,
    adult: false,
    video: false,
    media_type: 'movie',
    recommended_age: 6,
    title_status: 'owned',
  });

  await Movie.create({
    title: 'Some Wishlisted Movie',
    original_title: null,
    original_language: 'en',
    genre: null,
    director: 'Some Director',
    cast: [],
    release_date: '2024-06-01',
    format: '4K UHD',
    imdb_rating: null,
    rotten_tomato_rating: null,
    rotten_tomatoes_link: null,
    tmdb_rating: null,
    tmdb_id: null,
    imdb_id: null,
    price: null,
    runtime: null,
    plot: null,
    comments: null,
    never_seen: true,
    acquired_date: null,
    import_id: null,
    poster_path: null,
    backdrop_path: null,
    budget: null,
    revenue: null,
    trailer_key: null,
    trailer_site: null,
    status: null,
    popularity: null,
    vote_count: null,
    adult: false,
    video: false,
    media_type: 'movie',
    recommended_age: null,
    title_status: 'wish',
  });

  // Albums.
  await Album.create({
    artist: ['Pink Floyd'],
    title: 'The Wall',
    releaseYear: 1979,
    labels: ['Columbia'],
    genres: ['Rock', 'Progressive'],
    format: 'CD',
    rating: 9,
    totalDuration: 5234,
    titleStatus: 'owned',
  });
  await Album.create({
    artist: ['Miles Davis'],
    title: 'Kind of Blue',
    releaseYear: 1959,
    labels: ['Columbia'],
    genres: ['Jazz'],
    format: 'Vinyl',
    rating: 10,
    totalDuration: 2700,
    titleStatus: 'owned',
  });
  await Album.create({
    artist: ['Radiohead'],
    title: 'In Rainbows',
    releaseYear: 2007,
    labels: [],
    genres: ['Rock'],
    format: 'Digital Media',
    titleStatus: 'digital',
  });
  await Album.create({
    artist: ['Wishlist Artist'],
    title: 'Future Album',
    releaseYear: 2025,
    labels: [],
    genres: [],
    format: 'CD',
    titleStatus: 'wish',
  });

  // The Wall's third track, its guide and its story, as the card shows them.
  const wall = await new Promise<{ id: number }>((resolve, reject) =>
    getDatabase().get(`SELECT id FROM albums WHERE title = 'The Wall'`, (err: Error | null, row: { id: number }) => (err ? reject(err) : resolve(row))));
  await Track.create({
    cdId: wall.id, discNumber: 1, trackNumber: 3, title: 'Another Brick in the Wall, Part 1', durationSec: 191,
    performers: [{ name: 'David Gilmour', role: 'guitar' }],
  });
  await AlbumGuide.save(wall.id, '### Avant d\'écouter\n\nUn opéra rock.', 'claude');
  await AlbumStory.save(wall.id, {
    found: true, reason: null, lang: 'en', title: 'The Wall', url: 'https://en.wikipedia.org/wiki/The_Wall',
    wikidataId: null, intro: 'The Wall is the eleventh studio album by Pink Floyd.',
    sections: [{ heading: 'Recording', level: 2, text: 'Recorded in France.' }],
    works: [], links: [{ lang: 'en', title: 'The Wall', url: 'https://en.wikipedia.org/wiki/The_Wall' }],
    fetchedAt: new Date().toISOString(),
  });

  // Books.
  await Book.create({
    title: 'Norwegian Wood',
    authors: ['Haruki Murakami'],
    publisher: null,
    publishedYear: 1987,
    language: 'en',
    format: 'physical',
    genres: ['Fiction', 'Drama'],
    rating: 8,
    readDate: '2023-06-12',
    pageCount: 296,
    titleStatus: 'owned',
  });
  await Book.create({
    title: 'Kafka on the Shore',
    authors: ['Haruki Murakami'],
    publishedYear: 2002,
    language: 'en',
    format: 'physical',
    genres: ['Fiction'],
    rating: 9,
    readDate: null,
    titleStatus: 'owned',
  });
  await Book.create({
    title: 'Future Book',
    authors: ['Wishful Author'],
    publishedYear: 2026,
    language: 'en',
    format: 'physical',
    genres: [],
    titleStatus: 'wish',
  });
};

let client: Client;

const callTool = async (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> => {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
};

const textOf = (result: CallToolResult): string => {
  return result.content.map(c => (c as { text?: string }).text ?? '').join('\n');
};

beforeAll(async () => {
  await setupDatabase();
  await wipeAllTables();
  await seedFixtures();

  const server = createMcpServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client(
    { name: 'test-client', version: '0.0.0' },
    { capabilities: {} }
  );
  await client.connect(clientTransport);
}, 30000);

describe('MCP integration: tool registry', () => {
  it('exposes the 13 documented tools', async () => {
    const list = await client.listTools();
    const names = list.tools.map(t => t.name).sort();
    expect(names).toEqual(
      [
        'clear_movie_watched',
        'get_album',
        'get_album_story',
        'get_book',
        'get_collection_stats',
        'get_movie',
        'get_now_playing',
        'list_watch_next',
        'list_wishlist',
        'mark_movie_watched',
        'search_albums',
        'search_books',
        'search_movies',
      ].sort()
    );
  });
});

describe('search_movies', () => {
  it('returns owned movies in markdown by default with id-first column', async () => {
    const r = await callTool('search_movies', {});
    const text = textOf(r);
    expect(text).toMatch(/^\| id \| title \|/m);
    expect(text).toContain('Inception');
    expect(text).toContain('My Neighbor Totoro');
    expect(text).not.toContain('Some Wishlisted Movie');
  });

  it('returns JSON when format_output=json', async () => {
    const r = await callTool('search_movies', { format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.items.length).toBe(2);
    expect(parsed.items[0]).toHaveProperty('id');
    expect(parsed.items[0]).toHaveProperty('title');
  });

  it('respects max_age filter', async () => {
    const r = await callTool('search_movies', { max_age: 10, format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    const titles = parsed.items.map((i: { title: string }) => i.title);
    expect(titles).toContain('My Neighbor Totoro');
    expect(titles).not.toContain('Inception');
  });

  it('respects min_imdb filter', async () => {
    const r = await callTool('search_movies', { min_imdb: 8.5, format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    const titles = parsed.items.map((i: { title: string }) => i.title);
    expect(titles).toEqual(['Inception']);
  });

  it('respects runtime_max filter (in-memory)', async () => {
    const r = await callTool('search_movies', { runtime_max: 100, format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    const titles = parsed.items.map((i: { title: string }) => i.title);
    expect(titles).toEqual(['My Neighbor Totoro']);
  });

  it('respects watched=false filter', async () => {
    const r = await callTool('search_movies', { watched: false, format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    const titles = parsed.items.map((i: { title: string }) => i.title);
    expect(titles).toContain('My Neighbor Totoro');
    expect(titles).not.toContain('Inception');
  });

  it('respects limit and reports total_count + truncated when exceeded', async () => {
    const r = await callTool('search_movies', { limit: 1, format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.returned).toBe(1);
    expect(parsed.total_count).toBe(2);
    expect(parsed.truncated).toBe(true);
  });
});

describe('search_albums', () => {
  it('returns the CDs and the albums the user has only as files, never the wishes', async () => {
    const r = await callTool('search_albums', { format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    const items = parsed.items.map((i: { title: string; status: string }) => `${i.title} (${i.status})`).sort();
    expect(items).toEqual(['In Rainbows (digital)', 'Kind of Blue (CD)', 'The Wall (CD)']);
  });

  it('keeps to one medium when asked', async () => {
    const cds = JSON.parse(textOf(await callTool('search_albums', { medium: 'cd', format_output: 'json' })));
    expect(cds.items.map((i: { title: string }) => i.title).sort()).toEqual(['Kind of Blue', 'The Wall']);
    const files = JSON.parse(textOf(await callTool('search_albums', { medium: 'digital', genre: 'Rock', format_output: 'json' })));
    expect(files.items.map((i: { title: string }) => i.title)).toEqual(['In Rainbows']);
  });

  it('filters by artist', async () => {
    const r = await callTool('search_albums', { artist: 'Pink Floyd', format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.items.map((i: { title: string }) => i.title)).toEqual(['The Wall']);
  });

  it('filters by genre', async () => {
    const r = await callTool('search_albums', { genre: 'Jazz', format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.items.map((i: { title: string }) => i.title)).toEqual(['Kind of Blue']);
  });

  it('filters by format (in-memory)', async () => {
    const r = await callTool('search_albums', { format: 'Vinyl', format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.items.map((i: { title: string }) => i.title)).toEqual(['Kind of Blue']);
  });

  it('filters by year range', async () => {
    const r = await callTool('search_albums', { year_min: 1970, year_max: 1990, format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.items.map((i: { title: string }) => i.title)).toEqual(['The Wall']);
  });
});

describe('search_books', () => {
  it('returns owned books', async () => {
    const r = await callTool('search_books', { format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    const titles = parsed.items.map((i: { title: string }) => i.title).sort();
    expect(titles).toEqual(['Kafka on the Shore', 'Norwegian Wood']);
  });

  it('filters by author', async () => {
    const r = await callTool('search_books', { author: 'Murakami', format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.items.length).toBe(2);
  });

  it('filters by read=true', async () => {
    const r = await callTool('search_books', { read: true, format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.items.map((i: { title: string }) => i.title)).toEqual(['Norwegian Wood']);
  });

  it('filters by read=false', async () => {
    const r = await callTool('search_books', { read: false, format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.items.map((i: { title: string }) => i.title)).toEqual(['Kafka on the Shore']);
  });
});

describe('get_movie', () => {
  it('returns full JSON detail for an existing movie', async () => {
    const list = await callTool('search_movies', { format_output: 'json' });
    const items = JSON.parse(textOf(list)).items as Array<{ id: number; title: string }>;
    const inception = items.find(i => i.title === 'Inception')!;

    const r = await callTool('get_movie', { id: inception.id });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.id).toBe(inception.id);
    expect(parsed.title).toBe('Inception');
    expect(parsed.plot).toContain('thief');
    expect(Array.isArray(parsed.cast)).toBe(true);
    expect(Array.isArray(parsed.crew)).toBe(true);
    expect(Array.isArray(parsed.collections)).toBe(true);
  });

  it('returns isError when movie does not exist', async () => {
    const r = await callTool('get_movie', { id: 99999 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('not found');
  });
});

describe('get_album', () => {
  it('returns full JSON detail with discs array', async () => {
    const list = await callTool('search_albums', { format_output: 'json' });
    const items = JSON.parse(textOf(list)).items as Array<{ id: number; title: string }>;
    const wall = items.find(i => i.title === 'The Wall')!;

    const r = await callTool('get_album', { id: wall.id });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.id).toBe(wall.id);
    expect(parsed.title).toBe('The Wall');
    expect(Array.isArray(parsed.discs)).toBe(true);
  });

  it('returns isError when album does not exist', async () => {
    const r = await callTool('get_album', { id: 99999 });
    expect(r.isError).toBe(true);
  });

  it('gives each track its credits and the album its listening guide', async () => {
    const wall = JSON.parse(textOf(await callTool('search_albums', { format_output: 'json' }))).items.find((i: { title: string }) => i.title === 'The Wall');
    const parsed = JSON.parse(textOf(await callTool('get_album', { id: wall.id })));
    expect(parsed.discs[0].tracks[0]).toMatchObject({
      track_number: 3, title: 'Another Brick in the Wall, Part 1', performers: [{ name: 'David Gilmour', role: 'guitar' }],
    });
    expect(parsed.discs[0].tracks[0].work).toBeUndefined();
    expect(parsed.listening_guide).toContain('Un opéra rock.');
  });
});

describe('get_album_story', () => {
  it('tells the album\'s Wikipedia article as text', async () => {
    const wall = JSON.parse(textOf(await callTool('search_albums', { format_output: 'json' }))).items.find((i: { title: string }) => i.title === 'The Wall');
    const parsed = JSON.parse(textOf(await callTool('get_album_story', { id: wall.id })));
    expect(parsed.found).toBe(true);
    expect(parsed.article.url).toBe('https://en.wikipedia.org/wiki/The_Wall');
    expect(parsed.article.text).toBe('The Wall is the eleventh studio album by Pink Floyd.\n\n## Recording\n\nRecorded in France.');
  });

  it('returns isError when album does not exist', async () => {
    expect((await callTool('get_album_story', { id: 99999 })).isError).toBe(true);
  });
});

describe('get_now_playing', () => {
  afterEach(() => jest.restoreAllMocks());

  it('says nothing plays when no player told Navidrome', async () => {
    jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
    jest.spyOn(navidromeService, 'getNowPlaying').mockResolvedValue([]);
    expect(JSON.parse(textOf(await callTool('get_now_playing'))).playing).toEqual([]);
  });

  it('finds the DexVault album of the song a player plays', async () => {
    const wall = JSON.parse(textOf(await callTool('search_albums', { format_output: 'json' }))).items.find((i: { title: string }) => i.title === 'The Wall');
    jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
    jest.spyOn(navidromeService, 'getNowPlaying').mockResolvedValue([{
      songId: 's3', title: 'Another Brick in the Wall, Part 1', artist: 'Pink Floyd', album: 'The Wall', albumId: 'nd-wall',
      discNumber: 1, track: 3, durationSec: 191, user: 'Dexvault', player: 'dexvault', minutesAgo: 1,
    }]);
    jest.spyOn(ripStatusService, 'navidromeAlbums').mockResolvedValue(new Map([[wall.id, { id: 'nd-wall' } as never]]));
    const [playing] = JSON.parse(textOf(await callTool('get_now_playing'))).playing;
    expect(playing).toMatchObject({ where: 'DexVault', album_id: wall.id, track_number: 3, minutes_ago: 1 });
  });
});

describe('get_book', () => {
  it('returns full JSON detail including comments array', async () => {
    const list = await callTool('search_books', { format_output: 'json' });
    const items = JSON.parse(textOf(list)).items as Array<{ id: number; title: string }>;
    const nw = items.find(i => i.title === 'Norwegian Wood')!;

    const r = await callTool('get_book', { id: nw.id });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.id).toBe(nw.id);
    expect(parsed.title).toBe('Norwegian Wood');
    expect(Array.isArray(parsed.comments)).toBe(true);
  });

  it('returns isError when book does not exist', async () => {
    const r = await callTool('get_book', { id: 99999 });
    expect(r.isError).toBe(true);
  });
});

describe('get_collection_stats', () => {
  it('returns counters by type, format, genre', async () => {
    const r = await callTool('get_collection_stats', {});
    const parsed = JSON.parse(textOf(r));
    expect(parsed.movies.total).toBe(2);
    expect(parsed.albums.total).toBe(2);
    expect(parsed.books.total).toBe(2);
    expect(parsed.movies.by_format['Blu-ray']).toBe(1);
    expect(parsed.movies.by_format['DVD']).toBe(1);
    expect(parsed.albums.by_genre['Jazz']).toBe(1);
    expect(parsed.books.by_genre['Fiction']).toBe(2);
    expect(parsed.grand_total).toBe(6);
  });
});

describe('list_wishlist', () => {
  it('returns wishlist items across all types when type is omitted', async () => {
    const r = await callTool('list_wishlist', { format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    const types = parsed.items.map((i: { type: string }) => i.type).sort();
    expect(types).toEqual(['album', 'book', 'movie']);
  });

  it('filters by type=movie', async () => {
    const r = await callTool('list_wishlist', { type: 'movie', format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].type).toBe('movie');
    expect(parsed.items[0].title).toBe('Some Wishlisted Movie');
  });

  it('filters by type=album', async () => {
    const r = await callTool('list_wishlist', { type: 'album', format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].title).toBe('Future Album');
  });

  it('filters by type=book', async () => {
    const r = await callTool('list_wishlist', { type: 'book', format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].title).toBe('Future Book');
  });

  it('interleaves types when truncated so each type with items is represented', async () => {
    // Each type has exactly 1 wish item in the fixtures (3 total). With limit=2
    // and a naive concatenation, books would be dropped. Round-robin ensures
    // that the first 2 items contain at least 2 distinct types.
    const r = await callTool('list_wishlist', { limit: 2, format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.total_count).toBe(3);
    expect(parsed.returned).toBe(2);
    expect(parsed.truncated).toBe(true);
    const types = new Set(parsed.items.map((i: { type: string }) => i.type));
    expect(types.size).toBe(2);
  });
});

describe('safe handler', () => {
  it('rejects invalid input via zod validation (negative id)', async () => {
    let threw = false;
    try {
      await client.callTool({ name: 'get_movie', arguments: { id: -1 } });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toMatch(/(Invalid|validation|expected|parse)/i);
    }
    // Either the SDK throws on invalid input, or it returns an isError result.
    // Both are acceptable failure modes. If it didn't throw, fall back to isError check.
    if (!threw) {
      const r = (await client.callTool({ name: 'get_movie', arguments: { id: -1 } })) as CallToolResult;
      expect(r.isError).toBe(true);
    }
  });
});

// Create a fresh, unwatched movie so write-tool tests don't depend on or
// disturb the shared read-tool fixtures.
const makeMovie = async (title: string) => {
  return Movie.create({
    title,
    original_title: title,
    original_language: 'en',
    genre: null,
    director: 'Test Director',
    cast: [],
    release_date: '2023-01-01',
    format: 'Blu-ray',
    imdb_rating: null,
    rotten_tomato_rating: null,
    rotten_tomatoes_link: null,
    tmdb_rating: null,
    tmdb_id: null,
    imdb_id: null,
    price: null,
    runtime: null,
    plot: null,
    comments: null,
    never_seen: true,
    acquired_date: null,
    import_id: null,
    poster_path: null,
    backdrop_path: null,
    budget: null,
    revenue: null,
    trailer_key: null,
    trailer_site: null,
    status: null,
    popularity: null,
    vote_count: null,
    adult: false,
    video: false,
    media_type: 'movie',
    recommended_age: null,
    title_status: 'owned',
  });
};

describe('mark_movie_watched', () => {
  it('marks a movie watched at a given date, setting last_watched and never_seen=false', async () => {
    const m = await makeMovie('Mark Target A');
    const r = await callTool('mark_movie_watched', { id: m.id, date: '2025-03-15' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.id).toBe(m.id);
    expect(parsed.last_watched).toBe('2025-03-15');
    expect(parsed.never_seen).toBe(false);
    expect(parsed.watch_count).toBe(1);
  });

  it('increments watch_count on each call', async () => {
    const m = await makeMovie('Mark Target B');
    await callTool('mark_movie_watched', { id: m.id, date: '2025-01-01' });
    const r = await callTool('mark_movie_watched', { id: m.id, date: '2025-02-01' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.watch_count).toBe(2);
    expect(parsed.last_watched).toBe('2025-02-01');
  });

  it('defaults to today when no date is provided', async () => {
    const m = await makeMovie('Mark Target C');
    const r = await callTool('mark_movie_watched', { id: m.id });
    const parsed = JSON.parse(textOf(r));
    const today = new Date().toISOString().split('T')[0];
    expect(parsed.last_watched).toBe(today);
    expect(parsed.watch_count).toBe(1);
  });

  it('returns isError when the movie does not exist', async () => {
    const r = await callTool('mark_movie_watched', { id: 99999 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('not found');
  });

  it('rejects an invalid date format via zod validation', async () => {
    let threw = false;
    let result: CallToolResult | undefined;
    try {
      result = (await client.callTool({
        name: 'mark_movie_watched',
        arguments: { id: 1, date: '15-03-2025' },
      })) as CallToolResult;
    } catch (err) {
      threw = true;
      expect((err as Error).message).toMatch(/(Invalid|validation|expected|parse|date|YYYY)/i);
    }
    if (!threw) {
      expect(result!.isError).toBe(true);
    }
  });
});

describe('clear_movie_watched', () => {
  it('resets last_watched to null and watch_count to 0', async () => {
    const m = await makeMovie('Clear Target');
    await callTool('mark_movie_watched', { id: m.id, date: '2025-04-01' });
    const r = await callTool('clear_movie_watched', { id: m.id });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.id).toBe(m.id);
    expect(parsed.last_watched).toBeNull();
    expect(parsed.watch_count).toBe(0);
  });

  it('returns isError when the movie does not exist', async () => {
    const r = await callTool('clear_movie_watched', { id: 99999 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('not found');
  });
});

describe('list_watch_next', () => {
  let firstId: number;
  let secondId: number;

  beforeAll(async () => {
    await Collection.initializeSystemCollections();
    const a = await makeMovie('Watch Next One');
    const b = await makeMovie('Watch Next Two');
    firstId = a.id;
    secondId = b.id;
    await Movie.toggleWatchNext(a.id);
    await Movie.toggleWatchNext(b.id);
  });

  it('returns Watch Next movies as id-first markdown by default', async () => {
    const r = await callTool('list_watch_next', {});
    const text = textOf(r);
    expect(text).toMatch(/^\| id \| title \|/m);
    expect(text).toContain('Watch Next One');
    expect(text).toContain('Watch Next Two');
  });

  it('returns JSON with compact movie fields, in the order of the collection', async () => {
    const r = await callTool('list_watch_next', { format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(parsed.items[0]).toHaveProperty('id');
    expect(parsed.items[0]).toHaveProperty('title');
    expect(parsed.items[0]).toHaveProperty('watched');
    // toggled a then b; a new movie goes to the end, so a leads.
    expect(parsed.items[0].id).toBe(firstId);
    expect(parsed.items.map((i: { id: number }) => i.id)).toContain(secondId);
  });

  it('respects limit and reports truncation', async () => {
    const r = await callTool('list_watch_next', { limit: 1, format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.returned).toBe(1);
    expect(parsed.truncated).toBe(true);
    expect(parsed.total_count).toBeGreaterThanOrEqual(2);
  });

  it('returns an empty list (not an error) when nothing is queued', async () => {
    // Remove both from Watch Next via toggle, then expect an empty result.
    await Movie.toggleWatchNext(firstId);
    await Movie.toggleWatchNext(secondId);
    const r = await callTool('list_watch_next', { format_output: 'json' });
    const parsed = JSON.parse(textOf(r));
    expect(r.isError).toBeFalsy();
    expect(parsed.items.length).toBe(0);
    expect(parsed.total_count).toBe(0);
  });
});
