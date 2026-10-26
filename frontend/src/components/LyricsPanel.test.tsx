import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LyricsPanel, { lineAt, parseLrc, shiftLabel, withinLines } from './LyricsPanel';
import musicService from '../services/musicService';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  time: 0,
}));

vi.mock('../services/musicService', () => ({ default: { getLyrics: vi.fn(), fixLyricsTiming: vi.fn(), resetLyricsTiming: vi.fn() } }));
vi.mock('../services/player', () => ({
  usePlayer: (select: (state: Record<string, unknown>) => unknown) => select(mocks.state),
  player: {
    currentTime: () => mocks.time,
    seek: vi.fn(),
    toggle: vi.fn(),
    showLyrics: vi.fn(),
    setRate: vi.fn(),
    getState: () => mocks.state,
  },
}));
vi.mock('../utils/audioPeaks', () => ({ peaksOf: vi.fn(async () => ({ bin: 0.02, levels: new Float32Array(15000) })) }));

import { player } from '../services/player';

const SYNCED = '[00:05.15] There\'s a fire starting in my heart\n[00:09.74] Reaching a fever pitch\n[00:14.24] Finally I can see you crystal clear';

const playing = (changes: Record<string, unknown> = {}) => {
  mocks.state = {
    lyricsOpen: true, barShown: true, playing: true, index: 0, output: { kind: 'local' },
    album: { id: 25, title: '21', artist: 'Adele', cover: '/api/images/cd/21.jpg' },
    tracks: [{ songId: 's1', title: 'Rolling in the Deep', disc: 1, no: 1, durationSec: 229 }],
    ...changes,
  };
};

// jsdom draws nothing and knows no pointer events: a canvas without a context, a pointer as a mouse.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
if (!window.PointerEvent) window.PointerEvent = MouseEvent as unknown as typeof PointerEvent;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.time = 0;
  playing();
});

describe('parseLrc', () => {
  it('reads the timed lines in order, a line sung twice at both its times', () => {
    expect(parseLrc('[ar:Adele]\n[00:02.00] One\n[00:01.00][00:03.50] Two')).toEqual([
      { at: 1, text: 'Two' }, { at: 2, text: 'One' }, { at: 3.5, text: 'Two' },
    ]);
  });

  it('marks the silences of the voice: before the first words, at an empty line, in a long gap', () => {
    const lines = parseLrc('[00:10.00] First\n[00:12.00]\n[00:20.00] Second\n[00:21.00] Third\n[00:40.00] Fourth');
    expect(lines).toEqual([
      { at: 0, text: null },
      { at: 10, text: 'First' },
      { at: 12, text: null },
      { at: 20, text: 'Second' },
      { at: 21, text: 'Third' },
      { at: 27, text: null },
      { at: 40, text: 'Fourth' },
    ]);
  });
});

describe('lineAt', () => {
  it('is the last line to have started, -1 before the first', () => {
    const lines = parseLrc('[00:01.00] a\n[00:03.00] b');
    expect(lineAt(lines, 0.5)).toBe(-1);
    expect(lineAt(lines, 1)).toBe(0);
    expect(lineAt(lines, 10)).toBe(1);
  });
});

describe('withinLines', () => {
  it('moves by hand no higher than the first line, no lower than the last, where the line sung stands', () => {
    // The line sung stands 100px down; the lines run from 0 to 900px.
    expect(withinLines(50, 100, 0, 900)).toBe(50);
    expect(withinLines(400, 100, 0, 900)).toBe(100);
    expect(withinLines(-2000, 100, 0, 900)).toBe(-800);
  });
});

describe('LyricsPanel', () => {
  it('shows the words of the track playing, the line sung lit', async () => {
    vi.mocked(musicService.getLyrics).mockResolvedValue({ status: 'found', plain: null, synced: SYNCED, source: 'lrclib', checkedAt: '' });
    mocks.time = 10;
    render(<LyricsPanel />);

    expect(screen.getByRole('complementary', { name: 'Lyrics' })).toBeInTheDocument();
    expect(musicService.getLyrics).toHaveBeenCalledWith(25, 1, 1);
    const line = await screen.findByText('Reaching a fever pitch');
    await waitFor(() => expect(line).toHaveAttribute('aria-current', 'true'));
  });

  it('plays from a line clicked', async () => {
    vi.mocked(musicService.getLyrics).mockResolvedValue({ status: 'found', plain: null, synced: SYNCED, source: 'lrclib', checkedAt: '' });
    playing({ playing: false });
    render(<LyricsPanel />);

    fireEvent.click(await screen.findByText('Finally I can see you crystal clear'));
    expect(player.seek).toHaveBeenCalledWith(expect.closeTo(14.19, 2));
    expect(player.toggle).toHaveBeenCalledWith(true);
  });

  it('reads words without times as a page', async () => {
    vi.mocked(musicService.getLyrics).mockResolvedValue({ status: 'found', plain: 'Line one\nLine two', synced: null, source: 'lrclib', checkedAt: '' });
    render(<LyricsPanel />);

    expect(await screen.findByText('Not timed')).toBeInTheDocument();
    expect(screen.getByText('Line two')).toBeInTheDocument();
  });

  it('says when a track has no words, or is an instrumental', async () => {
    vi.mocked(musicService.getLyrics).mockResolvedValue({ status: 'missing', plain: null, synced: null, source: null, checkedAt: '' });
    const { unmount } = render(<LyricsPanel />);
    expect(await screen.findByText('No words found for this track.')).toBeInTheDocument();
    unmount();

    vi.mocked(musicService.getLyrics).mockResolvedValue({ status: 'instrumental', plain: null, synced: null, source: 'lrclib', checkedAt: '' });
    render(<LyricsPanel />);
    expect(await screen.findByText('An instrumental: no words to sing.')).toBeInTheDocument();
  });

  it('closes from its ✕', async () => {
    vi.mocked(musicService.getLyrics).mockResolvedValue({ status: 'missing', plain: null, synced: null, source: null, checkedAt: '' });
    render(<LyricsPanel />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close lyrics' })); });
    expect(player.showLyrics).toHaveBeenCalledWith(false);
  });

  it('stays away when closed, with no bar out, or for an album DexVault does not hold', () => {
    playing({ lyricsOpen: false });
    const { rerender } = render(<LyricsPanel />);
    expect(screen.queryByRole('complementary', { name: 'Lyrics' })).toBeNull();

    playing({ barShown: false });
    rerender(<LyricsPanel />);
    expect(screen.queryByRole('complementary', { name: 'Lyrics' })).toBeNull();

    playing({ album: { id: null, title: 'X', artist: 'Y', cover: null } });
    rerender(<LyricsPanel />);
    expect(screen.queryByRole('complementary', { name: 'Lyrics' })).toBeNull();
    expect(musicService.getLyrics).not.toHaveBeenCalled();
  });

  describe('fixing the timing', () => {
    const found = (changes = {}) => ({ status: 'found' as const, plain: null, synced: SYNCED, source: 'lrclib', checkedAt: '', timing: 'lrclib' as const, lrclibSynced: SYNCED, ...changes });
    const openFix = async (name = 'Timing') => {
      fireEvent.click(await screen.findByRole('button', { name }));
      fireEvent.click(await screen.findByText('Fix timing…'));
      return screen.getByRole('group', { name: 'Fix timing' });
    };

    it('moves the words with the slider as the song plays, and keeps them in DexVault on Save', async () => {
      vi.mocked(musicService.getLyrics).mockResolvedValue(found());
      vi.mocked(musicService.fixLyricsTiming).mockResolvedValue({ lyrics: found({ timing: 'fixed' }), lrc: 'none' });
      mocks.time = 8;
      render(<LyricsPanel />);
      await openFix();
      // At 8 s LRCLIB still sings the first line; 2.4 s earlier, the second.
      await waitFor(() => expect(screen.getByText("There's a fire starting in my heart")).toHaveAttribute('aria-current', 'true'));
      fireEvent.change(screen.getByRole('slider', { name: 'Shift the words' }), { target: { value: '-2.4' } });
      await waitFor(() => expect(screen.getByText('Reaching a fever pitch')).toHaveAttribute('aria-current', 'true'));
      expect(screen.getByText('−2.40 s')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(musicService.fixLyricsTiming).toHaveBeenCalledWith(25, 1, 1,
        "[00:02.75] There's a fire starting in my heart\n[00:07.34] Reaching a fever pitch\n[00:11.84] Finally I can see you crystal clear", false));
      expect(screen.queryByRole('group', { name: 'Fix timing' })).not.toBeInTheDocument();
    });

    it('moves the words by a tenth with the arrows, by a second with shift, and lets go on Esc, keeping the keys from the page', async () => {
      vi.mocked(musicService.getLyrics).mockResolvedValue(found());
      const page = vi.fn();
      window.addEventListener('keydown', page);
      render(<LyricsPanel />);
      await openFix();
      fireEvent.keyDown(document.body, { key: 'ArrowDown' });
      expect(page).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(await screen.findByText('+0.10 s')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true });
      expect(await screen.findByText('−0.90 s')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('group', { name: 'Fix timing' })).not.toBeInTheDocument());
      expect(page).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: 'ArrowDown' });
      expect(page).toHaveBeenCalledTimes(1);
      window.removeEventListener('keydown', page);
    });

    it('plays slower while fixing, here only, and at the song’s pace again once closed', async () => {
      vi.mocked(musicService.getLyrics).mockResolvedValue(found());
      const { unmount } = render(<LyricsPanel />);
      await openFix();
      fireEvent.click(screen.getByRole('radio', { name: '0.5×' }));
      expect(player.setRate).toHaveBeenLastCalledWith(0.5);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(player.setRate).toHaveBeenLastCalledWith(1));
      unmount();

      playing({ output: { kind: 'renderer', id: 'salon', name: 'Salon' } });
      render(<LyricsPanel />);
      await openFix();
      expect(screen.queryByRole('radio', { name: '0.5×' })).not.toBeInTheDocument();
    });

    it('scrubs the track as the wave is dragged, to the right back, the music held until let go, leaving the words where they are', async () => {
      vi.mocked(musicService.getLyrics).mockResolvedValue(found());
      mocks.time = 20;
      render(<LyricsPanel />);
      const drawer = await openFix();
      const wave = await waitFor(() => {
        const ready = drawer.querySelector('.lyrics-wave--ready');
        if (!ready) throw new Error('the wave is not read yet');
        return ready as HTMLElement;
      });
      // jsdom lays nothing out: the wave is 1 px wide, 8 s across it.
      vi.mocked(player.toggle).mockClear();
      fireEvent.pointerDown(wave, { clientX: 10, pointerId: 1 });
      expect(player.toggle).toHaveBeenLastCalledWith(false);
      fireEvent.pointerMove(wave, { clientX: 10.5, pointerId: 1 });
      fireEvent.pointerUp(wave, { pointerId: 1 });
      expect(player.seek).toHaveBeenLastCalledWith(16);
      expect(player.toggle).toHaveBeenLastCalledWith(true);
      expect(screen.getByText('0.00 s')).toBeInTheDocument();
    });

    it('saves into the lyrics when asked, starting from the timing fixed, and resets it', async () => {
      const fixed = "[00:02.75] There's a fire starting in my heart\n[00:07.34] Reaching a fever pitch\n[00:11.84] Finally I can see you crystal clear";
      vi.mocked(musicService.getLyrics).mockResolvedValue(found({ synced: fixed, timing: 'fixed' }));
      vi.mocked(musicService.fixLyricsTiming).mockResolvedValue({ lyrics: found({ synced: fixed, timing: 'saved' }), lrc: 'written' });
      vi.mocked(musicService.resetLyricsTiming).mockResolvedValue({ lyrics: found(), lrc: 'written' });
      render(<LyricsPanel />);

      expect(await openFix('Timing fixed')).toBeInTheDocument();
      expect(screen.getByText('−2.40 s')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      fireEvent.click(screen.getByRole('button', { name: 'Timing fixed' }));
      fireEvent.click(await screen.findByText('Save timing into the lyrics'));
      await waitFor(() => expect(musicService.fixLyricsTiming).toHaveBeenCalledWith(25, 1, 1, fixed, true));

      fireEvent.click(await screen.findByRole('button', { name: 'Timing saved into the lyrics' }));
      fireEvent.click(await screen.findByText('Reset timing'));
      await waitFor(() => expect(musicService.resetLyricsTiming).toHaveBeenCalledWith(25, 1, 1));
    });
  });

  it('labels a shift', () => {
    expect(shiftLabel(-2.4)).toBe('−2.40 s');
    expect(shiftLabel(0.1)).toBe('+0.10 s');
    expect(shiftLabel(0)).toBe('0.00 s');
  });
});
