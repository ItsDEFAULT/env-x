import { useCallback, useEffect, useState } from 'react';
import type { FolderListing, ImportResult, Project } from '@envx/core';
import type { Install } from './App';
import { browseFolders, errorMessage, type Backend, type Mode } from './backend';
import { pickProjectFolder } from './browser';
import { ProjectView } from './ProjectView';
import { Brand, Code, Icon, INSTALL_CLI, Modal, ThemeToggle, useToast } from './ui';
import { VaultPicker } from './VaultPicker';

const SELECTED_KEY = 'envx.selected';

export function Workspace(props: {
  mode: Mode;
  backend: Backend;
  install: Install;
  daemonHere: boolean;
  onChooseVault: (mode: Mode) => void;
}) {
  const { mode, backend } = props;
  const toast = useToast();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(SELECTED_KEY));
  const [modal, setModal] = useState<'import' | 'agents' | 'vault' | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await backend.listProjects();
      setProjects(list);
      setLoadError('');
      setSelected((s) => (s && list.some((p) => p.id === s) ? s : (list[0]?.id ?? null)));
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [backend]);

  useEffect(() => {
    refresh();
    // Pick up switches made from the CLI or an agent while this window was in the background.
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  useEffect(() => {
    if (selected) localStorage.setItem(SELECTED_KEY, selected);
  }, [selected]);

  function reportImport(r: ImportResult) {
    const names = r.imported.map((i) => i.env).join(', ');
    toast(
      r.imported.length
        ? `${r.created ? 'Imported' : 'Updated'} ${r.project.name}: ${names}`
        : `${r.project.name}: no new .env files found`,
      r.imported.length ? 'ok' : 'warn',
    );
    setSelected(r.project.id);
    refresh();
  }

  async function importFromBrowser() {
    try {
      const { root, name } = await pickProjectFolder();
      reportImport(await backend.importProject({ root, name }));
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') toast(errorMessage(err), 'error');
    }
  }

  const project = projects?.find((p) => p.id === selected) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <span className="mode-chip" title={mode.kind === 'remote' ? `Connected to ${mode.url}` : 'Vault stored in this browser'}>
          <Icon name={mode.kind === 'remote' ? 'terminal' : 'folder'} size={13} />
          {mode.kind === 'remote' ? `CLI vault · ${mode.url.replace(/^https?:\/\//, '')}` : 'Browser vault'}
        </span>
        <div className="spacer" />
        {props.install.available && (
          <button className="btn ghost small" onClick={props.install.prompt} aria-label="Install the app" title="Install the app">
            <Icon name="download" size={14} /> <span className="label">Install</span>
          </button>
        )}
        <button className="btn ghost small" onClick={() => setModal('agents')} aria-label="Terminal & agents" title="Terminal & agents">
          <Icon name="bot" size={14} /> <span className="label">Terminal &amp; agents</span>
        </button>
        <button className="btn ghost small" onClick={() => setModal('vault')} aria-label="Switch vault" title="Use the browser vault or connect to the envx CLI">
          <Icon name="link" size={14} /> <span className="label">Switch vault</span>
        </button>
        <ThemeToggle />
      </header>

      <aside className="sidebar">
        <div className="sidebar-head">
          <span>Projects</span>
          <button
            className="icon-btn"
            title="Import project"
            onClick={() => (mode.kind === 'browser' ? importFromBrowser() : setModal('import'))}
          >
            <Icon name="plus" />
          </button>
        </div>
        <nav>
          {projects?.map((p) => (
            <button key={p.id} className={`project-item ${p.id === selected ? 'selected' : ''}`} onClick={() => setSelected(p.id)}>
              <span className="project-name">{p.name}</span>
              {p.active && <span className="env-badge">{p.active}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        {loadError ? (
          <div className="empty">
            <Icon name="alert" size={28} />
            <h2>Can't load your vault</h2>
            <p>{loadError}</p>
            <div className="row">
              <button className="btn" onClick={refresh}>
                Retry
              </button>
              <button className="btn ghost" onClick={() => setModal('vault')}>
                Switch vault
              </button>
            </div>
          </div>
        ) : projects === null ? (
          <div className="empty muted">Loading…</div>
        ) : project ? (
          <ProjectView key={project.id} backend={backend} mode={mode} project={project} onChanged={refresh} />
        ) : (
          <div className="empty">
            <Icon name="folder" size={28} />
            <h2>Import your first project</h2>
            <p>
              envx picks up every <code>.env</code>, <code>.env.staging</code>, <code>.env.production</code>… in the folder and
              turns each into an environment you can switch to.
            </p>
            <button className="btn primary" onClick={() => (mode.kind === 'browser' ? importFromBrowser() : setModal('import'))}>
              <Icon name="folder" /> Import a project
            </button>
            {mode.kind === 'browser' && (
              <p className="muted small">
                Using the envx CLI?{' '}
                <button className="link-btn" onClick={() => setModal('vault')}>
                  Connect to your CLI vault
                </button>{' '}
                to share projects with your terminal and AI agents.
              </p>
            )}
          </div>
        )}
      </main>

      {modal === 'import' && mode.kind === 'remote' && (
        <ImportModal mode={mode} backend={backend} onClose={() => setModal(null)} onImported={reportImport} />
      )}
      {modal === 'agents' && <AgentsModal mode={mode} onClose={() => setModal(null)} />}
      {modal === 'vault' && (
        <VaultPicker
          current={mode}
          daemonHere={props.daemonHere}
          onClose={() => setModal(null)}
          onChoose={(next) => {
            setModal(null);
            props.onChooseVault(next);
          }}
        />
      )}
    </div>
  );
}

/** CLI vault import: browse the server's folders, since browsers never reveal a picked folder's real path. */
function ImportModal(props: {
  mode: Extract<Mode, { kind: 'remote' }>;
  backend: Backend;
  onClose: () => void;
  onImported: (r: ImportResult) => void;
}) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const go = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError('');
      try {
        const next = await browseFolders(props.mode, path);
        setListing(next);
        setPathInput(next.path);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [props.mode],
  );

  useEffect(() => {
    go();
  }, [go]);

  async function submit() {
    if (!listing?.path) return;
    setBusy(true);
    setError('');
    try {
      const r = await props.backend.importProject({ root: listing.path, name: name.trim() || undefined });
      props.onImported(r);
      props.onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const here = listing?.crumbs[listing.crumbs.length - 1]?.name;

  return (
    <Modal
      title="Import a project"
      onClose={props.onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || loading || !listing?.path} onClick={submit}>
            <span className="truncate">{busy ? 'Importing…' : listing?.path ? `Import ${here}` : 'Import'}</span>
          </button>
        </>
      }
    >
      <div className="picker">
        {listing && (
          <>
            <div className="shortcuts" aria-label="Shortcuts">
              {listing.shortcuts.map((s) => (
                <button key={s.path} className="chip" onClick={() => go(s.path)} title={s.path || 'Drives'}>
                  {s.label}
                </button>
              ))}
            </div>
            <nav className="crumbs" aria-label="Current folder">
              {listing.crumbs.map((c, i) => (
                <span key={c.path}>
                  {i > 0 && <span className="crumb-sep">/</span>}
                  <button className="crumb" onClick={() => go(c.path)} disabled={i === listing.crumbs.length - 1}>
                    {c.name}
                  </button>
                </span>
              ))}
            </nav>
            <div className={`folder-list ${loading ? 'loading' : ''}`}>
              {listing.parent !== null && (
                <button className="folder-row up" onClick={() => go(listing.parent!)}>
                  <Icon name="arrowUp" size={15} />
                  <span>Up one level</span>
                </button>
              )}
              {listing.folders.map((f) => (
                <button key={f.path} className="folder-row" onClick={() => go(f.path)}>
                  <Icon name="folder" size={15} />
                  <span className="folder-name">{f.name}</span>
                  {f.project ? <span className="tag">imported</span> : f.hasEnv && <span className="tag accent">.env</span>}
                </button>
              ))}
              {listing.folders.length === 0 && <p className="muted small folder-empty">No folders here.</p>}
              {listing.truncated && <p className="muted small folder-empty">Showing the first 400 folders. Type a path below to go further.</p>}
            </div>
            <p className="folder-status small">
              {!listing.path ? (
                'Pick a drive.'
              ) : listing.project ? (
                <>
                  Already imported as <strong>{listing.project}</strong>. Importing again adds any new .env files.
                </>
              ) : listing.envFiles.length ? (
                <>
                  Will import <span className="mono">{listing.envFiles.join(', ')}</span>
                </>
              ) : (
                <span className="muted">No .env files in this folder. Open the project folder that contains them.</span>
              )}
            </p>
          </>
        )}
        <form
          className="picker-path"
          onSubmit={(e) => {
            e.preventDefault();
            go(pathInput.trim());
          }}
        >
          <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder="Or type a folder path" spellCheck={false} aria-label="Folder path" className="mono" />
          <button className="btn">Go</button>
        </form>
        <label className="picker-name">
          <span>Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={here ? `Defaults to ${here}` : 'Defaults to the folder name'} />
        </label>
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  );
}

function AgentsModal({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const mcpJson = JSON.stringify({ mcpServers: { envx: { command: 'envx', args: ['mcp'] } } }, null, 2);
  return (
    <Modal title="Terminal & AI agents" onClose={onClose} wide>
      {mode.kind === 'browser' && (
        <p className="callout">
          <Icon name="alert" size={14} /> You're using the browser vault, which the terminal and agents can't see. To share one
          vault everywhere, install the CLI, import your projects there, and connect this app with <code>envx serve</code>.
        </p>
      )}
      <h3>Terminal</h3>
      <Code>{INSTALL_CLI}</Code>
      <Code>{'cd my-app && envx import\nenvx use staging      # one command to switch\nenvx ls               # every project and its active env'}</Code>

      <h3>Claude Code</h3>
      <Code>{'claude mcp add envx -- envx mcp'}</Code>

      <h3>Cursor, Claude Desktop, other MCP clients</h3>
      <Code>{mcpJson}</Code>
      <p className="muted small">
        Agents get tools to list projects, check status, compare environments and switch. Variable values are masked unless you
        set <code>ENVX_MCP_REVEAL=1</code>. Agents without MCP can call the CLI with <code>--json</code>.
      </p>
    </Modal>
  );
}
