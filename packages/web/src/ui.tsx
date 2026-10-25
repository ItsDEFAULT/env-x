import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ── icons ───────────────────────────────────────────────────────────────────

const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  terminal: 'M4 17l6-5-6-5M12 19h8',
  bot: 'M12 8V4M8 4h8M5 8h14v11H5zM9 13h.01M15 13h.01M2 13v3M22 13v3',
  download: 'M12 4v12M6 11l6 6 6-6M4 20h16',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  diff: 'M6 3v12M18 9v12M3 6h6M15 18h6M6 21a3 3 0 1 0 0-6M18 3a3 3 0 1 0 0 6',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

// ── modal ───────────────────────────────────────────────────────────────────

export function Modal(props: {
  title: string;
  /** Omit to make the dialog impossible to dismiss (no close button, Escape or backdrop click). */
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    // Keep an input the content focused itself (autoFocus); otherwise focus the dialog, not
    // whatever showModal() picks first (e.g. a scrollable code block).
    const wanted = document.activeElement;
    dialog.showModal();
    if (wanted instanceof HTMLElement && wanted !== document.body && dialog.contains(wanted)) wanted.focus();
    else dialog.focus();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={props.wide ? 'modal wide' : 'modal'}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose?.();
      }}
      onClick={(e) => e.target === ref.current && props.onClose?.()}
    >
      <div className="modal-head">
        <h2>{props.title}</h2>
        {props.onClose && (
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        )}
      </div>
      <div className="modal-body">{props.children}</div>
      {props.footer && <div className="modal-foot">{props.footer}</div>}
    </dialog>
  );
}

// ── toasts ──────────────────────────────────────────────────────────────────

type Toast = { id: number; text: string; tone: 'ok' | 'warn' | 'error' };
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <Icon name={t.tone === 'ok' ? 'check' : 'alert'} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ── misc ────────────────────────────────────────────────────────────────────

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={label ? 'btn ghost small' : 'icon-btn'}
      title="Copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={14} />
      {label && <span>{done ? 'Copied' : label}</span>}
    </button>
  );
}

export function Code({ children }: { children: string }) {
  return (
    <div className="code">
      <pre>{children}</pre>
      <CopyButton text={children} />
    </div>
  );
}

// ── theme ───────────────────────────────────────────────────────────────────

type Theme = 'light' | 'dark';
const THEME_KEY = 'envx.theme';
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  return set === 'light' || set === 'dark' ? set : systemDark() ? 'dark' : 'light';
}

/** Light/dark switch. Starts from the system setting; an explicit choice is remembered (see index.html). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(currentTheme());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="icon-btn"
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          // Not remembered, but still applied for this visit.
        }
        setTheme(next);
      }}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <img src="./icon.svg" alt="" width={26} height={26} />
      <span>envx</span>
    </div>
  );
}

export const REPO_URL ='https://github.com/ItsDEFAULT/env-x';

/** envx is installed from source; it is not published to npm. */
export const INSTALL_CLI = `git clone ${REPO_URL}.git\ncd env-x && npm install && npm run build\nnpm link -w @env-x/cli`;

export function displayRoot(root: string): string {
  return root.startsWith('handle:') ? 'Folder access granted in this browser' : root;
}
