#!/usr/bin/env node
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { EnvxError, maskValue, parseEnv, toRecord, type DriftPolicy, type Project, type SwitchResult, type Vault } from '@envx/core';
import { createVault, daemonToken } from './node.js';
import { startServer } from './server.js';
import { runMcp } from './mcp.js';
import { VERSION } from './version.js';

const HELP = `envx ${VERSION}: every .env you have, one command to switch.

Usage: envx <command> [options]

Projects
  import [dir]              Import the .env* files in dir (default: current dir)
      --name <name>         Project name (default: folder name)
      --target <file>       File that holds the active env (default: .env)
  ls                        List projects and their active environment
  forget [project]          Remove a project from envx (its files stay as they are)

Environments (in the current project, or -p <project>)
  envs                      List environments
  use <env>                 Switch to <env>: rewrites the target .env file
      --all                 Switch every project that has <env>
      --discard             Drop outside edits to .env instead of saving them
      --strict              Fail if .env has outside edits
  status                    Show the active env and outside edits
  show [env]                Show variables (values masked; --reveal to show)
  diff <a> [b]              Compare two envs by key (b defaults to the active env)
  new <env>                 Create an env, copied from the active one
      --from <env>          Copy from another env instead   --empty  start blank
  edit [env]                Open an env in $EDITOR
  set KEY=VALUE...          Set variables (-e <env>, default: active)
  unset KEY...              Remove variables (-e <env>, default: active)
  rename <old> <new>        Rename an env
  delete <env>              Delete an env
  pull                      Save outside edits of .env into the active env

GUI and agents
  ui                        Open the envx web app on this machine
  serve                     Run the local API so the hosted web app can connect
      --port <n>            Port (default: 4280)
      --origin <url>        Allow a hosted web app URL (repeatable; also $ENVX_ORIGINS)
  token                     Print the token the web app uses to connect
  mcp                       Run the MCP server (stdio) for AI agents

Global
  -p, --project <ref>       Project name, id or path
  --json                    Machine-readable output
  -h, --help, -v, --version
`;

// ── args ──────────────────────────────────────────────────────────────────

const BOOL_FLAGS = new Set(['json', 'reveal', 'all', 'discard', 'strict', 'empty', 'force', 'help', 'version', 'no-open']);
const ALIASES: Record<string, string> = { p: 'project', e: 'env', h: 'help', v: 'version' };

interface Args {
  positional: string[];
  flags: Record<string, string | boolean>;
  multi: Record<string, string[]>;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { positional: [], flags: {}, multi: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      out.positional.push(...argv.slice(i + 1));
      break;
    }
    const m = /^(--?)([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m || (m[1] === '-' && m[2].length > 1 && !ALIASES[m[2]])) {
      out.positional.push(arg);
      continue;
    }
    const name = ALIASES[m[2]] ?? m[2];
    let value: string | boolean;
    if (m[3] !== undefined) value = m[3];
    else if (BOOL_FLAGS.has(name)) value = true;
    else if (i + 1 < argv.length) value = argv[++i];
    else throw new EnvxError('INVALID', `--${name} needs a value`);
    out.flags[name] = value;
    if (typeof value === 'string') (out.multi[name] ??= []).push(value);
  }
  return out;
}

// ── output ────────────────────────────────────────────────────────────────

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { bold: paint(1), dim: paint(2), red: paint(31), green: paint(32), yellow: paint(33), cyan: paint(36) };

let jsonMode = false;

function print(human: string | (() => string), data?: unknown): void {
  if (jsonMode) {
    if (data !== undefined) console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(typeof human === 'function' ? human() : human);
  }
}

function table(rows: string[][]): string {
  // eslint-disable-next-line no-control-regex
  const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => visible(r[i] ?? ''))));
  return rows.map((r) => r.map((cell, i) => cell + ' '.repeat(widths[i] - visible(cell))).join('  ').trimEnd()).join('\n');
}

// ── helpers ───────────────────────────────────────────────────────────────

async function currentProject(vault: Vault, args: Args): Promise<Project> {
  const ref = args.flags.project;
  if (typeof ref === 'string') return vault.getProject(ref);
  const found = await vault.findProjectForPath(process.cwd());
  if (!found) {
    throw new EnvxError('NO_PROJECT', 'Not inside an imported project. Run `envx import` here, or pass -p <project>.');
  }
  return found;
}

function activeOrArg(project: Project, env: string | undefined): string {
  const name = env ?? project.active;
  if (!name) throw new EnvxError('INVALID', `"${project.name}" has no active environment; name one explicitly.`);
  return name;
}

function need(value: string | undefined, usage: string): string {
  if (!value) throw new EnvxError('INVALID', `Usage: envx ${usage}`);
  return value;
}

function driftPolicy(args: Args): DriftPolicy {
  if (args.flags.strict) return 'error';
  if (args.flags.discard) return 'discard';
  return 'save';
}

function openBrowser(url: string): void {
  const [cmd, cmdArgs] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

async function existingDaemon(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    return ((await res.json()) as { app?: string }).app === 'envx';
  } catch {
    return false;
  }
}

function editorCommand(): string {
  return process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
}

// ── commands ──────────────────────────────────────────────────────────────

async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  jsonMode = Boolean(args.flags.json);
  const [command, ...rest] = args.positional;

  if (args.flags.version) return print(VERSION, { version: VERSION });
  if (!command || args.flags.help || command === 'help') return print(HELP);

  const { vault } = createVault();

  switch (command) {
    case 'import': {
      const root = resolve(rest[0] ?? '.');
      const r = await vault.importProject({
        root,
        name: typeof args.flags.name === 'string' ? args.flags.name : undefined,
        target: typeof args.flags.target === 'string' ? args.flags.target : undefined,
      });
      return print(() => {
        const lines = [`${c.green('✔')} ${r.created ? 'Imported' : 'Updated'} ${c.bold(r.project.name)} ${c.dim(r.project.root)}`];
        for (const i of r.imported) lines.push(`  + ${c.cyan(i.env)} ${c.dim('from ' + i.file)}`);
        for (const s of r.skipped) lines.push(c.dim(`  · skipped ${s.file}: ${s.reason}`));
        if (r.imported.length === 0 && r.created) lines.push(c.yellow('  No .env files found. Create one with `envx new <env> --empty`.'));
        if (r.project.active) lines.push(`  active: ${c.green(r.project.active)} → ${r.project.target}`);
        lines.push(c.dim(`  Switch with: envx use <env>`));
        return lines.join('\n');
      }, r);
    }

    case 'ls':
    case 'projects': {
      const projects = await vault.listProjects();
      return print(() => {
        if (projects.length === 0) return 'No projects yet. Run `envx import` inside a project.';
        return table([
          [c.dim('PROJECT'), c.dim('ACTIVE'), c.dim('ENVIRONMENTS'), c.dim('PATH')],
          ...projects.map((p) => [c.bold(p.name), p.active ? c.green(p.active) : c.dim('none'), p.envs.join(', '), c.dim(p.root)]),
        ]);
      }, projects);
    }

    case 'envs':
    case 'list': {
      const project = await currentProject(vault, args);
      const envs = await vault.listEnvs(project.id);
      return print(() => {
        if (envs.length === 0) return `${project.name} has no environments. Create one with \`envx new <env>\`.`;
        return [
          c.bold(project.name) + c.dim(` → ${project.target}`),
          ...envs.map((e) => `${e.active ? c.green('●') : ' '} ${e.active ? c.green(e.name) : e.name} ${c.dim(`${e.keys} keys`)}`),
        ].join('\n');
      }, envs);
    }

    case 'use':
    case 'switch': {
      const env = need(rest[0], 'use <env>');
      const onDrift = driftPolicy(args);
      const targets = args.flags.all
        ? (await vault.listProjects()).filter((p) => p.envs.includes(env))
        : [await currentProject(vault, args)];
      if (targets.length === 0) throw new EnvxError('NOT_FOUND', `No project has an environment named "${env}".`);
      const results: SwitchResult[] = [];
      for (const p of targets) results.push(await vault.switchEnv(p.id, env, { onDrift }));
      return print(
        () =>
          results
            .map((r) => {
              let line = `${c.green('✔')} ${c.bold(r.project.name)}: ${r.from ?? 'none'} → ${c.green(r.to)} ${c.dim(`(${r.project.target})`)}`;
              if (r.drift === 'saved') line += `\n  ${c.yellow('!')} outside edits to ${r.project.target} were saved into "${r.savedTo}"`;
              if (r.drift === 'discarded') line += `\n  ${c.yellow('!')} outside edits to ${r.project.target} were discarded`;
              return line;
            })
            .join('\n'),
        results,
      );
    }

    case 'status': {
      const project = await currentProject(vault, args);
      const s = await vault.status(project.id);
      return print(() => {
        const lines = [
          `${c.bold(project.name)} ${c.dim(project.root)}`,
          `  active: ${s.active ? c.green(s.active) : c.dim('none')} → ${project.target}${s.targetExists ? '' : c.dim(' (missing)')}`,
          `  envs:   ${project.envs.join(', ') || c.dim('none')}`,
        ];
        if (s.drift) lines.push(c.yellow(`  ${project.target} has edits made outside envx. They will be saved into "${s.active ?? 'unsaved'}" on the next switch (or run \`envx pull\`).`));
        return lines.join('\n');
      }, s);
    }

    case 'show': {
      const project = await currentProject(vault, args);
      const env = activeOrArg(project, rest[0]);
      const text = await vault.readEnv(project.id, env);
      const reveal = Boolean(args.flags.reveal);
      const entries = parseEnv(text);
      return print(
        () => {
          if (entries.length === 0) return c.dim(`${env} is empty.`);
          return entries.map((e) => `${c.cyan(e.key)}=${reveal ? e.value : c.dim(maskValue(e.value))}`).join('\n');
        },
        { project: project.name, env, variables: Object.fromEntries(entries.map((e) => [e.key, reveal ? e.value : maskValue(e.value)])) },
      );
    }

    case 'diff': {
      const project = await currentProject(vault, args);
      const a = need(rest[0], 'diff <a> [b]');
      const [from, to] = rest[1] ? [a, rest[1]] : [activeOrArg(project, undefined), a];
      const d = await vault.diffEnvs(project.id, from, to);
      const reveal = Boolean(args.flags.reveal);
      const [va, vb] = [toRecord(await vault.readEnv(project.id, from)), toRecord(await vault.readEnv(project.id, to))];
      const show = (v: string) => (reveal ? v : maskValue(v));
      return print(() => {
        const lines = [c.dim(`${from} → ${to}`)];
        for (const k of d.added) lines.push(c.green(`+ ${k}=${show(vb[k])}`));
        for (const k of d.removed) lines.push(c.red(`- ${k}=${show(va[k])}`));
        for (const k of d.changed) lines.push(c.yellow(`~ ${k}: ${show(va[k])} → ${show(vb[k])}`));
        if (lines.length === 1) lines.push('No differences.');
        else lines.push(c.dim(`${d.unchanged.length} unchanged`));
        return lines.join('\n');
      }, { from, to, ...d });
    }

    case 'new':
    case 'create': {
      const project = await currentProject(vault, args);
      const env = need(rest[0], 'new <env> [--from <env>] [--empty]');
      const from = args.flags.empty ? undefined : typeof args.flags.from === 'string' ? args.flags.from : project.active ?? undefined;
      const p = await vault.createEnv(project.id, env, { from });
      return print(`${c.green('✔')} Created ${c.cyan(env)}${from ? c.dim(` from ${from}`) : ''}. Edit it with \`envx edit ${env}\`.`, p);
    }

    case 'edit': {
      const project = await currentProject(vault, args);
      const env = activeOrArg(project, rest[0]);
      const text = await vault.readEnv(project.id, env);
      const tmp = join(tmpdir(), `envx-${project.name.replace(/[^\w.-]/g, '_')}-${env}.env`);
      await writeFile(tmp, text, { mode: 0o600 });
      try {
        const editor = editorCommand();
        const code = await new Promise<number | null>((done, fail) => {
          spawn(`${editor} "${tmp}"`, { stdio: 'inherit', shell: true }).on('exit', done).on('error', fail);
        });
        if (code !== 0) throw new EnvxError('INVALID', `Editor exited with code ${code}; nothing saved.`);
        const edited = await readFile(tmp, 'utf8');
        if (edited === text) return print(c.dim('No changes.'), { changed: false });
        await vault.saveEnv(project.id, env, edited, { force: Boolean(args.flags.force) });
        return print(`${c.green('✔')} Saved ${c.cyan(env)}${env === project.active ? ` and updated ${project.target}` : ''}.`, { changed: true });
      } finally {
        await rm(tmp, { force: true });
      }
    }

    case 'set': {
      const project = await currentProject(vault, args);
      const env = activeOrArg(project, typeof args.flags.env === 'string' ? args.flags.env : undefined);
      const vars: Record<string, string> = {};
      for (const pair of rest) {
        const eq = pair.indexOf('=');
        if (eq < 1) throw new EnvxError('INVALID', `Expected KEY=VALUE, got "${pair}"`);
        vars[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
      if (Object.keys(vars).length === 0) throw new EnvxError('INVALID', 'Usage: envx set KEY=VALUE... [-e <env>]');
      await vault.setVars(project.id, env, vars, { force: Boolean(args.flags.force) });
      return print(`${c.green('✔')} Set ${Object.keys(vars).join(', ')} in ${c.cyan(env)}.`, { env, keys: Object.keys(vars) });
    }

    case 'unset': {
      const project = await currentProject(vault, args);
      const env = activeOrArg(project, typeof args.flags.env === 'string' ? args.flags.env : undefined);
      if (rest.length === 0) throw new EnvxError('INVALID', 'Usage: envx unset KEY... [-e <env>]');
      await vault.unsetVars(project.id, env, rest, { force: Boolean(args.flags.force) });
      return print(`${c.green('✔')} Removed ${rest.join(', ')} from ${c.cyan(env)}.`, { env, keys: rest });
    }

    case 'rename': {
      const project = await currentProject(vault, args);
      const p = await vault.renameEnv(project.id, need(rest[0], 'rename <old> <new>'), need(rest[1], 'rename <old> <new>'));
      return print(`${c.green('✔')} Renamed ${rest[0]} → ${c.cyan(rest[1])}.`, p);
    }

    case 'delete':
    case 'rm': {
      const project = await currentProject(vault, args);
      const p = await vault.deleteEnv(project.id, need(rest[0], 'delete <env>'));
      return print(`${c.green('✔')} Deleted ${rest[0]} from ${project.name}.`, p);
    }

    case 'pull': {
      const project = await currentProject(vault, args);
      const p = await vault.pull(project.id);
      return print(`${c.green('✔')} Saved ${project.target} into ${c.cyan(p.active!)}.`, p);
    }

    case 'forget': {
      const project = rest[0] ? await vault.getProject(rest[0]) : await currentProject(vault, args);
      await vault.removeProject(project.id);
      return print(`${c.green('✔')} Forgot ${project.name}. ${project.target} was left as it is.`, { removed: project.id });
    }

    case 'token':
      return print(await daemonToken(), { token: await daemonToken() });

    case 'ui':
    case 'serve': {
      const port = Number(args.flags.port ?? process.env.ENVX_PORT ?? 4280);
      const token = await daemonToken();
      const origins = [...(args.multi.origin ?? []), ...(process.env.ENVX_ORIGINS?.split(',').filter(Boolean) ?? [])];
      const appUrl = `http://127.0.0.1:${port}/#token=${token}`;
      if (command === 'ui' && (await existingDaemon(port))) {
        console.log(`envx is already running at http://127.0.0.1:${port}`);
        if (!args.flags['no-open']) openBrowser(appUrl);
        return;
      }
      const { url } = await startServer({ vault, token, port, host: '127.0.0.1', origins, web: true });
      console.log(`${c.green('●')} envx is running at ${c.bold(url)}  ${c.dim('(Ctrl+C to stop)')}`);
      if (command === 'ui') {
        console.log(c.dim(`  Opening ${url} …`));
        if (!args.flags['no-open']) openBrowser(appUrl);
      } else {
        console.log(`  Connect the web app with:`);
        console.log(`    URL    ${url}`);
        console.log(`    Token  ${token}`);
        for (const o of origins) console.log(`    Link   ${o.replace(/\/+$/, '')}/#connect=${encodeURIComponent(url)}&token=${token}`);
        if (origins.length === 0) console.log(c.dim('  Using a hosted copy of the web app? Restart with --origin <its URL> to allow it.'));
      }
      return new Promise(() => {}); // run until interrupted
    }

    case 'mcp':
      runMcp(vault);
      return new Promise(() => {});

    default:
      throw new EnvxError('INVALID', `Unknown command "${command}". Run \`envx help\`.`);
  }
}

run(process.argv.slice(2)).catch((err: unknown) => {
  if (jsonMode) {
    const e = err as EnvxError;
    console.log(JSON.stringify({ error: { code: e.code ?? 'ERROR', message: e.message } }, null, 2));
  } else {
    console.error(`${c.red('✖')} ${(err as Error).message}`);
  }
  process.exit(err instanceof EnvxError && err.code === 'NO_PROJECT' ? 2 : 1);
});
