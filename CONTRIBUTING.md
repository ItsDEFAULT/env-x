# Contributing

Issues and pull requests are welcome.

## Setup

```sh
npm install
npm run build      # core → web → cli (the CLI bundles the built web app)
npm test           # core unit tests + CLI, MCP and server end-to-end tests
```

Useful while developing:

```sh
npm run dev:web                       # web app with hot reload on http://localhost:5291
node packages/cli/dist/index.js help  # run the CLI without linking
ENVX_HOME=/tmp/envx-dev envx ls       # use a throwaway vault
```

## Layout

Read [docs/architecture.md](docs/architecture.md) first; this is the short version.

| Package | |
| --- | --- |
| [`packages/core`](packages/core/src) | Platform-neutral TypeScript: dotenv parser, `Vault` (import, switch, hand-edit detection). Storage and filesystem are interfaces. |
| [`packages/cli`](packages/cli/src) | Node adapters, CLI, local server (token-protected RPC + static web app), MCP server. No runtime dependencies besides core. |
| [`packages/web`](packages/web/src) | React PWA. The browser vault is `Vault` running on IndexedDB + File System Access; the CLI vault is an RPC proxy to the local server. |

Every `Vault` method the web app calls must be listed in `VAULT_METHODS` (`packages/core/src/index.ts`). That list is also the server's allow-list.

## Guidelines

- Add a test for behavior changes: `packages/core/test` for vault/parser logic, `packages/cli/test` for commands, MCP and the server.
- Never lose user data: anything that overwrites `.env` must go through the hand-edit check.
- Keep secrets masked by default in every new output (CLI, MCP, UI).
