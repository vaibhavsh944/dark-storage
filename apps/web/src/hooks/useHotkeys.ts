import { useEffect } from 'react';

export interface UseHotkeysOptions {
  userRole?: string;
  canPick?: boolean;
  onNavigate: (path: string) => void;
  onShowToast: (message: string) => void;
  onToggleHelp: () => void;
}

export function isInteractiveElement(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const target = el as HTMLElement;
  if (!target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Pure handler for keydown events.
 * Returns true if the shortcut was handled and prevented default.
 */
export function handleHotkeyDown(e: KeyboardEvent, options: UseHotkeysOptions): boolean {
  // Ignore held-down repeated keydown events
  if (e.repeat) return false;

  // Ignore shortcuts when user is typing in an input, textarea, select, or contenteditable
  if (isInteractiveElement(e.target) || (typeof document !== 'undefined' && isInteractiveElement(document.activeElement))) {
    return false;
  }

  // 1. Shortcut Help: '?' or 'Alt+/'
  const isHelpKey =
    e.key === '?' ||
    (e.altKey && (e.code === 'Slash' || e.key === '/'));

  if (isHelpKey) {
    e.preventDefault();
    options.onToggleHelp();
    return true;
  }

  // All navigation shortcuts require Alt (Option on macOS)
  if (!e.altKey) {
    return false;
  }

  // 2. Alt + W -> /warehouse
  if (e.code === 'KeyW') {
    e.preventDefault();
    options.onNavigate('/warehouse');
    return true;
  }

  // 3. Alt + I -> /inventory
  if (e.code === 'KeyI') {
    e.preventDefault();
    options.onNavigate('/inventory');
    return true;
  }

  // 4. Alt + H -> /
  if (e.code === 'KeyH') {
    e.preventDefault();
    options.onNavigate('/');
    return true;
  }

  // 5. Alt + O -> /orders
  if (e.code === 'KeyO') {
    e.preventDefault();
    options.onNavigate('/orders');
    return true;
  }

  // 6. Alt + P -> /picking (Permission-aware: canPick only)
  if (e.code === 'KeyP') {
    e.preventDefault();
    const canPick = options.canPick ?? (options.userRole ? ['MANAGER', 'PICKER'].includes(options.userRole) : false);
    if (canPick) {
      options.onNavigate('/picking');
    } else {
      options.onShowToast("Picking isn't available for your role");
    }
    return true;
  }

  return false;
}

/**
 * React hook that binds window keydown event listener.
 */
export function useHotkeys(options: UseHotkeysOptions): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      handleHotkeyDown(e, options);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [options.userRole, options.onNavigate, options.onShowToast, options.onToggleHelp]);
}
