import React, { forwardRef, useContext } from 'react';
import FormContext from 'react-bootstrap/FormContext';
import './field.css';

/**
 * The fields of DexVault (field.css): a hollow a little darker than its
 * dialog, a grey edge, gold when it has the focus, red when what is in it
 * will not do. A form's Select, closed, looks the same.
 */

interface FieldLook {
  /** sm in a bar or an edit in place (28 px), md in a form (36 px), title a heading edited in place (the radio's prompt). */
  size?: 'sm' | 'md' | 'title';
  /** What is in it will not do: a red edge; say why beside it. */
  isInvalid?: boolean;
}

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>, FieldLook {
  /** Before the words, inside the field: a search's magnifier. */
  icon?: React.ReactNode;
  /** After them, inside the field: a unit, CHF. */
  suffix?: React.ReactNode;
}

const fieldClass = (base: string, size: FieldLook['size'], isInvalid: boolean | undefined, className?: string) =>
  [base, size !== 'md' && `${base}--${size}`, isInvalid && `${base}--invalid`, className].filter(Boolean).join(' ');

/** A field of one line: words, a number, a date, an address, a search. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(({
  size = 'md', isInvalid, icon, suffix, className, id, type = 'text', ...rest
}, ref) => {
  // In a Form.Group, its controlId, for the group's label to name it.
  const { controlId } = useContext(FormContext);
  const input = (
    <input
      ref={ref}
      id={id ?? controlId}
      type={type}
      aria-invalid={isInvalid || undefined}
      className={fieldClass('ui-input', size, isInvalid, icon || suffix ? undefined : className)}
      {...rest}
    />
  );
  if (!icon && !suffix) return input;
  return (
    <span className={['ui-input-box', icon && 'ui-input-box--icon', suffix && 'ui-input-box--suffix', className].filter(Boolean).join(' ')}>
      {icon && <span className="ui-input-box__icon" aria-hidden="true">{icon}</span>}
      {input}
      {suffix && <span className="ui-input-box__suffix" aria-hidden="true">{suffix}</span>}
    </span>
  );
});

TextField.displayName = 'TextField';

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, FieldLook {}

/** A field of several lines: notes, a comment, a description. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(({
  size = 'md', isInvalid, className, id, rows = 3, ...rest
}, ref) => {
  const { controlId } = useContext(FormContext);
  return (
    <textarea
      ref={ref}
      id={id ?? controlId}
      rows={rows}
      aria-invalid={isInvalid || undefined}
      className={fieldClass('ui-input', size, isInvalid, ['ui-input--area', className].filter(Boolean).join(' '))}
      {...rest}
    />
  );
});

TextArea.displayName = 'TextArea';

/** Why what is in a field will not do, in red under it; nothing when it will. */
export const FieldError: React.FC<{ children?: React.ReactNode; id?: string }> = ({ children, id }) =>
  children ? <div className="ui-field-error" id={id} role="alert">{children}</div> : null;

/** A word under a field on what to put in it. */
export const FieldHint: React.FC<{ children: React.ReactNode; id?: string }> = ({ children, id }) =>
  <div className="ui-field-hint" id={id}>{children}</div>;

export default TextField;
