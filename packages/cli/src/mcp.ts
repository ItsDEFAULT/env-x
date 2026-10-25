import { createInterface } from 'node:readline';
import { EnvxError, maskValue, parseEnv, type Vault } from '@envx/core';
import { VERSION } from './version.js';

/**
 * Minimal Model Context Protocol server over stdio (newline-delimited JSON-RPC).
 * Exposes switching and inspection tools. Variable values are masked unless the
 * user opts in with ENVX_MCP_REVEAL=1, so secrets do not leak into model context.
 */

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const projectProp = {
  project: {
    type: 'string',
    description: 'Project name, id or path. Defaults to the project containing the current working directory.',
  },
};

const TOOLS = [
  {
    name: 'envx_list_projects',
    description: 'List every project in the envx vault with its environments and which one is active.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'envx_status',
    description: 'Show the active environment of a project and whether its .env file has edits made outside envx.',
    inputSchema: { type: 'object', properties: { ...projectProp } },
  },
  {
    name: 'envx_switch_environment',
    description:
      "Switch a project to another environment (e.g. development, staging, production) by rewriting its .env file. Outside edits to the .env are saved into the previously active environment unless on_drift says otherwise.",
    inputSchema: {
      type: 'object',
      properties: {
        environment: { type: 'string', description: 'Environment to activate.' },
        ...projectProp,
        on_drift: {
          type: 'string',
          enum: ['save', 'discard', 'error'],
          description: 'What to do with outside edits to the .env file. Default: save.',
        },
      },
      required: ['environment'],
    },
  },
  {
    name: 'envx_show_environment',
    description: 'List the variables of an environment (defaults to the active one). Values are masked unless the user enabled reveal.',
    inputSchema: {
      type: 'object',
      properties: { environment: { type: 'string' }, ...projectProp },
    },
  },
  {
    name: 'envx_diff_environments',
    description: 'Compare two environments of a project by key: which variables are added, removed or changed.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Base environment. Defaults to the active one.' },
        to: { type: 'string', description: 'Environment to compare against.' },
        ...projectProp,
      },
      required: ['to'],
    },
  },
];

type Args = Record<string, string | undefined>;

async function resolveProject(vault: Vault, ref: string | undefined): Promise<string> {
  if (ref) return (await vault.getProject(ref)).id;
  const found = await vault.findProjectForPath(process.cwd());
  if (!found) {
    throw new EnvxError('NO_PROJECT', `No envx project contains ${process.cwd()}. Pass "project" (see envx_list_projects).`);
  }
  return found.id;
}

async function callTool(vault: Vault, name: string, args: Args): Promise<unknown> {
  const reveal = process.env.ENVX_MCP_REVEAL === '1';
  switch (name) {
    case 'envx_list_projects': {
      const projects = await vault.listProjects();
      return projects.map((p) => ({ name: p.name, root: p.root, target: p.target, active: p.active, environments: p.envs }));
    }
    case 'envx_status': {
      const s = await vault.status(await resolveProject(vault, args.project));
      return {
        project: s.project.name,
        root: s.project.root,
        target: s.project.target,
        active: s.active,
        environments: s.project.envs,
        outside_edits: s.drift,
      };
    }
    case 'envx_switch_environment': {
      if (!args.environment) throw new EnvxError('INVALID', '"environment" is required.');
      const policy = (args.on_drift ?? 'save') as 'save' | 'discard' | 'error';
      const r = await vault.switchEnv(await resolveProject(vault, args.project), args.environment, { onDrift: policy });
      return {
        project: r.project.name,
        from: r.from,
        to: r.to,
        file: r.project.target,
        outside_edits: r.drift,
        ...(r.savedTo ? { outside_edits_saved_to: r.savedTo } : {}),
        note: 'Restart running dev servers if they do not reload .env automatically.',
      };
    }
    case 'envx_show_environment': {
      const id = await resolveProject(vault, args.project);
      const project = await vault.getProject(id);
      const env = args.environment ?? project.active;
      if (!env) throw new EnvxError('INVALID', 'No active environment; pass "environment".');
      const vars: Record<string, string> = {};
      for (const e of parseEnv(await vault.readEnv(id, env))) vars[e.key] = reveal ? e.value : maskValue(e.value);
      return { project: project.name, environment: env, active: env === project.active, masked: !reveal, variables: vars };
    }
    case 'envx_diff_environments': {
      const id = await resolveProject(vault, args.project);
      const project = await vault.getProject(id);
      const from = args.from ?? project.active;
      if (!from || !args.to) throw new EnvxError('INVALID', 'Need both "from" (or an active env) and "to".');
      return { project: project.name, from, to: args.to, ...(await vault.diffEnvs(id, from, args.to)) };
    }
    default:
      throw new EnvxError('INVALID', `Unknown tool ${name}`);
  }
}

export function runMcp(vault: Vault): void {
  const rl = createInterface({ input: process.stdin });
  const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n');

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg: { id?: string | number; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const { id, method, params = {} } = msg;
    if (id === undefined) return; // notification, e.g. notifications/initialized

    const reply = (result: unknown) => send({ jsonrpc: '2.0', id, result });
    switch (method) {
      case 'initialize': {
        const requested = String(params.protocolVersion ?? '');
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'envx', version: VERSION },
          instructions:
            'envx manages .env files. To change which environment a project runs against, call envx_switch_environment instead of editing .env by hand.',
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const name = String(params.name);
        try {
          const result = await callTool(vault, name, (params.arguments ?? {}) as Args);
          return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        } catch (err) {
          return reply({ content: [{ type: 'text', text: (err as Error).message }], isError: true });
        }
      }
      default:
        return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  });
}
