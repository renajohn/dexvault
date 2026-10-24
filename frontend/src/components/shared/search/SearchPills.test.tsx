import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SearchPills from './SearchPills';
import { yesNo, type SearchSchema } from './schema';

const composers = ['Bach', 'Carl Philipp Emanuel Bach', 'Händel', 'Joni Mitchell', 'Mozart'];
const styles = ['Rock opera', 'Rock', 'Pop rock', 'Jazz', 'Pop'];

const schema: SearchSchema = {
  section: 'test',
  placeholder: 'Search the test',
  wordsHint: 'In titles',
  keys: [
    {
      key: 'composer', group: 'Who', type: 'text', desc: 'A composer', example: 'composer:Bach',
      suggest: async typed => composers.filter(c => c.toLowerCase().includes(typed.toLowerCase())).map(value => ({ value })),
    },
    { key: 'cd', group: 'Medium', type: 'bool', desc: 'A CD', values: yesNo('Only your CDs', 'Not your CDs') },
    { key: 'file', group: 'Medium', type: 'enum', desc: 'Its files', values: [{ value: 'lossless', desc: 'FLAC' }, { value: 'lossy', desc: 'Compressed' }] },
    { key: 'genre', group: 'What', type: 'text', desc: 'A genre' },
    {
      key: 'style', group: 'What', type: 'text', desc: 'A style',
      suggest: async typed => styles.filter(c => c.toLowerCase().includes(typed.toLowerCase())).map(value => ({ value })),
    },
    { key: 'work', group: 'What', type: 'text', desc: 'A work' },
    { key: 'stars', group: 'Stars', type: 'number', desc: 'Your stars', shortcuts: [{ value: '>=4.5' }, { value: '>=4' }, { value: '<3' }] },
    { key: 'year', group: 'When', type: 'number', desc: 'Its year', shortcuts: [{ value: '1970-1979' }, { value: '1960-1969' }] },
  ],
};

/** The field as App holds it: the string in a state, every change handed on. */
const Harness: React.FC<{ initial?: string; onChange?: (q: string) => void; measureTops?: (els: HTMLElement[]) => number[] }> = ({ initial = '', onChange, measureTops }) => {
  const [value, setValue] = useState(initial);
  return (
    <>
      <SearchPills schema={schema} value={value} measureTops={measureTops}
        onChange={q => { setValue(q); onChange?.(q); }} />
      <button type="button" onClick={() => setValue('cd:true genre:jazz')}>Set from outside</button>
    </>
  );
};

const input = () => screen.getByRole('combobox');
const pills = () => screen.queryAllByRole('group').map(g => g.getAttribute('aria-label'));
const type = (text: string) => {
  const field = input();
  fireEvent.change(field, { target: { value: text } });
};
/** Typed as a keyboard types: each key down, then the letter in the field unless the key down kept it out. */
const typeKeys = (text: string) => {
  for (const c of text) {
    if (fireEvent.keyDown(input(), { key: c })) fireEvent.change(input(), { target: { value: (input() as HTMLInputElement).value + c } });
  }
};
const options = () => within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent);

describe('SearchPills', () => {
  it('shows a string set from outside as pills, in the words a pill writes', () => {
    render(<Harness initial="composer:Bach,Händel blue" />);
    expect(pills()).toEqual(['composer: Bach or Händel']);
    expect(screen.getByText('blue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set from outside' }));

    expect(pills()).toEqual(['cd: yes', 'genre: jazz']);
  });

  it('opens a pill on a key typed, without searching at each letter of its value', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.focus(input());

    type('composer:');
    expect(input()).toHaveAccessibleName('A value of composer');
    onChange.mockClear();

    type('Moz');
    type('Mozart');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('composer:Mozart');
    expect(pills()).toEqual(['composer: Mozart']);
  });

  it('takes the grey rest with Tab: a key, then a value', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.focus(input());

    type('comp');
    expect(screen.getByText('oser:')).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input()).toHaveAccessibleName('A value of composer');

    type('Moz');
    await waitFor(() => expect(screen.getByText('art')).toBeInTheDocument());
    fireEvent.keyDown(input(), { key: 'Tab' });

    expect(onChange).toHaveBeenLastCalledWith('composer:Mozart');
  });

  it('adds another value with a comma, and keeps the words as typed', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.focus(input());
    type('composer:');

    type('bach');
    fireEvent.keyDown(input(), { key: ',' });
    type('Händel');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(onChange).toHaveBeenLastCalledWith('composer:bach,Händel');
  });

  it('excludes with ! typed first, and writes it -', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.focus(input());
    type('!genre:');
    type('jazz');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(onChange).toHaveBeenLastCalledWith('-genre:jazz');
    expect(pills()).toEqual(['Not genre: jazz']);
  });

  it('opens the last pill again on ⌫ in the empty field, on its last value', () => {
    render(<Harness initial="cd:yes composer:Bach,Mozart" />);
    fireEvent.focus(input());

    fireEvent.keyDown(input(), { key: 'Backspace' });

    expect(input()).toHaveAccessibleName('A value of composer');
    expect(input()).toHaveValue('Mozart');
    expect(pills()).toEqual(['cd: yes']);

    // Esc leaves it as it was.
    fireEvent.keyDown(input(), { key: 'Escape' });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(pills()).toEqual(['cd: yes', 'composer: Bach or Mozart']);
  });

  it('opens a pill on a value clicked, with every value of its key, the current one ✓', () => {
    const onChange = vi.fn();
    render(<Harness initial="file:lossless" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'lossless' }));

    const list = screen.getByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual([expect.stringContaining('lossless'), expect.stringContaining('lossy')]);
    expect(options[0]).toHaveTextContent('✓');
    expect(options[1]).not.toHaveTextContent('✓');

    fireEvent.click(options[1]);
    expect(onChange).toHaveBeenLastCalledWith('file:lossy');
  });

  it('opens its menu on a click on a pill\'s key, Remove taking it away', () => {
    const onChange = vi.fn();
    render(<Harness initial="cd:yes genre:jazz" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'genre' }));
    expect(screen.getByRole('menuitem', { name: 'Exclude it' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));

    expect(onChange).toHaveBeenLastCalledWith('cd:yes');
    expect(pills()).toEqual(['cd: yes']);
  });

  it('excludes a pill from its menu', () => {
    const onChange = vi.fn();
    render(<Harness initial="genre:jazz" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'genre' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exclude it' }));
    expect(onChange).toHaveBeenLastCalledWith('-genre:jazz');
  });

  it('takes a pill away with its ✕', () => {
    const onChange = vi.fn();
    render(<Harness initial="cd:yes genre:jazz blue" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove cd' }));

    expect(onChange).toHaveBeenLastCalledWith('genre:jazz blue');
  });

  it('says what a mistyped key was meant to be, and mends it', () => {
    const onChange = vi.fn();
    render(<Harness initial="composr:Bach" onChange={onChange} />);

    expect(screen.getByRole('alert')).toHaveTextContent('composr is not a filter. Did you mean composer?');
    fireEvent.click(screen.getByRole('button', { name: 'Use composer' }));

    expect(onChange).toHaveBeenLastCalledWith('composer:Bach');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the keys by group in the empty field, and the recent searches, after two seconds', () => {
    vi.useFakeTimers();
    try {
      render(<SearchPills schema={schema} value="" onChange={() => undefined} recentKey="test-recent" />);
      fireEvent.focus(input());
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(2000); });
      const list = screen.getByRole('listbox');
      expect(within(list).getByText('Who')).toBeInTheDocument();
      expect(within(list).getByText('composer:Bach')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show the keys once there is a pill, unless ↓ asks for them', () => {
    vi.useFakeTimers();
    try {
      render(<Harness initial="cd:yes" />);
      fireEvent.focus(input());
      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
      expect(within(screen.getByRole('listbox')).getByText('composer:Bach')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows two rows at rest, "+N" for the pills that do not fit', () => {
    // One pill a row: two rows hold the first pill and "+N".
    render(<Harness initial="cd:yes genre:jazz file:lossy composer:Bach" measureTops={els => els.map((_, i) => i * 30)} />);

    const more = screen.getByRole('button', { name: '+3' });
    expect(more).toBeVisible();
    expect(screen.getByRole('group', { name: 'genre: jazz' })).toHaveClass('is-hidden');

    // In use, the field shows them all.
    act(() => { fireEvent.focus(input()); });
    expect(screen.getByRole('group', { name: 'genre: jazz' })).not.toHaveClass('is-hidden');
  });

  describe('Enter, a space and a comma take the words typed, not the grey rest', () => {
    it('keeps a comparison typed whole: >=4 is not >=4.5', () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.focus(input());
      type('stars:');
      type('>=4');
      expect(document.querySelector('.search-pills__rest')).toBeNull();
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith('stars:>=4');

      type('year:');
      type('196');
      expect(document.querySelector('.search-pills__rest')).toBeNull();
      fireEvent.keyDown(input(), { key: ' ' });
      expect(onChange).toHaveBeenLastCalledWith('stars:>=4 year:196');
    });

    it('takes a value the key has in its own spelling, and no grey rest after it', async () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.focus(input());
      type('style:');
      type('rock');
      await waitFor(() => expect(options()).toEqual([expect.stringContaining('Rock'), expect.stringContaining('Rock opera'), expect.stringContaining('Pop rock')]));
      expect(options()[0]).not.toContain('opera');
      expect(document.querySelector('.search-pills__rest')).toBeNull();

      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith('style:Rock');
    });

    it('keeps every value typed with commas, Pop not Pop rock', async () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.focus(input());
      type('style:');
      type('Jazz');
      fireEvent.keyDown(input(), { key: ',' });
      type('Pop');
      await waitFor(() => expect(options()).toContainEqual(expect.stringContaining('Pop rock')));
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith('style:Jazz,Pop');
    });

    it('takes the line chosen with the arrows, and the grey rest with Tab', async () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.focus(input());
      type('style:');
      type('Rock');
      await waitFor(() => expect(options()).toContainEqual(expect.stringContaining('Rock opera')));
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith('style:"Rock opera"');

      type('style:');
      type('Ja');
      await waitFor(() => expect(screen.getByText('zz')).toBeInTheDocument());
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith('style:"Rock opera" style:Ja');
    });

    it('searches the words typed on Enter rather than opening the key they begin', () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.focus(input());
      type('comp');
      expect(screen.getByText('oser:')).toBeInTheDocument();
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith('comp');
      expect(input()).toHaveAccessibleName('Search');
    });
  });

  describe('a value between quotes', () => {
    it('keeps its commas, typed letter by letter, and leaves no quote behind', () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.focus(input());
      typeKeys('work:"Cello Concerto in B minor, Op. 104"');
      expect(input()).toHaveAccessibleName('A value of work');
      fireEvent.keyDown(input(), { key: 'Enter' });

      expect(onChange).toHaveBeenLastCalledWith('work:"Cello Concerto in B minor, Op. 104"');
      expect(pills()).toEqual(['work: Cello Concerto in B minor, Op. 104']);

      // The next filter stays a filter of its own.
      typeKeys('cd:yes ');
      expect(onChange).toHaveBeenLastCalledWith('work:"Cello Concerto in B minor, Op. 104" cd:yes');
      expect(pills()).toEqual(['work: Cello Concerto in B minor, Op. 104', 'cd: yes']);
    });

    it('goes on with another value after the closing quote and a comma', () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.focus(input());
      typeKeys('work:"B minor, Op. 104",Brandenburg');
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith('work:"B minor, Op. 104",Brandenburg');
    });

    it('is opened again between quotes, so that a letter typed does not cut it', () => {
      const onChange = vi.fn();
      render(<Harness initial={'work:"B minor, Op. 104"'} onChange={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: 'B minor, Op. 104' }));
      expect(input()).toHaveValue('"B minor, Op. 104"');
      type('"B minor, Op. 10"');
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith('work:"B minor, Op. 10"');
    });
  });

  describe('leaving a pill open', () => {
    it('closes it with its values on a click on its key, and opens the key\'s menu', () => {
      const onChange = vi.fn();
      render(<Harness initial="composer:Bach,Mozart genre:jazz" onChange={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: 'Bach' }));
      expect(input()).toHaveAccessibleName('A value of composer');

      fireEvent.click(screen.getByRole('button', { name: 'composer' }));

      expect(pills()).toEqual(['composer: Bach or Mozart', 'genre: jazz']);
      expect(screen.getByRole('menuitem', { name: 'Exclude it' })).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('closes it on a click in the field\'s empty space, keeping what was typed', () => {
      const onChange = vi.fn();
      const { container } = render(<Harness initial="genre:jazz" onChange={onChange} />);
      fireEvent.focus(input());
      type('composer:');
      type('Moz');

      fireEvent.mouseDown(container.querySelector('.search-pills__content')!);

      expect(onChange).toHaveBeenLastCalledWith('genre:jazz composer:Moz');
      expect(pills()).toEqual(['genre: jazz', 'composer: Moz']);
      expect(input()).toHaveAccessibleName('Search');
      expect(input()).toHaveFocus();
    });
  });

  it('shows the recent searches as pills', () => {
    const stored = new Map([['test-recent-pills', JSON.stringify(['-composer:Bach,Händel blue'])]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
    render(<SearchPills schema={schema} value="" onChange={() => undefined} recentKey="test-recent-pills" />);
    fireEvent.focus(input());
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const recent = within(screen.getByRole('listbox')).getAllByRole('option')[0];
    const pill = recent.querySelector('.search-pills__tok')!;
    expect(pill.querySelector('.search-pill__not')).toHaveTextContent('!');
    expect(pill.querySelector('.search-pill__key-text')).toHaveTextContent('composer');
    expect(Array.from(pill.querySelectorAll('.search-pills__tok-value')).map(v => v.textContent)).toEqual(['Bach', 'Händel']);
    expect(pill).toHaveTextContent('or');
    expect(recent).toHaveTextContent('blue');
    vi.unstubAllGlobals();
  });

  it('takes away a filter it does not know with Remove', () => {
    const onChange = vi.fn();
    render(<Harness initial="colour:blue cd:yes" onChange={onChange} />);
    expect(screen.getByRole('alert')).toHaveTextContent('colour is not a filter here.');

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Remove' }));

    expect(onChange).toHaveBeenLastCalledWith('cd:yes');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('emptying the field from the keyboard', () => {
  it('empties it all with ⌘⌫, and takes the last pill whole with ⌥⌫', () => {
    const onChange = vi.fn();
    render(<Harness initial="composer:Bach cd:yes blue" onChange={onChange} />);
    fireEvent.focus(input());
    fireEvent.keyDown(input(), { key: 'Backspace', altKey: true });
    expect(onChange).toHaveBeenLastCalledWith('composer:Bach cd:yes');
    expect(input()).toHaveValue('');
    fireEvent.keyDown(input(), { key: 'Backspace', metaKey: true });
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(pills()).toEqual([]);
  });
});

describe('guessing what a few letters name', () => {
  const albums = [
    { id: 1, label: 'Abbey Road', sub: 'The Beatles · 1969' },
    { id: 2, label: 'Beautiful Garbage', sub: 'Garbage · 2001' },
    { id: 3, label: 'Into the Beat', sub: 'Somebody' },
  ];
  const artists = ['The Beatles', 'The Beach Boys', 'Bebel Gilberto'];
  const opened: number[] = [];
  const guessing: SearchSchema = {
    section: 'guess',
    placeholder: 'Search',
    keys: [
      {
        key: 'artist', group: 'Who', type: 'text', desc: 'An artist',
        suggest: async typed => artists.filter(a => a.toLowerCase().includes(typed.toLowerCase())).map(value => ({ value })),
      },
      { key: 'title', group: 'What', type: 'text', desc: 'A title', valuesForWords: false },
    ],
    guesses: [
      { section: 'Artists', kind: 'pill', keys: ['artist'] },
      {
        section: 'Albums', kind: 'open',
        find: async typed => albums.filter(a => `${a.label} ${a.sub}`.toLowerCase().includes(typed.toLowerCase())),
        open: album => { opened.push(album.id); },
        key: 'title',
      },
    ],
  };
  const Guessing: React.FC<{ onChange?: (q: string) => void }> = ({ onChange }) => {
    const [value, setValue] = useState('');
    return <SearchPills schema={guessing} value={value} onChange={q => { setValue(q); onChange?.(q); }} />;
  };
  const ghost = () => document.querySelector('.search-pills__rest')?.textContent;

  it('puts the group holding the best guess first, the best of each first, and its name grey', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Guessing />);
      fireEvent.focus(input());
      type('bea');
      await act(async () => { vi.advanceTimersByTime(250); });
      await waitFor(() => expect(options()[0]).toContain('The Beatles'));
      const list = options();
      expect(list.findIndex(o => o?.includes('Beautiful Garbage'))).toBeGreaterThan(list.findIndex(o => o?.includes('The Beach Boys')));
      expect(list.findIndex(o => o?.includes('Into the Beat'))).toBeGreaterThan(list.findIndex(o => o?.includes('Beautiful Garbage')));
      expect(ghost()).toBe('  → The Beatles');

      type('abbey');
      await act(async () => { vi.advanceTimersByTime(250); });
      await waitFor(() => expect(options()[0]).toContain('Abbey Road'));
      expect(ghost()).toBe(' Road');
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the guess with Enter (an artist a pill, an album opened), makes a title: pill of it with Tab, keeps the letters after Esc', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onChange = vi.fn();
      render(<Guessing onChange={onChange} />);
      fireEvent.focus(input());
      type('bea');
      await act(async () => { vi.advanceTimersByTime(250); });
      await waitFor(() => expect(ghost()).toBe('  → The Beatles'));
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith('artist:"The Beatles"');

      type('abbey');
      await act(async () => { vi.advanceTimersByTime(250); });
      await waitFor(() => expect(ghost()).toBe(' Road'));
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(opened).toEqual([1]);
      expect(onChange).toHaveBeenLastCalledWith('artist:"The Beatles" abbey');

      // ↓ shows the menu again, the letters still there.
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
      await act(async () => { vi.advanceTimersByTime(250); });
      await waitFor(() => expect(ghost()).toBe(' Road'));
      fireEvent.keyDown(input(), { key: 'Tab' });
      expect(input()).toHaveValue('');
      expect(onChange).toHaveBeenLastCalledWith('artist:"The Beatles" title:"Abbey Road"');
      expect(opened).toEqual([1]);

      type('beau');
      await act(async () => { vi.advanceTimersByTime(250); });
      await waitFor(() => expect(ghost()).toBe('tiful Garbage'));
      fireEvent.keyDown(input(), { key: 'Escape' });
      expect(ghost()).toBeUndefined();
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith('artist:"The Beatles" title:"Abbey Road" beau');
      expect(opened).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
