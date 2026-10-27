import test from 'node:test';
import assert from 'node:assert/strict';
import { Vault, MemoryStore, MemoryFS, stripHeader } from '../dist/index.js';

function setup(files) {
  const store = new MemoryStore();
  const fs = new MemoryFS();
  for (const [name, text] of Object.entries(files)) fs.files.set(`/app/${name}`, text);
  return { vault: new Vault(store, fs), store, fs };
}

test('import picks up env files, skips templates and dedupes the target', async () => {
  const { vault } = setup({
    '.env': 'A=dev\n',
    '.env.development': 'A=dev\n',
    '.env.production': 'A=prod\n',
    '.env.example': 'A=\n',
    'package.json': '{}',
  });
  const res = await vault.importProject({ root: '/app' });
  assert.equal(res.project.name, 'app');
  assert.deepEqual(res.imported.map((i) => i.env).sort(), ['development', 'production']);
  assert.equal(res.project.active, 'development');
  const status = await vault.status('app');
  assert.equal(status.drift, false);
});

test('switching writes the target with a header', async () => {
  const { vault, fs } = setup({ '.env': 'A=local\n', '.env.staging': 'A=staging\n' });
  await vault.importProject({ root: '/app' });
  const res = await vault.switchEnv('app', 'staging');
  assert.equal(res.from, 'default');
  assert.equal(res.drift, 'none');
  const written = fs.files.get('/app/.env');
  assert.match(written, /^# envx: staging/);
  assert.equal(stripHeader(written), 'A=staging\n');
});

test('outside edits are saved into the active env on switch', async () => {
  const { vault, fs } = setup({ '.env': 'A=local\n', '.env.staging': 'A=staging\n' });
  await vault.importProject({ root: '/app' });
  await vault.switchEnv('app', 'staging');
  fs.files.set('/app/.env', fs.files.get('/app/.env') + 'NEW=1\n');
  assert.equal((await vault.status('app')).drift, true);
  const res = await vault.switchEnv('app', 'default');
  assert.equal(res.drift, 'saved');
  assert.equal(res.savedTo, 'staging');
  assert.equal(await vault.readEnv('app', 'staging'), 'A=staging\nNEW=1\n');
  await assert.rejects(() => vault.switchEnv('app', 'staging', { onDrift: 'error' }).then(() => {
    fs.files.set('/app/.env', 'X=1\n');
    return vault.switchEnv('app', 'default', { onDrift: 'error' });
  }), /edited outside envx/);
});

test('saving the active env rewrites the target, refusing to clobber drift', async () => {
  const { vault, fs } = setup({ '.env': 'A=1\n' });
  await vault.importProject({ root: '/app' });
  await vault.setVars('app', 'default', { B: '2' });
  assert.equal(stripHeader(fs.files.get('/app/.env')), 'A=1\nB=2\n');
  fs.files.set('/app/.env', 'A=hand-edited\n');
  await assert.rejects(() => vault.setVars('app', 'default', { C: '3' }), /edited outside envx/);
  await vault.pull('app');
  assert.equal(await vault.readEnv('app', 'default'), 'A=hand-edited\n');
});

test('setVars rejects keys dotenv cannot read', async () => {
  const { vault, fs } = setup({ '.env': 'A=1\n' });
  await vault.importProject({ root: '/app' });
  await assert.rejects(() => vault.setVars('app', 'default', { 'A B': '1' }), /Invalid variable name: "A B"/);
  await assert.rejects(() => vault.setVars('app', 'default', { '1X': '1' }), /Invalid variable name/);
  assert.equal(fs.files.get('/app/.env'), 'A=1\n');
});

test('env lifecycle: create, rename, delete', async () => {
  const { vault, fs } = setup({ '.env': 'A=1\n' });
  await vault.importProject({ root: '/app' });
  await vault.createEnv('app', 'staging', { from: 'default' });
  await vault.renameEnv('app', 'default', 'local');
  assert.match(fs.files.get('/app/.env'), /^# envx: local/);
  await assert.rejects(() => vault.deleteEnv('app', 'local'), /active environment/);
  await vault.deleteEnv('app', 'staging');
  assert.deepEqual((await vault.listEnvs('app')).map((e) => e.name), ['local']);
  await assert.rejects(() => vault.createEnv('app', 'bad name'), /not a valid/);
});

test('switching to a secure environment needs confirmation', async () => {
  const { vault, fs } = setup({ '.env': 'DB=local\n', '.env.production': 'DB=prod\n' });
  await vault.importProject({ root: '/app' });
  await vault.setSecure('app', 'production', true);
  assert.equal((await vault.listEnvs('app')).find((e) => e.name === 'production').secure, true);

  await assert.rejects(() => vault.switchEnv('app', 'production'), (err) => err.code === 'CONFIRM');
  assert.equal(stripHeader(fs.files.get('/app/.env')), 'DB=local\n', 'nothing written without confirmation');

  await vault.switchEnv('app', 'production', { confirm: true });
  assert.match(fs.files.get('/app/.env'), /DB=prod/);
  // Re-applying the env that is already active is not "switching over to it".
  await vault.switchEnv('app', 'production', { onDrift: 'discard' });
  // Switching away from a secure env needs no confirmation.
  await vault.switchEnv('app', 'default');

  await vault.renameEnv('app', 'production', 'prod');
  assert.deepEqual((await vault.getProject('app')).secure, ['prod'], 'rename keeps the mark');
  await assert.rejects(() => vault.switchEnv('app', 'prod'), (err) => err.code === 'CONFIRM');
  await vault.setSecure('app', 'prod', false);
  await vault.switchEnv('app', 'prod');
  await vault.switchEnv('app', 'default');
  await vault.setSecure('app', 'prod', true);
  await vault.deleteEnv('app', 'prod');
  assert.deepEqual((await vault.getProject('app')).secure, [], 'delete clears the mark');
});

test('one folder is one project, however its path is spelled', async () => {
  // A filesystem where /link is a symlink to /app.
  class LinkedFS extends MemoryFS {
    async realpath(root) {
      return root.replace(/^\/link(?=\/|$)/, '/app');
    }
  }
  const store = new MemoryStore();
  const fs = new LinkedFS();
  fs.files.set('/app/.env', 'A=1\n');
  const vault = new Vault(store, fs);
  const first = await vault.importProject({ root: '/app' });
  const again = await vault.importProject({ root: '/link' });
  assert.equal(again.created, false);
  assert.equal(again.project.id, first.project.id);
  assert.equal((await vault.listProjects()).length, 1);
  assert.equal((await vault.findProjectForPath('/link/src')).id, first.project.id);
  assert.equal((await vault.getProject('/link')).id, first.project.id);
});

test('findProjectForPath matches subdirectories', async () => {
  const { vault, fs } = setup({});
  fs.files.set('C:\\Code\\api/.env', 'A=1\n');
  await vault.importProject({ root: 'C:\\Code\\api' });
  assert.equal((await vault.findProjectForPath('c:/code/api/src/routes')).name, 'api');
  assert.equal(await vault.findProjectForPath('c:/code/apiary'), null);
});
