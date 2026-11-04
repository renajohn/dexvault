import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../../services/musicService', () => ({
  default: { getAutocompleteSuggestions: vi.fn(async () => []), searchAlbums: vi.fn(async () => []), getImageUrl: vi.fn(() => null) },
}));

import SearchPills from '../SearchPills';
import { MOODS, STYLES } from '../../../../services/radioService';
import { canonicalQuery, findKey, parseNumber, parseToken } from '../query';
import { musicSchema } from './music';

const { keys } = musicSchema;

const Harness: React.FC<{ initial?: string; onChange?: (q: string) => void }> = ({ initial = '', onChange }) => {
  const [value, setValue] = useState(initial);
  return <SearchPills schema={musicSchema} value={value} onChange={q => { setValue(q); onChange?.(q); }} />;
};

const input = () => screen.getByRole('combobox');
const options = () => within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent || '');

describe('MusicDex’s words of how a song sounds', () => {
  it('offer the radio’s closed lists of moods and styles, the three tempos and the energy from 0 to 10', () => {
    expect(findKey('mood', keys)?.values?.map(v => v.value)).toEqual([...MOODS]);
    expect(findKey('style', keys)?.values?.map(v => v.value)).toEqual([...STYLES]);
    expect(findKey('tempo', keys)?.values?.map(v => v.value)).toEqual(['slow', 'mid', 'fast']);
    for (const s of findKey('energy', keys)?.shortcuts || []) {
      const n = parseNumber(s.value);
      expect(n, s.value).not.toBeNull();
      expect(s.value.split('-').every(v => Number(v) >= 0 && Number(v) <= 10), s.value).toBe(true);
    }
    for (const key of ['mood', 'style', 'energy', 'tempo']) expect(findKey(key, keys)?.group).toBe('How it sounds');
  });

  it('are written as the backend reads them: listed spellings, commas, - for not', () => {
    expect(canonicalQuery('!mood:MELANCHOLIC,Dark style:R&B energy:7-10 tempo:Fast piano', keys))
      .toBe('-mood:melancholic,dark style:r&b energy:7-10 tempo:fast piano');
  });

  it('say a mood the list has not, and mend one a letter off', () => {
    const t = parseToken('mood:melancolic', keys);
    expect(t.error?.fixLabel).toBe('Use mood:melancholic');
    expect(parseToken('tempo:slowly', keys).error).toBeTruthy();
    expect(parseToken('style:hard-rock', keys).error).toBeUndefined();
  });

  it('open a pill on mood: with the moods to choose, the letters typed narrowing them', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'mood:' } });
    expect(input()).toHaveAccessibleName('A value of mood');
    expect(options()).toEqual(expect.arrayContaining(['driving', 'melancholic', 'cinematic'].map(m => expect.stringContaining(m))));
    fireEvent.change(input(), { target: { value: 'melan' } });
    expect(options()).toEqual([expect.stringContaining('melancholic')]);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option'));
    expect(onChange).toHaveBeenLastCalledWith('mood:melancholic');
    expect(screen.queryAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['mood: melancholic']);
  });
});
