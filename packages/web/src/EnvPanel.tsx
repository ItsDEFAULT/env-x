import { useEffect, useMemo, useState } from 'react';
import { diffEnv, isValidKey, maskValue, parseEnv, setVar, toRecord, unsetVar, type Project } from '@envx/core';
import { errorCode, errorMessage, type Backend } from './backend';
import { CopyButton, Icon, Modal, useToast } from './ui';

interface Props {
  backend: Backend;
  project: Project;
  env: string;
  /** Bumped by the parent after changes, to reload the text. */
  version: number;
  active: boolean;
  /** Switching to this env asks for confirmation. */
  secure: boolean;
  envNames: string[];
  secureEnvs: string[];
  onSelect: (env: string) => void;
  onChanged: () => Promise<void>;
}

type View = 'vars' | 'raw' | 'compare';

export function EnvPanel({ backend, project, env, version, active, secure, envNames, secureEnvs, onSelect, onChanged }: Props) {
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const [view, setView] = useState<View>('vars');
  const [revealAll, setRevealAll] = useState(false);
  const [modal, setModal] = useState<'rename' | 'delete' | 'unsecure' | null>(null);
  const [driftRetry, setDriftRetry] = useState<string | null>(null);

  useEffect(() => {
    backend.readEnv(project.id, env).then(setText, (err) => toast(errorMessage(err), 'error'));
  }, [backend, project.id, env, version, toast]);

  /** Persist a new full text; on drift, ask before overwriting the hand-edited target. */
  async function save(next: string, force = false): Promise<boolean> {
    try {
      await backend.saveEnv(project.id, env, next, { force });
      setText(next);
      setDriftRetry(null);
      if (active) toast(`Saved ${env} and updated ${project.target}`);
      else toast(`Saved ${env}`);
      await onChanged();
      return true;
    } catch (err) {
      if (errorCode(err) === 'DRIFT') setDriftRetry(next);
      else toast(errorMessage(err), 'error');
      return false;
    }
  }

  async function setSecure(next: boolean) {
    try {
      await backend.setSecure(project.id, env, next);
      toast(next ? `${env} now asks for confirmation before switching to it` : `${env} is no longer marked secure`);
      setModal(null);
      await onChanged();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="tabs" role="tablist" aria-label="Environment">
          {envNames.map((name) => (
            <button key={name} role="tab" aria-selected={name === env} className={`tab ${name === env ? 'selected' : ''}`} onClick={() => onSelect(name)} title={name}>
              <span className="tab-name">{name}</span>
              {secureEnvs.includes(name) && <Icon name="lock" size={11} />}
            </button>
          ))}
        </div>
        <div className="panel-actions">
          <div className="segmented" role="tablist" aria-label="View">
            {(['vars', 'raw', 'compare'] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {v === 'vars' ? 'Variables' : v === 'raw' ? 'Raw' : 'Compare'}
              </button>
            ))}
          </div>
          <button className="icon-btn" title={revealAll ? 'Hide values' : 'Reveal values'} onClick={() => setRevealAll((r) => !r)}>
            <Icon name={revealAll ? 'eyeOff' : 'eye'} />
          </button>
          <button
            className={`icon-btn ${secure ? 'on' : ''}`}
            title={secure ? 'Secure: asks before switching to it. Click to remove the mark.' : 'Mark as secure: ask before switching to it'}
            aria-pressed={secure}
            onClick={() => (secure ? setModal('unsecure') : setSecure(true))}
          >
            <Icon name="lock" />
          </button>
          <button className="icon-btn" title="Rename" onClick={() => setModal('rename')}>
            <Icon name="pencil" />
          </button>
          <button className="icon-btn" title={active ? 'Switch to another environment before deleting this one' : 'Delete'} disabled={active} onClick={() => setModal('delete')}>
            <Icon name="trash" />
          </button>
        </div>
      </div>

      {active && (
        <p className="panel-note">
          <Icon name="file" size={14} />
          <span>
            Active: changes here are written to <code>{project.target}</code> right away.
          </span>
        </p>
      )}

      {text === null ? (
        <div className="empty muted">Loading…</div>
      ) : view === 'vars' ? (
        <VarsView text={text} revealAll={revealAll} onSave={save} />
      ) : view === 'raw' ? (
        <RawView text={text} onSave={save} />
      ) : (
        <CompareView backend={backend} project={project} env={env} text={text} envNames={envNames} revealAll={revealAll} />
      )}

      {driftRetry !== null && (
        <Modal
          title={`${project.target} was edited outside envx`}
          onClose={() => setDriftRetry(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setDriftRetry(null)}>
                Cancel
              </button>
              <button className="btn danger" onClick={() => save(driftRetry, true)}>
                Overwrite {project.target}
              </button>
            </>
          }
        >
          <p>
            Someone (or something) changed <code>{project.target}</code> since envx last wrote it. Saving now replaces those edits.
            To keep them, cancel and use <strong>Save edits now</strong> above first.
          </p>
        </Modal>
      )}
      {modal === 'unsecure' && (
        <Modal
          title={`Remove the secure mark from ${env}?`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="btn danger" onClick={() => setSecure(false)}>
                Remove mark
              </button>
            </>
          }
        >
          <p>Switching to {env} will no longer ask for confirmation, here, in the terminal, or from AI agents.</p>
        </Modal>
      )}
      {modal === 'rename' && (
        <RenameModal
          env={env}
          onClose={() => setModal(null)}
          onRename={async (to) => {
            await backend.renameEnv(project.id, env, to);
            onSelect(to);
            toast(`Renamed ${env} to ${to}`);
            await onChanged();
          }}
        />
      )}
      {modal === 'delete' && (
        <Modal
          title={`Delete ${env}?`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  try {
                    await backend.deleteEnv(project.id, env);
                    toast(`Deleted ${env}`);
                    setModal(null);
                    await onChanged();
                  } catch (err) {
                    toast(errorMessage(err), 'error');
                  }
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <p>
            This removes the <strong>{env}</strong> environment and its {parseEnv(text ?? '').length} variables from envx. This
            can't be undone.
          </p>
        </Modal>
      )}
    </section>
  );
}

// ── variables ───────────────────────────────────────────────────────────────

function VarsView({ text, revealAll, onSave }: { text: string; revealAll: boolean; onSave: (next: string) => Promise<boolean> }) {
  const entries = useMemo(() => {
    // Show each key once, with its effective (last) value.
    const record = toRecord(text);
    return Object.keys(record).map((key) => ({ key, value: record[key] }));
  }, [text]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [filter, setFilter] = useState('');

  const shown = entries.filter((e) => e.key.toLowerCase().includes(filter.toLowerCase()));
  const keyError = newKey && !isValidKey(newKey) ? 'Use letters, digits and _ (no spaces), not starting with a digit.' : '';

  const toggle = (key: string) =>
    setRevealed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function add() {
    if (!newKey || keyError) return;
    if (await onSave(setVar(text, newKey, newValue))) {
      setNewKey('');
      setNewValue('');
    }
  }

  return (
    <div className="vars">
      {entries.length > 6 && <input className="filter" placeholder="Filter keys…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      <div className="table-wrap">
        <table className="vars-table">
          <tbody>
            {shown.map(({ key, value }) => {
              const visible = revealAll || revealed.has(key);
              return (
                <tr key={key}>
                  <td className="key mono">{key}</td>
                  <td className="value mono">
                    {editing === key ? (
                      <form
                        className="inline-edit"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (await onSave(setVar(text, key, draft))) setEditing(null);
                        }}
                      >
                        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} spellCheck={false} />
                        <button className="icon-btn" title="Save">
                          <Icon name="check" size={14} />
                        </button>
                      </form>
                    ) : value === '' ? (
                      <span className="muted">empty</span>
                    ) : visible ? (
                      <span className="revealed">{value}</span>
                    ) : (
                      <span className="masked">{maskValue(value)}</span>
                    )}
                  </td>
                  <td className="row-actions">
                    {editing !== key && (
                      <>
                        {!revealAll && value !== '' && (
                          <button className="icon-btn" title={visible ? 'Hide' : 'Reveal'} onClick={() => toggle(key)}>
                            <Icon name={visible ? 'eyeOff' : 'eye'} size={14} />
                          </button>
                        )}
                        <CopyButton text={value} />
                        <button
                          className="icon-btn"
                          title="Edit"
                          onClick={() => {
                            setEditing(key);
                            setDraft(value);
                          }}
                        >
                          <Icon name="pencil" size={14} />
                        </button>
                        <button className="icon-btn" title="Remove" onClick={() => onSave(unsetVar(text, key))}>
                          <Icon name="trash" size={14} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className="muted center">
                  No variables yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <form
        className="add-var"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="mono" placeholder="NEW_KEY" value={newKey} onChange={(e) => setNewKey(e.target.value.trim())} spellCheck={false} aria-invalid={Boolean(keyError)} />
        <input className="mono" placeholder="value" value={newValue} onChange={(e) => setNewValue(e.target.value)} spellCheck={false} />
        <button className="btn" disabled={!newKey || Boolean(keyError)}>
          <Icon name="plus" size={14} /> Add
        </button>
      </form>
      {keyError && <p className="error-text small">{keyError}</p>}
    </div>
  );
}

// ── raw ─────────────────────────────────────────────────────────────────────

function RawView({ text, onSave }: { text: string; onSave: (next: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const dirty = draft !== text;
  return (
    <div className="raw">
      <textarea
        className="mono"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            if (dirty) onSave(draft);
          }
        }}
        spellCheck={false}
        rows={Math.min(28, Math.max(10, draft.split('\n').length + 2))}
        aria-label="Environment file"
      />
      <div className="raw-foot">
        <span className="muted small">{dirty ? 'Unsaved changes · Ctrl/⌘ + S to save' : 'Comments and ordering are kept exactly as written.'}</span>
        <button className="btn ghost" disabled={!dirty} onClick={() => setDraft(text)}>
          Revert
        </button>
        <button className="btn primary" disabled={!dirty} onClick={() => onSave(draft)}>
          Save
        </button>
      </div>
    </div>
  );
}

// ── compare ─────────────────────────────────────────────────────────────────

function CompareView(props: { backend: Backend; project: Project; env: string; text: string; envNames: string[]; revealAll: boolean }) {
  const others = props.envNames.filter((e) => e !== props.env);
  const [other, setOther] = useState(others[0] ?? '');
  const [otherText, setOtherText] = useState<string | null>(null);

  useEffect(() => {
    if (!other) return;
    setOtherText(null);
    props.backend.readEnv(props.project.id, other).then(setOtherText, () => setOtherText(''));
  }, [props.backend, props.project.id, other]);

  if (!other) return <div className="empty muted">Create a second environment to compare against.</div>;

  const a = toRecord(props.text);
  const b = toRecord(otherText ?? '');
  const d = otherText === null ? null : diffEnv(props.text, otherText);
  const show = (v: string | undefined) => (v === undefined ? '—' : v === '' ? '(empty)' : props.revealAll ? v : maskValue(v));
  const rows = d
    ? [
        ...d.changed.map((k) => ({ k, kind: 'changed' })),
        ...d.removed.map((k) => ({ k, kind: 'only-here' })),
        ...d.added.map((k) => ({ k, kind: 'only-there' })),
        ...d.unchanged.map((k) => ({ k, kind: 'same' })),
      ]
    : [];

  return (
    <div className="compare">
      <div className="compare-head">
        <span className="mono">{props.env}</span>
        <Icon name="diff" size={14} />
        <select value={other} onChange={(e) => setOther(e.target.value)}>
          {others.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        {d && (
          <span className="muted small">
            {d.changed.length} different · {d.removed.length} only in {props.env} · {d.added.length} only in {other} · {d.unchanged.length} same
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table className="vars-table compare-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>{props.env}</th>
              <th>{other}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ k, kind }) => (
              <tr key={k} className={kind}>
                <td className="key mono">{k}</td>
                <td className="value mono">{show(a[k])}</td>
                <td className="value mono">{show(b[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RenameModal(props: { env: string; onClose: () => void; onRename: (to: string) => Promise<void> }) {
  const [name, setName] = useState(props.env);
  const [error, setError] = useState('');
  const submit = async () => {
    try {
      await props.onRename(name.trim());
      props.onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title={`Rename ${props.env}`}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!name.trim() || name.trim() === props.env} onClick={submit}>
            Rename
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
          <span>New name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button hidden />
      </form>
    </Modal>
  );
}
