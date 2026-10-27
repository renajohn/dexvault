import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Dialog from './Dialog';
import { ConfirmHost, confirm, resetConfirm } from './ConfirmDialog';

afterEach(() => resetConfirm());

describe('Dialog', () => {
  it('heads itself with its icon, title, aside, ‹ › and ✕, and leaves before it tells', async () => {
    const onClose = vi.fn();
    const onNext = vi.fn();
    render(
      <Dialog onClose={onClose} icon={<svg data-testid="icon" />} title="This Is the Life" aside={<span>A-3</span>}
        steps={{ onPrevious: null, onNext, noun: 'album' }}>
        <Dialog.Body>Tracks</Dialog.Body>
        <Dialog.Footer><button type="button">Play</button></Dialog.Footer>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'This Is the Life' });
    expect(dialog).toHaveTextContent('A-3');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous album' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next album' }));
    expect(onNext).toHaveBeenCalled();
    expect(dialog.querySelector('.dialog-foot')).toHaveTextContent('Play');
    // It slides or fades out first, then tells.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('offers ← back when it has a view to go back to', () => {
    const onBack = vi.fn();
    render(<Dialog onClose={vi.fn()} onBack={onBack} title="Edit Book: Heat"><Dialog.Body>Form</Dialog.Body></Dialog>);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('as a sheet, comes with a handle: pulled down a little it stays, pulled far or tapped it closes', async () => {
    const onClose = vi.fn();
    render(<Dialog variant="sheet" onClose={onClose} title="Links"><Dialog.Body>MusicBrainz</Dialog.Body></Dialog>);

    const sheet = screen.getByRole('dialog', { name: 'Links' });
    expect(sheet).toHaveClass('dialog--sheet');
    const handle = screen.getByRole('button', { name: 'Pull down to close' });

    fireEvent.touchStart(handle, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(handle, { touches: [{ clientY: 130 }] });
    fireEvent.touchEnd(handle);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.touchStart(handle, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(handle, { touches: [{ clientY: 300 }] });
    fireEvent.touchEnd(handle);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('as a sheet, closes on a tap of its handle', async () => {
    const onClose = vi.fn();
    render(<Dialog variant="sheet" onClose={onClose} title="Links"><Dialog.Body>MusicBrainz</Dialog.Body></Dialog>);
    fireEvent.click(screen.getByRole('button', { name: 'Pull down to close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('as a question to answer, has no ✕', () => {
    render(<Dialog modal onClose={vi.fn()} title="Restoring…"><Dialog.Body>Wait</Dialog.Body></Dialog>);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });
});

describe('confirm()', () => {
  it('asks in DexVault’s own dialog and answers yes', async () => {
    render(<ConfirmHost />);
    let answer: Promise<boolean>;
    act(() => { answer = confirm({ title: 'Delete “Heat”?', message: 'It goes for good.', confirmLabel: 'Delete', danger: true }); });

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete “Heat”?' });
    expect(dialog).toHaveTextContent('It goes for good.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await expect(answer!).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('answers no on Cancel', async () => {
    render(<ConfirmHost />);
    let answer: Promise<boolean>;
    act(() => { answer = confirm({ title: 'Clean up temporary files?' }); });

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await expect(answer!).resolves.toBe(false);
  });
});
