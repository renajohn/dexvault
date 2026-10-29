import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipHost } from './Tooltip';

const point = (element: Element, type: 'pointerover' | 'pointerout', relatedTarget: Element | null = null) =>
  fireEvent(element, Object.assign(new Event(type, { bubbles: true }), { pointerType: 'mouse', relatedTarget }));

describe('TooltipHost', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the title in its own bubble a moment after the pointer comes, and puts it back as the pointer leaves', () => {
    render(<><TooltipHost /><button title="Play the album">▶</button><p>beside</p></>);
    const button = screen.getByRole('button');

    point(button, 'pointerover');
    // The system's tooltip has nothing to show while ours waits.
    expect(button).not.toHaveAttribute('title');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Play the album');

    point(button, 'pointerout', screen.getByText('beside'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Play the album');
  });

  it('shows just under the pointer, where it stopped, as the system would', () => {
    render(<><TooltipHost /><button title="Sort">↕</button></>);
    const button = screen.getByRole('button');

    fireEvent(button, Object.assign(new Event('pointerover', { bubbles: true }), { pointerType: 'mouse', clientX: 100, clientY: 50 }));
    fireEvent(button, Object.assign(new Event('pointermove', { bubbles: true }), { pointerType: 'mouse', clientX: 120, clientY: 52 }));
    act(() => { vi.advanceTimersByTime(250); });

    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '124px', top: '70px' });
  });

  it('shows none inside a part that turned its tooltips off, nor the system tooltip', () => {
    render(<><TooltipHost /><div data-tooltip-off><button title="Remove">✕</button></div></>);
    const button = screen.getByRole('button');

    point(button, 'pointerover');
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button).not.toHaveAttribute('title');
  });

  it('shows none for a focus given after a finger touched (a menu opened by a slide), one for the keyboard’s', () => {
    render(<><TooltipHost /><button title="Add to Running">Running</button><button>other</button></>);
    const [entry, other] = screen.getAllByRole('button');
    const press = (pointerType: string) => fireEvent(document, Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType }));

    press('touch');
    act(() => { entry.focus(); vi.advanceTimersByTime(600); });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => { other.focus(); });
    fireEvent.keyDown(document, { key: 'Tab' });
    act(() => { entry.focus(); vi.advanceTimersByTime(600); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Add to Running');
  });

  it('puts it away when a key is typed, but not for Tab or a modifier', () => {
    render(<><TooltipHost /><button title="Sort">↕</button></>);
    const button = screen.getByRole('button');
    point(button, 'pointerover');
    act(() => { vi.advanceTimersByTime(250); });

    fireEvent.keyDown(document, { key: 'Shift' });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'c' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the next one at once after one has just gone', () => {
    render(<><TooltipHost /><button title="One">1</button><button title="Two">2</button></>);
    const [one, two] = screen.getAllByRole('button');

    point(one, 'pointerover');
    act(() => { vi.advanceTimersByTime(250); });
    point(one, 'pointerout', two);
    point(two, 'pointerover');

    expect(screen.getByRole('tooltip')).toHaveTextContent('Two');
    expect(one).toHaveAttribute('title', 'One');
  });

  it('takes the new words when the title changes under the pointer', async () => {
    const { rerender } = render(<><TooltipHost /><button title="Add to Listen Next">+</button></>);
    const button = screen.getByRole('button');
    point(button, 'pointerover');
    act(() => { vi.advanceTimersByTime(250); });

    rerender(<><TooltipHost /><button title="In Listen Next">+</button></>);
    await act(async () => { await Promise.resolve(); });

    expect(button).not.toHaveAttribute('title');
    expect(screen.getByRole('tooltip')).toHaveTextContent('In Listen Next');
  });

  it('goes away at a click, and does not come back until the pointer has left', () => {
    render(<><TooltipHost /><button title="Delete">x</button></>);
    const button = screen.getByRole('button');
    point(button, 'pointerover');
    act(() => { vi.advanceTimersByTime(250); });

    fireEvent.pointerDown(button);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button).not.toHaveAttribute('title');
  });

  it('says nothing for a touch', () => {
    render(<><TooltipHost /><button title="Play">▶</button></>);
    const button = screen.getByRole('button');
    fireEvent(button, Object.assign(new Event('pointerover', { bubbles: true }), { pointerType: 'touch' }));
    act(() => { vi.advanceTimersByTime(1000); });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Play');
  });
});
