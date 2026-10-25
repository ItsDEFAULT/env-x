import type { ProjectFS, VaultState, VaultStore } from './vault.js';

/** In-memory store, for tests and previews. */
export class MemoryStore implements VaultStore {
  state: VaultState | null = null;
  envs = new Map<string, string>();

  async loadState() {
    return this.state ? JSON.parse(JSON.stringify(this.state)) : null;
  }
  async saveState(state: VaultState) {
    this.state = JSON.parse(JSON.stringify(state));
  }
  async readEnv(projectId: string, env: string) {
    return this.envs.get(`${projectId}/${env}`) ?? null;
  }
  async writeEnv(projectId: string, env: string, text: string) {
    this.envs.set(`${projectId}/${env}`, text);
  }
  async deleteEnv(projectId: string, env: string) {
    this.envs.delete(`${projectId}/${env}`);
  }
  async deleteProject(projectId: string) {
    for (const key of [...this.envs.keys()]) if (key.startsWith(projectId + '/')) this.envs.delete(key);
  }
}

/** In-memory project filesystem keyed by `root/file`. */
export class MemoryFS implements ProjectFS {
  files = new Map<string, string>();

  async list(root: string) {
    const prefix = root + '/';
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }
  async read(root: string, file: string) {
    return this.files.get(`${root}/${file}`) ?? null;
  }
  async write(root: string, file: string, text: string) {
    this.files.set(`${root}/${file}`, text);
  }
}
