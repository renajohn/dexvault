import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DigitalAlbum } from '../services/musicService';
import { buyOrder, buyReason, formatLabel, isDismissed, isLossy, isToBuy, offersWish, openRicardo, ricardoUrl } from './digitalLibrary';

const album = (fields: Partial<DigitalAlbum>): DigitalAlbum => ({
  navidromeId: 'nd', name: 'Album', artist: 'Artist', songCount: 10, url: '', formats: ['FLAC'], quality: 'lossless',
  bitRate: null, hiRes: false, cd: null, oldCopy: false, wishAlbumId: null, albumId: 1, rating: 0, starred: false,
  favouriteTracks: 0, listening: { favourites: 0, needed: 3, plays: 0, lastPlayed: null, score: 0 }, buy: null, dismissed: false,
  ...fields,
});

describe('digitalLibrary', () => {
  it('cherche le CD sur Ricardo sans ce qu’un titre digital ajoute', () => {
    expect(ricardoUrl({ artist: 'Pink Floyd', name: 'Relics (Remastered) [Disc 1]' }))
      .toBe('https://www.ricardo.ch/fr/s/Pink%20Floyd%20Relics/');
  });

  it('dit le format et le débit des fichiers', () => {
    expect(formatLabel(album({}))).toBe('FLAC');
    expect(formatLabel(album({ hiRes: true }))).toBe('FLAC hi-res');
    expect(formatLabel(album({ formats: ['MP3'], quality: 'lossy', bitRate: 128 }))).toBe('MP3 128');
    expect(formatLabel(album({ formats: ['MP3'], quality: 'near', bitRate: 320 }))).toBe('MP3 320');
  });

  it('ne compte comme lossy que ce qui est sous 256 kbps', () => {
    expect(isLossy(album({ quality: 'lossy' }))).toBe(true);
    expect(isLossy(album({ quality: 'near' }))).toBe(false);
    expect(isLossy(null)).toBe(false);
  });

  it('offre la wish list aux albums sans CD en lossy ou near lossless, sauf souhaités ou notés sous 3', () => {
    const lossy = album({ quality: 'lossy', formats: ['MP3'], bitRate: 192 });
    expect(offersWish(lossy, 'digital')).toBe(true);
    expect(offersWish(lossy, 'digital', 3)).toBe(true);
    expect(offersWish(lossy, 'digital', 2.5)).toBe(false);
    expect(offersWish(album({ ...lossy, rating: 2 }), 'digital')).toBe(false);
    expect(offersWish(album({ ...lossy, rating: 2 }), 'digital', 4)).toBe(true);
    expect(offersWish(lossy, 'wish')).toBe(false);
    expect(offersWish(lossy, 'owned')).toBe(false);
    expect(offersWish(album({}), 'digital')).toBe(false);
    expect(offersWish(album({ quality: 'near', formats: ['AAC'], bitRate: 256 }), 'digital')).toBe(true);
    expect(offersWish(album({ quality: 'lossless', formats: ['FLAC'], bitRate: null }), 'digital')).toBe(false);
    expect(offersWish(null, 'digital')).toBe(false);
  });

  it('dit pourquoi un album est à acheter', () => {
    expect(buyReason(album({
      buy: { listened: true, rated: true, wished: false }, rating: 4,
      listening: { favourites: 5, needed: 3, plays: 31, lastPlayed: null, score: 9 },
    }))).toBe('5 tracks ×2+ · ★4');
  });

  it('garde dans Buy un souhait même écarté, et met de côté ce qui est seulement écouté', () => {
    const heard = { listened: true, rated: false, wished: false };
    expect(isToBuy(album({ buy: heard }))).toBe(true);
    expect(isToBuy(album({ buy: heard, dismissed: true }))).toBe(false);
    expect(isDismissed(album({ buy: heard, dismissed: true }))).toBe(true);
    expect(isToBuy(album({ buy: { ...heard, wished: true }, dismissed: true }))).toBe(true);
  });

  it('met l’écoute avant les simples souhaits, la plus récente d’abord', () => {
    const wished = album({ name: 'W', buy: { listened: false, rated: false, wished: true } });
    const old = album({ name: 'O', buy: { listened: true, rated: false, wished: false }, listening: { favourites: 3, needed: 3, plays: 6, lastPlayed: null, score: 1 } });
    const recent = album({ name: 'R', buy: { listened: true, rated: false, wished: false }, listening: { favourites: 3, needed: 3, plays: 6, lastPlayed: null, score: 5 } });
    expect([wished, old, recent].sort(buyOrder).map(entry => entry.name)).toEqual(['R', 'O', 'W']);
  });
});

describe('openRicardo', () => {
  const url = 'https://www.ricardo.ch/fr/s/Steely%20Dan%20Gaucho/';
  afterEach(() => vi.unstubAllGlobals());

  it('goes in the same tab on an iPhone, so no blank tab stays behind once the app takes it', () => {
    const assign = vi.fn();
    const open = vi.fn();
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 });
    vi.stubGlobal('location', { assign });
    vi.stubGlobal('open', open);
    openRicardo(url);
    expect(assign).toHaveBeenCalledWith(url);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a tab of its own on a computer', () => {
    const open = vi.fn();
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 });
    vi.stubGlobal('open', open);
    openRicardo(url);
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
  });
});
