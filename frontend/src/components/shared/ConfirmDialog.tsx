import React, { useEffect, useId, useState } from 'react';
import { BsExclamationTriangle, BsTrash } from 'react-icons/bs';
import Dialog from './Dialog';
import Button from './Button';

export interface ConfirmOptions {
  /** The question: "Delete “Heat”?". */
  title: string;
  /** What follows from yes, in a sentence or two. */
  message?: React.ReactNode;
  /** The answer that does it: "Delete". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** It cannot be undone: red, a bin, and never gold. */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (yes: boolean) => void;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach(listener => listener());

/**
 * Asks, in DexVault's own dialog rather than the browser's: true for yes.
 * The ConfirmHost mounted once in the app shows it.
 */
export const confirm = (options: ConfirmOptions): Promise<boolean> =>
  new Promise(resolve => {
    pending?.resolve(false);
    pending = { ...options, resolve };
    tell();
  });

const answer = (yes: boolean) => {
  const asked = pending;
  pending = null;
  tell();
  asked?.resolve(yes);
};

/** The questions confirm() asks, once in the app. */
export const ConfirmHost: React.FC = () => {
  const [, redraw] = useState(0);
  const messageId = useId();
  useEffect(() => {
    const listener = () => redraw(n => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  if (!pending) return null;
  return <ConfirmDialog {...pending} messageId={messageId} onAnswer={answer} />;
};

interface ConfirmDialogProps extends ConfirmOptions {
  onAnswer: (yes: boolean) => void;
  messageId?: string;
  loading?: boolean;
}

/** A question: Cancel, and the answer that does it, red when it cannot be undone. Esc says no. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, onAnswer, messageId, loading = false,
}) => (
  <Dialog
    size="sm"
    modal
    role="alertdialog"
    zIndex={12000}
    // Its shade over all, a full screen record (10100) too: a page's card sets every backdrop under it.
    backdropClassName="over-player-backdrop"
    describedBy={message ? messageId : undefined}
    onClose={() => onAnswer(false)}
    title={title}
    icon={danger ? <BsTrash className="dialog-confirm__danger" /> : <BsExclamationTriangle />}
    className="dialog-confirm"
  >
    {message && <Dialog.Body id={messageId}>{message}</Dialog.Body>}
    <Dialog.Footer>
      <span style={{ flex: 1 }} />
      <Button variant="quiet" onClick={() => onAnswer(false)} autoFocus={danger}>{cancelLabel}</Button>
      <Button variant={danger ? 'danger' : 'primary'} icon={danger ? <BsTrash /> : undefined} loading={loading}
        onClick={() => onAnswer(true)} autoFocus={!danger}>
        {confirmLabel}
      </Button>
    </Dialog.Footer>
  </Dialog>
);

/** For tests: no question waiting. */
export const resetConfirm = () => { pending = null; tell(); };
