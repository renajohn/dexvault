import { describe, expect, it } from 'vitest';
import { asksNavidrome } from './musicSearchWords';

describe('what MusicDex reads in its search', () => {
  it('Digital on: cd:, file:, ripped:, favourites: whatever their sign, value or name', () => {
    for (const q of ['cd:no', '-cd:yes', '!cd:yes', 'cd:false', 'file:lossy', 'ripped:without', 'blue favourites:yes', 'fav:1', 'favorites:true', 'cd:']) {
      expect(asksNavidrome(q), q).toBe(true);
    }
    for (const q of ['', 'blue', 'composer:Bach', 'mixtape:yes', 'title:"cd: two"', 'discd:yes']) {
      expect(asksNavidrome(q), q).toBe(false);
    }
  });
});
