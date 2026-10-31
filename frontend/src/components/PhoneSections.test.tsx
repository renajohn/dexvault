import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PhoneSections from './PhoneSections';

const sections = [
  { value: 'filmdex', icon: <svg data-testid="film" />, label: 'FilmDex' },
  { value: 'musicdex', icon: <svg data-testid="disc" />, label: 'MusicDex' },
  { value: 'analytics', icon: <svg data-testid="chart" />, label: 'Analytics' },
];

const strip = () => screen.getByRole('radiogroup', { name: 'Collections', hidden: true });

describe('PhoneSections', () => {
  it('shows the section in its button, the strip shut', () => {
    render(<PhoneSections sections={sections} value="musicdex" onChange={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'MusicDex: the sections' });

    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.querySelector('[data-testid="disc"]')).not.toBeNull();
    expect(strip()).toHaveAttribute('inert');
  });

  it('opens into every section and ⚙︎, and closes once one is chosen', () => {
    const onChange = vi.fn();
    render(<PhoneSections sections={sections} value="musicdex" onChange={onChange}
      tools={() => <button type="button">Menu</button>} />);

    fireEvent.click(screen.getByRole('button', { name: 'MusicDex: the sections' }));
    expect(strip()).not.toHaveAttribute('inert');
    expect(screen.getByRole('radio', { name: 'MusicDex' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Analytics' }));
    expect(onChange).toHaveBeenCalledWith('analytics');
    expect(strip()).toHaveAttribute('inert');
  });

  it('closes on a touch beside it, a scroll or Escape, not on a touch in a menu', () => {
    render(<>
      <PhoneSections sections={sections} value="filmdex" onChange={vi.fn()} />
      <div className="menu"><button type="button">In a menu</button></div>
      <p>Beside</p>
    </>);
    const button = screen.getByRole('button', { name: 'FilmDex: the sections' });
    const opened = () => button.getAttribute('aria-expanded') === 'true';

    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByText('In a menu'));
    expect(opened()).toBe(true);
    fireEvent.pointerDown(screen.getByText('Beside'));
    expect(opened()).toBe(false);

    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(opened()).toBe(false);

    fireEvent.click(button);
    fireEvent.scroll(window);
    expect(opened()).toBe(false);
  });

  it('shows its rest icon where no section is (Backups)', () => {
    render(<PhoneSections sections={sections} value={null} onChange={vi.fn()} restIcon={<svg data-testid="gear" />} />);
    expect(screen.getByRole('button', { name: 'The sections' }).querySelector('[data-testid="gear"]')).not.toBeNull();
  });
});
