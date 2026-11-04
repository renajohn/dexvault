import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RadioCriteria, RadioPool, RadioSong } from '../services/radioService';

const server = vi.hoisted(() => ({
  criteria: vi.fn(),
  next: vi.fn(),
  left: vi.fn(),
  fiches: vi.fn(),
  askFiches: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  createMixtape: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../services/radioService', () => ({ default: server }));
vi.mock('../utils/mixtapeStore', () => ({ createMixtape: server.createMixtape }));
vi.mock('../services/musicService', () => ({ default: { getImageUrl: (path: string | null) => (path ? `/images/${path}` : null) } }));
vi.mock('./shared/Toast', () => ({ default: server.toast, toast: server.toast }));

import RadioBanner, { heardAs, poolWords, tintOf } from './RadioBanner';
import { BannerModeSwitch, useBannerMode, BANNER_MODE_KEY } from './BannerMode';
import { radio, resetRadio } from '../services/radio';
import { player, resetPlayer } from '../services/player';

const song = (n: number, energy = 5, extra: Partial<RadioSong> = {}): RadioSong => ({
  songId: `s${n}`, title: `Song ${n}`, artist: `Artist ${n}`, albumId: 100 + n, album: `Album ${n}`, cover: `covers/${n}.jpg`,
  discNumber: 1, track: n, durationSec: 240, work: null, movement: null,
  energy, tempo: 'mid', moods: ['upbeat', 'joyful'], styles: ['rock', 'pop'], lang: 'en', ...extra,
});

let counter = 0;
let energy = 5;
let missing = 0;
const drawing = () => server.next.mockImplementation(async (_criteria: RadioCriteria, _pool: RadioPool, count: number) => ({
  songs: Array.from({ length: count }, () => song(++counter, energy)), poolSize: 1190, fitting: 240, missingFiches: missing,
}));

const stored = new Map<string, string>();

beforeEach(() => {
  counter = 0;
  energy = 5;
  missing = 0;
  stored.clear();
  Object.values(server).forEach(fn => fn.mockReset());
  server.criteria.mockResolvedValue({ energyMin: 6, tempos: ['fast'], moods: ['upbeat', 'joyful'], styles: ['rock'] });
  server.left.mockResolvedValue({ ok: true });
  server.createMixtape.mockResolvedValue(42);
  drawing();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
  });
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
  resetPlayer();
  resetRadio();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const Banner: React.FC = () => <RadioBanner heading={<span>modes</span>} />;

/** The banner with a prompt heard and ten songs drawn for it. */
const tuned = async (words = 'quelque chose de upbeat') => {
  render(<Banner />);
  await act(() => radio.listen(words));
};

const covers = () => [...document.querySelectorAll('.radio-card[data-song]')].map(card => card.getAttribute('data-song'));

describe('the banner\'s switch', () => {
  const Switch: React.FC = () => {
    const [mode, choose] = useBannerMode();
    return <><BannerModeSwitch value={mode} onChange={choose} /><span data-testid="mode">{mode}</span></>;
  };

  it('goes from Listen Next to Radio and remembers it in this browser', () => {
    const { unmount } = render(<Switch />);
    expect(screen.getByTestId('mode').textContent).toBe('listenNext');
    fireEvent.click(screen.getByRole('radio', { name: /Radio/ }));
    expect(screen.getByTestId('mode').textContent).toBe('radio');
    expect(stored.get(BANNER_MODE_KEY)).toBe('radio');
    unmount();
    render(<Switch />);
    expect(screen.getByTestId('mode').textContent).toBe('radio');
    expect(screen.getByRole('radio', { name: /Radio/ })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('the radio banner', () => {
  it('plays the prompt typed on ↵ and offers the recent ones again', async () => {
    render(<Banner />);
    const field = screen.getByRole('textbox', { name: 'What to play' });
    fireEvent.change(field, { target: { value: 'rock alternatif énergique' } });
    await act(async () => { fireEvent.submit(field.closest('form')!); });
    expect(server.criteria).toHaveBeenCalledWith('rock alternatif énergique');
    await waitFor(() => expect(covers()).toHaveLength(10));
    expect(screen.getByText('10 ahead · 40 min · endless')).toBeTruthy();
    // Played at once, as one album named after the words.
    expect(player.getState().album?.title).toBe('Radio · rock alternatif énergique');
    expect(document.querySelector('.radio-card--now')?.getAttribute('data-song')).toBe('s1');

    fireEvent.change(field, { target: { value: 'mélancolique, un jour de pluie' } });
    await act(async () => { fireEvent.submit(field.closest('form')!); });
    // The one before is a chip now; a click plays it again.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'rock alternatif énergique' })); });
    expect(server.criteria).toHaveBeenLastCalledWith('rock alternatif énergique');
    expect(screen.getByRole('button', { name: 'mélancolique, un jour de pluie' })).toBeTruthy();
  });

  it('shows each song with its first mood, its first style and its energy', async () => {
    await tuned();
    const card = document.querySelector('.radio-card[data-song="s1"]') as HTMLElement;
    expect(within(card).getByText('upbeat')).toBeTruthy();
    expect(within(card).getByText('rock')).toBeTruthy();
    expect(within(card).queryByText('joyful')).toBeNull();
    expect(within(card).getByRole('img', { name: 'Energy 5 of 10' })).toBeTruthy();
    expect(within(card).getByText('Song 1')).toBeTruthy();
  });

  it('adds up the pool\'s sources in its menu, and draws again once it closes', async () => {
    await tuned();
    const pill = screen.getByRole('button', { name: /From/ });
    expect(pill.textContent).toContain('Albums 4★+');
    expect(pill.textContent).toMatch(/1\s190 tracks/);
    fireEvent.click(pill);
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'My ♥ tracks' }));
    // The menu stays open: the sources add up.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: "The albums' popular tracks" }));
    fireEvent.click(screen.getByRole('radio', { name: '4½★' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Albums at 4½★ and more' })).toHaveAttribute('aria-checked', 'true');
    expect(pill.textContent).toContain('Albums 4½★+ ∪ ♥ ∪ Popular');
    server.next.mockClear();
    const band = covers();
    await act(async () => { fireEvent.click(pill); });
    // The band offered to stay, as far as it is still in the pool.
    expect(server.next).toHaveBeenCalledWith(expect.anything(), { stars: 4.5, hearts: true, popular: true, genre: 'both', wholeWorks: false }, 10, [], band);
  });

  it('says everything that plays when no source is ticked', () => {
    expect(poolWords({ stars: null, hearts: false, popular: false, genre: 'both', wholeWorks: false })).toBe('Everything that plays');
    expect(poolWords({ stars: 3, hearts: true, popular: false, genre: 'both', wholeWorks: false })).toBe('Albums 3★+ ∪ ♥');
  });

  it('draws again without a "Heard as" taken away', async () => {
    await tuned();
    expect(heardAs(radio.getState().criteria).map(one => one.label)).toEqual(['energy 6–10', 'fast', 'upbeat', 'joyful', 'rock']);
    server.next.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not “joyful”' })); });
    expect(server.next).toHaveBeenCalledWith({ energyMin: 6, tempos: ['fast'], moods: ['upbeat'], styles: ['rock'] }, expect.anything(), 10, [], expect.any(Array));
    expect(screen.queryByRole('button', { name: 'Not “joyful”' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not “energy 6–10”' })); });
    expect(server.next).toHaveBeenLastCalledWith({ energyMin: null, energyMax: null, tempos: ['fast'], moods: ['upbeat'], styles: ['rock'] }, expect.anything(), 10, [], expect.any(Array));
  });

  it('✕ on a cover: told skipped, and another one comes', async () => {
    await tuned();
    const card = document.querySelector('.radio-card[data-song="s3"]') as HTMLElement;
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Not this one' })); });
    expect(server.left).toHaveBeenCalledWith('s3', 'skipped');
    await waitFor(() => expect(covers()).toEqual(['s1', 's2', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11']));
  });

  it('▶ plays the radio in DexVault\'s player, the song playing marked, ⏸ then', async () => {
    await tuned('upbeat');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Play the radio' })); });
    expect(player.getState().album?.title).toBe('Radio · upbeat');
    expect(document.querySelector('.radio-card--now')?.getAttribute('data-song')).toBe('s1');
    expect(screen.getByRole('button', { name: 'Pause the radio' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks the song playing, which does not drag, for a radio in the player that keeps no flag of it (an appliance)', async () => {
    await tuned('upbeat');
    const band = radio.getState().songs;
    // As the Salon gives it back: "Radio · …", no radio flag.
    act(() => {
      player.playAlbum({ id: null, title: 'Radio · upbeat', artist: 'Radio', cover: null },
        band.map((one, at) => ({ songId: one.songId, title: one.title, disc: 1, no: at + 1, durationSec: one.durationSec })), 0);
    });
    const now = document.querySelector('.radio-card--now');
    expect(now?.getAttribute('data-song')).toBe('s1');
    expect(now).not.toHaveClass('next-banner__card--sortable');
    expect(document.querySelector('.radio-card[data-song="s2"]')).toHaveClass('next-banner__card--sortable');
  });

  it('lets the whole band move when the radio in the player is another one, paused', async () => {
    // A radio of another prompt left paused, then a new prompt drawn and not played yet. Paused, the element says so.
    vi.mocked(window.HTMLMediaElement.prototype.pause).mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('pause')); });
    player.playAlbum({ id: null, radio: true, title: 'Radio · calm', artist: 'Radio', cover: null },
      [{ songId: 'c1', title: 'Calm 1', disc: 1, no: 1, durationSec: 200 }], 0);
    player.toggle(false);
    await tuned('upbeat');
    expect(radio.getState().songs[0].songId).toBe('s1');
    expect(document.querySelector('.radio-card--now')).toBeNull();
    expect(document.querySelector('.radio-card[data-song="s1"]')).toHaveClass('next-banner__card--sortable');
  });

  it('saves as a mixtape: its name and 30 tracks by default, the missing ones drawn', async () => {
    await tuned('upbeat');
    fireEvent.click(screen.getByRole('button', { name: 'Save as mixtape…' }));
    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Radio · upbeat');
    expect(screen.getByRole('radio', { name: '30' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/The 10 ahead and 20 more drawn the same way: about 2 h 00/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '20' }));
    fireEvent.change(name, { target: { value: 'Running' } });
    server.next.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save in Navidrome' })); });
    expect(server.next).toHaveBeenCalledWith(expect.anything(), expect.anything(), 10, covers());
    expect(server.createMixtape).toHaveBeenCalledWith('Running', [...covers(), ...Array.from({ length: 10 }, (_, at) => `s${11 + at}`)]);
  });

  it('says so when nothing fits, and offers to look in everything that plays', async () => {
    server.next.mockResolvedValueOnce({ songs: [], poolSize: 300, fitting: 12, missingFiches: 0 });
    await tuned('du jazz pour cuisiner');
    expect(screen.getByText('Nothing in Albums 4★+ for “du jazz pour cuisiner”.')).toBeTruthy();
    expect(screen.getByText(/12 songs fit, all heard lately/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Look in everything that plays' })); });
    expect(server.next).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ stars: null, hearts: false, popular: false }), 10, [], []);
    await waitFor(() => expect(covers()).toHaveLength(10));
    expect(screen.getByRole('button', { name: /From/ }).textContent).toContain('Everything that plays');
  });

  it('takes a warm hue for upbeat songs and a blue one for calm songs', async () => {
    expect(tintOf([])).toBe(38);
    expect(tintOf([song(1, 9), song(2, 8)])).toBe(15);
    expect(tintOf([song(1, 1), song(2, 2)])).toBe(215);
    energy = 8.5;
    await tuned();
    const banner = document.querySelector('.radio-banner') as HTMLElement;
    expect(banner.style.getPropertyValue('--radio-hue')).toBe('15');
    energy = 2;
    await act(() => radio.redraw());
    expect(banner.style.getPropertyValue('--radio-hue')).toBe('215');
  });

  it('shows the covers waiting while the LLM chooses', async () => {
    let answer: (criteria: RadioCriteria) => void = () => undefined;
    server.criteria.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));
    render(<Banner />);
    act(() => { void radio.listen('calme'); });
    expect(screen.getByText('Listening to the words…')).toBeTruthy();
    expect(document.querySelectorAll('.next-banner__image--pending')).toHaveLength(10);
    await act(async () => { answer({ moods: ['calm'] }); });
    await waitFor(() => expect(covers()).toHaveLength(10));
  });

  it('counts the songs with no fiche and asks for them', async () => {
    missing = 312;
    server.askFiches.mockResolvedValue({ songs: 1500, withFiche: 1190, queued: 312, writing: true });
    await tuned();
    expect(screen.getByText('312 songs of this pool have no fiche yet: they are never drawn.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Describe them first' })); });
    expect(server.askFiches).toHaveBeenCalledWith(expect.objectContaining({ stars: 4 }));
    expect(screen.getByText("312 in the writer's queue")).toBeTruthy();
  });

  it('shows the energy, the tempos and six moods or styles, the rest behind +N, each still taken away', async () => {
    server.criteria.mockResolvedValue({ energyMin: 7, tempos: ['fast'],
      moods: ['upbeat', 'energetic', 'driving', 'joyful', 'uplifting', 'anthemic', 'intense', 'playful'], styles: ['rock', 'pop'] });
    await tuned('quelque chose de upbeat pour courir');
    const heard = () => [...document.querySelectorAll('.radio-banner__heard .ui-chip__label')].map(chip => chip.textContent);
    expect(heard()).toEqual(['energy 7–10', 'fast', 'upbeat', 'energetic', 'driving', 'joyful', 'uplifting', 'anthemic', '+4']);
    fireEvent.click(screen.getByRole('button', { name: '4 more: intense, playful, rock, pop' }));
    expect(heard()).toEqual(['energy 7–10', 'fast', 'upbeat', 'energetic', 'driving', 'joyful', 'uplifting', 'anthemic', 'intense', 'playful', 'rock', 'pop', 'Less']);
    fireEvent.click(screen.getByRole('button', { name: 'Less' }));
    expect(heard()).toEqual(['energy 7–10', 'fast', 'upbeat', 'energetic', 'driving', 'joyful', 'uplifting', 'anthemic', '+4']);
    fireEvent.click(screen.getByRole('button', { name: '4 more: intense, playful, rock, pop' }));
    server.next.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not “pop”' })); });
    expect(server.next).toHaveBeenCalledWith(expect.objectContaining({ styles: ['rock'] }), expect.anything(), expect.any(Number), expect.anything(), expect.anything());
    expect(heard()).not.toContain('pop');
  });

  it('folds the moods and styles after three on a phone, and Less folds them again', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 575px'), addEventListener() {}, removeEventListener() {} }));
    try {
      server.criteria.mockResolvedValue({ energyMin: 7, tempos: ['fast'], moods: ['upbeat', 'energetic', 'driving', 'joyful'], styles: ['rock'] });
      await tuned('quelque chose de upbeat pour courir');
      const heard = () => [...document.querySelectorAll('.radio-banner__heard .ui-chip__label')].map(chip => chip.textContent);
      expect(heard()).toEqual(['energy 7–10', 'fast', 'upbeat', 'energetic', 'driving', '+2']);
      fireEvent.click(screen.getByRole('button', { name: '2 more: joyful, rock' }));
      expect(heard()).toEqual(['energy 7–10', 'fast', 'upbeat', 'energetic', 'driving', 'joyful', 'rock', 'Less']);
      fireEvent.click(screen.getByRole('button', { name: 'Less' }));
      expect(heard()).toEqual(['energy 7–10', 'fast', 'upbeat', 'energetic', 'driving', '+2']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
