/**
 * Puts words on the clipboard: by the Clipboard API where the page has it (a
 * secure page), else by a hidden field copied, as an older Safari or a page
 * served over plain http allow. True when it was copied.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // The hidden field below may still do it.
  }
  try {
    const focused = document.activeElement as HTMLElement | null;
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.setAttribute('aria-hidden', 'true');
    field.tabIndex = -1;
    Object.assign(field.style, { position: 'absolute', left: '-9999px', top: '-9999px', width: '1px', height: '1px', padding: '0', border: '0', outline: '0', background: 'transparent', pointerEvents: 'none' });
    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(field);
    focused?.focus?.();
    return copied;
  } catch {
    return false;
  }
};

export default copyText;
