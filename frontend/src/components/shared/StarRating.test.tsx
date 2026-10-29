import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import StarRating, { DIAL_STEP_PX, halfTone } from './StarRating';

/** A star 20 px wide at x = 0: a click at 5 px is its left half, at 15 px its right one. */
const box = (star: HTMLElement) => {
  star.getBoundingClientRect = () => ({ left: 0, width: 20, top: 0, height: 20, right: 20, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
  return star;
};

describe('StarRating', () => {
  it('gives a whole star with its right half, a half with its left', () => {
    const onChange = vi.fn();
    render(<StarRating value={null} onChange={onChange} />);

    fireEvent.click(box(screen.getByRole('button', { name: '4 stars' })), { clientX: 15 });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent.click(box(screen.getByRole('button', { name: '4 stars' })), { clientX: 5 });
    expect(onChange).toHaveBeenLastCalledWith(3.5);
  });

  it('takes the stars away with a click on those given', () => {
    const onChange = vi.fn();
    render(<StarRating value={3.5} onChange={onChange} />);

    const fourth = screen.getByRole('button', { name: '4 stars' });
    expect(fourth).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group')).toHaveAttribute('aria-label', 'Your rating: 3.5 stars');
    fireEvent.click(box(fourth), { clientX: 5 });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('never takes the focus, so the arrows still go from one record to the next', () => {
    render(<StarRating value={2} onChange={() => {}} />);
    screen.getAllByRole('button').forEach(star => expect(star).toHaveAttribute('tabindex', '-1'));
  });

  it('keeps the gold for the stars given, under the pointer as well', () => {
    // 3.5 given, the pointer on 4.5: seven halves gold, two white, one empty.
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(h => halfTone(h, 3.5, 4.5)))
      .toEqual(['given', 'given', 'given', 'given', 'given', 'given', 'given', 'adding', 'adding', null]);
    // The pointer on 2: what a click takes away goes pale.
    expect([4, 5, 7, 8].map(h => halfTone(h, 3.5, 2))).toEqual(['given', 'leaving', 'leaving', null]);
  });
});

/** The halves the dial fills, in gold or in the grey of its first 3. */
const dialHalves = (tone: 'given' | 'seed') => document.querySelectorAll(`.ui-star-dial .ui-star__${tone}`).length;

/** A finger on the stars, at height `y`. */
const finger = (element: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', y: number) =>
  fireEvent(element, Object.assign(new Event(type, { bubbles: true }), { pointerType: 'touch', pointerId: 1, clientY: y, clientX: 0 }));

describe('StarRating under a finger: the dial', () => {
  it('goes up by halves as the finger goes up, from the stars given, and gives them let go', () => {
    const onChange = vi.fn();
    render(<StarRating value={3.5} onChange={onChange} />);
    const stars = screen.getByRole('group');

    finger(stars, 'pointerdown', 300);
    finger(stars, 'pointermove', 300 - DIAL_STEP_PX * 2);
    expect(dialHalves('given')).toBe(9);
    finger(stars, 'pointerup', 300 - DIAL_STEP_PX * 2);
    expect(onChange).toHaveBeenCalledWith(4.5);
    expect(document.querySelector('.ui-star-dial')).toBeNull();
    // The click that follows is the finger's: it changes nothing more.
    fireEvent.click(box(screen.getByRole('button', { name: '1 star' })), { clientX: 15 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('starts from 3, grey, on a record of no stars, gold once the finger moves; down to none, never round to 5', () => {
    const onChange = vi.fn();
    render(<StarRating value={null} onChange={onChange} />);
    const stars = screen.getByRole('group');

    finger(stars, 'pointerdown', 300);
    expect(dialHalves('seed')).toBe(6);
    expect(dialHalves('given')).toBe(0);
    finger(stars, 'pointermove', 300 + DIAL_STEP_PX * 3);
    expect(dialHalves('given')).toBe(3);
    expect(dialHalves('seed')).toBe(0);
    finger(stars, 'pointermove', 300 + DIAL_STEP_PX * 20);
    expect(dialHalves('given')).toBe(0);
    expect(document.querySelector('.ui-star-dial')).not.toBeNull();
    finger(stars, 'pointermove', 300 + DIAL_STEP_PX * 2);
    finger(stars, 'pointerup', 300 + DIAL_STEP_PX * 2);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('gives 3 to a record of no stars, the finger moved and back on it; nothing let go on none', () => {
    const onChange = vi.fn();
    render(<StarRating value={null} onChange={onChange} />);
    const stars = screen.getByRole('group');

    finger(stars, 'pointerdown', 300);
    finger(stars, 'pointermove', 300 - DIAL_STEP_PX);
    finger(stars, 'pointermove', 302);
    expect(dialHalves('given')).toBe(6);
    finger(stars, 'pointerup', 302);
    expect(onChange).toHaveBeenCalledWith(3);

    finger(stars, 'pointerdown', 300);
    finger(stars, 'pointermove', 300 + DIAL_STEP_PX * 8);
    finger(stars, 'pointerup', 300 + DIAL_STEP_PX * 8);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('turns from the half nearest stars given of another time (a book’s 4.2)', () => {
    const onChange = vi.fn();
    render(<StarRating value={4.2} onChange={onChange} />);
    const stars = screen.getByRole('group');
    finger(stars, 'pointerdown', 300);
    expect(dialHalves('given')).toBe(8);
    finger(stars, 'pointermove', 300 - DIAL_STEP_PX);
    finger(stars, 'pointerup', 300 - DIAL_STEP_PX);
    expect(onChange).toHaveBeenCalledWith(4.5);
    // Back on its 4, the 4.2 stays.
    finger(stars, 'pointerdown', 300);
    finger(stars, 'pointermove', 300 - DIAL_STEP_PX);
    finger(stars, 'pointermove', 300);
    finger(stars, 'pointerup', 300);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('gives nothing back where it started, nor for a mere touch, which shows the dial a moment', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(<StarRating value={4} onChange={onChange} />);
      const stars = screen.getByRole('group');

      finger(stars, 'pointerdown', 300);
      finger(stars, 'pointermove', 300 - DIAL_STEP_PX * 2);
      finger(stars, 'pointermove', 302);
      finger(stars, 'pointerup', 302);
      expect(onChange).not.toHaveBeenCalled();

      finger(stars, 'pointerdown', 300);
      finger(stars, 'pointerup', 300);
      expect(onChange).not.toHaveBeenCalled();
      expect(document.querySelector('.ui-star-dial__hint')).toHaveTextContent('Slide up or down');
      act(() => { vi.advanceTimersByTime(1500); });
      expect(document.querySelector('.ui-star-dial')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
