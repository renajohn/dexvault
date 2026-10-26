import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LISTEN_NEXT_LEFT_EVENT, player, resetPlayer, restorePlayer } from './player';

const album = { id: 7, title: 'Come Away With Me', artist: 'Norah Jones', cover: null };
const tracks = [
  { songId: 's1', title: 'Don’t Know Why', disc: 1, no: 1, durationSec: 186 },
  { songId: 's2', title: 'Seven Years', disc: 1, no: 2, durationSec: 145 },
];

/** The audio element DexVault plays through now. */
const playingAudio = (): HTMLAudioElement => {
  const audio = created.find(element => element.src.endsWith(`/stream/${player.getState().tracks[player.getState().index].songId}`));
  return audio!;
};
let created: HTMLAudioElement[] = [];

beforeEach(() => {
  created = [];
  const RealAudio = window.Audio;
  vi.stubGlobal('Audio', function Audio() {
    const element = new RealAudio();
    created.push(element);
    return element;
  });
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
  // This test environment has no localStorage of its own: a plain one stands in.
  const stored = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
  });
  document.body.classList.remove('modal-open');
  resetPlayer();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('player', () => {
  it('shows the words or hides them, and remembers it in this browser', () => {
    expect(player.getState().lyricsOpen).toBe(false);
    player.showLyrics();
    expect(player.getState().lyricsOpen).toBe(true);
    resetPlayer();
    expect(player.getState().lyricsOpen).toBe(true);
    player.showLyrics(false);
    resetPlayer();
    expect(player.getState().lyricsOpen).toBe(false);
  });

  it('plays an album from a track, from Navidrome through DexVault, the next one loading beside it', () => {
    player.playAlbum(album, tracks, 0);

    expect(player.getState()).toMatchObject({ album, index: 0, playing: true, barShown: true });
    expect(created.map(audio => audio.src)).toEqual([
      expect.stringContaining('/api/music/navidrome/stream/s1'),
      expect.stringContaining('/api/music/navidrome/stream/s2'),
    ]);
  });

  it('tells Navidrome the track is playing, then counts it once half of it is heard', () => {
    player.playAlbum(album, tracks, 0);
    const audio = playingAudio();
    audio.dispatchEvent(new Event('playing'));
    Object.defineProperty(audio, 'duration', { value: 186, configurable: true });
    audio.currentTime = 100;
    audio.dispatchEvent(new Event('timeupdate'));
    audio.dispatchEvent(new Event('timeupdate'));

    const calls = vi.mocked(fetch).mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body)).submission]);
    expect(calls).toEqual([['/api/music/navidrome/scrobble/s1', false], ['/api/music/navidrome/scrobble/s1', true]]);
  });

  it('brings the bar out at once, an album’s card open or not', () => {
    const card = document.createElement('div');
    card.className = 'modal show';
    document.body.append(card);
    document.body.classList.add('modal-open');
    player.playAlbum(album, tracks, 1);
    expect(player.getState().barShown).toBe(true);
    card.remove();
    document.body.classList.remove('modal-open');
  });

  it('stops on ✕, keeps the place for Resume, and plays on from it', () => {
    player.playAlbum(album, tracks, 1);
    playingAudio().currentTime = 42;
    player.stop();

    expect(player.getState()).toMatchObject({ album: null, barShown: false, resume: { album, index: 1, position: 42 } });
    player.resume();
    expect(player.getState()).toMatchObject({ album, index: 1, position: 42, resume: null });
  });

  it('goes back to the start of a track, or to the one before in its first seconds', () => {
    player.playAlbum(album, tracks, 1);
    playingAudio().currentTime = 30;
    player.previous();
    expect(player.getState()).toMatchObject({ index: 1, position: 0 });
    player.previous();
    expect(player.getState().index).toBe(0);
  });

  it('goes on with its list once the album is over, or once ⏭ skips its last track', async () => {
    const onAlbumEnd = vi.fn(() => Promise.resolve(true));
    player.playAlbum(album, tracks, 1, 0, { queue: 'listenNext', onAlbumEnd });
    expect(player.getState().queue).toBe('listenNext');

    player.next();
    expect(onAlbumEnd).toHaveBeenLastCalledWith('skipped');

    playingAudio().dispatchEvent(new Event('ended'));
    expect(onAlbumEnd).toHaveBeenLastCalledWith('ended');
  });

  it('leaves an album taken out of its list once its track ends', () => {
    const onAlbumEnd = vi.fn(() => Promise.resolve(true));
    player.playAlbum(album, tracks, 0, 0, { queue: 'listenNext', onAlbumEnd, leaveAfterTrack: () => true });

    playingAudio().dispatchEvent(new Event('ended'));

    expect(onAlbumEnd).toHaveBeenCalledWith('removed');
  });

  it('waits on the first track of an album played alone once it is over, and ⏭ does nothing on its last', () => {
    player.playAlbum(album, tracks, 1);
    player.next();
    expect(player.getState().index).toBe(1);

    playingAudio().dispatchEvent(new Event('ended'));

    expect(player.getState()).toMatchObject({ index: 0, playing: false, queue: null });
  });

  it('tells the page an album of Listen Next left it, as the server answers a scrobble', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, left: { id: 3, albumId: 7 } })))));
    const heard = vi.fn();
    window.addEventListener(LISTEN_NEXT_LEFT_EVENT, heard);
    player.playAlbum(album, tracks, 0);
    const audio = playingAudio();
    Object.defineProperty(audio, 'duration', { value: 186, configurable: true });
    audio.currentTime = 100;
    audio.dispatchEvent(new Event('timeupdate'));

    await vi.waitFor(() => expect(heard).toHaveBeenCalled());
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 3, albumId: 7 });
    window.removeEventListener(LISTEN_NEXT_LEFT_EVENT, heard);
  });
  it('keeps the Mac awake across the step from one track to the next, and lets go a while after a pause', () => {
    vi.useFakeTimers();
    const level = { value: 0 };
    const context = {
      state: 'running',
      resume: vi.fn(() => { context.state = 'running'; return Promise.resolve(); }),
      suspend: vi.fn(() => { context.state = 'suspended'; return Promise.resolve(); }),
      close: vi.fn(() => Promise.resolve()),
      destination: {},
      createConstantSource: () => ({ offset: level, connect: vi.fn(), start: vi.fn() }),
    };
    vi.stubGlobal('AudioContext', function AudioContext() { return context; });
    try {
      player.playAlbum(album, tracks, 0);
      expect(level.value).toBeGreaterThan(0);
      playingAudio().dispatchEvent(new Event('ended'));
      player.toggle(false);
      playingAudio().dispatchEvent(new Event('pause'));
      vi.advanceTimersByTime(29000);
      expect(context.suspend).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2000);
      expect(context.suspend).toHaveBeenCalled();

      player.toggle(true);
      expect(context.state).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  describe('after a reload', () => {
    /** Plays the album up to `at` seconds into its second track, then reloads the page. */
    const playThenReload = (at: number) => {
      player.playAlbum(album, tracks, 1);
      const audio = playingAudio();
      audio.dispatchEvent(new Event('playing'));
      audio.currentTime = at;
      audio.dispatchEvent(new Event('timeupdate'));
      resetPlayer();
      created = [];
      vi.mocked(fetch).mockClear();
      vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    };

    it('brings the bar back, paused on the same track at the same moment, and plays on from there on ▶', () => {
      playThenReload(42);

      restorePlayer();

      expect(player.getState()).toMatchObject({ album, index: 1, position: 42, playing: false, barShown: true, resume: null });
      // Nothing loaded before ▶: a browser plays nothing a click has not asked for, and an iPhone cannot seek in
      // a source set outside a touch.
      expect(created.every(audio => !audio.src)).toBe(true);
      const play = vi.mocked(HTMLMediaElement.prototype.play);
      expect(play).not.toHaveBeenCalled();
      player.toggle();
      expect(play).toHaveBeenCalledTimes(1);
      expect(created[0].src).toContain('/stream/s2');
      expect(created[0].currentTime).toBe(42);
      expect(player.getState()).toMatchObject({ index: 1, position: 42, playing: true });
    });

    it('tells Navidrome only once it really plays, and does not count again a track counted before', () => {
      playThenReload(100);
      restorePlayer();
      expect(fetch).not.toHaveBeenCalled();

      player.toggle();
      const audio = playingAudio();
      audio.dispatchEvent(new Event('playing'));
      Object.defineProperty(audio, 'duration', { value: 145, configurable: true });
      audio.currentTime = 110;
      audio.dispatchEvent(new Event('timeupdate'));

      const bodies = vi.mocked(fetch).mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)));
      expect(bodies).toEqual([{ submission: false }]);
    });

    it('on an iPhone, which loads nothing before a touch, a seek before the data comes is kept, and another album starts where it is asked', () => {
      // The place of the track left yesterday is known, nothing loaded.
      playThenReload(143);
      restorePlayer();

      // ▶ loads it now, within the touch; iOS starts from 0, so the place kept is set again as the metadata comes.
      player.toggle();
      const kept = created[0];
      expect(kept.src).toContain('/stream/s2');
      expect(kept.currentTime).toBe(143);
      kept.currentTime = 0;
      kept.dispatchEvent(new Event('loadedmetadata'));
      expect(kept.currentTime).toBe(143);

      // The scrubber drawn to 0:40 while the stream still loads: the metadata coming must not take it back.
      Object.defineProperty(kept, 'readyState', { value: 0, configurable: true });
      player.seek(40);
      expect(player.getState().position).toBe(40);
      kept.dispatchEvent(new Event('loadedmetadata'));
      expect(kept.currentTime).toBe(40);

      // Another album on the same element: it starts at its own place, not at yesterday's.
      const other = { id: 8, title: 'Feels Like Home', artist: 'Norah Jones', cover: null };
      player.playAlbum(other, [{ songId: 's9', title: 'Sunrise', disc: 1, no: 1, durationSec: 200 }], 0);
      const audio = playingAudio();
      audio.dispatchEvent(new Event('loadedmetadata'));
      expect(audio.currentTime).toBe(0);
      expect(player.getState()).toMatchObject({ album: other, index: 0, position: 0, playing: true });
    });

    it('brings nothing back after ✕: the album’s card still offers Resume', () => {
      player.playAlbum(album, tracks, 1);
      player.stop();
      resetPlayer();

      restorePlayer();

      expect(player.getState()).toMatchObject({ album: null, barShown: false });
      expect(player.getState().resume).toMatchObject({ album, index: 1, barOpen: false });
    });
  });
});
