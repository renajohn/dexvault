import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import configManager from './src/config';
import logger from './src/logger';
import movieController from './src/controllers/movieController';
import analyticsController from './src/controllers/analyticsController';
import musicController from './src/controllers/musicController';
import mixtapeController from './src/controllers/mixtapeController';
import musicService from './src/services/musicService';
import bookController from './src/controllers/bookController';
import remoteController from './src/controllers/remoteController';
import outputController from './src/controllers/outputController';
import bookService from './src/services/bookService';
import backupController from './src/controllers/backupController';
import dropboxBackupController from './src/controllers/dropboxBackupController';
import bookCommentController from './src/controllers/bookCommentController';
import spokenForController from './src/controllers/spokenForController';
import albumFinderController from './src/controllers/albumFinderController';
import movieFinderController from './src/controllers/movieFinderController';
import bookFinderController from './src/controllers/bookFinderController';
import bookSectionsController from './src/controllers/bookSectionsController';
import scorePiecesController from './src/controllers/scorePiecesController';
import warningsController from './src/controllers/warningsController';
import filmagesController from './src/controllers/filmagesController';
import albumStoryController from './src/controllers/albumStoryController';
import albumGuideController from './src/controllers/albumGuideController';
import lyricsController from './src/controllers/lyricsController';
import playerController from './src/controllers/playerController';
import navidromePluginController from './src/controllers/navidromePluginController';
import albumGuideService from './src/services/albumGuideService';
import lyricsService from './src/services/lyricsService';
import digitalAlbumService from './src/services/digitalAlbumService';
import listenNextPlaylistService from './src/services/listenNextPlaylistService';
import mixtapeService from './src/services/mixtapeService';
import shelvingController from './src/controllers/shelvingController';
import shelvingService from './src/services/shelvingService';
import warningsService from './src/services/warningsService';
import movieFilmagesService from './src/services/movieFilmagesService';
import movieCreditsService from './src/services/movieCreditsService';
import { startNightlyBackup } from './src/services/nightlyBackupService';
import albumRatingService from './src/services/albumRatingService';
import listenHistoryService from './src/services/listenHistoryService';
import navidromeService from './src/services/navidromeService';
import outputs from './src/services/upnp/outputs';
import ripStatusService from './src/services/ripStatusService';
import trackPopularityService from './src/services/trackPopularityService';
import { mountMcp } from './src/mcp/mount';
import Movie from './src/models/movie';
import MovieCast from './src/models/movieCast';
import MovieCrew from './src/models/movieCrew';
import Collection from './src/models/collection';
import MovieCollection from './src/models/movieCollection';
import { initDatabase } from './src/database';
import imageService from './src/services/imageService';
import movieService from './src/services/movieService';
import { sendImage } from './src/services/imageThumbService';

// Parse command line arguments
const args = process.argv.slice(2);
const deploymentFile = args.find(arg => arg.startsWith('--deployment='))?.split('=')[1] ||
                      args.find(arg => arg.startsWith('-d='))?.split('=')[1];

// Load configuration
try {
  configManager.loadDeploymentConfig(deploymentFile);
  configManager.loadDataConfig();
} catch (error) {
  logger.error('Configuration loading failed:', (error as Error).message);
  logger.info('Usage: node index.js [--deployment=path/to/deployment.json]');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.static('public'));

// Apply multer middleware specifically for file upload routes BEFORE JSON parsing
// Create upload middleware after config is loaded
let backupUploadMiddleware: ReturnType<typeof backupController.restoreUpload> | undefined;

app.post('/api/movies/:id/upload-poster', movieController.posterUploadMiddleware, movieController.uploadCustomPoster);
app.post('/api/backup/upload-restore', (req: Request, res: Response, next: NextFunction) => {
  if (!backupUploadMiddleware) {
    return next(new Error('Upload middleware not initialized'));
  }
  backupUploadMiddleware(req, res, next);
}, backupController.uploadAndRestoreBackup);

// JSON parsing middleware for all other routes (with increased limit for cover art)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// MCP server: mount before static and after JSON parsing.
// The streamable HTTP transport reads req.body (already parsed by express.json).
mountMcp(app, '/mcp');

// Initialize database
const startServer = async (): Promise<void> => {
  try {
    await initDatabase();

    // Initialize services with configuration
    await imageService.init();

    // Initialize ebooks directory
    try {
      const ebooksDir = configManager.getEbooksPath();
      if (!fs.existsSync(ebooksDir)) {
        fs.mkdirSync(ebooksDir, { recursive: true });
        logger.info(`Created ebooks directory: ${ebooksDir}`);
      }
    } catch (error) {
      logger.warn('Failed to initialize ebooks directory:', (error as Error).message);
      // Don't block initialization if ebooks directory creation fails
    }

    // Initialize music tables
    await musicService.initializeTables();

    // Note: Book tables are initialized in database.js during initDatabase()

    logger.info('Database initialized successfully');
    logger.info(`Using database: ${configManager.getDatabasePath()}`);
    logger.info(`Using images directory: ${configManager.getImagesPath()}`);
    logger.info(`Using ebooks directory: ${configManager.getEbooksPath()}`);

    // Initialize upload middleware with proper config
    backupUploadMiddleware = backupController.restoreUpload();
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    process.exit(1);
  }
};

// API Routes (all under /api prefix)
app.get('/api/movies', movieController.getAllMovies);
app.get('/api/movies/search', movieController.searchMovies);
app.get('/api/movies/search/tmdb', movieController.searchMoviesTMDB);
app.get('/api/movies/search/all', movieController.searchAllTMDB);
// Finding a movie as one types: its people, its sagas; adding it at once, or a box set; buying what was wished
app.get('/api/movies/finder/search', movieFinderController.search);
app.get('/api/movies/finder/people/:id', movieFinderController.person);
app.get('/api/movies/finder/sagas/:id', movieFinderController.saga);
app.post('/api/movies/finder/movies', movieFinderController.addMovie);
app.post('/api/movies/finder/box-sets', movieFinderController.addBoxSet);
app.post('/api/movies/finder/buy', movieFinderController.buy);
app.get('/api/tmdb/genres', movieController.getTMDBGenres);
app.get('/api/tmdb/movie/:id', movieController.getMovieDetailsTMDB);
app.get('/api/tmdb/tv/:id', movieController.getTVShowDetailsTMDB);
app.get('/api/omdb/search', movieController.searchOMDB);
app.get('/api/movies/autocomplete', movieController.getAutocompleteSuggestions);
app.get('/api/movies/formats', movieController.getFormats);
app.get('/api/movies/collections', movieController.getCollectionNames);
app.get('/api/debug/collections', movieController.debugCollections);
app.post('/api/fix/box-set-types', movieController.fixBoxSetTypes);
app.get('/api/movies/collections/movies', movieController.getMoviesByCollection);

// Collection routes
app.get('/api/collections', movieController.getAllCollections);
app.get('/api/collections/suggestions', movieController.getCollectionSuggestions);
app.post('/api/collections', movieController.createCollection);
app.put('/api/collections/:id', movieController.updateCollection);
app.delete('/api/collections/:id', movieController.deleteCollection);
// Specific route for Watch Next must come before generic :id route
app.get('/api/collections/watch-next/movies', movieController.getWatchNextMovies);
app.put('/api/collections/watch-next/order', movieController.reorderWatchNext);
app.get('/api/collections/:id/movies', movieController.getCollectionMovies);
app.post('/api/collections/cleanup', movieController.cleanupEmptyCollections);

// Movie collection routes
app.get('/api/movies/:id/collections', movieController.getMovieCollections);
app.post('/api/movies/:id/collections', movieController.addMovieToCollection);
app.put('/api/movies/:id/collections', movieController.updateMovieCollections);
app.delete('/api/movies/:movieId/collections/:collectionId', movieController.removeMovieFromCollection);
app.put('/api/movies/:movieId/collections/:collectionId/order', movieController.updateMovieOrder);
app.post('/api/collections/handle-name-change', movieController.handleCollectionNameChange);
app.get('/api/movies/check-status', movieController.checkMovieStatus);
app.get('/api/movies/check-editions', movieController.checkMovieEditions);
// Spider and snake warnings (DoesTheDogDie)
app.get('/api/movies/:id/warnings', warningsController.get);
app.put('/api/movies/:id/warnings/:topic/override', warningsController.setOverride);
app.put('/api/movies/:id/ddd-link', warningsController.setLink);
app.post('/api/movies/:id/warnings/refresh', warningsController.refresh);
app.post('/api/warnings/import', warningsController.importSnapshot);

// Legal and suggested ages (FilmAges, filmages.ch)
app.get('/api/movies/:id/filmages', filmagesController.get);
app.put('/api/movies/:id/filmages-link', filmagesController.setLink);
app.delete('/api/movies/:id/filmages-link', filmagesController.clearLink);
app.post('/api/movies/:id/filmages/refresh', filmagesController.refresh);
app.post('/api/filmages/sweep', filmagesController.sweep);
app.get('/api/movies/:id', movieController.getMovieById);
app.get('/api/movies/:id/details', movieController.getMovieDetails);
app.get('/api/movies/:id/cast', movieController.getMovieCast);
app.get('/api/movies/:id/crew', movieController.getMovieCrew);
app.post('/api/movies', movieController.createMovie);
app.post('/api/movies/add', movieController.addMovie);
app.post('/api/movies/add-with-pipeline', movieController.addMovieWithPipeline);
app.post('/api/movies/scan-cover', movieController.scanCover);
app.get('/api/tmdb/search', movieController.searchTMDB);
app.put('/api/movies/:id', movieController.updateMovie);
app.post('/api/movies/:id/refresh-ratings', movieController.refreshMovieRatings);
app.delete('/api/movies/:id', movieController.deleteMovie);

// Wish list routes
app.get('/api/movies/status/:status', movieController.getMoviesByStatus);
app.put('/api/movies/:id/status', movieController.updateMovieStatus);
app.put('/api/movies/:id/spoken-for', spokenForController.updateMovie);
app.post('/api/migrate/title-status', movieController.migrateTitleStatus);

// Watch Next routes
app.put('/api/movies/:id/watch-next', movieController.toggleWatchNext);

// Mark as Watched routes
app.put('/api/movies/:id/watched', movieController.markAsWatched);
app.delete('/api/movies/:id/watched', movieController.clearWatched);
app.put('/api/movies/:id/watch-count', movieController.updateWatchCount);

// TMDB Poster routes
app.get('/api/tmdb/:tmdbId/posters', movieController.getMoviePosters);

app.get('/api/ratings', movieController.fetchRatings);
app.get('/api/thumbnail', movieController.getMovieThumbnail);
// Serve images with support for subdirectories (e.g., cd/custom/filename.jpg)
// Route with subdirectory
app.get('/api/images/:type/:subdir/:filename', (req: Request, res: Response) => {
  const { type, subdir, filename } = req.params;
  void sendImage(req, res, path.join(type as string, subdir as string, filename as string));
});
// Route without subdirectory (for backward compatibility)
app.get('/api/images/:type/:filename', (req: Request, res: Response) => {
  const { type, filename } = req.params;
  void sendImage(req, res, path.join(type as string, filename as string));
});

// Analytics routes
// Shelving: where each physical object is kept
app.get('/api/shelving', shelvingController.plan);
app.get('/api/shelving/locations', shelvingController.locations);
app.post('/api/shelving/moves/done', shelvingController.movesDone);
app.post('/api/shelving/moves/undo', shelvingController.movesUndone);
app.put('/api/shelving/items/:kind/:id', shelvingController.saveItem);
app.post('/api/shelving/items/:kind/:id/no-room', shelvingController.noRoom);
app.post('/api/shelving/items/:kind/:id/move-back', shelvingController.moveBack);
app.post('/api/shelving/units', shelvingController.createUnit);
app.put('/api/shelving/units/:id', shelvingController.updateUnit);
app.delete('/api/shelving/units/:id', shelvingController.deleteUnit);
app.get('/api/shelving/levels/state', shelvingController.levelsState);
app.put('/api/shelving/levels/state', shelvingController.restoreLevels);
app.put('/api/shelving/levels/:id', shelvingController.updateLevel);
app.get('/api/shelving/levels/:id/line', shelvingController.line);
app.post('/api/shelving/levels/:id/take-off', shelvingController.takeOff);
app.put('/api/shelving/collections/:id', shelvingController.setTogether);
app.get('/api/shelving/places', shelvingController.places);
app.post('/api/shelving/places', shelvingController.createPlace);
app.put('/api/shelving/places/:id', shelvingController.renamePlace);
app.delete('/api/shelving/places/:id', shelvingController.deletePlace);

app.get('/api/analytics', analyticsController.getAnalytics);
app.get('/api/analytics/music', analyticsController.getMusicAnalytics);
app.get('/api/analytics/books', analyticsController.getBookAnalytics);

// Cache management routes
app.post('/api/cache/invalidate', analyticsController.invalidateCache);
app.get('/api/cache/stats', analyticsController.getCacheStats);

// Music routes
app.get('/api/music/albums', musicController.getAllAlbums);
app.get('/api/music/albums/search', musicController.searchAlbums);
app.get('/api/music/albums/status/:status', musicController.getAlbumsByStatus);
app.post('/api/music/scan-cover', musicController.scanCover);
app.post('/api/music/transcribe-sleeve', musicController.transcribeSleeve);
app.post('/api/music/releases/:source/:releaseId', musicController.addAlbumFromSource);
app.post('/api/music/albums', musicController.addAlbum);
app.get('/api/music/digital', musicController.getDigitalLibrary);
app.post('/api/music/digital/sync', musicController.syncDigitalLibrary);
app.put('/api/music/digital/:navidromeId/wish', musicController.setDigitalWished);
app.delete('/api/music/digital/:navidromeId/wish', musicController.setDigitalWished);
app.put('/api/music/digital/:navidromeId/dismiss', musicController.setDigitalDismissed);
app.delete('/api/music/digital/:navidromeId/dismiss', musicController.setDigitalDismissed);
app.get('/api/music/digital/:navidromeId/tracks', musicController.getDigitalTracks);
app.get('/api/music/navidrome-cover/:navidromeId', musicController.getNavidromeCover);
app.get('/api/music/navidrome/stream/:id', playerController.stream);
// The remote: what plays in which browser, and commands to it from another device.
// Kept, behind REMOTE_ENABLED, until playing on the appliances (UPnP) is trusted.
if (configManager.getUpnpOptions().remoteEnabled) {
  app.get('/api/remote/players', remoteController.players);
  app.put('/api/remote/players/:id', remoteController.report);
  app.get('/api/remote/players/:id/commands', remoteController.commands);
  app.put('/api/remote/players/:id/name', remoteController.rename);
  app.post('/api/remote/players/:id/commands', remoteController.command);
  app.post('/api/remote/acks/:commandId', remoteController.acknowledge);
}
// The appliances DexVault plays on (UPnP: the Onkyo, the WiiM), and what plays there
app.get('/api/outputs', outputController.list);
app.get('/api/outputs/events', outputController.events);
app.post('/api/outputs/:id/play', outputController.play);
app.post('/api/outputs/:id/listen-next', outputController.listenNext);
app.post('/api/outputs/:id/toggle', outputController.toggle);
app.post('/api/outputs/:id/next', outputController.next);
app.post('/api/outputs/:id/previous', outputController.previous);
app.post('/api/outputs/:id/stop', outputController.stop);
app.post('/api/outputs/:id/resume', outputController.resume);
app.post('/api/outputs/:id/track', outputController.track);
app.post('/api/outputs/:id/seek', outputController.seek);
app.put('/api/outputs/:id/volume', outputController.volume);
app.put('/api/outputs/:id/settings', outputController.settings);
app.post('/api/music/navidrome/scrobble/:id', playerController.scrobble);
app.put('/api/music/navidrome/star/:id', playerController.star);
app.delete('/api/music/navidrome/star/:id', playerController.star);
// What the DexVault plugin in Navidrome hands on of every account, as Navidrome told it.
app.post('/api/music/navidrome/plugin/events', navidromePluginController.authenticate, navidromePluginController.event);
app.put('/api/music/navidrome/plugin/library/:user', navidromePluginController.authenticate, navidromePluginController.library);
app.get('/api/music/navidrome/plugin/recent', navidromePluginController.recent);
app.post('/api/music/albums/link-musicbrainz', musicController.linkMusicBrainz);
app.post('/api/music/albums/refresh-musicbrainz', musicController.refreshAllFromMusicBrainz);
app.post('/api/music/albums/:id/refresh-musicbrainz', musicController.refreshFromMusicBrainz);
app.post('/api/music/albums/community-ratings', musicController.refreshAllCommunityRatings);
app.post('/api/music/albums/:id/community-rating', musicController.refreshCommunityRating);
app.post('/api/music/albums/:id/track-popularity', musicController.refreshTrackPopularity);
app.get('/api/music/albums/:id', musicController.getAlbumById);
app.put('/api/music/albums/:id', musicController.updateAlbum);
app.put('/api/music/albums/:id/status', musicController.updateAlbumStatus);
app.put('/api/music/albums/:id/spoken-for', spokenForController.updateAlbum);
app.delete('/api/music/albums/:id', musicController.deleteAlbum);
app.post('/api/music/albums/:id/upload-cover', musicController.coverUploadMiddleware, musicController.uploadCustomCover);
app.post('/api/music/albums/:id/upload-back-cover', musicController.coverUploadMiddleware, musicController.uploadCustomBackCover);
app.post('/api/music/albums/:id/import-navidrome-cover', musicController.importNavidromeCover);
app.get('/api/music/albums/:id/cover-candidates', musicController.getCoverCandidates);
app.post('/api/music/albums/:id/cover-candidates', musicController.useCoverCandidate);
app.get('/api/music/albums/:id/navidrome-tracks', musicController.getNavidromeTracks);
app.put('/api/music/albums/:id/rating', musicController.setUserRating);
app.post('/api/music/albums/:id/rating/sync', musicController.syncUserRating);
app.post('/api/music/ratings/sync', musicController.syncAllUserRatings);
app.get('/api/music/albums/:id/notes', musicController.getAlbumNotes);
app.get('/api/music/albums/:id/overlaps', musicController.getAlbumOverlaps);
app.get('/api/music/albums/:id/scores', scorePiecesController.ofAlbum);
app.post('/api/music/albums/:id/notes', musicController.createAlbumNote);
app.put('/api/music/notes/:id', musicController.updateAlbumNote);
app.delete('/api/music/notes/:id', musicController.deleteAlbumNote);
app.get('/api/music/autocomplete', musicController.getAutocompleteSuggestions);
app.get('/api/music/search', musicController.searchMusicBrainz);
// Finding an album as one types: a store's catalogue, then MusicBrainz for its CD editions
app.get('/api/music/finder/search', albumFinderController.search);
app.get('/api/music/finder/artists/:source/:id/albums', albumFinderController.discography);
app.get('/api/music/finder/editions', albumFinderController.editions);
app.post('/api/music/finder/albums', albumFinderController.addAlbum);
app.get('/api/music/coverart/:releaseId', musicController.getCoverArt);
app.get('/api/music/search-covers', musicController.getSearchCovers);
app.get('/api/music/search/catalog', musicController.searchByCatalogNumber);
app.get('/api/music/search/barcode', musicController.searchByBarcode);
app.get('/api/music/release/:releaseId', musicController.getMusicBrainzReleaseDetails);
app.post('/api/music/release/:releaseId', musicController.addAlbumFromMusicBrainz);
app.post('/api/music/barcode/:barcode', musicController.addAlbumByBarcode);
app.get('/api/music/albums/:id/apple-music', musicController.getAppleMusicUrl);
app.put('/api/music/albums/:id/listen-next', musicController.toggleListenNext);
app.post('/api/music/albums/:id/bought', musicController.markAlbumBought);
app.post('/api/music/attachable-albums', musicController.findAttachableAlbums);
app.get('/api/music/albums/:id/story', albumStoryController.get);
app.post('/api/music/albums/:id/story/refresh', albumStoryController.refresh);
app.get('/api/music/albums/:id/guide', albumGuideController.get);
app.put('/api/music/albums/:id/guide', albumGuideController.save);
app.delete('/api/music/albums/:id/guide', albumGuideController.remove);
app.post('/api/music/albums/:id/guide/generate', albumGuideController.generate);
app.get('/api/music/albums/:id/lyrics', lyricsController.album);
app.get('/api/music/albums/:id/discs/:disc/tracks/:track/lyrics', lyricsController.get);
app.post('/api/music/albums/:id/discs/:disc/tracks/:track/lyrics', lyricsController.get);
app.get('/api/collections/listen-next/albums', musicController.getListenNextAlbums);
app.put('/api/collections/listen-next/order', musicController.reorderListenNext);
app.put('/api/collections/listen-next/move', musicController.moveListenNext);
app.post('/api/collections/listen-next/smart-fill', musicController.smartFillListenNext);
app.post('/api/collections/listen-next/shuffle/:albumId', musicController.shuffleListenNextAlbum);
app.get('/api/collections/listen-next/stats', musicController.getSmartPlaylistStats);
app.get('/api/collections/listen-next/play', musicController.getListenNextPlay);
app.put('/api/collections/listen-next/repeat', musicController.setListenNextRepeat);
app.put('/api/collections/listen-next/albums/:albumId/shuffled', musicController.setListenNextShuffled);
app.post('/api/collections/listen-next/departures/:id/keep', musicController.keepListenNextDeparture);
app.post('/api/collections/listen-next/played/:albumId', musicController.markListenNextPlayed);

// Mixtapes: the owner's playlists in Navidrome, kept as albums of their own.
app.get('/api/music/mixtapes', mixtapeController.list);
app.post('/api/music/mixtapes', mixtapeController.create);
app.get('/api/music/mixtapes/:albumId', mixtapeController.get);
app.patch('/api/music/mixtapes/:albumId', mixtapeController.update);
app.delete('/api/music/mixtapes/:albumId', mixtapeController.remove);

// Book routes
app.get('/api/books', bookController.getAllBooks);
app.get('/api/books/search', bookController.searchBooks);
app.get('/api/books/search/external', bookController.searchExternalBooks);
// Finding a book as one types: Google Books, its series and its authors; adding it, several, buying
app.get('/api/books/finder/search', bookFinderController.search);
app.get('/api/books/finder/series', bookFinderController.series);
app.get('/api/books/finder/authors', bookFinderController.author);
app.post('/api/books/finder/books', bookFinderController.add);
app.post('/api/books/finder/books/batch', bookFinderController.addMany);
app.post('/api/books/finder/buy', bookFinderController.buy);
// The scores, a section of their own; the reading journal; notes on a series of books
app.get('/api/scores', bookSectionsController.list);
app.put('/api/scores/composers', bookSectionsController.setComposers);
// A score's pieces, as MusicBrainz works, and the recordings of the music playing them
app.get('/api/scores/lookup', scorePiecesController.lookup);
app.post('/api/scores', scorePiecesController.create);
app.post('/api/scores/henle', scorePiecesController.henleAll);
app.get('/api/scores/works/search', scorePiecesController.search);
app.post('/api/scores/works/index', scorePiecesController.index);
app.get('/api/scores/:id/pieces', scorePiecesController.pieces);
app.post('/api/scores/:id/pieces', scorePiecesController.addPieces);
app.put('/api/scores/:id/pieces/:pieceId', scorePiecesController.choose);
app.delete('/api/scores/:id/pieces/:pieceId', scorePiecesController.removePiece);
app.put('/api/scores/:id/pieces/:pieceId/parts', scorePiecesController.keepParts);
app.get('/api/scores/:id/suggestions', scorePiecesController.suggestions);
app.get('/api/scores/:id/imslp', scorePiecesController.imslpPage);
app.get('/api/scores/:id/henle', scorePiecesController.henle);
app.post('/api/scores/:id/contents-photo', scorePiecesController.contentsPhoto);
app.get('/api/books/reading', bookSectionsController.reading);
app.put('/api/books/readings/:id', bookSectionsController.changeReading);
app.delete('/api/books/readings/:id', bookSectionsController.removeReading);
app.get('/api/books/:id/readings', bookSectionsController.readingsOf);
app.post('/api/books/:id/readings', bookSectionsController.addReading);
app.get('/api/books/series-notes', bookSectionsController.seriesNotes);
app.post('/api/books/series-notes', bookSectionsController.addSeriesNote);
app.delete('/api/books/series-notes/:id', bookSectionsController.deleteSeriesNote);
app.get('/api/books/search/series', bookController.searchSeriesVolumes);
app.get('/api/books/series', bookController.getBooksBySeries);
app.get('/api/books/status/:status', bookController.getBooksByStatus);
app.get('/api/books/autocomplete', bookController.getAutocompleteSuggestions); // Must come before /:id route
app.post('/api/books/descriptions/translate', bookController.translateDescriptions);
app.post('/api/books/bnf', bookController.enrichFromBnf);
app.post('/api/books', bookController.addBook);
app.post('/api/books/batch', bookController.addBooksBatch);
app.post('/api/books/enrich', bookController.enrichBook);
app.post('/api/books/scan-cover', bookController.scanCover);
app.post('/api/books/read-photos', bookController.readPhotos);

// Book comment routes - Must come before /:id route
app.get('/api/books/comments/autocomplete/names', bookCommentController.getCommentNameSuggestions);
app.get('/api/books/comments/:id', bookCommentController.getCommentById);
app.post('/api/books/comments', bookCommentController.createComment);
app.put('/api/books/comments/:id', bookCommentController.updateComment);
app.delete('/api/books/comments/:id', bookCommentController.deleteComment);
app.get('/api/books/:bookId/comments', bookCommentController.getCommentsByBookId); // Must come after /comments/:id

app.post('/api/books/:id/re-enrich', bookController.reEnrichBook); // Must come before generic /:id route
app.get('/api/books/:id', bookController.getBookById);
app.put('/api/books/:id', bookController.updateBook);
app.put('/api/books/:id/status', bookController.updateBookStatus);
app.put('/api/books/:id/spoken-for', spokenForController.updateBook);
app.delete('/api/books/:id', bookController.deleteBook);
app.post('/api/books/:id/upload-cover', bookController.coverUploadMiddleware, bookController.uploadCustomCover);
app.post('/api/books/:id/upload-back-cover', bookController.coverUploadMiddleware, bookController.uploadCustomCover);
app.post('/api/books/:id/upload-ebook', bookController.ebookUploadMiddleware, bookController.uploadEbook);
app.get('/api/books/:id/ebook/info', bookController.getEbookInfo);
app.get('/api/books/:id/ebook/download', bookController.downloadEbook);
app.delete('/api/books/:id/ebook', bookController.deleteEbook);

// Configuration endpoint for frontend
app.get('/api/config', (req: Request, res: Response) => {
  try {
    res.json({
      version: process.env.npm_package_version || '0.0.1'
    });
  } catch (error) {
    logger.error('Failed to get config:', (error as Error).message);
    res.status(500).json({ error: 'Failed to get configuration' });
  }
});

// Backup routes
app.post('/api/backup/create', backupController.createBackup);
app.get('/api/backup/list', backupController.listBackups);
app.get('/api/backup/download/:filename', backupController.downloadBackup);
app.post('/api/backup/restore', backupController.restoreBackup);
app.post('/api/backup/upload-restore', backupController.uploadMiddleware, backupController.uploadAndRestoreBackup);
app.get('/api/backup/dropbox/status', dropboxBackupController.getStatus);
app.post('/api/backup/dropbox/run', dropboxBackupController.run);
app.delete('/api/backup/:filename', backupController.deleteBackup);
app.post('/api/backup/cleanup-restore', backupController.cleanupRestoreBackups);

// Cover scan health check
app.get('/api/cover-scan/health', async (req: Request, res: Response) => {
  try {
    const coverScanService = (await import('./src/services/coverScanService')).default;
    const health = await coverScanService.checkHealth();
    res.json(health);
  } catch (error) {
    res.json({ available: false, error: (error as Error).message });
  }
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Posters and backdrops saved before /api/images, stored as /images/…
app.use('/images', (req: Request, res: Response) => {
  let relative: string;
  try {
    relative = decodeURIComponent(req.path).replace(/^\/+/, '');
  } catch {
    res.status(404).json({ error: 'Image not found' });
    return;
  }
  void sendImage(req, res, relative);
});

// Serve the frontend build
// Check for frontend in both development and production locations
let frontendPath: string | null = null;

const frontendPaths = [
  path.join(__dirname, '../frontend'), // Production (from dist)
  path.join(__dirname, '../frontend/build'), // Development
  path.join(process.cwd(), 'frontend') // Fallback
];

for (const testPath of frontendPaths) {
  if (fs.existsSync(testPath)) {
    frontendPath = testPath;
    break;
  }
}

if (frontendPath) {
  logger.info(`Serving frontend from: ${frontendPath}`);

  // Add root redirect to /filmdex
  app.get('/', (req: Request, res: Response) => {
    res.redirect('/filmdex');
  });

  // Serve static files from frontend build (CSS, JS, images, etc.)
  // Vite hashes filenames, so we can cache them aggressively
  app.use('/static', express.static(path.join(frontendPath, 'static'), {
    maxAge: '1y',
    immutable: true,
  }));
  app.use('/assets', express.static(path.join(frontendPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  app.use('/', express.static(frontendPath, { index: false }));

  // Helper to send index.html with no-cache headers
  // This ensures browsers (especially iOS Safari / home screen PWAs)
  // always check for the latest version of the app shell
  const sendIndexHtml = (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(frontendPath as string, 'index.html'));
  };

  // Handle /filmdex route
  app.get('/filmdex', sendIndexHtml);

  // Handle all other routes for React Router (catch-all)
  app.use('/', sendIndexHtml);

// Handle Chrome DevTools request to silence warning
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req: Request, res: Response) => {
  res.status(404).json({ message: 'Not found' });
});

// Root route is now handled by frontend serving above
} else {
  logger.warn('Frontend build not found, serving placeholder');
  app.get('/', (req: Request, res: Response) => {
    res.send(`
      <html>
        <head><title>DexVault</title></head>
        <body>
          <h1>DexVault Backend</h1>
          <p>Backend is running. Frontend build not found.</p>
          <p>API available at <a href="/api/config">/api/config</a></p>
        </body>
      </html>
    `);
  });
}

// Error handling middleware
app.use((err: Error & { code?: string }, req: Request, res: Response, next: NextFunction) => {
  logger.error('Request error:', err.stack);

  // Handle multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      error: `File size exceeds maximum allowed size of ${configManager.getMaxUploadMb()}MB`
    });
    return;
  }

  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req: Request, res: Response) => {
  logger.warn(`Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Route not found' });
});

// Start the server
const serverReady = startServer().then(() => {
  // Only start listening if not in test environment
  if (process.env.NODE_ENV !== 'test') {
    const server = app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      logger.info(`Frontend available at: http://localhost:${PORT}/app/`);
      logger.info(`API available at: http://localhost:${PORT}/api/`);
    });

    // Set a longer timeout for large file downloads (30 minutes)
    server.timeout = 30 * 60 * 1000;
    server.keepAliveTimeout = 30 * 60 * 1000;
    server.headersTimeout = 31 * 60 * 1000;

    warningsService.startDailyRefresh();
    movieFilmagesService.startDailySweep();
    startNightlyBackup();
    albumRatingService.startSync();
    if (navidromeService.isConfigured()) listenHistoryService.startRecording(ripStatusService.refreshLibrary);
    albumGuideService.startAutoWrite();
    digitalAlbumService.startAutoSync();
    listenNextPlaylistService.startAutoSync();
    mixtapeService.startAutoSync();
    lyricsService.startAutoFetch();
    shelvingService.startSortNameSync();
    trackPopularityService.startAutoRefresh();
    movieCreditsService.fillCharacters()
      .then(r => { if (r.movies) logger.info(`Actors' parts: ${r.filled} filled in ${r.movies} movies`); })
      .catch((error: Error) => logger.warn('Could not fill the actors\' parts:', error.message));
    movieService.localizeRemotePosters().catch((error: Error) => logger.warn('Could not bring the posters from TMDB:', error.message));
    // The appliances to play on, and the media listener they fetch the files from: nothing without UPNP_MEDIA_BASE_URL.
    outputs.init(configManager.getUpnpOptions()).catch((error: Error) => logger.warn('UPnP not started:', error.message));
  }
}).catch((error: Error) => {
  logger.error('Failed to start server:', error);
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
});

(app as unknown as express.Application & { serverReady: Promise<void> }).serverReady = serverReady;
export default app;
