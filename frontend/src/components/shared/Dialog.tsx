import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Modal, type ModalProps } from 'react-bootstrap';
import { BsArrowLeft, BsX } from 'react-icons/bs';
import { IconButton } from './Button';
import DetailSteps from './DetailSteps';
import './dialog.css';

type Step = (() => void) | null | undefined;

export interface DialogHeaderProps {
  /** What the dialog is about; a long one ends in "…". */
  title: React.ReactNode;
  /** Before the title: what kind of thing it is (a disc, a film, a book). */
  icon?: React.ReactNode;
  /** After the title, what tells it apart: its shelf, its marks. */
  aside?: React.ReactNode;
  /** ‹ › to the item before or after on the page, when there is one. */
  steps?: { onPrevious: Step; onNext: Step; noun: string };
  /** ✕; none for a confirmation, which is answered rather than closed. */
  onClose?: () => void;
  /** ← before the icon: back to the view this one was opened from. */
  onBack?: () => void;
  titleId?: string;
  className?: string;
}

/**
 * The head of every dialog of DexVault, as an album's card first had it: the
 * icon, the title, what tells it apart, ‹ ›, ✕, over a line.
 */
export const DialogHeader: React.FC<DialogHeaderProps> = ({ title, icon, aside, steps, onClose, onBack, titleId, className }) => (
  <div className={`dialog-head${className ? ` ${className}` : ''}`}>
    {onBack && <IconButton label="Back" className="dialog-head__back" onClick={onBack}><BsArrowLeft /></IconButton>}
    {icon && <span className="dialog-head__icon" aria-hidden="true">{icon}</span>}
    <h2 className="dialog-title" id={titleId}>{title}</h2>
    {aside && <span className="dialog-head__aside">{aside}</span>}
    {steps && <DetailSteps onPrevious={steps.onPrevious} onNext={steps.onNext} noun={steps.noun} className="dialog-head__steps" />}
    {onClose && <IconButton label="Close" className="dialog-head__close" onClick={onClose}><BsX /></IconButton>}
  </div>
);

export interface DialogProps extends Omit<DialogHeaderProps, 'titleId' | 'className'> {
  show?: boolean;
  /** Esc, ✕, a click beside it. */
  onClose: () => void;
  /** sm a question, md a form, lg a search or a long form. */
  size?: 'sm' | 'md' | 'lg';
  /** center: a form or a question; panel: a record's card along the right edge. */
  variant?: 'center' | 'panel';
  /**
   * The whole screen below this width: a panel below lg, where it becomes the
   * panel along the right edge, never a box in between; a large dialog below md.
   */
  fullscreen?: 'sm' | 'md' | 'lg' | false;
  /** A question to answer: neither a click beside it nor ✕ closes it. */
  modal?: boolean;
  scrollable?: boolean;
  zIndex?: number;
  className?: string;
  backdropClassName?: string;
  /** In place of the standard head: a dialog whose head says more than a title. */
  header?: React.ReactNode;
  role?: 'dialog' | 'alertdialog';
  describedBy?: string;
  onEntered?: () => void;
  /** What else react-bootstrap's Modal should be told: its focus, say. */
  modalProps?: Partial<ModalProps>;
  children: React.ReactNode;
}

/**
 * The one dialog of DexVault (dialog.css), on react-bootstrap's Modal for the
 * focus, Esc and the page that stops scrolling. Its body and foot are
 * Dialog.Body and Dialog.Footer.
 */
/** Closes the dialog holding it as its ✕ does: it leaves first, sliding or fading out, then tells. */
const DialogClose = createContext<() => void>(() => undefined);
export const useDialogClose = () => useContext(DialogClose);

const DialogRoot: React.FC<DialogProps> = ({
  show = true, onClose, size = 'md', variant = 'center', fullscreen, modal = false, scrollable, zIndex, className, backdropClassName,
  title, icon, aside, steps, onBack, header, role = 'dialog', describedBy, onEntered, modalProps, children,
}) => {
  const titleId = useId();
  const panel = variant === 'panel';
  const full = fullscreen ?? (panel ? 'lg' : size === 'lg' ? 'md' : false);
  // Asked to close, it leaves on its own first: the page that holds it may take it away at once,
  // and a panel would vanish rather than slide out. Once it has left, the page is told.
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => { leavingRef.current = true; setLeaving(true); }, []);
  const left = useCallback(() => {
    if (!leavingRef.current) return;
    leavingRef.current = false;
    setLeaving(false);
    onCloseRef.current();
  }, []);
  // Should its exit never tell it is done (a transition that does not end), it is over all the same:
  // a dialog left on the page, unseen, would keep the page from scrolling.
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(left, 600);
    return () => window.clearTimeout(timer);
  }, [leaving, left]);
  // Closed by the page that holds it (Add this book), it leaves the same way: should its fade never end
  // (Safari), it is taken off the page, rather than staying over it, unseen, catching every click.
  const [present, setPresent] = useState(show);
  useEffect(() => {
    if (show) { setPresent(true); return undefined; }
    const timer = window.setTimeout(() => setPresent(false), 700);
    return () => window.clearTimeout(timer);
  }, [show]);
  if (!present && !show) return null;
  return (
    <DialogClose.Provider value={close}>
    <Modal
      show={show && !leaving}
      onHide={close}
      onExited={left}
      onEntered={onEntered}
      // react-bootstrap gives a role prop to its inner box: an alert dialog is the outer one that bears the title.
      onEnter={(node: HTMLElement) => {
        if (role !== 'dialog') node.setAttribute('role', role);
        // A record's card sets every .modal's z-index !important (MusicDetailCard.css): a z-index asked for, over the
        // phone's player say, must be as firm to win.
        if (zIndex) node.style.setProperty('z-index', String(zIndex), 'important');
      }}
      centered
      size={size === 'md' ? undefined : size}
      fullscreen={full ? `${full}-down` as 'md-down' : undefined}
      scrollable={scrollable}
      backdrop={modal ? 'static' : true}
      style={zIndex ? { zIndex } : undefined}
      className={['dialog', `dialog--${variant}`, `dialog--${size}`, panel && 'side-panel-modal', className].filter(Boolean).join(' ')}
      backdropClassName={[panel && 'side-panel-backdrop', backdropClassName].filter(Boolean).join(' ') || undefined}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      {...modalProps}
    >
      {header ?? (
        <DialogHeader title={title} icon={icon} aside={aside} steps={steps} onBack={onBack} onClose={modal ? undefined : close} titleId={titleId} />
      )}
      {children}
    </Modal>
    </DialogClose.Provider>
  );
};

interface PartProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

const Body = React.forwardRef<HTMLDivElement, PartProps>(({ className, ...rest }, ref) => (
  <Modal.Body ref={ref} className={`dialog-body${className ? ` ${className}` : ''}`} {...rest} />
));
Body.displayName = 'Dialog.Body';

/** The dialog's actions: what it is for on the right, in gold; others before it. */
const Footer: React.FC<PartProps> = ({ className, ...rest }) => (
  <Modal.Footer className={`dialog-foot${className ? ` ${className}` : ''}`} {...rest} />
);

const Dialog = Object.assign(DialogRoot, { Body, Footer });

export default Dialog;
