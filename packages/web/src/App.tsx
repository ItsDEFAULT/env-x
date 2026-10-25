import { useEffect, useMemo, useState } from 'react';
import { checkDaemon, createBackend, loadMode, modeFromLocation, saveMode, type Mode } from './backend';
import { fsAccessSupported } from './browser';
import { Brand, ThemeToggle } from './ui';
import { VaultPicker } from './VaultPicker';
import { Workspace } from './Workspace';

// Captured at module load: the event can fire before React mounts.
let deferredInstall: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e as BeforeInstallPromptEvent;
  installListeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  installListeners.forEach((fn) => fn());
});

export interface Install {
  available: boolean;
  prompt: () => void;
}

function useInstall(): Install {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    installListeners.add(fn);
    return () => void installListeners.delete(fn);
  }, []);
  return {
    available: deferredInstall !== null,
    prompt: async () => {
      if (!deferredInstall) return;
      await deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      rerender((n) => n + 1);
    },
  };
}

export function App() {
  const [initial] = useState(() => modeFromLocation() ?? loadMode());
  const [mode, setMode] = useState<Mode | null>(initial);
  const [daemonHere, setDaemonHere] = useState(false);
  const [resolving, setResolving] = useState(initial === null);
  const backend = useMemo(() => (mode ? createBackend(mode) : null), [mode]);
  const install = useInstall();

  // First visit: open straight into a vault. A page served by `envx ui` belongs to the CLI vault
  // (it still needs the token); otherwise use this browser when it can reach local folders.
  useEffect(() => {
    checkDaemon(location.origin).then((isDaemon) => {
      setDaemonHere(isDaemon);
      if (initial === null && !isDaemon && fsAccessSupported) setMode({ kind: 'browser' });
      setResolving(false);
    });
  }, [initial]);

  useEffect(() => saveMode(mode), [mode]);

  // A connect link opened in a tab that already shows the app only changes the fragment.
  useEffect(() => {
    const onHash = () => {
      const next = modeFromLocation();
      if (next) setMode(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!mode || !backend) {
    return (
      <div className="app">
        <header className="topbar">
          <Brand />
          <div className="spacer" />
          <ThemeToggle />
        </header>
        {!resolving && <VaultPicker current={null} daemonHere={daemonHere} onChoose={setMode} />}
      </div>
    );
  }
  return <Workspace key={JSON.stringify(mode)} mode={mode} backend={backend} install={install} daemonHere={daemonHere} onChooseVault={setMode} />;
}
