import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatOf, LISTEN_NEXT_LEFT_EVENT, player, resetPlayer, restorePlayer } from './player';

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
    // The next track waits muted: iOS's lock screen shows, of the elements holding a track, the one last touched
    // rather than the one playing, and a muted one never.
    expect(created.map(audio => audio.muted)).toEqual([false, true]);
    created[0].dispatchEvent(new Event('ended'));
    expect(player.getState().index).toBe(1);
    expect(created.map(audio => audio.muted)).toEqual([true, false]);
  });

  it('primes the element about to play alone, the spare left untouched for the lock screen to follow the right one', () => {
    player.prime();
    const load = vi.mocked(HTMLMediaElement.prototype.load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.instances[0]).toBe(created[0]);
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

  it('L2: pauses with ⏯ and plays on from the same place, the track not loaded again', () => {
    player.playAlbum(album, tracks, 1);
    const audio = playingAudio();
    // Its data there, as a browser has it (jsdom's element has no source to load).
    Object.defineProperty(audio, 'networkState', { value: HTMLMediaElement.NETWORK_IDLE, configurable: true });
    Object.defineProperty(audio, 'error', { value: null, configurable: true });
    audio.currentTime = 42;
    const load = vi.mocked(HTMLMediaElement.prototype.load);
    load.mockClear();
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    Object.defineProperty(audio, 'paused', { value: false, configurable: true });
    player.toggle();
    expect(pause).toHaveBeenCalled();
    Object.defineProperty(audio, 'paused', { value: true, configurable: true });
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    player.toggle();
    expect(play.mock.contexts).toEqual([audio]);
    // The track playing is not loaded again (the spare may load the next one).
    expect(load.mock.contexts).not.toContain(audio);
    expect(audio.currentTime).toBe(42);
  });

  it('L4: seeks within a track on a Mac, its data there: straight there, no reload, the bar at once', () => {
    player.playAlbum(album, tracks, 0);
    const audio = playingAudio();
    Object.defineProperty(audio, 'readyState', { value: 4, configurable: true });
    const load = vi.mocked(HTMLMediaElement.prototype.load);
    load.mockClear();
    player.seek(90);
    expect(audio.currentTime).toBe(90);
    expect(player.getState().position).toBe(90);
    expect(load).not.toHaveBeenCalled();
    // The element moves on from there: the bar follows it, no older place pulls it back.
    audio.currentTime = 91;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(player.getState().position).toBe(91);
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
  /** A Web Audio context as the keep-awake makes it, its constant source's level in `level`. */
  const fakeAudioContext = () => {
    const level = { value: 0 };
    const context = {
      state: 'running',
      resume: vi.fn(() => { context.state = 'running'; return Promise.resolve(); }),
      suspend: vi.fn(() => { context.state = 'suspended'; return Promise.resolve(); }),
      close: vi.fn(() => Promise.resolve()),
      destination: {},
      createConstantSource: () => ({ offset: level, connect: vi.fn(), start: vi.fn() }),
    };
    const made = vi.fn(function AudioContext() { return context; });
    vi.stubGlobal('AudioContext', made);
    return { level, context, made };
  };
  /** A computer: a pointer that hovers. jsdom has no matchMedia, so a test is a phone unless it says so. */
  const onComputer = () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(hover: hover) and (pointer: fine)', media: query })));
  };

  it('keeps the Mac awake across the step from one track to the next, and lets go a while after a pause', () => {
    vi.useFakeTimers();
    onComputer();
    const { level, context } = fakeAudioContext();
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
  it('runs no Web Audio on a phone, whose lock screen would lose the track to it', () => {
    const { made } = fakeAudioContext();
    player.prime();
    player.playAlbum(album, tracks, 0);
    player.toggle(false);
    player.toggle(true);
    expect(made).not.toHaveBeenCalled();
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

    it('on an iPhone, a place it let go of at the metadata is asked again as it plays, and the bar shows the truth if it never goes', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        // A play carried over from Bureau, 2:03 into the track: loaded within the touch.
        player.playAlbum(album, tracks, 1, 123);
        const audio = playingAudio();
        Object.defineProperty(audio, 'readyState', { value: 0, configurable: true });
        audio.dispatchEvent(new Event('loadedmetadata'));
        Object.defineProperty(audio, 'readyState', { value: 4, configurable: true });
        // It plays from 0 all the same: the bar keeps 2:03, and the place is asked again a second later.
        audio.currentTime = 1;
        audio.dispatchEvent(new Event('timeupdate'));
        expect(player.getState().position).toBe(123);
        vi.advanceTimersByTime(1100);
        audio.dispatchEvent(new Event('timeupdate'));
        expect(audio.currentTime).toBe(123);
        // There now: the bar follows the element.
        audio.currentTime = 124;
        audio.dispatchEvent(new Event('timeupdate'));
        expect(player.getState().position).toBe(124);

        // Another time it never goes there: after a few tries, the bar shows where it really is.
        player.playAlbum(album, tracks, 0, 90);
        const other = playingAudio();
        Object.defineProperty(other, 'readyState', { value: 0, configurable: true });
        other.dispatchEvent(new Event('loadedmetadata'));
        Object.defineProperty(other, 'readyState', { value: 4, configurable: true });
        for (let at = 1; at <= 8; at++) {
          vi.advanceTimersByTime(1100);
          other.currentTime = at;
          other.dispatchEvent(new Event('timeupdate'));
        }
        expect(player.getState().position).toBe(8);
      } finally {
        vi.useRealTimers();
      }
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
  describe('when the network comes and goes', () => {
    const failed = (audio: HTMLAudioElement) =>
      Object.defineProperty(audio, 'error', { value: { code: 2 }, configurable: true });

    it('takes the track up again where it was once its stream is cut, without saying it stopped', () => {
      vi.useFakeTimers();
      try {
        player.playAlbum(album, tracks, 0);
        const audio = playingAudio();
        audio.currentTime = 80;
        failed(audio);
        audio.dispatchEvent(new Event('error'));
        expect(player.getState()).toMatchObject({ playing: true, error: null });

        const load = vi.mocked(HTMLMediaElement.prototype.load);
        load.mockClear();
        vi.advanceTimersByTime(1000);
        expect(load.mock.instances).toContain(audio);
        expect(player.getState().position).toBe(80);
      } finally {
        vi.useRealTimers();
      }
    });

    it('takes it up at once when the network is back', () => {
      vi.useFakeTimers();
      try {
        player.playAlbum(album, tracks, 0);
        const audio = playingAudio();
        failed(audio);
        audio.dispatchEvent(new Event('error'));
        const load = vi.mocked(HTMLMediaElement.prototype.load);
        load.mockClear();
        window.dispatchEvent(new Event('online'));
        expect(load.mock.instances).toContain(audio);
      } finally {
        vi.useRealTimers();
      }
    });

    it('says so once it gave up, and ▶ tries again', () => {
      vi.useFakeTimers();
      try {
        player.playAlbum(album, tracks, 0);
        const audio = playingAudio();
        failed(audio);
        for (let i = 0; i < 7; i += 1) {
          audio.dispatchEvent(new Event('error'));
          vi.advanceTimersByTime(30000);
        }
        expect(player.getState()).toMatchObject({ playing: false, error: expect.any(String) });
        const play = vi.mocked(HTMLMediaElement.prototype.play);
        play.mockClear();
        player.toggle(true);
        expect(player.getState().playing).toBe(true);
        expect(play).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('loads the next track again when its preload was cut, rather than playing nothing', () => {
      player.playAlbum(album, tracks, 0);
      const next = created.find(audio => audio.src.endsWith('/stream/s2'))!;
      failed(next);
      const load = vi.mocked(HTMLMediaElement.prototype.load);
      load.mockClear();
      player.next();
      expect(player.getState().index).toBe(1);
      expect(load.mock.instances).toContain(next);
    });

    it('takes a track up again that waits for its data too long', () => {
      vi.useFakeTimers();
      try {
        player.playAlbum(album, tracks, 0);
        const audio = playingAudio();
        Object.defineProperty(audio, 'paused', { value: false, configurable: true });
        audio.dispatchEvent(new Event('waiting'));
        const load = vi.mocked(HTMLMediaElement.prototype.load);
        load.mockClear();
        vi.advanceTimersByTime(10000 + 1000);
        expect(load.mock.instances).toContain(audio);
      } finally {
        vi.useRealTimers();
      }
    });

    it('plays the next track on the element that played when an iPhone refuses the spare', async () => {
      player.playAlbum(album, tracks, 0);
      const first = playingAudio();
      vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() =>
        Promise.reject(Object.assign(new Error('refused'), { name: 'NotAllowedError' })));
      first.dispatchEvent(new Event('ended'));
      await Promise.resolve();
      await Promise.resolve();
      expect(player.getState()).toMatchObject({ index: 1, playing: true, error: null });
      expect(first.src).toContain('/stream/s2');
      expect(first.muted).toBe(false);
    });
  });
  describe('lighter on a weak network', () => {
    const three = [...tracks, { songId: 's3', title: 'Cold Cold Heart', disc: 1, no: 3, durationSec: 218 }];
    const asked = () => vi.mocked(fetch).mock.calls
      .filter(([, init]) => init?.method === 'POST' && String(init?.body ?? '') === '')
      .map(([url]) => String(url));
    const settle = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

    it('plays the files as they are by default, nothing asked of the server', () => {
      player.playAlbum(album, tracks, 0);
      expect(created.map(audio => audio.src)).toEqual([
        expect.stringContaining('/stream/s1'), expect.stringContaining('/stream/s2'),
      ]);
      expect(asked()).toEqual([]);
      expect(player.getState()).toMatchObject({ quality: 'auto', light: false });
    });

    it('in AAC 256, has the tracks to come encoded and plays them lighter, the first one at once as it is', async () => {
      player.setQuality('light');
      player.playAlbum(album, three, 0);
      expect(playingAudio().src).toContain('/stream/s1');
      await settle();
      expect(asked()).toEqual(expect.arrayContaining(['/api/music/navidrome/light/s1', '/api/music/navidrome/light/s2', '/api/music/navidrome/light/s3']));
      const spare = created.find(audio => audio !== playingAudio())!;
      expect(spare.src).toContain('/light/s2');

      created.find(audio => audio.src.includes('/stream/s1'))!.dispatchEvent(new Event('ended'));
      expect(player.getState()).toMatchObject({ index: 1, light: true });
      expect(spare.muted).toBe(false);
    });

    it('keeps the choice in this browser', () => {
      player.setQuality('lossless');
      resetPlayer();
      expect(player.getState().quality).toBe('lossless');
      player.setQuality('auto');
      resetPlayer();
      expect(player.getState().quality).toBe('auto');
    });

    it('on Auto, goes lighter for the tracks to come once the music waits for its data', async () => {
      vi.useFakeTimers();
      try {
        player.playAlbum(album, three, 0);
        const audio = playingAudio();
        Object.defineProperty(audio, 'paused', { value: false, configurable: true });
        audio.dispatchEvent(new Event('playing'));
        audio.dispatchEvent(new Event('waiting'));
        vi.advanceTimersByTime(1600);
        await settle();
        expect(asked()).toContain('/api/music/navidrome/light/s2');
        expect(created.find(one => one !== audio)!.src).toContain('/light/s2');
      } finally {
        vi.useRealTimers();
      }
    });

    it('on Auto, a wait right after a start or a seek is not the network’s', () => {
      vi.useFakeTimers();
      try {
        player.playAlbum(album, three, 0);
        const audio = playingAudio();
        Object.defineProperty(audio, 'paused', { value: false, configurable: true });
        audio.dispatchEvent(new Event('waiting'));
        vi.advanceTimersByTime(1600);
        audio.dispatchEvent(new Event('playing'));
        player.seek(60);
        audio.dispatchEvent(new Event('waiting'));
        vi.advanceTimersByTime(1600);
        expect(asked()).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('says what is heard: Lossless, the file’s format, or AAC 256 for the lighter file', async () => {
      const told = [{ ...three[0], lossless: true, format: 'FLAC' }, { ...three[1], lossless: false, format: 'MP3' }, { ...three[2], lossless: true, format: 'FLAC' }];
      player.playAlbum(album, told, 0);
      expect(formatOf(player.getState())).toBe('Lossless');
      player.playTrack(1);
      expect(formatOf(player.getState())).toBe('MP3');

      player.setQuality('light');
      await settle();
      created.find(audio => audio.src.includes('/stream/s2'))!.dispatchEvent(new Event('ended'));
      expect(formatOf(player.getState())).toBe('AAC 256');
    });

    it('says nothing of a song whose file is not known, a mixtape’s', () => {
      player.playAlbum(album, tracks, 0);
      expect(formatOf(player.getState())).toBeNull();
    });

    it('stays as it is where the server cannot encode', async () => {
      vi.mocked(fetch).mockImplementation(() => Promise.resolve(new Response('{}', { status: 501 })));
      player.setQuality('light');
      player.playAlbum(album, three, 0);
      await settle();
      expect(created.find(audio => audio !== playingAudio())!.src).toContain('/stream/s2');
    });
  });
});
