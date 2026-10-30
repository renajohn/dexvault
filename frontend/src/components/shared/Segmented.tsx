import React from 'react';
import './segmented.css';

export interface SegmentedOption<T extends string> {
  value: T;
  /** Its words; an option with an icon alone needs a `tooltip`. */
  label?: React.ReactNode;
  icon?: React.ReactNode;
  /** A number after the words: how many there are. */
  count?: React.ReactNode;
  /** Said under the pointer, in the menus' glass, and to screen readers when it has no words. */
  tooltip?: string;
  disabled?: boolean;
  /** For tests and tools, as a select's option says it. */
  testId?: string;
}

export interface SegmentedProps<T extends string> {
  options: Array<SegmentedOption<T> | false | null | undefined>;
  value: T | null;
  onChange: (value: T) => void;
  /** What is chosen, for screen readers: "Show", "Search by". */
  label: string;
  /** sm in a bar (28 px), md in a dialog (36 px), lg for the app's own sections (44 px). */
  size?: 'sm' | 'md' | 'lg';
  /** neutral: a light veil on the one chosen (a view); gold: plain gold (a filter, the app's section). */
  tone?: 'neutral' | 'gold';
  /** Tabs show one panel among several; a choice sets a value. */
  kind?: 'choice' | 'tabs';
  block?: boolean;
  /** onChange on the one chosen too: a section of the app taken again goes back to its start. */
  reselect?: boolean;
  className?: string;
}

/**
 * One of a few, side by side (segmented.css): the app's sections, a search's
 * kind, a page's tabs. The one chosen wears a light veil, or plain gold when
 * it filters.
 */
function Segmented<T extends string>({
  options, value, onChange, label, size = 'md', tone = 'neutral', kind = 'choice', block = false, reselect = false, className,
}: SegmentedProps<T>) {
  const shown = options.filter((option): option is SegmentedOption<T> => Boolean(option));
  return (
    <div
      role={kind === 'tabs' ? 'tablist' : 'radiogroup'}
      aria-label={label}
      className={['ui-segmented', `ui-segmented--${size}`, tone !== 'neutral' && `ui-segmented--${tone}`, block && 'ui-segmented--block', className]
        .filter(Boolean).join(' ')}
    >
      {shown.map(option => {
        const chosen = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={kind === 'tabs' ? 'tab' : 'radio'}
            {...(kind === 'tabs' ? { 'aria-selected': chosen } : { 'aria-checked': chosen })}
            className={`ui-segmented__option${chosen ? ' ui-segmented__option--on' : ''}`}
            disabled={option.disabled}
            data-tooltip={option.tooltip}
            aria-label={option.label ? undefined : option.tooltip}
            data-testid={option.testId}
            onClick={() => { if (!chosen || reselect) onChange(option.value); }}
          >
            {option.icon && <span className="ui-segmented__icon" aria-hidden="true">{option.icon}</span>}
            {option.label && <span className="ui-segmented__label">{option.label}</span>}
            {option.count != null && <span className="ui-segmented__count">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
