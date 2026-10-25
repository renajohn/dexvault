import { imageUrlOf, mixtapeArtists, playerTracksOf, shuffledTracks } from '../../../src/services/playable';
import type { NavidromeTrackFile } from '../../../src/services/navidromeService';

const file = (disc: number, track: number, id: string | null = `s${disc}-${track}`): NavidromeTrackFile => ({
  id, url: null, discNumber: disc, track, title: `file ${disc}-${track}`, durationSec: 100 + track,
  suffix: 'flac', bitRate: null, bitDepth: 24, samplingRate: 96000, channelCount: 2, size: null, path: null, starred: track === 2,
});

describe('an album as an appliance plays it (the page’s playAlbum, on the server)', () => {
  it('plays the CD’s tracks that have a file, in the CD’s order, with its titles and the files’ kind', () => {
    const album = { id: 7, title: 'A', discs: [{ number: 1, tracks: [{ no: 1, title: 'One' }, { no: 2, title: 'Two' }, { no: 3, title: 'Three' }] }] };
    const tracks = playerTracksOf(album, { found: true, tracks: [file(1, 2), file(1, 1), file(1, 3, null)] });
    expect(tracks).toEqual([
      { songId: 's1-1', title: 'One', disc: 1, no: 1, durationSec: 101, starred: false, suffix: 'flac' },
      { songId: 's1-2', title: 'Two', disc: 1, no: 2, durationSec: 102, starred: true, suffix: 'flac' },
    ]);
  });

  it('plays the rip as it is when DexVault knows no tracks, and nothing without a rip', () => {
    const album = { id: 8, title: 'B', discs: [] };
    expect(playerTracksOf(album, { found: true, tracks: [file(2, 1), file(1, 1)] }).map(track => track.songId)).toEqual(['s1-1', 's2-1']);
    expect(playerTracksOf(album, { found: false, tracks: [] })).toEqual([]);
  });

  it('names images and mixtapes as the page does, and numbers a shuffled play again', () => {
    expect(imageUrlOf('cd/7.jpg')).toBe('/api/images/cd/7.jpg');
    expect(imageUrlOf('/images/x.jpg')).toBe('/images/x.jpg');
    expect(mixtapeArtists(['Miles Davis', 'Bach', 'Ligeti'])).toBe('Miles Davis, Bach & 1 more');
    const shuffled = shuffledTracks([file(1, 1), file(1, 2)].map(f => ({ songId: f.id!, title: f.title, disc: 2, no: f.track, durationSec: 1 })), () => 0);
    expect(shuffled.map(track => [track.songId, track.disc, track.no])).toEqual([['s1-2', 1, 1], ['s1-1', 1, 2]]);
  });
});
