import {
  Component,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { useResolvedTheme, useThemePreferenceState, type ThemeMode } from '../app/theme';
import { getTodayDateKey } from './dates';

// ---------------------------------------------------------------------------
// useToday — a date key that rolls over at midnight while a window stays open.
// ---------------------------------------------------------------------------

export function useToday() {
  const [todayKey, setTodayKey] = useState(() => getTodayDateKey());

  useEffect(() => {
    const interval = window.setInterval(() => {
      const nextKey = getTodayDateKey();
      setTodayKey((current) => (current === nextKey ? current : nextKey));
    }, 30_000);

    return () => window.clearInterval(interval);
  }, []);

  return todayKey;
}

// ---------------------------------------------------------------------------
// WidgetDialog — the one shared modal. Stack-aware Escape, focus trap,
// focus restore, and the panel chrome every hand-rolled dialog re-implemented.
// ---------------------------------------------------------------------------

const dialogStack: string[] = [];

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

export function WidgetDialog({
  children,
  className,
  kicker,
  onClose,
  theme,
  title,
  titleActions,
  wide
}: {
  children: ReactNode;
  className?: string;
  kicker?: ReactNode;
  onClose: () => void;
  theme: ThemeMode;
  title: ReactNode;
  titleActions?: ReactNode;
  wide?: boolean;
}) {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const sectionRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    dialogStack.push(dialogId);
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFirst = () => {
      const section = sectionRef.current;
      if (!section) {
        return;
      }
      const target =
        section.querySelector<HTMLElement>('[data-autofocus]') ??
        section.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        section;
      target.focus({ preventScroll: true });
    };
    const focusTimeout = window.setTimeout(focusFirst, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== dialogId) {
        return;
      }

      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const section = sectionRef.current;
      if (!section) {
        return;
      }

      const focusable = Array.from(section.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );
      if (focusable.length === 0) {
        event.preventDefault();
        section.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !section.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !section.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.clearTimeout(focusTimeout);
      window.removeEventListener('keydown', handleKeyDown, true);
      const stackIndex = dialogStack.indexOf(dialogId);
      if (stackIndex !== -1) {
        dialogStack.splice(stackIndex, 1);
      }
      restoreFocusRef.current?.focus({ preventScroll: true });
    };
  }, [dialogId]);

  return createPortal(
    <div
      className="lesson-plan-export-dialog__backdrop planner-week-dialog__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`panel planner-week-dialog${wide ? ' planner-week-dialog--wide' : ''}${
          className ? ` ${className}` : ''
        }`}
        data-theme={theme}
        ref={sectionRef}
        role="dialog"
        tabIndex={-1}
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div aria-hidden="true" className="panel__bezel-mid" />
        <div className="panel__content planner-week-dialog__content">
          <header className="planner-week-dialog__header">
            <div>
              {kicker ? <span className="panel-kicker">{kicker}</span> : null}
              <h2 id={titleId}>{title}</h2>
            </div>
            <div className="widget-dialog__header-actions">
              {titleActions}
              <button
                aria-label="Close dialog"
                className="widget-icon-button widget-icon-button--close"
                onClick={onClose}
                type="button"
              >
                ×
              </button>
            </div>
          </header>
          {children}
        </div>
      </section>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Live announcer — one polite aria-live region per window.
// ---------------------------------------------------------------------------

const ANNOUNCE_EVENT = 'teacher-tools:announce';

export function announce(message: string) {
  window.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: message }));
}

export function LiveRegion() {
  const [message, setMessage] = useState('');
  const clearTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const handleAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail !== 'string') {
        return;
      }

      // Re-set even for identical strings so repeat announcements fire.
      setMessage('');
      window.requestAnimationFrame(() => setMessage(detail));

      if (clearTimeoutRef.current !== null) {
        window.clearTimeout(clearTimeoutRef.current);
      }
      clearTimeoutRef.current = window.setTimeout(() => setMessage(''), 6000);
    };

    window.addEventListener(ANNOUNCE_EVENT, handleAnnounce);
    return () => {
      window.removeEventListener(ANNOUNCE_EVENT, handleAnnounce);
      if (clearTimeoutRef.current !== null) {
        window.clearTimeout(clearTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div aria-live="polite" className="visually-hidden" role="status">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Undo toast — showUndoToast('Deleted "10A"', restoreFn). One host per window.
// ---------------------------------------------------------------------------

const UNDO_EVENT = 'teacher-tools:undo-toast';
const UNDO_TOAST_DURATION_MS = 10_000;

type UndoToastDetail = {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
};

export function showUndoToast(message: string, onAction?: () => void, actionLabel = 'Undo') {
  announce(message);
  window.dispatchEvent(
    new CustomEvent<UndoToastDetail>(UNDO_EVENT, {
      detail: { actionLabel, message, onAction }
    })
  );
}

export function UndoToastHost() {
  const [toast, setToast] = useState<(UndoToastDetail & { id: number }) | null>(null);
  const dismissTimeoutRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);

  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<UndoToastDetail>).detail;
      if (!detail || typeof detail.message !== 'string') {
        return;
      }

      toastIdRef.current += 1;
      setToast({ ...detail, id: toastIdRef.current });

      if (dismissTimeoutRef.current !== null) {
        window.clearTimeout(dismissTimeoutRef.current);
      }
      dismissTimeoutRef.current = window.setTimeout(() => setToast(null), UNDO_TOAST_DURATION_MS);
    };

    window.addEventListener(UNDO_EVENT, handleToast);
    return () => {
      window.removeEventListener(UNDO_EVENT, handleToast);
      if (dismissTimeoutRef.current !== null) {
        window.clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, []);

  if (!toast) {
    return null;
  }

  return createPortal(
    <div className="undo-toast" role="status">
      <span className="undo-toast__message">{toast.message}</span>
      {toast.onAction ? (
        <button
          className="undo-toast__action"
          onClick={() => {
            toast.onAction?.();
            setToast(null);
          }}
          type="button"
        >
          {toast.actionLabel ?? 'Undo'}
        </button>
      ) : null}
      <button
        aria-label="Dismiss"
        className="undo-toast__dismiss"
        onClick={() => setToast(null)}
        type="button"
      >
        ×
      </button>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Confirm — requestConfirm({...}) resolves true/false. One host per window.
// Reserved for the few actions an undo toast can't cover (bulk, irreversible).
// ---------------------------------------------------------------------------

const CONFIRM_EVENT = 'teacher-tools:confirm';

export type ConfirmRequest = {
  cancelLabel?: string;
  confirmLabel?: string;
  message?: string;
  title: string;
  tone?: 'danger' | 'default';
};

type ConfirmDetail = ConfirmRequest & { resolve: (confirmed: boolean) => void };

export function requestConfirm(request: ConfirmRequest) {
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(
      new CustomEvent<ConfirmDetail>(CONFIRM_EVENT, { detail: { ...request, resolve } })
    );
  });
}

export function ConfirmHost() {
  const [themePreference] = useThemePreferenceState();
  const theme = useResolvedTheme(themePreference);
  const [request, setRequest] = useState<ConfirmDetail | null>(null);

  useEffect(() => {
    const handleConfirm = (event: Event) => {
      const detail = (event as CustomEvent<ConfirmDetail>).detail;
      if (!detail || typeof detail.resolve !== 'function') {
        return;
      }

      setRequest((current) => {
        current?.resolve(false);
        return detail;
      });
    };

    window.addEventListener(CONFIRM_EVENT, handleConfirm);
    return () => window.removeEventListener(CONFIRM_EVENT, handleConfirm);
  }, []);

  const settle = useCallback(
    (confirmed: boolean) => {
      setRequest((current) => {
        current?.resolve(confirmed);
        return null;
      });
    },
    []
  );

  if (!request) {
    return null;
  }

  return (
    <WidgetDialog
      className="confirm-dialog"
      onClose={() => settle(false)}
      theme={theme}
      title={request.title}
    >
      {request.message ? <p className="confirm-dialog__message">{request.message}</p> : null}
      <div className="confirm-dialog__actions">
        <button className="secondary-link" onClick={() => settle(false)} type="button">
          {request.cancelLabel ?? 'Cancel'}
        </button>
        <button
          className={`primary-button${request.tone === 'danger' ? ' confirm-dialog__confirm--danger' : ''}`}
          data-autofocus
          onClick={() => settle(true)}
          type="button"
        >
          {request.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </WidgetDialog>
  );
}

// ---------------------------------------------------------------------------
// Error boundary — a crashed transparent window is invisible without one.
// ---------------------------------------------------------------------------

export class WindowErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('TeacherTools window crashed:', error);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="window-error-fallback" role="alert">
        <div className="window-error-fallback__card">
          <h1>Something went wrong</h1>
          <p>This window hit an unexpected error. Your data is safe on disk.</p>
          <div className="window-error-fallback__actions">
            <button
              className="primary-button"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload
            </button>
            {window.electronAPI ? (
              <button
                className="secondary-link"
                onClick={() => void window.electronAPI?.revealDataFolder?.()}
                type="button"
              >
                Open data folder
              </button>
            ) : null}
          </div>
          <pre className="window-error-fallback__detail">{String(this.state.error?.message ?? this.state.error)}</pre>
        </div>
      </div>
    );
  }
}
