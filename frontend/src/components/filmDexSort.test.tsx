import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CollectionHeader from './shared/CollectionHeader';
import { sortOptions } from './filmDexSort';

const phone = (matches: boolean) => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches, media, addEventListener: () => {}, removeEventListener: () => {},
  }));
};

const header = (sortBy: string, onSortChange = vi.fn()) => (
  <CollectionHeader filteredCount={3} totalCount={3} itemLabel="movies"
    sortBy={sortBy} sortOptions={sortOptions} onSortChange={onSortChange} />
);

describe('FilmDex sorts', () => {
  afterEach(() => vi.unstubAllGlobals());

  describe('on a phone', () => {
    beforeEach(() => phone(true));

    it('folds each pair into one entry with its direction', () => {
      render(header('titleReverse'));
      fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
      const entries = screen.getAllByRole('menuitemradio');
      expect(entries.map(e => e.textContent)).toEqual(['TitleZ-A', 'AcquiredLast first', 'RatingHighest', 'AgeYoungest']);
    });

    it('turns the order when the chosen key is touched again', () => {
      const onSortChange = vi.fn();
      render(header('rating', onSortChange));
      fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
      fireEvent.click(screen.getAllByRole('menuitemradio')[2]);
      expect(onSortChange).toHaveBeenCalledWith('ratingLowest');
    });
  });

  it('keeps every label on a wide screen', () => {
    phone(false);
    render(header('title'));
    fireEvent.click(screen.getByRole('button', { name: /Sort/ }));
    expect(screen.getAllByRole('menuitemradio').map(e => e.textContent)).toEqual(sortOptions.map(o => o.label));
  });
});
