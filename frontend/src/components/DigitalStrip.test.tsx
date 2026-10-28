import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DigitalChips } from './DigitalStrip';

const phone = (narrow: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: narrow && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));

describe('DigitalChips', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says Buy and its count on a wide screen', () => {
    phone(false);
    render(<DigitalChips filter="all" onFilter={() => {}} counts={{ all: 9, buy: 4 }} />);
    expect(screen.getByRole('button').textContent).toBe('Buy4');
  });

  it('on a phone, is its cart and its count, Buy in its name', () => {
    phone(true);
    render(<DigitalChips filter="all" onFilter={() => {}} counts={{ all: 9, buy: 4 }} />);
    const chip = screen.getByRole('button', { name: 'Buy, 4' });
    expect(chip.textContent).toBe('4');
    expect(chip.getAttribute('title')).toBe('Buy');
  });

  it('is left out with nothing to buy', () => {
    phone(true);
    const { container } = render(<DigitalChips filter="all" onFilter={() => {}} counts={{ all: 9, buy: 0 }} />);
    expect(container.textContent).toBe('');
  });
});
