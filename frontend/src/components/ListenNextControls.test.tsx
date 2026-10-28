import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { resetPlayer } from '../services/player';
import { ListenNextControls } from './ListenNextPlay';

const play = {
  repeat: false, playlistId: null, departures: [], ripped: [1], shuffled: [],
  lengths: { '1:0': { discs: 1, tracks: 10, durationSec: 2400, missing: 0 } },
} as never;

const phone = (narrow: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: narrow && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));

describe('ListenNextControls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetPlayer();
  });

  it('on a phone, heads its ▾ with the list’s length', () => {
    phone(true);
    render(<ListenNextControls count={1} play={play} onRepeat={() => {}} albums={[{ id: 1 }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Where to play Listen Next' }));
    expect(screen.getByText('1 disc · 10 tracks · 40 min')).toBeTruthy();
  });

  it('on a wide screen, leaves the length to the line beside the switch', () => {
    phone(false);
    render(<ListenNextControls count={1} play={play} onRepeat={() => {}} albums={[{ id: 1 }]} />);
    expect(screen.queryByRole('button', { name: 'Where to play Listen Next' })).toBeNull();
  });
});
