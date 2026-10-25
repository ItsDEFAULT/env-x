# How it works

## Projects and environments

A **project** is a folder envx knows about. It has named **environments** (`default`, `staging`, `production`…) stored in the envx vault, and one **target file**, usually `.env`, that holds the active environment.

Your app keeps reading `.env` as it always has. envx only changes what's in it.

## Import

`envx import` turns each `.env*` file in the folder into an environment:

| File | Environment |
| --- | --- |
| `.env` | `default` |
| `.env.staging` | `staging` |
| `.env.production.local` | `production.local` |
| `.env.example`, `.sample`, `.template`, `.dist`, `.defaults`, `.schema`, `.vault`, `.keys`, `.me` | skipped |

If `.env` has the same content as another file (say `.env.development`), envx marks `development` active rather than creating a duplicate `default`.

Your original files are not moved or deleted.

## Switching

`envx use staging` writes the `staging` environment into `.env` with a one-line header:

```
# envx: staging (managed by envx; edits here are saved back to "staging" on the next switch)
DATABASE_URL=postgres://staging-db/acme
```

Environments are stored as raw text, so comments, blank lines and ordering come through exactly as you wrote them.

## Hand edits

envx remembers what it last wrote to `.env`. If the file changes after that (you edited it, or a tool did), envx treats it as a **hand edit**:

| When | What happens |
| --- | --- |
| You switch (default) | Your edits are saved into the environment that was active, then the new one is written. Nothing is lost. |
| `envx use <env> --discard` | Your edits are thrown away. |
| `envx use <env> --strict` | The switch fails. |
| `envx pull` | Your edits are saved into the active environment now. |
| You edit the active environment through envx | envx refuses to overwrite your edits until you `pull` (or pass `--force`). |

`envx status` and the web app show when `.env` has hand edits.

## Storage

The CLI vault lives in `~/.envx` (or `$ENVX_HOME`):

```
~/.envx/
  state.json                 projects, active env, target file
  envs/<project-id>/<env>.env    one file per environment
  token                      secret for the web app connection
```

The browser vault lives in the browser's IndexedDB and never leaves that browser.

## Security

- **Values are stored unencrypted**, the same way your `.env` files already are. On macOS and Linux the vault files are readable only by you (`0600`).
- **Nothing is sent anywhere.** There is no envx cloud; the hosted web app only talks to your own machine.
- **The local server** (`envx ui` / `envx serve`):
  - listens on `127.0.0.1` only;
  - requires the token from `~/.envx/token`;
  - rejects requests for unexpected hostnames, which blocks DNS-rebinding attacks;
  - accepts browser requests only from its own page and the URLs you pass with `--origin`;
  - lists folder names (and `.env` file names) for the web app's folder picker, never file contents.
- **AI agents** see variable names but masked values, unless you set `ENVX_MCP_REVEAL=1`.
