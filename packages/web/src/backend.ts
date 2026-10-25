import { EnvxError, Vault, VAULT_METHODS, type ErrorCode, type FolderListing, type VaultMethod } from '@envx/core';
import { HandleFS, IdbStore } from './browser';

/** Everything the UI can ask of a vault, whether it runs in this tab or behind the local daemon. */
export type Backend = Pick<Vault, VaultMethod>;

export type Mode = { kind: 'browser' } | { kind: 'remote'; url: string; token: string };

const MODE_KEY = 'envx.mode';

export function loadMode(): Mode | null {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    return raw ? (JSON.parse(raw) as Mode) : null;
  } catch {
    return null;
  }
}

export function saveMode(mode: Mode | null): void {
  try {
    if (mode) localStorage.setItem(MODE_KEY, JSON.stringify(mode));
    else localStorage.removeItem(MODE_KEY);
  } catch {
    // Storage blocked: the mode just won't be remembered.
  }
}

/**
 * `envx ui` opens `/#token=…`; `envx serve --origin` prints `/#connect=<url>&token=…`.
 * Either means "connect to that daemon"; the fragment is cleared so the token doesn't linger.
 */
export function modeFromLocation(): Mode | null {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('token');
  if (!token) return null;
  const url = (params.get('connect') ?? location.origin).replace(/\/+$/, '');
  history.replaceState(null, '', location.pathname + location.search);
  return { kind: 'remote', url, token };
}

export function createBackend(mode: Mode): Backend {
  if (mode.kind === 'browser') return new Vault(new IdbStore(), new HandleFS());
  return remoteBackend(mode.url, mode.token);
}

async function rpc(url: string, token: string, method: string, args: unknown[]): Promise<unknown> {
  // JSON turns a trailing `undefined` into `null`, which would defeat default parameters.
  while (args.length && args[args.length - 1] === undefined) args.pop();
  let res: Response;
  try {
    res = await fetch(`${url}/api/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, args }),
    });
  } catch {
    // From a hosted copy, Chrome also blocks this until the user allows local network access.
    const hint = new URL(url).origin === location.origin ? '' : ' If your browser asked to let this site access apps on your device, choose Allow.';
    throw new EnvxError('INVALID', `Can't reach envx at ${url}. Is \`envx serve\` running?${hint}`);
  }
  const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: { code: string; message: string } };
  if (body.error) throw new EnvxError(body.error.code as ErrorCode, body.error.message);
  if (!res.ok) throw new EnvxError('INVALID', `envx responded with HTTP ${res.status}`);
  return body.result;
}

function remoteBackend(url: string, token: string): Backend {
  return Object.fromEntries(VAULT_METHODS.map((m) => [m, (...args: unknown[]) => rpc(url, token, m, args)])) as unknown as Backend;
}

/** List folders on the envx server's machine, for the CLI vault's folder picker. */
export function browseFolders(mode: Extract<Mode, { kind: 'remote' }>, path?: string): Promise<FolderListing> {
  return rpc(mode.url, mode.token, 'browseFolders', [path]) as Promise<FolderListing>;
}

export async function checkDaemon(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/health`, { signal: AbortSignal.timeout(2000) });
    return ((await res.json()) as { app?: string }).app === 'envx';
  } catch {
    return false;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function errorCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code;
}
