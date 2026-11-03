import { parseToken, tokenize, type ParsedToken } from '../components/shared/search/query';
import { musicSchema } from '../components/shared/search/schemas/music';

/**
 * What MusicDex's page reads in its search before the backend does: whether it
 * asks what Navidrome has (Digital on). Read
 * with the search pills' own reading, so `-key:`, `!key:`, true/false,
 * with/without, y/n, 1/0 and the keys' other names (fav:) mean what they mean
 * to the backend.
 */
const filters = (q: string): ParsedToken[] =>
  tokenize(q || '').map(t => parseToken(t.text, musicSchema.keys)).filter(t => t.kind === 'filter' && !!t.def);

/** cd:, file:, ripped: and favourites: ask what Navidrome has, whatever their sign or value. */
const NAVIDROME_KEYS = new Set(['cd', 'file', 'ripped', 'favourites']);

export const asksNavidrome = (q: string): boolean => filters(q).some(t => NAVIDROME_KEYS.has(t.def!.key));
