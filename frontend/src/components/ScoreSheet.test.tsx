import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScoreSheet from './ScoreSheet';

const props = (over: Partial<React.ComponentProps<typeof ScoreSheet>> = {}): React.ComponentProps<typeof ScoreSheet> => ({
  id: 7,
  title: 'Album für die Jugend',
  composer: 'Robert Schumann',
  edition: ['G. Henle Verlag', 'HN 383', 'Henle level 3'],
  reference: 'HN 383',
  code: '9790201803838',
  cover: '/api/images/book/jugend.jpg',
  borrowed: false,
  hasPdf: false,
  imslpPage: null,
  heard: 12,
  total: 43,
  about: <p>For his daughter Marie.</p>,
  pieces: <p>The pieces</p>,
  pieceCount: 43,
  onAddPiece: vi.fn(),
  notes: <p>No note yet.</p>,
  noteCount: 0,
  onAddNote: vi.fn(),
  facts: [['Publisher', 'G. Henle Verlag'], ['Number', 'HN 383'], ['Paid', null]],
  editing: false,
  editionForm: <p>The form</p>,
  onEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  writing: false,
  onShowCover: vi.fn(),
  coverShown: false,
  onHideCover: vi.fn(),
  onPdf: vi.fn(),
  onImslp: vi.fn(),
  onHenle: null,
  onAttach: vi.fn(),
  onDelete: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

describe('ScoreSheet', () => {
  it('heads it with the piece, its composer and its edition', () => {
    const { container } = render(<ScoreSheet {...props()} />);
    expect(container.querySelector('.phone-sheet-head__title')).toHaveTextContent('Album für die Jugend');
    expect(screen.getByText('Robert Schumann')).toBeInTheDocument();
    expect(screen.getByText('G. Henle Verlag · HN 383')).toBeInTheDocument();
  });

  it('puts its number on its cover, and what plays it under', () => {
    const { container } = render(<ScoreSheet {...props()} />);
    expect(container.querySelector('.score-sheet-cover__tags')).toHaveTextContent('HN 383');
    expect(screen.getByText('♪ 12 of 43')).toBeInTheDocument();
  });

  it('names its tabs Score, Pieces and Owned, or Borrowed', () => {
    const { unmount } = render(<ScoreSheet {...props()} />);
    expect(screen.getAllByRole('tab').map(tab => tab.textContent?.replace(/\d+$/, ''))).toEqual(['Score', 'Pieces', 'Owned']);
    unmount();
    render(<ScoreSheet {...props({ borrowed: true })} />);
    expect(screen.getByRole('tab', { name: 'Borrowed' })).toBeInTheDocument();
  });

  it('shows its edition as facts, leaving out those it has none of', () => {
    render(<ScoreSheet {...props()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Owned' }));
    expect(screen.getByText('Number')).toBeInTheDocument();
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
  });

  it('opens the PDF from its cover when it has one', () => {
    const onPdf = vi.fn();
    render(<ScoreSheet {...props({ hasPdf: true, onPdf })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the PDF' }));
    expect(onPdf).toHaveBeenCalled();
  });

  it('cancels its edition being changed at Escape, rather than closing', () => {
    const onCancelEdit = vi.fn();
    const onClose = vi.fn();
    render(<ScoreSheet {...props({ editing: true, onCancelEdit, onClose })} />);
    expect(screen.getByText('The form')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancelEdit).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes its cover shown whole at Escape, not the sheet', () => {
    const onHideCover = vi.fn();
    const onClose = vi.fn();
    render(<ScoreSheet {...props({ coverShown: true, onHideCover, onClose })} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onHideCover).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
