import { readStored, writeStored } from './safeStorage';

/**
 * MusicDex's two views: the albums (/musicdex) and the mixtapes
 * (/musicdex/mixtapes), the same section, its search and Listen Next shared.
 * The view left last is kept in the browser, for MusicDex to open on it.
 */
export type MusicDexView = 'albums' | 'mixtapes';

export const MIXTAPES_PATH = '/musicdex/mixtapes';
const VIEW_KEY = 'dexvault.musicdex.view';

export const viewOfPath = (path: string): MusicDexView => (path === MIXTAPES_PATH ? 'mixtapes' : 'albums');

export const pathOfView = (view: MusicDexView): string => (view === 'mixtapes' ? MIXTAPES_PATH : '/musicdex');

export const keepView = (view: MusicDexView): void => writeStored(VIEW_KEY, view);

/** Where MusicDex opens: the view left last. */
export const musicDexPath = (): string => pathOfView(readStored(VIEW_KEY) === 'mixtapes' ? 'mixtapes' : 'albums');
