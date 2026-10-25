import { diffEnv, hashText, isValidKey, parseEnv, setVar, unsetVar, type EnvDiff } from './parse.js';

export interface Project {
  id: string;
  name: string;
  /** Location of the project. A filesystem path for Node; an opaque handle key in the browser. */
  root: string;
  /** File (relative to root) that receives the active environment, usually `.env`. */
  target: string;
  envs: string[];
  active: string | null;
  /** Hash of what envx last wrote to the target; anything else there is drift. */
  writtenHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VaultState {
  version: 1;
  projects: Project[];
}

/** Where the vault keeps its own data. */
export interface VaultStore {
  loadState(): Promise<VaultState | null>;
  saveState(state: VaultState): Promise<void>;
  readEnv(projectId: string, env: string): Promise<string | null>;
  writeEnv(projectId: string, env: string, text: string): Promise<void>;
  deleteEnv(projectId: string, env: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}

/** Access to the user's project directories. */
export interface ProjectFS {
  /** File names (not directories) directly inside `root`. */
  list(root: string): Promise<string[]>;
  read(root: string, file: string): Promise<string | null>;
  write(root: string, file: string, text: string): Promise<void>;
}

export type ErrorCode = 'NOT_FOUND' | 'EXISTS' | 'INVALID' | 'DRIFT' | 'NO_PROJECT' | 'PERMISSION';

export class EnvxError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EnvxError';
  }
}

/** What to do when the target file was edited outside envx. */
export type DriftPolicy = 'save' | 'discard' | 'error';

export interface EnvSummary {
  name: string;
  active: boolean;
  keys: number;
}

export interface ProjectStatus {
  project: Project;
  active: string | null;
  targetExists: boolean;
  /** True when the target file differs from what envx last wrote. */
  drift: boolean;
}

export interface SwitchResult {
  project: Project;
  from: string | null;
  to: string;
  drift: 'none' | 'saved' | 'discarded';
  /** Env that received the drifted edits, when drift === 'saved'. */
  savedTo?: string;
}

export interface ImportResult {
  project: Project;
  created: boolean;
  imported: { env: string; file: string }[];
  skipped: { file: string; reason: string }[];
}

const ENV_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TEMPLATE_SUFFIXES = ['example', 'sample', 'template', 'dist', 'defaults', 'schema', 'vault', 'keys', 'me'];
const HEADER_PREFIX = '# envx:';

export function isValidEnvName(name: string): boolean {
  return ENV_NAME_RE.test(name);
}

/** `.env` files worth importing; templates like `.env.example` are not environments. */
export function isEnvFile(file: string): boolean {
  if (!/^\.env(\.[A-Za-z0-9._-]+)?$/.test(file)) return false;
  const suffix = file.split('.').pop()!.toLowerCase();
  return !TEMPLATE_SUFFIXES.includes(suffix);
}

/** `.env` → `default`, `.env.staging` → `staging`, `.env.production.local` → `production.local`. */
export function envNameForFile(file: string): string {
  return file === '.env' ? 'default' : file.slice('.env.'.length);
}

const ENV_ORDER = ['default', 'local', 'dev', 'development', 'test', 'staging', 'preview', 'prod', 'production'];

/** Familiar environments first, in pipeline order; anything else alphabetically after. */
export function compareEnvNames(a: string, b: string): number {
  const rank = (n: string) => {
    const i = ENV_ORDER.indexOf(n.split('.')[0].toLowerCase());
    return i < 0 ? ENV_ORDER.length : i;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

export function managedHeader(env: string): string {
  return `${HEADER_PREFIX} ${env} (managed by envx; edits here are saved back to "${env}" on the next switch)`;
}

export function stripHeader(text: string): string {
  if (!text.startsWith(HEADER_PREFIX)) return text;
  const nl = text.indexOf('\n');
  return nl < 0 ? '' : text.slice(nl + 1);
}

export function normalizePath(p: string): string {
  let out = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^[A-Za-z]:/.test(out)) out = out.toLowerCase();
  return out;
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function newId(): string {
  return Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8);
}

function now(): string {
  return new Date().toISOString();
}

/**
 * The envx vault: a set of projects, each with named environments and a target
 * file that holds the active one. State is reloaded on every call so that the
 * CLI, the local daemon and the MCP server can share one vault safely.
 */
export class Vault {
  constructor(
    private store: VaultStore,
    private fs: ProjectFS,
  ) {}

  private async load(): Promise<VaultState> {
    return (await this.store.loadState()) ?? { version: 1, projects: [] };
  }

  private async commit(state: VaultState, project?: Project): Promise<void> {
    if (project) project.updatedAt = now();
    await this.store.saveState(state);
  }

  private resolve(state: VaultState, ref: string): Project {
    const lower = ref.toLowerCase();
    const norm = normalizePath(ref);
    const project =
      state.projects.find((p) => p.id === ref) ??
      state.projects.find((p) => p.name.toLowerCase() === lower) ??
      state.projects.find((p) => normalizePath(p.root) === norm);
    if (!project) throw new EnvxError('NOT_FOUND', `No project "${ref}". Run \`envx ls\` to see imported projects.`);
    return project;
  }

  private requireEnv(project: Project, env: string): void {
    if (!project.envs.includes(env)) {
      throw new EnvxError(
        'NOT_FOUND',
        `Project "${project.name}" has no environment "${env}". Available: ${project.envs.join(', ') || '(none)'}`,
      );
    }
  }

  private async envText(project: Project, env: string): Promise<string> {
    return (await this.store.readEnv(project.id, env)) ?? '';
  }

  private async readTarget(project: Project): Promise<string | null> {
    return this.fs.read(project.root, project.target);
  }

  private isDrift(project: Project, current: string | null): boolean {
    return current !== null && hashText(current) !== project.writtenHash;
  }

  private async applyTarget(project: Project, env: string, text: string): Promise<void> {
    const body = text.endsWith('\n') || text === '' ? text : text + '\n';
    const content = `${managedHeader(env)}\n${body}`;
    await this.fs.write(project.root, project.target, content);
    project.writtenHash = hashText(content);
  }

  private uniqueEnvName(project: Project, base: string): string {
    let name = base;
    for (let i = 2; project.envs.includes(name); i++) name = `${base}-${i}`;
    return name;
  }

  // ── projects ────────────────────────────────────────────────────────────

  async listProjects(): Promise<Project[]> {
    return (await this.load()).projects;
  }

  async getProject(ref: string): Promise<Project> {
    return this.resolve(await this.load(), ref);
  }

  /** The project whose root contains `path` (deepest match wins). */
  async findProjectForPath(path: string): Promise<Project | null> {
    const norm = normalizePath(path);
    let best: Project | null = null;
    for (const p of (await this.load()).projects) {
      const root = normalizePath(p.root);
      if ((norm === root || norm.startsWith(root + '/')) && (!best || root.length > best.root.length)) best = p;
    }
    return best;
  }

  /**
   * Import every `.env*` file in `root` as an environment. Re-importing an
   * existing project adds environments it does not have yet.
   */
  async importProject(opts: { root: string; name?: string; target?: string }): Promise<ImportResult> {
    const state = await this.load();
    const norm = normalizePath(opts.root);
    let project = state.projects.find((p) => normalizePath(p.root) === norm);
    const created = !project;

    if (!project) {
      let name = opts.name?.trim() || basename(opts.root);
      const taken = new Set(state.projects.map((p) => p.name.toLowerCase()));
      const base = name;
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}-${i}`;
      project = {
        id: newId(),
        name,
        root: opts.root,
        target: opts.target ?? '.env',
        envs: [],
        active: null,
        writtenHash: null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.projects.push(project);
    }

    const result: ImportResult = { project, created, imported: [], skipped: [] };
    const files = (await this.fs.list(opts.root)).filter(isEnvFile).sort();
    const targetRaw = files.includes(project.target) ? await this.fs.read(opts.root, project.target) : null;
    const targetBody = targetRaw === null ? null : stripHeader(targetRaw);
    const contents = new Map<string, string>();

    for (const file of files) {
      if (file === project.target) continue;
      contents.set(file, (await this.fs.read(opts.root, file)) ?? '');
    }

    // The target usually duplicates one of the other files; only keep it if it is unique.
    let targetMatch: string | null = null;
    for (const [file, text] of contents) if (targetBody !== null && text === targetBody) targetMatch = file;
    if (targetBody !== null && !targetMatch) {
      contents.set(project.target, targetBody);
    } else if (targetMatch) {
      result.skipped.push({ file: project.target, reason: `same content as ${targetMatch}` });
    }

    for (const [file, text] of contents) {
      const env = file === project.target ? 'default' : envNameForFile(file);
      if (!isValidEnvName(env)) {
        result.skipped.push({ file, reason: `"${env}" is not a valid environment name` });
        continue;
      }
      if (project.envs.includes(env)) {
        result.skipped.push({ file, reason: `environment "${env}" already exists` });
        continue;
      }
      await this.store.writeEnv(project.id, env, text);
      project.envs.push(env);
      result.imported.push({ env, file });
    }

    if (created) project.envs.sort(compareEnvNames);
    result.imported.sort((a, b) => compareEnvNames(a.env, b.env));
    if (created && targetRaw !== null) {
      const activeFile = targetMatch ?? project.target;
      project.active = activeFile === project.target ? 'default' : envNameForFile(activeFile);
      // What is on disk now is the baseline, so the first switch is not treated as drift.
      project.writtenHash = hashText(targetRaw);
    }

    await this.commit(state, project);
    return result;
  }

  async updateProject(ref: string, patch: { name?: string; target?: string }): Promise<Project> {
    const state = await this.load();
    const project = this.resolve(state, ref);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new EnvxError('INVALID', 'Project name cannot be empty.');
      if (state.projects.some((p) => p !== project && p.name.toLowerCase() === name.toLowerCase())) {
        throw new EnvxError('EXISTS', `A project named "${name}" already exists.`);
      }
      project.name = name;
    }
    if (patch.target !== undefined && patch.target !== project.target) {
      if (!/^[^/\\]+$/.test(patch.target)) throw new EnvxError('INVALID', 'Target must be a file name inside the project root.');
      project.target = patch.target;
      project.writtenHash = null;
    }
    await this.commit(state, project);
    return project;
  }

  /** Forget a project. Its files on disk are left untouched. */
  async removeProject(ref: string): Promise<void> {
    const state = await this.load();
    const project = this.resolve(state, ref);
    state.projects = state.projects.filter((p) => p !== project);
    await this.store.deleteProject(project.id);
    await this.commit(state);
  }

  async status(ref: string): Promise<ProjectStatus> {
    const project = await this.getProject(ref);
    const current = await this.readTarget(project);
    return {
      project,
      active: project.active,
      targetExists: current !== null,
      drift: this.isDrift(project, current),
    };
  }

  // ── environments ────────────────────────────────────────────────────────

  async listEnvs(ref: string): Promise<EnvSummary[]> {
    const project = await this.getProject(ref);
    return Promise.all(
      project.envs.map(async (name) => ({
        name,
        active: name === project.active,
        keys: new Set(parseEnv(await this.envText(project, name)).map((e) => e.key)).size,
      })),
    );
  }

  async readEnv(ref: string, env: string): Promise<string> {
    const project = await this.getProject(ref);
    this.requireEnv(project, env);
    return this.envText(project, env);
  }

  /**
   * Create or replace an environment. Saving the active environment rewrites
   * the target file too, unless that file has unsaved outside edits.
   */
  async saveEnv(ref: string, env: string, text: string, opts: { force?: boolean } = {}): Promise<Project> {
    const state = await this.load();
    const project = this.resolve(state, ref);
    if (!project.envs.includes(env)) {
      if (!isValidEnvName(env)) throw new EnvxError('INVALID', `"${env}" is not a valid environment name (letters, digits, . _ -).`);
      project.envs.push(env);
    }
    if (project.active === env) {
      if (!opts.force && this.isDrift(project, await this.readTarget(project))) {
        throw new EnvxError(
          'DRIFT',
          `${project.target} in "${project.name}" was edited outside envx. Pull those edits first or save with force to overwrite them.`,
        );
      }
      await this.applyTarget(project, env, text);
    }
    await this.store.writeEnv(project.id, env, text);
    await this.commit(state, project);
    return project;
  }

  async createEnv(ref: string, env: string, opts: { from?: string } = {}): Promise<Project> {
    const project = await this.getProject(ref);
    if (project.envs.includes(env)) throw new EnvxError('EXISTS', `Environment "${env}" already exists.`);
    let text = '';
    if (opts.from) {
      this.requireEnv(project, opts.from);
      text = await this.envText(project, opts.from);
    }
    return this.saveEnv(project.id, env, text);
  }

  async renameEnv(ref: string, from: string, to: string): Promise<Project> {
    const state = await this.load();
    const project = this.resolve(state, ref);
    this.requireEnv(project, from);
    if (from === to) return project;
    if (!isValidEnvName(to)) throw new EnvxError('INVALID', `"${to}" is not a valid environment name (letters, digits, . _ -).`);
    if (project.envs.includes(to)) throw new EnvxError('EXISTS', `Environment "${to}" already exists.`);
    const text = await this.envText(project, from);
    await this.store.writeEnv(project.id, to, text);
    await this.store.deleteEnv(project.id, from);
    project.envs = project.envs.map((e) => (e === from ? to : e));
    if (project.active === from) {
      project.active = to;
      const current = await this.readTarget(project);
      // Refresh the header so it names the new env, but never clobber outside edits.
      if (!this.isDrift(project, current)) await this.applyTarget(project, to, text);
    }
    await this.commit(state, project);
    return project;
  }

  async deleteEnv(ref: string, env: string): Promise<Project> {
    const state = await this.load();
    const project = this.resolve(state, ref);
    this.requireEnv(project, env);
    if (project.active === env) {
      throw new EnvxError('INVALID', `"${env}" is the active environment of "${project.name}". Switch to another one first.`);
    }
    await this.store.deleteEnv(project.id, env);
    project.envs = project.envs.filter((e) => e !== env);
    await this.commit(state, project);
    return project;
  }

  async setVars(ref: string, env: string, vars: Record<string, string>, opts: { force?: boolean } = {}): Promise<Project> {
    const bad = Object.keys(vars).filter((key) => !isValidKey(key));
    if (bad.length) {
      throw new EnvxError('INVALID', `Invalid variable name: ${bad.map((k) => JSON.stringify(k)).join(', ')}. Use letters, digits and _, not starting with a digit.`);
    }
    let text = await this.readEnv(ref, env);
    for (const [key, value] of Object.entries(vars)) text = setVar(text, key, value);
    return this.saveEnv(ref, env, text, opts);
  }

  async unsetVars(ref: string, env: string, keys: string[], opts: { force?: boolean } = {}): Promise<Project> {
    let text = await this.readEnv(ref, env);
    for (const key of keys) text = unsetVar(text, key);
    return this.saveEnv(ref, env, text, opts);
  }

  async diffEnvs(ref: string, from: string, to: string): Promise<EnvDiff> {
    const project = await this.getProject(ref);
    this.requireEnv(project, from);
    this.requireEnv(project, to);
    return diffEnv(await this.envText(project, from), await this.envText(project, to));
  }

  // ── switching ───────────────────────────────────────────────────────────

  /**
   * Make `env` the active environment by writing it to the project's target file.
   * Outside edits to the target are, by default, saved into the previously active env.
   */
  async switchEnv(ref: string, env: string, opts: { onDrift?: DriftPolicy } = {}): Promise<SwitchResult> {
    const policy = opts.onDrift ?? 'save';
    const state = await this.load();
    const project = this.resolve(state, ref);
    this.requireEnv(project, env);
    const from = project.active;
    const result: SwitchResult = { project, from, to: env, drift: 'none' };

    const current = await this.readTarget(project);
    if (this.isDrift(project, current)) {
      if (policy === 'error') {
        throw new EnvxError('DRIFT', `${project.target} in "${project.name}" was edited outside envx.`);
      }
      if (policy === 'save') {
        const savedTo = from && project.envs.includes(from) ? from : this.uniqueEnvName(project, 'unsaved');
        if (!project.envs.includes(savedTo)) project.envs.push(savedTo);
        await this.store.writeEnv(project.id, savedTo, stripHeader(current!));
        result.drift = 'saved';
        result.savedTo = savedTo;
      } else {
        result.drift = 'discarded';
      }
    }

    await this.applyTarget(project, env, await this.envText(project, env));
    project.active = env;
    await this.commit(state, project);
    return result;
  }

  /** Save outside edits of the target file into the active environment. */
  async pull(ref: string): Promise<Project> {
    const state = await this.load();
    const project = this.resolve(state, ref);
    const current = await this.readTarget(project);
    if (current === null) throw new EnvxError('NOT_FOUND', `${project.target} does not exist in "${project.name}".`);
    const env = project.active ?? this.uniqueEnvName(project, 'unsaved');
    if (!project.envs.includes(env)) project.envs.push(env);
    const body = stripHeader(current);
    await this.store.writeEnv(project.id, env, body);
    project.active = env;
    await this.applyTarget(project, env, body);
    await this.commit(state, project);
    return project;
  }
}
