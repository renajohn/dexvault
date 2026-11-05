import musicService from '../../../../services/musicService';
import { MOODS, STYLES } from '../../../../services/radioService';
import { openItem } from '../../../../services/openItem';
import { suggestFrom, yesNo, type SearchGuess, type SearchKey, type SearchSchema } from '../schema';

/**
 * MusicDex's keys, as the backend reads them: backend/src/models/album.ts
 * (_parseSearchQuery for the words on the album and its tracks, year:, stars:,
 * cd:, file:, ripped:, rated:; Album.search for classical:),
 * favouriteAlbumService for favourites:, backend/src/utils/ficheFilters.ts
 * for mood:, style:, energy: and tempo: (read on the songs' fiches, an album
 * answering when a third of its songs with a fiche do), all through
 * backend/src/utils/albumSearchFilters.ts, which understands `-key:` and
 * `!key:`, yes/no and the old words, commas as "or" and the aliases below.
 * The backend's mixtape: is not offered: the mixtapes have their own view of
 * MusicDex (/musicdex/mixtapes).
 * The values come from the collection, the digital albums and the wishes,
 * as the page shows them; the moods and the styles are
 * the radio's closed lists.
 */
const fromMusic = (field: string) => suggestFrom(
  (f, typed) => musicService.getAutocompleteSuggestions(f, typed, { withNoCd: true }),
  field,
);

const decades: SearchKey['shortcuts'] = [
  ...[2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950].map(year => ({ value: `${year}-${year + 9}`, desc: `${year}s` })),
  { value: '<1950', desc: 'Before 1950' },
];

const keys: SearchKey[] = [
  // Who
  { key: 'artist', aliases: ['by'], group: 'Who', type: 'text', desc: 'The album’s artist, or the artist of one of its tracks', example: 'artist:"Joni Mitchell"', suggest: fromMusic('artist') },
  { key: 'composer', group: 'Who', type: 'text', desc: 'A composer of one of its tracks', example: 'composer:Bach', suggest: fromMusic('composer') },
  { key: 'performer', group: 'Who', type: 'text', desc: 'Plays, sings or conducts on one of its tracks', example: 'performer:Argerich', suggest: fromMusic('performer') },
  { key: 'conductor', group: 'Who', type: 'text', desc: 'Conducts one of its tracks', example: 'conductor:Kleiber', suggest: fromMusic('conductor') },
  // What
  { key: 'title', group: 'What', type: 'text', desc: 'Words of the album’s title', example: 'title:blue', suggest: fromMusic('title'), valuesForWords: false },
  { key: 'track', group: 'What', type: 'text', desc: 'Words of the title of one of its tracks', example: 'track:"So What"', suggest: fromMusic('track'), valuesForWords: false },
  { key: 'work', group: 'What', type: 'text', desc: 'A work on one of its tracks: K. 466, Brandenburg…', example: 'work:"K. 466"', suggest: fromMusic('work') },
  { key: 'genre', group: 'What', type: 'text', desc: 'One of its genres', example: 'genre:jazz', suggest: fromMusic('genre') },
  { key: 'classical', group: 'What', type: 'bool', desc: 'Classical music, as the shelves tell it', values: yesNo('Only classical music, as on the shelves', 'Everything but classical music') },
  { key: 'instrument', group: 'What', type: 'text', desc: 'Someone plays it on one of its tracks: cello, piano…', example: 'instrument:cello', suggest: fromMusic('instrument') },
  { key: 'label', group: 'What', type: 'text', desc: 'Its record label', example: 'label:ECM', suggest: fromMusic('label') },
  { key: 'country', group: 'What', type: 'text', desc: 'The country it was released in, as MusicBrainz writes it', example: 'country:DE', suggest: fromMusic('country'), valuesForWords: false },
  // How it sounds: the songs' fiches, written by the local LLM for the radio.
  { key: 'mood', group: 'How it sounds', type: 'enum', desc: 'How a third of its songs feel, at least', example: 'mood:melancholic', values: MOODS.map(value => ({ value })) },
  { key: 'style', group: 'How it sounds', type: 'enum', desc: 'The style of a third of its songs, at least', example: 'style:rock', values: STYLES.map(value => ({ value })) },
  { key: 'energy', group: 'How it sounds', type: 'number', desc: 'The energy of a third of its songs, from 0 (a lullaby) to 10', example: 'energy:7-10', shortcuts: [
    { value: '8-10', desc: 'Full of energy' },
    { value: '6-10', desc: 'Lively' },
    { value: '4-6', desc: 'In between' },
    { value: '0-4', desc: 'Quiet' },
    { value: '0-2', desc: 'Very quiet' },
  ] },
  { key: 'tempo', group: 'How it sounds', type: 'enum', desc: 'The tempo of a third of its songs, at least', example: 'tempo:fast', values: [
    { value: 'slow', desc: 'Slow' },
    { value: 'mid', desc: 'Neither slow nor fast' },
    { value: 'fast', desc: 'Fast' },
  ] },
  // When
  { key: 'year', group: 'When', type: 'number', desc: 'Its year, exactly, compared or a range', example: 'year:1960-1969', shortcuts: decades },
  // Your stars
  { key: 'stars', group: 'Your stars', type: 'number', desc: 'Your stars, exactly, compared or a range', example: 'stars:>=4', shortcuts: [
    { value: '5', desc: '★★★★★' },
    { value: '>=4.5', desc: '4½ stars or more' },
    { value: '>=4', desc: '4 stars or more' },
    { value: '>=3', desc: '3 stars or more' },
    { value: '2-4', desc: 'Between 2 and 4 stars' },
    { value: '<3', desc: 'Under 3 stars' },
    { value: '0', desc: 'Not rated yet' },
  ] },
  { key: 'rated', group: 'Your stars', type: 'bool', desc: 'You have given it stars', values: yesNo('Rated, any number of stars', 'Not rated yet: what is left to listen to') },
  { key: 'favourites', aliases: ['favorites', 'fav'], group: 'Your stars', type: 'bool', desc: 'A track of it is a favourite (♥ in Navidrome)', values: yesNo('A track of it is a favourite', 'No track of it is a favourite') },
  // CD and files
  { key: 'cd', group: 'CD and files', type: 'bool', desc: 'You have the CD', values: yesNo('CDs only', 'No CD: files or wishes') },
  { key: 'ripped', group: 'CD and files', type: 'bool', desc: 'Its CD is in Navidrome', values: yesNo('CDs in Navidrome', 'CDs not ripped yet') },
  { key: 'file', group: 'CD and files', type: 'enum', desc: 'How good its files in Navidrome are', example: 'file:lossy', values: [
    { value: 'lossless', desc: 'FLAC, ALAC: as on the CD' },
    { value: 'near', desc: 'Near lossless: AAC 256, MP3 320' },
    { value: 'lossy', desc: 'Below 256 kbps: a copy to do again' },
  ] },
];

interface FoundAlbum {
  id: number;
  title: string;
  artist?: string[] | string | null;
  releaseYear?: number | null;
  cover?: string | null;
}

/** The albums whose words hold the letters, as the page would find them, to open. */
const findAlbums = async (typed: string): Promise<SearchGuess[]> => {
  const found = await musicService.searchAlbums(typed, { withNoCd: true }) as FoundAlbum[];
  return (Array.isArray(found) ? found : []).map(album => ({
    id: album.id,
    label: album.title,
    sub: [Array.isArray(album.artist) ? album.artist.join(', ') : album.artist, album.releaseYear].filter(Boolean).join(' · '),
    image: musicService.getImageUrl(album.cover) ?? undefined,
  }));
};

export const musicSchema: SearchSchema = {
  section: 'music',
  keys,
  placeholder: 'Search MusicDex: words, or a filter like composer:Bach',
  wordsHint: 'In titles, artists, composers, performers, works, labels and genres',
  // A CD's few letters name its artist or its title, one or the other.
  guesses: [
    { section: 'Artists', kind: 'pill', keys: ['artist', 'composer'] },
    { section: 'Albums', kind: 'open', find: findAlbums, open: album => openItem('album', album.id), key: 'title' },
  ],
};
