import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EnvxError, Vault, type ProjectFS, type VaultState, type VaultStore } from '@envx/core';

export function envxHome(): string {
  return process.env.ENVX_HOME || join(homedir(), '.envx');
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Write via a temp file + rename so a crash never leaves a half-written vault file. */
async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, path);
}

/**
 * Vault data under ~/.envx (or $ENVX_HOME):
 *   state.json               projects and their metadata
 *   envs/<project>/<env>.env one file per environment
 */
export class NodeStore implements VaultStore {
  constructor(private home = envxHome()) {}

  private envDir(projectId: string): string {
    return join(this.home, 'envs', projectId);
  }

  envPath(projectId: string, env: string): string {
    return join(this.envDir(projectId), `${env}.env`);
  }

  async loadState(): Promise<VaultState | null> {
    const text = await readOrNull(join(this.home, 'state.json'));
    return text ? (JSON.parse(text) as VaultState) : null;
  }

  async saveState(state: VaultState): Promise<void> {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    await writeAtomic(join(this.home, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  }

  async readEnv(projectId: string, env: string): Promise<string | null> {
    return readOrNull(this.envPath(projectId, env));
  }

  async writeEnv(projectId: string, env: string, text: string): Promise<void> {
    await mkdir(this.envDir(projectId), { recursive: true, mode: 0o700 });
    await writeAtomic(this.envPath(projectId, env), text);
  }

  async deleteEnv(projectId: string, env: string): Promise<void> {
    await rm(this.envPath(projectId, env), { force: true });
  }

  async deleteProject(projectId: string): Promise<void> {
    await rm(this.envDir(projectId), { recursive: true, force: true });
  }
}

export class NodeFS implements ProjectFS {
  async list(root: string): Promise<string[]> {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') throw new EnvxError('NOT_FOUND', `Folder not found: ${root}`);
      throw err;
    }
  }

  async read(root: string, file: string): Promise<string | null> {
    return readOrNull(join(root, file));
  }

  async write(root: string, file: string, text: string): Promise<void> {
    // Written in place (not renamed) so dev-server file watchers see a normal change.
    await writeFile(join(root, file), text);
  }

  async realpath(root: string): Promise<string> {
    const absolute = resolve(root);
    // Resolves symlinks (macOS /var → /private/var) and Windows short names (RUNNER~1).
    return realpath(absolute).catch(() => absolute);
  }
}

export function createVault(): { vault: Vault; store: NodeStore } {
  const store = new NodeStore();
  return { vault: new Vault(store, new NodeFS()), store };
}

/** Secret shared between the local daemon and the web app. */
export async function daemonToken(): Promise<string> {
  const path = join(envxHome(), 'token');
  const existing = (await readOrNull(path))?.trim();
  if (existing) return existing;
  const token = randomBytes(24).toString('base64url');
  await mkdir(envxHome(), { recursive: true, mode: 0o700 });
  await writeFile(path, token + '\n', { mode: 0o600 });
  return token;
}
