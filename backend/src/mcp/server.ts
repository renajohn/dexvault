import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSearchMovies } from './tools/searchMovies';
import { registerSearchAlbums } from './tools/searchAlbums';
import { registerSearchBooks } from './tools/searchBooks';
import { registerGetMovie } from './tools/getMovie';
import { registerGetAlbum } from './tools/getAlbum';
import { registerGetAlbumStory } from './tools/getAlbumStory';
import { registerGetNowPlaying } from './tools/getNowPlaying';
import { registerGetBook } from './tools/getBook';
import { registerGetCollectionStats } from './tools/getCollectionStats';
import { registerListWishlist } from './tools/listWishlist';
import { registerMarkMovieWatched } from './tools/markMovieWatched';
import { registerClearMovieWatched } from './tools/clearMovieWatched';
import { registerListWatchNext } from './tools/listWatchNext';

export const SERVER_NAME = 'dexvault-mcp';
export const SERVER_VERSION = '0.1.0';

export const createMcpServer = (): McpServer => {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  registerSearchMovies(server);
  registerSearchAlbums(server);
  registerSearchBooks(server);
  registerGetMovie(server);
  registerGetAlbum(server);
  registerGetAlbumStory(server);
  registerGetNowPlaying(server);
  registerGetBook(server);
  registerGetCollectionStats(server);
  registerListWishlist(server);
  registerMarkMovieWatched(server);
  registerClearMovieWatched(server);
  registerListWatchNext(server);

  return server;
};
