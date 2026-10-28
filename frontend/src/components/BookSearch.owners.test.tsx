import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import BookSearch from './BookSearch';
import bookService from '../services/bookService';

vi.mock('../services/bookService', () => ({
  default: {
    getAllBooks: vi.fn(),
    searchBooks: vi.fn(),
    getBookById: vi.fn(),
    getImageUrl: (p: string | null) => p,
    getAutocompleteSuggestions: vi.fn().mockResolvedValue([]),
  },
}));

const book = (id: number, title: string, owner: string | null) => ({ id, title, authors: ['Someone'], owner, bookType: 'book', titleStatus: 'owned' });

/** Where BookSearch sent the search, as the app reads it back from the URL. */
let searched: string | null = null;
const Spy = () => {
  const location = useLocation();
  searched = new URLSearchParams(location.search).get('search');
  return null;
};

const page = (searchText: string) => (
  <MemoryRouter initialEntries={['/bookdex']}>
    <Spy />
    <BookSearch books={[]} loading={false} onAddBook={vi.fn()} onUpdateBook={vi.fn()} onDeleteBook={vi.fn()} searchCriteria={{ searchText }} />
  </MemoryRouter>
);

const owners = () => within(screen.getByRole('group', { name: 'Whose books' }));
const isOn = (name: string) => owners().getByText(name).closest('.ui-chip')!.classList.contains('ui-chip--on');

beforeEach(() => {
  searched = null;
  vi.mocked(bookService.getAllBooks).mockReset().mockResolvedValue([
    book(1, 'Dune', 'Alice'), book(2, 'Incal', 'Oriane'), book(3, 'Earthsea', 'Alice'), book(4, 'Rings', null),
  ]);
  vi.mocked(bookService.searchBooks).mockReset().mockResolvedValue([]);
});

describe('BookSearch, ses boutons de propriétaires et la pastille owner', () => {
  it('allume les boutons que nomme la pastille, et aucun pour une exclusion', async () => {
    const { rerender } = render(page('owner:Alice,Oriane'));
    await screen.findByRole('group', { name: 'Whose books' });
    expect(isOn('Alice')).toBe(true);
    expect(isOn('Oriane')).toBe(true);
    expect(isOn('No owner')).toBe(false);

    rerender(page('owner:none'));
    expect(isOn('No owner')).toBe(true);
    expect(isOn('Alice')).toBe(false);

    rerender(page('-owner:Alice'));
    expect(isOn('Alice')).toBe(false);

    // The pill taken away in the field: the button goes off.
    rerender(page('dune'));
    expect(isOn('Alice')).toBe(false);
    expect(isOn('Oriane')).toBe(false);
  });

  it('un clic remplace la pastille, un Alt-clic y ajoute un nom', async () => {
    const { rerender } = render(page('dune owner:Oriane'));
    await screen.findByRole('group', { name: 'Whose books' });
    fireEvent.click(owners().getByText('Alice'));
    expect(searched).toBe('dune owner:Alice');

    rerender(page('owner:Alice'));
    fireEvent.click(owners().getByText('Oriane'), { altKey: true });
    expect(searched).toBe('owner:Alice,Oriane');

    rerender(page('owner:Alice,Oriane'));
    fireEvent.click(owners().getByText('Alice'), { altKey: true });
    expect(searched).toBe('owner:Oriane');

    rerender(page('owner:Oriane'));
    fireEvent.click(owners().getByText('Oriane'));
    expect(searched).toBe('');
  });

  it("n'a plus de rangée de filtres sous la grille : les pastilles du champ la remplacent", async () => {
    const { container } = render(page('type:book has_ebook:yes'));
    await screen.findByRole('group', { name: 'Whose books' });
    expect(container.querySelector('.active-filters')).toBeNull();
  });
});

describe('BookSearch sur un téléphone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 575px'), addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const menu = () => screen.findByRole('button', { name: 'Whose books' });

  it("montre les propriétaires en un menu, pas en boutons, et un choix n'en prend qu'un", async () => {
    const { rerender } = render(page('dune owner:Oriane'));
    const trigger = await menu();
    expect(screen.queryByRole('group', { name: 'Whose books' })).toBeNull();
    expect(trigger.textContent).toContain('Oriane');
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Alice/ }));
    expect(searched).toBe('dune owner:Alice');

    rerender(page('dune owner:Alice'));
    fireEvent.click(await menu());
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Everyone/ }));
    expect(searched).toBe('dune');
  });

  it("plie le tri par clé : Title, Author, Series, Year, Added", async () => {
    render(page(''));
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    const entries = (await screen.findAllByRole('menuitemradio')).map(item => item.textContent);
    expect(entries).toHaveLength(5);
    expect(entries.join('|')).toMatch(/^Title.*\|Author.*\|Series\|Year.*\|Added/);
  });
});
