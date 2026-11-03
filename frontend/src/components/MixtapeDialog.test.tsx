import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const server = vi.hoisted(() => ({ songs: [] as Array<Record<string, unknown>>, title: 'OSR · 20 novembre', deleted: [] as number[], changes: [] as unknown[] }));

const song = (songId: string, title: string, extra: Record<string, unknown> = {}) => ({
  songId, title, artist: 'Antonín Dvořák', album: 'Symphony no. 9', navidromeAlbumId: 'nd', discNumber: 1, track: 1,
  durationSec: 600, albumId: 281, cover: null, work: null, movement: null, ...extra,
});
const symphony = ['I. Adagio', 'II. Largo', 'III. Scherzo', 'IV. Allegro con fuoco']
  .map((movement, at) => song(`d${at + 1}`, `Symphony no. 9: ${movement}`, { track: at + 1, work: 'Symphony no. 9', movement }));
const concerto = song('m1', 'Violin Concerto in E minor', { artist: 'Felix Mendelssohn', album: 'Violin Concertos', albumId: 440 });

const details = () => ({
  album: { id: 9, title: server.title, artist: ['Antonín Dvořák'], cover: null, titleStatus: 'playlist' },
  playlistId: 'p9', url: 'https://music/p9', songs: server.songs,
});

vi.mock('../services/musicService', () => ({
  default: {
    getImageUrl: vi.fn(() => null),
    getMixtape: vi.fn(async () => details()),
    getListenNextAlbums: vi.fn(async () => []),
    updateMixtape: vi.fn(async (_id: number, change: { songs?: string[] }) => {
      server.changes.push(change);
      if (change.songs) {
        const all = [...symphony, concerto];
        server.songs = change.songs.map(id => all.find(one => one.songId === id)!);
      }
      return details();
    }),
    deleteMixtape: vi.fn(async (id: number) => { server.deleted.push(id); }),
    searchForMixtape: vi.fn(async () => ({ albums: [], works: [], tracks: [] })),
  },
}));
vi.mock('./shared/Toast', () => ({ default: vi.fn(), toast: vi.fn() }));

import MixtapeDialog from './MixtapeDialog';

beforeEach(() => {
  server.songs = [concerto, ...symphony];
  server.title = 'OSR · 20 novembre';
  server.deleted = [];
  server.changes = [];
});

describe("a mixtape's card", () => {
  it('shows a work\'s movements under its head, each by its own name, and Add tracks… above', async () => {
    render(<MixtapeDialog albumId={9} onClose={() => undefined} onOpenAlbum={() => undefined} />);
    await screen.findByText('I. Adagio');
    const work = document.querySelector('.mixtape-work') as HTMLElement;
    expect(within(work).getByText('Symphony no. 9', { selector: '.mixtape-work-name' })).toBeTruthy();
    expect(within(work).getByText(/4 movements · 40 min/)).toBeTruthy();
    expect(within(work).getAllByText(/^(I|II|III|IV)\. /).map(one => one.textContent)).toEqual(['I. Adagio', 'II. Largo', 'III. Scherzo', 'IV. Allegro con fuoco']);
    expect(screen.getByLabelText('Add tracks')).toBeTruthy();
  });

  it('takes a whole work out from its head', async () => {
    render(<MixtapeDialog albumId={9} onClose={() => undefined} onOpenAlbum={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Take Symphony no. 9 out' }));
    await waitFor(() => expect(server.changes).toContainEqual({ songs: ['m1'] }));
  });

  it('moves a work whole, dragged by its head', async () => {
    render(<MixtapeDialog albumId={9} onClose={() => undefined} onOpenAlbum={() => undefined} />);
    await screen.findByText('I. Adagio');
    const head = document.querySelector('.mixtape-work-head') as HTMLElement;
    const first = screen.getByText('Violin Concerto in E minor').closest('.mixtape-song') as HTMLElement;
    fireEvent.dragStart(head, { dataTransfer: { effectAllowed: '' } });
    fireEvent.dragOver(first);
    fireEvent.drop(first);
    await waitFor(() => expect(server.changes).toContainEqual({ songs: ['d1', 'd2', 'd3', 'd4', 'm1'] }));
  });

  it('opens a mixtape just made on its name, and lets it go once closed with no track', async () => {
    server.songs = [];
    server.title = 'New mixtape';
    const onClose = vi.fn();
    render(<MixtapeDialog albumId={9} fresh onClose={onClose} onOpenAlbum={() => undefined} />);
    const name = await screen.findByLabelText('Name of the mixtape') as HTMLInputElement;
    expect(name.value).toBe('New mixtape');
    expect(screen.getByText(/No track yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(server.deleted).toEqual([9]));
  });

  it('keeps a mixtape just made once it has tracks, and an old one even empty', async () => {
    server.songs = [concerto];
    const { unmount } = render(<MixtapeDialog albumId={9} fresh onClose={() => undefined} onOpenAlbum={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    unmount();
    server.songs = [];
    render(<MixtapeDialog albumId={9} onClose={() => undefined} onOpenAlbum={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(server.deleted).toEqual([]);
  });
});
