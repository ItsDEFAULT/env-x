import { EnvxError, type ProjectFS, type VaultState, type VaultStore } from '@envx/core';

/**
 * Browser mode: the vault lives in IndexedDB and project folders are reached
 * through File System Access API handles (Chromium browsers). A project's
 * `root` is the key of its stored directory handle, e.g. `handle:<uuid>`.
 */

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open('envx', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction('kv', mode).objectStore('kv');
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const kv = {
  get: <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key)),
  set: (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key)).then(() => undefined),
  del: (key: string) => tx('readwrite', (s) => s.delete(key)).then(() => undefined),
  keys: async (prefix: string) =>
    ((await tx('readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿')))) as string[]),
};

export class IdbStore implements VaultStore {
  async loadState() {
    return (await kv.get<VaultState>('state')) ?? null;
  }
  async saveState(state: VaultState) {
    await kv.set('state', state);
  }
  async readEnv(projectId: string, env: string) {
    return (await kv.get<string>(`env/${projectId}/${env}`)) ?? null;
  }
  async writeEnv(projectId: string, env: string, text: string) {
    await kv.set(`env/${projectId}/${env}`, text);
  }
  async deleteEnv(projectId: string, env: string) {
    await kv.del(`env/${projectId}/${env}`);
  }
  async deleteProject(projectId: string) {
    for (const key of await kv.keys(`env/${projectId}/`)) await kv.del(key);
  }
}

export const fsAccessSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

async function handleFor(root: string): Promise<FileSystemDirectoryHandle> {
  const handle = await kv.get<FileSystemDirectoryHandle>(root);
  if (!handle) throw new EnvxError('NOT_FOUND', 'Access to this folder was lost. Remove the project and import it again.');
  return handle;
}

/** Current permission for a project folder; `request` must run inside a click handler. */
export async function folderPermission(root: string, request = false): Promise<PermissionState> {
  const handle = await handleFor(root);
  const state = await handle.queryPermission({ mode: 'readwrite' });
  if (state === 'granted' || !request) return state;
  return handle.requestPermission({ mode: 'readwrite' });
}

export class HandleFS implements ProjectFS {
  private async dir(root: string): Promise<FileSystemDirectoryHandle> {
    const handle = await handleFor(root);
    let state = await handle.queryPermission({ mode: 'readwrite' });
    if (state !== 'granted') {
      // Succeeds when called during a user gesture; otherwise the UI offers an "Allow access" button.
      state = await handle.requestPermission({ mode: 'readwrite' }).catch(() => state);
    }
    if (state !== 'granted') {
      throw new EnvxError('PERMISSION', `envx needs permission to read and write the "${handle.name}" folder.`);
    }
    return handle;
  }

  async list(root: string) {
    const names: string[] = [];
    for await (const [name, entry] of (await this.dir(root)).entries()) if (entry.kind === 'file') names.push(name);
    return names;
  }

  async read(root: string, file: string) {
    const dir = await this.dir(root);
    try {
      return await (await (await dir.getFileHandle(file)).getFile()).text();
    } catch (err) {
      if ((err as DOMException).name === 'NotFoundError') return null;
      throw err;
    }
  }

  async write(root: string, file: string, text: string) {
    const fh = await (await this.dir(root)).getFileHandle(file, { create: true });
    const writable = await fh.createWritable();
    await writable.write(text);
    await writable.close();
  }
}

/** Ask the user for a project folder; reuses the stored handle if that folder was picked before. */
export async function pickProjectFolder(): Promise<{ root: string; name: string }> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'envx-project' });
  for (const key of await kv.keys('handle:')) {
    const existing = await kv.get<FileSystemDirectoryHandle>(key);
    if (existing && (await existing.isSameEntry(handle))) return { root: key, name: handle.name };
  }
  const key = `handle:${crypto.randomUUID()}`;
  await kv.set(key, handle);
  return { root: key, name: handle.name };
}

export async function forgetFolder(root: string): Promise<void> {
  if (root.startsWith('handle:')) await kv.del(root);
}
