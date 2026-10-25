import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const base = mkdtempSync(join(tmpdir(), 'envx-test-'));
const home = join(base, 'home');
const app = join(base, 'my-app');
mkdirSync(app);
writeFileSync(join(app, '.env'), 'API_URL=http://localhost:3000\nSECRET=local-secret\n');
writeFileSync(join(app, '.env.staging'), 'API_URL=https://staging.example.com\nSECRET=staging-secret-value\n');
writeFileSync(join(app, '.env.example'), 'API_URL=\n');

const env = { ...process.env, ENVX_HOME: home, NO_COLOR: '1' };

function envx(...args) {
  return execFileSync(process.execPath, [BIN, ...args], { cwd: app, env, encoding: 'utf8' });
}
const envxJson = (...args) => JSON.parse(envx(...args, '--json'));

test('import, switch, set, diff via the CLI', () => {
  const imported = envxJson('import');
  assert.equal(imported.project.name, 'my-app');
  assert.deepEqual(imported.project.envs.sort(), ['default', 'staging']);

  const [switched] = envxJson('use', 'staging');
  assert.equal(switched.to, 'staging');
  const dotenv = readFileSync(join(app, '.env'), 'utf8');
  assert.match(dotenv, /^# envx: staging/);
  assert.match(dotenv, /API_URL=https:\/\/staging\.example\.com/);

  envx('set', 'FEATURE_FLAG=on');
  assert.match(readFileSync(join(app, '.env'), 'utf8'), /FEATURE_FLAG=on/);

  const shown = envxJson('show');
  assert.equal(shown.variables.FEATURE_FLAG, '••••••');
  assert.equal(envxJson('show', '--reveal').variables.SECRET, 'staging-secret-value');

  const diff = envxJson('diff', 'default');
  assert.deepEqual(diff.removed, ['FEATURE_FLAG']);
  assert.deepEqual(diff.changed.sort(), ['API_URL', 'SECRET']);

  // Hand edit the .env, then switch: the edit lands in staging.
  writeFileSync(join(app, '.env'), readFileSync(join(app, '.env'), 'utf8') + 'HAND=edited\n');
  assert.equal(envxJson('status').drift, true);
  const [back] = envxJson('use', 'default');
  assert.equal(back.savedTo, 'staging');
  assert.match(envx('show', 'staging'), /HAND=/);

  envx('new', 'production', '--from', 'staging');
  envx('rename', 'production', 'prod');
  assert.deepEqual(envxJson('envs').map((e) => e.name).sort(), ['default', 'prod', 'staging']);
});

test('a symlinked path reaches the same project', () => {
  const link = join(base, 'my-app-link');
  symlinkSync(app, link, 'junction'); // a junction on Windows (no admin needed), a symlink elsewhere
  const r = JSON.parse(execFileSync(process.execPath, [BIN, 'import', '--json'], { cwd: link, env, encoding: 'utf8' }));
  assert.equal(r.created, false, 'importing through the link does not create a second project');
  const status = JSON.parse(execFileSync(process.execPath, [BIN, 'status', '--json'], { cwd: link, env, encoding: 'utf8' }));
  assert.equal(status.project.name, 'my-app');
  assert.equal(envxJson('ls').length, 1);
});

test('errors are reported with a non-zero exit code', () => {
  assert.throws(() => envx('use', 'nope'), /no environment "nope"/);
  assert.throws(() => envx('import', join(base, 'missing-dir')), /Folder not found/);
  assert.throws(
    () => execFileSync(process.execPath, [BIN, 'status'], { cwd: base, env, encoding: 'utf8', stdio: 'pipe' }),
    (err) => err.status === 2,
  );
});

test('MCP server lists tools and switches environments', async () => {
  const child = spawn(process.execPath, [BIN, 'mcp'], { cwd: app, env });
  const pending = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      pending.get(msg.id)?.(msg);
    }
  });
  let nextId = 1;
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });

  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'envx');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    const list = await call('tools/list', {});
    assert.ok(list.result.tools.some((t) => t.name === 'envx_switch_environment'));

    const res = await call('tools/call', { name: 'envx_switch_environment', arguments: { environment: 'staging' } });
    assert.equal(res.result.isError, undefined);
    assert.equal(JSON.parse(res.result.content[0].text).to, 'staging');

    const shown = await call('tools/call', { name: 'envx_show_environment', arguments: {} });
    const vars = JSON.parse(shown.result.content[0].text).variables;
    assert.ok(!Object.values(vars).includes('staging-secret-value'), 'values are masked');

    const bad = await call('tools/call', { name: 'envx_switch_environment', arguments: { environment: 'nope' } });
    assert.equal(bad.result.isError, true);
  } finally {
    child.kill();
  }
});

test('daemon requires a token and serves RPC', async () => {
  const child = spawn(process.execPath, [BIN, 'serve', '--port', '4399', '--origin', 'https://you.github.io/env-x/'], { cwd: app, env });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => String(d).includes('running') && resolve());
      child.on('exit', reject);
    });
    const token = envx('token').trim();
    const rpc = (auth, body) =>
      fetch('http://127.0.0.1:4399/api/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify(body),
      });
    assert.equal((await rpc(null, { method: 'listProjects', args: [] })).status, 401);
    const ok = await (await rpc(token, { method: 'listProjects', args: [] })).json();
    assert.equal(ok.result[0].name, 'my-app');
    const denied = await fetch('http://127.0.0.1:4399/api/rpc', {
      method: 'POST',
      headers: { origin: 'https://evil.example', authorization: `Bearer ${token}` },
      body: '{}',
    });
    assert.equal(denied.status, 403);
    // --origin was given as a full app URL with a path; requests from its origin are allowed.
    const hosted = await fetch('http://127.0.0.1:4399/api/rpc', {
      method: 'POST',
      headers: { origin: 'https://you.github.io', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'listProjects', args: [] }),
    });
    assert.equal(hosted.status, 200);

    // Folder picker for the CLI vault: lists folders, flags .env folders and imported projects.
    const listing = (await (await rpc(token, { method: 'browseFolders', args: [base] })).json()).result;
    const myApp = listing.folders.find((f) => f.name === 'my-app');
    assert.equal(myApp.hasEnv, true);
    assert.equal(myApp.project, 'my-app');
    assert.ok(!listing.folders.some((f) => f.name === 'home' && f.hasEnv), 'folders without .env files are not flagged');
    // Listings use real paths: symlinks resolved (macOS /var -> /private/var) and Windows short
    // names expanded (RUNNER~1). Only the native realpath expands short names, as envx does.
    assert.equal(listing.crumbs.at(-1).path, realpathSync.native(base));
    const inside = (await (await rpc(token, { method: 'browseFolders', args: [app] })).json()).result;
    assert.deepEqual(inside.envFiles, ['.env', '.env.staging']);
    assert.equal(inside.parent, realpathSync.native(base));
    const missing = await (await rpc(token, { method: 'browseFolders', args: [join(base, 'nope')] })).json();
    assert.equal(missing.error.code, 'NOT_FOUND');
    assert.equal((await rpc(null, { method: 'browseFolders', args: [base] })).status, 401);
    assert.equal(hosted.headers.get('access-control-allow-origin'), 'https://you.github.io');
  } finally {
    child.kill();
  }
});
