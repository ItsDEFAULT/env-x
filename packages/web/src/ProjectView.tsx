import { useCallback, useEffect, useState } from 'react';
import type { EnvSummary, Project, ProjectStatus } from '@envx/core';
import { errorCode, errorMessage, type Backend, type Mode } from './backend';
import { folderPermission, forgetFolder } from './browser';
import { EnvPanel } from './EnvPanel';
import { displayRoot, Icon, Modal, useToast } from './ui';

interface Props {
  backend: Backend;
  mode: Mode;
  project: Project;
  onChanged: () => void;
}

export function ProjectView({ backend, mode, project, onChanged }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [envs, setEnvs] = useState<EnvSummary[]>([]);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [viewing, setViewing] = useState<string | null>(project.active ?? project.envs[0] ?? null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [modal, setModal] = useState<'new' | 'settings' | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to make EnvPanel reload

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([backend.status(project.id), backend.listEnvs(project.id)]);
      setStatus(s);
      setEnvs(e);
      setNeedsAccess(false);
      setViewing((v) => (v && e.some((x) => x.name === v) ? v : (s.active ?? e[0]?.name ?? null)));
    } catch (err) {
      if (errorCode(err) === 'PERMISSION') setNeedsAccess(true);
      else toast(errorMessage(err), 'error');
    }
  }, [backend, project.id, toast]);

  useEffect(() => {
    load();
  }, [load, project.updatedAt]);

  const reloadAll = useCallback(async () => {
    await load();
    setVersion((v) => v + 1);
    onChanged();
  }, [load, onChanged]);

  async function run(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      if (success) toast(success);
    } catch (err) {
      if (errorCode(err) === 'PERMISSION') setNeedsAccess(true);
      toast(errorMessage(err), 'error');
    } finally {
      await reloadAll();
    }
  }

  async function switchTo(env: string, confirmed = false) {
    if (switching) return;
    // Secure environments ask first; the vault refuses the switch without `confirm` anyway.
    if (!confirmed && env !== active && envs.find((e) => e.name === env)?.secure) return setConfirmSwitch(env);
    setSwitching(env);
    await run(async () => {
      try {
        const r = await backend.switchEnv(project.id, env, { onDrift: 'save', confirm: confirmed });
        setViewing(env);
        toast(`${project.name} is now on ${env}`);
        if (r.drift === 'saved') toast(`Your edits to ${project.target} were saved into "${r.savedTo}"`, 'warn');
      } catch (err) {
        // Marked secure elsewhere (CLI, another window) since this view loaded.
        if (errorCode(err) === 'CONFIRM') return setConfirmSwitch(env);
        throw err;
      }
    });
    setSwitching(null);
  }

  async function grantAccess() {
    const state = await folderPermission(project.root, true).catch(() => 'denied' as const);
    if (state === 'granted') load();
    else toast('Access was not granted.', 'error');
  }

  const active = status?.active ?? project.active;

  return (
    <div className="project">
      <div className="project-head">
        <div>
          <h1>{project.name}</h1>
          <p className="muted mono small">
            {displayRoot(project.root)} <span className="sep">→</span> {project.target}
          </p>
        </div>
        <button className="btn ghost small" onClick={() => setModal('settings')}>
          <Icon name="settings" size={14} /> Settings
        </button>
      </div>

      {needsAccess && (
        <div className="banner">
          <Icon name="lock" />
          <span>Your browser needs your permission again to read and write this project's folder.</span>
          <button className="btn small primary" onClick={grantAccess}>
            Allow access
          </button>
        </div>
      )}

      {status?.drift && (
        <div className="banner warn">
          <Icon name="alert" />
          <span>
            <code>{project.target}</code> was edited outside envx.{' '}
            {active ? `Switching saves those edits into "${active}".` : 'Save them as an environment to keep them.'}
          </span>
          <button className="btn small" onClick={() => run(() => backend.pull(project.id), `Saved ${project.target} into ${active ?? 'a new environment'}`)}>
            Save edits now
          </button>
          {active && (
            <button
              className="btn small ghost"
              onClick={() => run(() => backend.switchEnv(project.id, active, { onDrift: 'discard' }), `Restored ${project.target} from ${active}`)}
            >
              Discard edits
            </button>
          )}
        </div>
      )}

      <section className="switcher-section">
        <div className="section-label">Active environment</div>
        <div className="switcher" role="radiogroup" aria-label="Active environment">
          {envs.map((e) => (
            <button
              key={e.name}
              role="radio"
              aria-checked={e.name === active}
              className={`env-option ${e.name === active ? 'active' : ''} ${switching === e.name ? 'pending' : ''}`}
              onClick={() => (e.name === active ? setViewing(e.name) : switchTo(e.name))}
              disabled={needsAccess}
              title={e.name === active ? 'Active' : `Switch ${project.target} to ${e.name}`}
            >
              <span className="env-option-top">
                <span className="env-option-name">{e.name}</span>
                {e.secure && (
                  <span className="env-secure" title="Secure: asks for confirmation before switching to it">
                    <Icon name="lock" size={12} />
                    <span className="sr-only">(secure)</span>
                  </span>
                )}
                {e.name === active ? (
                  <span className="env-state">
                    <Icon name="check" size={13} /> Active
                  </span>
                ) : switching === e.name ? (
                  <span className="env-state">Switching…</span>
                ) : (
                  <span className="env-state hint" aria-hidden="true">
                    Switch
                  </span>
                )}
              </span>
              <span className="env-option-meta">{e.keys} keys</span>
            </button>
          ))}
          <button className="env-option add" onClick={() => setModal('new')} disabled={needsAccess && mode.kind === 'browser'}>
            <Icon name="plus" size={14} />
            <span>New environment</span>
          </button>
        </div>
      </section>

      {viewing && envs.some((e) => e.name === viewing) && (
        <EnvPanel
          key={viewing}
          version={version}
          backend={backend}
          project={project}
          env={viewing}
          active={viewing === active}
          secure={envs.some((e) => e.name === viewing && e.secure)}
          envNames={envs.map((e) => e.name)}
          secureEnvs={envs.filter((e) => e.secure).map((e) => e.name)}
          onSelect={setViewing}
          onChanged={reloadAll}
        />
      )}

      {confirmSwitch && (
        <Modal
          title={`Switch to ${confirmSwitch}?`}
          onClose={() => setConfirmSwitch(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmSwitch(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const env = confirmSwitch;
                  setConfirmSwitch(null);
                  switchTo(env, true);
                }}
              >
                <Icon name="lock" size={14} /> <span className="truncate">Switch to {confirmSwitch}</span>
              </button>
            </>
          }
        >
          <p>
            <strong>{confirmSwitch}</strong> is marked secure. Switching rewrites <code>{project.target}</code> in{' '}
            <strong>{project.name}</strong>, so anything that reads it will use the {confirmSwitch} values.
          </p>
        </Modal>
      )}
      {modal === 'new' && (
        <NewEnvModal
          envs={envs.map((e) => e.name)}
          defaultFrom={active ?? ''}
          onClose={() => setModal(null)}
          onCreate={async (name, from) => {
            await backend.createEnv(project.id, name, { from: from || undefined });
            setViewing(name);
            toast(`Created ${name}`);
            await reloadAll();
          }}
        />
      )}
      {modal === 'settings' && (
        <SettingsModal
          project={project}
          onClose={() => setModal(null)}
          onSave={async (patch) => {
            await backend.updateProject(project.id, patch);
            toast('Project updated');
            await reloadAll();
          }}
          onRemove={async () => {
            await backend.removeProject(project.id);
            if (mode.kind === 'browser') await forgetFolder(project.root);
            toast(`Removed ${project.name} from envx`);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function NewEnvModal(props: { envs: string[]; defaultFrom: string; onClose: () => void; onCreate: (name: string, from: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState(props.defaultFrom);
  const [error, setError] = useState('');
  const submit = async () => {
    try {
      await props.onCreate(name.trim(), from);
      props.onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title="New environment"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={submit}>
            Create
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label>
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="staging" spellCheck={false} />
        </label>
        <label>
          <span>Start from</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Empty</option>
            {props.envs.map((e) => (
              <option key={e} value={e}>
                Copy of {e}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="error-text">{error}</p>}
        <button hidden />
      </form>
    </Modal>
  );
}

function SettingsModal(props: {
  project: Project;
  onClose: () => void;
  onSave: (patch: { name: string; target: string }) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [name, setName] = useState(props.project.name);
  const [target, setTarget] = useState(props.project.target);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const attempt = (fn: () => Promise<void>) => async () => {
    try {
      await fn();
      props.onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title="Project settings"
      onClose={props.onClose}
      footer={
        confirming ? (
          <>
            <span className="muted small grow">Forget this project? Its files on disk stay as they are.</span>
            <button className="btn ghost" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button className="btn danger" onClick={attempt(props.onRemove)}>
              Remove
            </button>
          </>
        ) : (
          <>
            <button className="btn ghost danger-text grow-right" onClick={() => setConfirming(true)}>
              <Icon name="trash" size={14} /> Remove project
            </button>
            <button className="btn ghost" onClick={props.onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={attempt(() => props.onSave({ name: name.trim(), target: target.trim() }))}>
              Save
            </button>
          </>
        )
      }
    >
      <div className="form">
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>Target file</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} spellCheck={false} className="mono" />
          <small className="muted">The file in the project folder that receives the active environment, e.g. .env or .env.local.</small>
        </label>
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  );
}
