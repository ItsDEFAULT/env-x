import { access, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';
import { EnvxError, isEnvFile, normalizePath, type FolderEntry, type FolderListing, type Project } from '@envx/core';

const WINDOWS = process.platform === 'win32';
// Folders nobody keeps a project in; listing them only adds noise and slow scans.
const SKIP = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);
const MAX_FOLDERS = 400;
const MAX_SHORTCUTS = 6;

async function windowsDrives(): Promise<string[]> {
  const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
  const found = await Promise.all(
    letters.map((l) =>
      access(`${l}:\\`).then(
        () => `${l}:\\`,
        () => null,
      ),
    ),
  );
  return found.filter((d): d is string => d !== null);
}

async function envFilesIn(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && isEnvFile(e.name)).map((e) => e.name).sort();
  } catch {
    return []; // unreadable folders simply show no badge
  }
}

/** Run `fn` over `items`, at most `limit` at a time, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function crumbsFor(path: string): FolderListing['crumbs'] {
  const crumbs: FolderListing['crumbs'] = WINDOWS ? [{ name: 'This PC', path: '' }] : [];
  const { root } = parse(path);
  crumbs.push({ name: WINDOWS ? root.replace(/\\$/, '') : '/', path: root });
  let current = root;
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}

function shortcutsFor(projects: Pick<Project, 'root'>[]): FolderListing['shortcuts'] {
  const shortcuts = [{ label: 'Home', path: homedir() }];
  // Folders that already hold projects are the likeliest place for the next one.
  for (const p of projects) {
    if (shortcuts.length >= MAX_SHORTCUTS) break;
    const parent = dirname(p.root);
    if (!shortcuts.some((s) => normalizePath(s.path) === normalizePath(parent))) {
      shortcuts.push({ label: basename(parent) || parent, path: parent });
    }
  }
  if (WINDOWS) shortcuts.push({ label: 'This PC', path: '' });
  return shortcuts;
}

/**
 * List the folders inside `input` (default: the home folder) for the web app's folder browser.
 * Only folder names and .env file names are returned, never file contents.
 */
export async function browseFolders(input: string | undefined, projects: Pick<Project, 'name' | 'root'>[]): Promise<FolderListing> {
  const byRoot = new Map(projects.map((p) => [normalizePath(p.root), p.name]));
  const projectAt = (path: string) => byRoot.get(normalizePath(path));
  const shortcuts = shortcutsFor(projects);

  if (WINDOWS && input === '') {
    const folders = (await windowsDrives()).map((d) => ({ name: d.slice(0, 2), path: d, hasEnv: false }));
    return { path: '', parent: null, crumbs: [{ name: 'This PC', path: '' }], folders, envFiles: [], shortcuts, truncated: false };
  }

  const requested = resolve(input?.trim() || homedir());
  // List the real path, so folders match project roots (which are stored resolved) and
  // breadcrumbs show where the folder actually is.
  const path = await realpath(requested).catch(() => requested);
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new EnvxError('NOT_FOUND', `Folder not found: ${path}`);
    if (code === 'ENOTDIR') throw new EnvxError('INVALID', `Not a folder: ${path}`);
    if (code === 'EACCES' || code === 'EPERM') throw new EnvxError('PERMISSION', `envx isn't allowed to read ${path}`);
    throw err;
  }

  const names = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const folders = await mapLimit(names.slice(0, MAX_FOLDERS), 32, async (name): Promise<FolderEntry> => {
    const full = join(path, name);
    return { name, path: full, hasEnv: (await envFilesIn(full)).length > 0, project: projectAt(full) };
  });

  const up = dirname(path);
  return {
    path,
    parent: up !== path ? up : WINDOWS ? '' : null,
    crumbs: crumbsFor(path),
    folders,
    envFiles: entries.filter((e) => e.isFile() && isEnvFile(e.name)).map((e) => e.name).sort(),
    project: projectAt(path),
    shortcuts,
    truncated: names.length > MAX_FOLDERS,
  };
}
