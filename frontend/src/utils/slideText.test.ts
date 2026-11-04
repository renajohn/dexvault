import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSlideText } from './slideText';

/** A field 200 px wide holding 500 px of words, its scroll kept as a browser would. */
const longField = () => {
  const field = document.createElement('input');
  document.body.appendChild(field);
  let left = 0;
  Object.defineProperty(field, 'scrollWidth', { configurable: true, get: () => 500 });
  Object.defineProperty(field, 'clientWidth', { configurable: true, get: () => 200 });
  Object.defineProperty(field, 'scrollLeft', {
    configurable: true,
    get: () => left,
    set: (value: number) => { left = Math.max(0, Math.min(300, value)); },
  });
  return field;
};

const finger = (field: HTMLElement, type: string, x: number, y = 10) => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  const touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(event, 'touches', { value: touches });
  field.dispatchEvent(event);
  return event;
};

describe('useSlideText', () => {
  let field: HTMLInputElement;
  beforeEach(() => {
    vi.useFakeTimers();
    field = longField();
  });
  afterEach(() => {
    vi.useRealTimers();
    field.remove();
  });

  it('slides the words toward their end once rested', () => {
    renderHook(() => useSlideText({ current: field }, 'a long prompt'));
    expect(field.scrollLeft).toBe(0);
    vi.advanceTimersByTime(1800 + 1000);
    expect(field.scrollLeft).toBeGreaterThan(20);
  });

  it('follows a finger slid along them, without a tap, and goes on from there', () => {
    renderHook(() => useSlideText({ current: field }, 'a long prompt'));
    finger(field, 'touchstart', 150);
    expect(finger(field, 'touchmove', 145).defaultPrevented).toBe(false);  // not yet a drag
    expect(finger(field, 'touchmove', 50).defaultPrevented).toBe(true);
    expect(field.scrollLeft).toBe(100);
    // Held, the words do not slide under the finger.
    vi.advanceTimersByTime(5000);
    expect(field.scrollLeft).toBe(100);
    // Lifted, no tap: the field is not focused.
    expect(finger(field, 'touchend', 50).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(2900);
    expect(field.scrollLeft).toBe(100);
    vi.advanceTimersByTime(1000);
    expect(field.scrollLeft).toBeGreaterThan(100);
  });

  it('leaves a tap and an upward slide to the system', () => {
    renderHook(() => useSlideText({ current: field }, 'a long prompt'));
    finger(field, 'touchstart', 150);
    expect(finger(field, 'touchend', 150).defaultPrevented).toBe(false);
    finger(field, 'touchstart', 150, 100);
    expect(finger(field, 'touchmove', 148, 60).defaultPrevented).toBe(false);
    expect(finger(field, 'touchmove', 100, 20).defaultPrevented).toBe(false);
    expect(field.scrollLeft).toBe(0);
  });

  it('takes the words where a trackpad left them', () => {
    renderHook(() => useSlideText({ current: field }, 'a long prompt'));
    field.scrollLeft = 250;
    field.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(2900);
    expect(field.scrollLeft).toBe(250);
    vi.advanceTimersByTime(1000);
    expect(field.scrollLeft).toBeGreaterThan(250);
  });
});
