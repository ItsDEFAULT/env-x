# CLI reference

```
envx <command> [options]
```

Most commands act on the project that contains the current directory. Use `-p <project>` (a name, id or path) to target another one.

## Projects

| Command | Description |
| --- | --- |
| `envx import [dir]` | Import the `.env*` files in `dir` (default: current directory). Running it again adds new files only. |
| `envx ls` | List projects with their active environment. |
| `envx forget [project]` | Remove a project from envx. Its files on disk are left untouched. |

`import` options:

| Option | Default | |
| --- | --- | --- |
| `--name <name>` | folder name | Project name |
| `--target <file>` | `.env` | File that receives the active environment |

## Environments

| Command | Description |
| --- | --- |
| `envx envs` | List environments; `●` marks the active one. |
| `envx use <env>` | Switch to `<env>`. |
| `envx status` | Show the active environment and whether `.env` has hand edits. |
| `envx show [env]` | Show variables, masked. Add `--reveal` to show values. |
| `envx diff <a> [b]` | Compare two environments by key. `b` defaults to the active one. Values masked unless `--reveal`. |
| `envx new <env>` | Create an environment as a copy of the active one. `--from <env>` copies another; `--empty` starts blank. |
| `envx edit [env]` | Open an environment in `$VISUAL` / `$EDITOR` (Notepad on Windows, `vi` elsewhere). |
| `envx set KEY=VALUE…` | Set variables. `-e <env>` targets another environment. |
| `envx unset KEY…` | Remove variables. `-e <env>` targets another environment. |
| `envx rename <old> <new>` | Rename an environment. |
| `envx delete <env>` | Delete an environment. You can't delete the active one. |
| `envx pull` | Save hand edits of `.env` into the active environment now. |

`use` options:

| Option | |
| --- | --- |
| `--all` | Switch every project that has `<env>`. |
| `--discard` | Throw away hand edits to `.env` instead of saving them. |
| `--strict` | Fail if `.env` has hand edits. |

Editing the **active** environment (`set`, `unset`, `edit`) also rewrites `.env` right away. If `.env` has hand edits, the command fails instead of overwriting them. Run `envx pull` first, or add `--force` to overwrite.

## GUI and agents

| Command | Description |
| --- | --- |
| `envx ui` | Serve the web app on `http://127.0.0.1:4280` and open it, already connected. |
| `envx serve` | Serve the API only, so a [hosted copy](web-app.md#connect-a-hosted-copy) of the web app can connect. Prints the URL and token. |
| `envx token` | Print the token the web app uses to connect. |
| `envx mcp` | Run the MCP server over stdio for [AI agents](ai-agents.md). |

`ui` / `serve` options:

| Option | Default | |
| --- | --- | --- |
| `--port <n>` | `4280` | Port to listen on |
| `--origin <url>` | none | Allow a hosted web app, e.g. `https://itsdefault.github.io/env-x`. Repeatable. |
| `--no-open` | | `ui` only: don't open the browser |

## Global options

| Option | |
| --- | --- |
| `-p, --project <ref>` | Project name, id or path |
| `--json` | Machine-readable output, including errors |
| `-h, --help` | Help |
| `-v, --version` | Version |

## Environment variables

| Variable | |
| --- | --- |
| `ENVX_HOME` | Vault location. Default: `~/.envx` |
| `ENVX_PORT` | Default port for `ui` / `serve` |
| `ENVX_ORIGINS` | Comma-separated list of extra allowed web app URLs |
| `ENVX_MCP_REVEAL` | Set to `1` to show real values to AI agents |
| `VISUAL`, `EDITOR` | Editor used by `envx edit` |
| `NO_COLOR` | Disable colored output |

## Exit codes

| Code | |
| --- | --- |
| `0` | Success |
| `1` | Error |
| `2` | Not inside an imported project (pass `-p`, or run `envx import`) |
