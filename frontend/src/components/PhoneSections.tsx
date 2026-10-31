import React, { useEffect, useRef, useState } from 'react';
import './PhoneSections.css';

export interface PhoneSection {
  value: string;
  icon: React.ReactNode;
  label: string;
}

interface PhoneSectionsProps {
  sections: PhoneSection[];
  /** The section shown; none (Backups) shows the last entry's icon, `restIcon`. */
  value: string | null;
  onChange: (value: string) => void;
  /** Shown on the button when no section is: ⚙︎ under Backups. */
  restIcon?: React.ReactNode;
  /** The ⚙︎ at the end of the strip, told when to close it: `close()` once its menu is done. */
  tools?: (close: () => void) => React.ReactNode;
}

/**
 * On a phone, the app's sections in one button beside the search: it shows
 * the section in gold; touched, it opens into a strip over the search, every
 * section and ⚙︎, and closes once one is chosen, or on a touch beside it, a
 * scroll or Escape.
 */
const PhoneSections: React.FC<PhoneSectionsProps> = ({ sections, value, onChange, restIcon, tools }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return undefined;
    const away = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // ⚙︎'s menu lies in a portal: a touch in it is the strip's own.
      if (rootRef.current?.contains(target) || target?.closest?.('.menu')) return;
      setOpen(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const scrolled = () => setOpen(false);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scrolled);
    };
  }, [open]);

  const current = sections.find(section => section.value === value);

  return (
    <div ref={rootRef} className={`phone-sections${open ? ' phone-sections--open' : ''}`}>
      <button
        type="button"
        className={`phone-sections__current${current ? ' phone-sections__current--on' : ''}`}
        aria-label={current ? `${current.label}: the sections` : 'The sections'}
        aria-expanded={open}
        onClick={() => setOpen(was => !was)}
      >
        {current ? current.icon : restIcon}
      </button>
      <div className="phone-sections__strip menu-surface" role="radiogroup" aria-label="Collections" inert={!open}>
        {sections.map(section => (
          <button
            key={section.value}
            type="button"
            role="radio"
            aria-checked={section.value === value}
            aria-label={section.label}
            className={`phone-sections__option${section.value === value ? ' phone-sections__option--on' : ''}`}
            onClick={() => { setOpen(false); onChange(section.value); }}
          >
            {section.icon}
          </button>
        ))}
        {tools && <span className="phone-sections__tools">{tools(close)}</span>}
      </div>
    </div>
  );
};

export default PhoneSections;
