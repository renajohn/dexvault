import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const server = vi.hoisted(() => ({ made: [] as Array<{ name: string; songIds: string[] }> }));

const summary = (id: number, title: string, songs: number, seconds: number, updatedAt: string) => ({
  album: { id, title, artist: ['A'], cover: null, titleStatus: 'playlist', totalDuration: seconds, updatedAt },
  playlistId: `p${id}`, songIds: Array.from({ length: songs }, (_, at) => `${id}-${at}`),
});

vi.mock('../services/musicService', () => ({
  default: {
    getImageUrl: vi.fn(() => null),
    getMixtapes: vi.fn(async () => ({
      configured: true,
      mixtapes: [summary(1, 'Running', 54, 11810, '2026-11-01'), summary(2, 'Brel & Souchon', 12, 2400, '2026-11-02'), summary(3, 'Adagios', 5, 3000, '2026-10-20')],
    })),
    createMixtape: vi.fn(async (name: string, songIds: string[]) => { server.made.push({ name, songIds }); return { id: 99, title: name }; }),
    searchAlbums: vi.fn(async () => [{ id: 1 }]),
    toggleListenNext: vi.fn(async () => ({})),
  },
}));
vi.mock('./shared/Toast', () => ({ default: vi.fn(), toast: vi.fn() }));
vi.mock('./shared/AlbumPlayButton', () => ({ default: () => null }));
vi.mock('./shared/ShelfCode', () => ({ default: () => null }));

import MixtapesGrid from './MixtapesGrid';
import { resetMixtapes } from '../utils/mixtapeStore';

const titles = () => [...document.querySelectorAll('.music-thumbnail-title')].map(one => one.textContent);

beforeEach(() => {
  server.made = [];
  resetMixtapes();
});

describe("MusicDex's view of the mixtapes", () => {
  it('shows each mixtape with its length, the last changed first, after a tile to make one', async () => {
    render(<MixtapesGrid searchText="" viewSwitch={<span>Albums | Mixtapes</span>} listenNextIds={new Set([1])} onListenNextChange={() => undefined} onOpen={() => undefined} />);
    await waitFor(() => expect(titles()).toEqual(['Brel & Souchon', 'Running', 'Adagios']));
    expect(screen.getByText('54 tracks · 3 h 17')).toBeTruthy();
    expect(document.querySelector('.collection-count')!.textContent).toContain('Showing 3 of 3 mixtapes');
    expect(screen.getByText('Albums | Mixtapes')).toBeTruthy();
    expect(document.querySelector('.mixtapes-new')).toBeTruthy();
    // Running is in Listen Next: its headphones are gold.
    expect(screen.getByRole('button', { name: 'Take Running out of Listen Next' })).toBeTruthy();
  });

  it('makes an empty mixtape from its tile and opens it, its name to be typed', async () => {
    const onOpen = vi.fn();
    render(<MixtapesGrid searchText="" viewSwitch={null} listenNextIds={new Set()} onListenNextChange={() => undefined} onOpen={onOpen} />);
    await waitFor(() => expect(titles()).toHaveLength(3));
    fireEvent.click(document.querySelector('.mixtapes-new')!);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(99, { fresh: true }));
    expect(server.made).toEqual([{ name: 'New mixtape', songIds: [] }]);
  });

  it('shows what a search finds, without the tile', async () => {
    render(<MixtapesGrid searchText="adele" viewSwitch={null} listenNextIds={new Set()} onListenNextChange={() => undefined} onOpen={() => undefined} />);
    await waitFor(() => expect(titles()).toEqual(['Running']));
    expect(document.querySelector('.mixtapes-new')).toBeNull();
  });

  it('duplicates a mixtape from its ⋯, its songs in their order', async () => {
    const onOpen = vi.fn();
    render(<MixtapesGrid searchText="" viewSwitch={null} listenNextIds={new Set()} onListenNextChange={() => undefined} onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole('button', { name: 'More for Adagios' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Duplicate/ }));
    await waitFor(() => expect(server.made).toEqual([{ name: 'Adagios (copy)', songIds: ['3-0', '3-1', '3-2', '3-3', '3-4'] }]));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(99, { naming: true }));
  });
});
