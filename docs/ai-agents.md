# AI agents

envx ships an [MCP](https://modelcontextprotocol.io) server, so coding agents can check and switch environments instead of editing `.env` by hand.

## Set up

**Claude Code**

```sh
claude mcp add envx -- envx mcp
```

**Cursor, Claude Desktop, Windsurf and other MCP clients.** Add this to the client's MCP config:

```json
{
  "mcpServers": {
    "envx": { "command": "envx", "args": ["mcp"] }
  }
}
```

The agent uses the CLI vault (`~/.envx`). Projects imported only in the web app's browser vault aren't visible to it.

## Tools

| Tool | What it does |
| --- | --- |
| `envx_list_projects` | All projects, their environments and the active one |
| `envx_status` | Active environment and whether `.env` has hand edits |
| `envx_switch_environment` | Switch a project to an environment |
| `envx_show_environment` | Variables of an environment (masked) |
| `envx_diff_environments` | Keys added, removed or changed between two environments |

Each tool takes an optional `project` (name, id or path). Without it, the tool uses the project that contains the agent's working directory.

## Try it

> Switch this project to staging and restart the dev server.

> Which variables are different between staging and production?

> Is any project still pointing at production?

## Secrets

Agents see variable **names**, but values are masked (`sk_••••••`). To let agents read real values:

```json
{ "command": "envx", "args": ["mcp"], "env": { "ENVX_MCP_REVEAL": "1" } }
```

## Agents without MCP

Any agent that can run shell commands can use the CLI with `--json`:

```sh
envx status --json
envx use staging --json
envx diff production --json
```

Errors are JSON too (`{"error": {"code": "...", "message": "..."}}`), with a non-zero exit code.
