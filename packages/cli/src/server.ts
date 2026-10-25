import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { EnvxError, VAULT_METHODS, type Vault } from '@envx/core';
import { VERSION } from './version.js';
import { browseFolders } from './folders.js';

export interface ServeOptions {
  vault: Vault;
  token: string;
  port: number;
  host: string;
  /** Extra origins (e.g. the hosted PWA) allowed to call the API. */
  origins: string[];
  /** Serve the bundled web app as well as the API. */
  web: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const WEB_ROOT = fileURLToPath(new URL('../web', import.meta.url));
const METHODS = new Set<string>(VAULT_METHODS);
const MAX_BODY = 5 * 1024 * 1024;

/** `--origin` may be the full app URL (e.g. https://you.github.io/env-x); CORS only compares the origin. */
function toOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Local daemon: a token-protected JSON-RPC endpoint over the vault, plus the
 * bundled web app. Binds to loopback only, checks the Host header against
 * DNS rebinding and only answers CORS requests from allowed origins.
 */
export function startServer(opts: ServeOptions): Promise<{ url: string; close: () => void }> {
  const { vault, token, port, host } = opts;
  const selfHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const allowedOrigins = new Set([...[...selfHosts].map((h) => `http://${h}`), ...opts.origins.map(toOrigin)]);

  const server = createServer(async (req, res) => {
    try {
      if (!selfHosts.has(req.headers.host ?? '')) {
        return json(res, 421, { error: { code: 'INVALID', message: 'Unexpected Host header' } });
      }

      const origin = req.headers.origin;
      if (origin && allowedOrigins.has(origin)) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
        res.setHeader('access-control-allow-headers', 'authorization, content-type');
        res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
        // Chrome's Private Network Access preflight for https pages calling localhost.
        res.setHeader('access-control-allow-private-network', 'true');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(origin && allowedOrigins.has(origin) ? 204 : 403);
        return res.end();
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname === '/api/health') {
        return json(res, 200, { app: 'envx', version: VERSION });
      }

      if (url.pathname === '/api/rpc') {
        if (origin && !allowedOrigins.has(origin)) {
          return json(res, 403, { error: { code: 'INVALID', message: `Origin ${origin} is not allowed. Restart with --origin ${origin}` } });
        }
        const auth = req.headers.authorization ?? '';
        if (!safeEqual(auth, `Bearer ${token}`)) {
          return json(res, 401, { error: { code: 'INVALID', message: 'Missing or wrong token. Run `envx token` to see it.' } });
        }
        if (req.method !== 'POST') return json(res, 405, { error: { code: 'INVALID', message: 'POST only' } });
        const { method, args } = JSON.parse(await readBody(req)) as { method: string; args: unknown[] };
        if (!(METHODS.has(method) || method === 'browseFolders') || !Array.isArray(args)) {
          return json(res, 400, { error: { code: 'INVALID', message: `Unknown method ${method}` } });
        }
        try {
          // browseFolders is the one non-vault method: the web app's folder picker for the CLI vault.
          const result =
            method === 'browseFolders'
              ? await browseFolders(typeof args[0] === 'string' ? args[0] : undefined, await vault.listProjects())
              : await (vault as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method].apply(vault, args);
          return json(res, 200, { result: result ?? null });
        } catch (err) {
          if (err instanceof EnvxError) return json(res, 200, { error: { code: err.code, message: err.message } });
          const e = err as NodeJS.ErrnoException;
          return json(res, 200, { error: { code: e.code ?? 'ERROR', message: e.message } });
        }
      }

      if (opts.web && (req.method === 'GET' || req.method === 'HEAD')) return serveStatic(url.pathname, res);
      json(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    } catch (err) {
      json(res, 500, { error: { code: 'ERROR', message: (err as Error).message } });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({ url: `http://${host === '::1' ? '[::1]' : host}:${port}`, close: () => server.close() });
    });
  });
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(WEB_ROOT, rel);
  if (!file.startsWith(WEB_ROOT + sep) && file !== WEB_ROOT) return json(res, 403, { error: 'Forbidden' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
  } catch {
    file = join(WEB_ROOT, 'index.html'); // SPA fallback
  }
  try {
    const body = await readFile(file);
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('The web app is not bundled. Run `npm run build` at the repo root.');
  }
}
