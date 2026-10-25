# packages/cli

The `envx` command: the CLI, the local server behind `envx ui` / `envx serve`, and the MCP server for AI agents.

It's installed from the repository root, not from npm:

```sh
npm install && npm run build
npm link -w @env-x/cli     # puts `envx` on your PATH
```

See the [main README](../../README.md), the [CLI reference](../../docs/cli.md) and the [architecture notes](../../docs/architecture.md).
