import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const song = (songId: string, title: string, extra: Record<string, unknown> = {}) => ({
  songId, title, artist: 'Antonín Dvořák', albumId: 281, album: 'Symphony no. 9', cover: null, discNumber: 1, track: 1,
  durationSec: 600, starred: false, popular: false, work: null, movement: null, ...extra,
});
const movements = ['I. Adagio', 'II. Largo', 'III. Scherzo', 'IV. Allegro con fuoco']
  .map((movement, at) => song(`d${at + 1}`, `Symphony no. 9: ${movement}`, { track: at + 1, work: 'Symphony no. 9', movement }));
const overture = song('d5', 'Carnival Overture, op. 92', { track: 5 });

vi.mock('../services/musicService', () => ({
  default: {
    getImageUrl: vi.fn(() => null),
    searchForMixtape: vi.fn(async () => ({
      albums: [{ albumId: 281, title: 'Symphony no. 9', artist: 'Antonín Dvořák', cover: null, songs: [...movements, overture] }],
      works: [{ key: '281:0', name: 'Symphony no. 9', albumId: 281, album: 'Symphony no. 9', artists: ['Antonín Dvořák', 'Seiji Ozawa'], cover: null, songs: movements }],
      tracks: [overture],
    })),
  },
}));

import musicService from '../services/musicService';
import MixtapeComposer from './MixtapeComposer';

/** The composer over a mixtape the test holds, as the dialog holds it. */
const Holder: React.FC<{ start: string[]; seen: (ids: string[]) => void }> = ({ start, seen }) => {
  const [ids, setIds] = useState(start);
  return <MixtapeComposer songIds={ids} onSongs={next => { setIds(next); seen(next); }} />;
};

const type = async (words: string) => {
  const field = screen.getByLabelText('Add tracks');
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: words } });
  await screen.findByRole('option', { name: 'Carnival Overture, op. 92' });
  return field;
};

const option = (name: string, at = 0) => screen.getAllByRole('option', { name })[at];

describe("a mixtape's Add tracks…", () => {
  it('finds albums, works and tracks, each ticked as the mixtape holds it', async () => {
    render(<Holder start={['d2']} seen={() => undefined} />);
    await type('dvorak 9');
    expect(screen.getByText('Albums')).toBeTruthy();
    expect(screen.getByText('Works')).toBeTruthy();
    expect(screen.getByText('Tracks')).toBeTruthy();
    // One movement of five: a part of the album, of the work.
    expect(option('Symphony no. 9', 0).textContent).toContain('1 of 5');
    expect(option('Symphony no. 9', 1).textContent).toContain('1 of 4');
    expect(option('Symphony no. 9', 1).textContent).toContain('Work · 4 movements · 40 min · Dvořák · Ozawa');
    expect(option('Carnival Overture, op. 92').getAttribute('aria-selected')).toBe('false');
  });

  it('ticks a work whole, its movements in order at the end, and unticks it', async () => {
    const seen = vi.fn();
    render(<Holder start={['x']} seen={seen} />);
    await type('dvorak 9');
    fireEvent.click(option('Symphony no. 9', 1));
    expect(seen).toHaveBeenLastCalledWith(['x', 'd1', 'd2', 'd3', 'd4']);
    expect(option('Symphony no. 9', 1).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(option('Symphony no. 9', 1));
    expect(seen).toHaveBeenLastCalledWith(['x']);
  });

  it('opens an album ticked, for its tracks to be unticked, and puts one back where it stood', async () => {
    const seen = vi.fn();
    render(<Holder start={['x']} seen={seen} />);
    await type('dvorak 9');
    fireEvent.click(option('Symphony no. 9', 0));
    expect(seen).toHaveBeenLastCalledWith(['x', 'd1', 'd2', 'd3', 'd4', 'd5']);
    // Open: its movements under their work, by their own names.
    expect(screen.getByRole('option', { name: 'II. Largo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'II. Largo' }));
    expect(seen).toHaveBeenLastCalledWith(['x', 'd1', 'd3', 'd4', 'd5']);
    fireEvent.click(screen.getByRole('option', { name: 'II. Largo' }));
    expect(seen).toHaveBeenLastCalledWith(['x', 'd1', 'd2', 'd3', 'd4', 'd5']);
  });

  it('ticks with ↵ and keeps the list open, goes with the arrows, and empties the field with Esc', async () => {
    const seen = vi.fn();
    render(<Holder start={[]} seen={seen} />);
    const field = await type('dvorak 9');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(seen).toHaveBeenLastCalledWith(['d1', 'd2', 'd3', 'd4']);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect((field as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('forgets where a song stood once the field is left', async () => {
    const seen = vi.fn();
    render(<Holder start={['d5', 'x', 'y']} seen={seen} />);
    const field = await type('dvorak 9');
    fireEvent.click(option('Carnival Overture, op. 92'));
    expect(seen).toHaveBeenLastCalledWith(['x', 'y']);
    act(() => { fireEvent.blur(field); });
    fireEvent.focus(field);
    fireEvent.click(option('Carnival Overture, op. 92'));
    expect(seen).toHaveBeenLastCalledWith(['x', 'y', 'd5']);
  });

  it('hands the words of how a song sounds to the server as they are typed: the tracks it finds are ticked like the others', async () => {
    render(<Holder start={[]} seen={() => undefined} />);
    await type('mood:melancholic piano');
    expect(musicService.searchForMixtape).toHaveBeenLastCalledWith('mood:melancholic piano', expect.anything());
    expect(screen.getByLabelText('Add tracks').getAttribute('placeholder')).toContain('mood:');
  });
});
