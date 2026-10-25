import { useState } from 'react';
import { createBackend, errorMessage, type Mode } from './backend';
import { fsAccessSupported } from './browser';
import { Code, Icon, INSTALL_CLI, Modal, REPO_URL } from './ui';

const DEFAULT_DAEMON = 'http://127.0.0.1:4280';

interface Props {
  current: Mode | null;
  /** True when this page is served by the envx daemon itself (`envx ui`). */
  daemonHere: boolean;
  onChoose: (mode: Mode) => void;
  /** Omitted when there is no vault to go back to. */
  onClose?: () => void;
}

/** Choose where the vault lives: in this browser, or in the envx CLI through the local server. */
export function VaultPicker({ current, daemonHere, onChoose, onClose }: Props) {
  const [url, setUrl] = useState(current?.kind === 'remote' ? current.url : daemonHere ? location.origin : DEFAULT_DAEMON);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setError('');
    const mode: Mode = { kind: 'remote', url: url.trim().replace(/\/+$/, ''), token: token.trim() };
    try {
      await createBackend(mode).listProjects();
      onChoose(mode);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const appUrl = (location.origin + location.pathname).replace(/\/+$/, '');
  const serveCmd = daemonHere ? 'envx token' : `envx serve --origin ${appUrl}`;
  const isBrowser = current?.kind === 'browser';
  const isRemote = current?.kind === 'remote';

  return (
    <Modal title={current ? 'Switch vault' : 'Connect to your vault'} onClose={onClose} wide>
      <div className="vault-options">
        <section className={`vault-option ${isBrowser ? 'current' : ''}`}>
          <h3>
            <Icon name="folder" /> This browser {isBrowser && <span className="tag accent">current</span>}
          </h3>
          <p className="muted">
            Your vault stays in this browser. envx edits <code>.env</code> files in the project folders you give it access to.
            Your terminal and AI agents can't see it.
          </p>
          {fsAccessSupported ? (
            !isBrowser && (
              <button className="btn" onClick={() => onChoose({ kind: 'browser' })}>
                Use the browser vault
              </button>
            )
          ) : (
            <p className="note">
              <Icon name="alert" size={14} /> This browser can't open local folders. Use Chrome, Edge, Brave or Arc, or connect to
              the CLI.
            </p>
          )}
        </section>

        <section className={`vault-option ${isRemote ? 'current' : ''}`}>
          <h3>
            <Icon name="terminal" /> envx CLI {isRemote && <span className="tag accent">current</span>}
          </h3>
          <p className="muted">One vault shared by your terminal, this app and your AI agents. Start the local server, then paste its token.</p>
          {!daemonHere && (
            <>
              <Code>{INSTALL_CLI}</Code>
              <p className="muted small">
                Not installed yet? Needs Node.js 20+.{' '}
                <a href={`${REPO_URL}/blob/main/docs/getting-started.md`} target="_blank" rel="noreferrer">
                  Install guide
                </a>
              </p>
            </>
          )}
          <Code>{serveCmd}</Code>
          <form
            className="connect-form"
            onSubmit={(e) => {
              e.preventDefault();
              connect();
            }}
          >
            <label>
              <span>Server</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            </label>
            <label>
              <span>Token</span>
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Printed by the command above" spellCheck={false} autoComplete="off" />
            </label>
            {error && <p className="error-text">{error}</p>}
            <button className="btn primary" disabled={busy || !token.trim()}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </form>
        </section>
      </div>
    </Modal>
  );
}
