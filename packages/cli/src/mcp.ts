import { createInterface } from 'node:readline';
import { EnvxError, maskValue, needsConfirm, parseEnv, type Vault } from '@envx/core';
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
      "Switch a project to another environment (e.g. development, staging, production) by rewriting its .env file. Outside edits to the .env are saved into the previously active environment unless on_drift says otherwise. Environments marked secure need the user's own confirmation: envx asks the user through this app, and an agent cannot confirm on their behalf.",
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

/** Asks the human (not the agent) a yes/no question through the client, or null if the client can't. */
type AskUser = ((message: string, label: string) => Promise<boolean>) | null;

async function callTool(vault: Vault, name: string, args: Args, askUser: AskUser): Promise<unknown> {
  const reveal = process.env.ENVX_MCP_REVEAL === '1';
  switch (name) {
    case 'envx_list_projects': {
      const projects = await vault.listProjects();
      return projects.map((p) => ({
        name: p.name,
        root: p.root,
        target: p.target,
        active: p.active,
        environments: p.envs,
        secure_environments: p.secure ?? [],
      }));
    }
    case 'envx_status': {
      const s = await vault.status(await resolveProject(vault, args.project));
      return {
        project: s.project.name,
        root: s.project.root,
        target: s.project.target,
        active: s.active,
        environments: s.project.envs,
        secure_environments: s.project.secure ?? [],
        outside_edits: s.drift,
      };
    }
    case 'envx_switch_environment': {
      if (!args.environment) throw new EnvxError('INVALID', '"environment" is required.');
      const policy = (args.on_drift ?? 'save') as 'save' | 'discard' | 'error';
      const id = await resolveProject(vault, args.project);
      const project = await vault.getProject(id);
      const env = args.environment;
      let confirm = false;
      if (needsConfirm(project, env)) {
        if (!askUser) {
          throw new EnvxError(
            'CONFIRM',
            `"${env}" is marked secure, so switching ${project.name} to it needs the user's confirmation, and this app can't ask them. ` +
              `Don't retry: ask the user to switch it themselves (\`envx use ${env}\` in the project, or the envx app).`,
          );
        }
        confirm = await askUser(
          `"${env}" is marked secure. Allow your AI agent to switch ${project.name} to ${env}? This rewrites ${project.target}.`,
          `Switch ${project.name} to ${env}`,
        );
        if (!confirm) {
          throw new EnvxError('CONFIRM', `The user did not confirm switching ${project.name} to "${env}". Don't retry unless they ask.`);
        }
      }
      const r = await vault.switchEnv(id, env, { onDrift: policy, confirm });
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

  // Requests we send to the client (elicitation), waiting for its response.
  const pending = new Map<string, (msg: { result?: unknown; error?: { message?: string } }) => void>();
  let nextRequest = 1;
  let canElicit = false;
  const request = (method: string, params: unknown) =>
    new Promise<{ result?: unknown; error?: { message?: string } }>((resolve) => {
      const id = `envx-${nextRequest++}`;
      pending.set(id, resolve);
      send({ jsonrpc: '2.0', id, method, params });
    });

  /** MCP elicitation: the client shows the question to the user and returns their answer. */
  const askUser = async (message: string, label: string): Promise<boolean> => {
    const res = await request('elicitation/create', {
      message,
      requestedSchema: {
        type: 'object',
        properties: { confirm: { type: 'boolean', title: label, description: 'Tick to confirm.' } },
        required: ['confirm'],
      },
    });
    const result = res.result as { action?: string; content?: { confirm?: unknown } } | undefined;
    return result?.action === 'accept' && result.content?.confirm === true;
  };

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg: { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const { id, method, params = {} } = msg;
    if (method === undefined && id !== undefined) {
      // A response to one of our requests.
      const resolve = pending.get(String(id));
      pending.delete(String(id));
      return resolve?.(msg);
    }
    if (id === undefined) return; // notification, e.g. notifications/initialized

    const reply = (result: unknown) => send({ jsonrpc: '2.0', id, result });
    switch (method) {
      case 'initialize': {
        const requested = String(params.protocolVersion ?? '');
        canElicit = Boolean((params.capabilities as { elicitation?: unknown } | undefined)?.elicitation);
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
          const result = await callTool(vault, name, (params.arguments ?? {}) as Args, canElicit ? askUser : null);
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
