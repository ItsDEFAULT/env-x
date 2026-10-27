# Troubleshooting

**"Not inside an imported project"**
Run `envx import` in the project folder, or name the project with `-p <name>`. `envx ls` lists what's imported.

**I switched, but my app still uses the old values**
Most dev servers read `.env` only at startup. Restart the server.

**`envx set` / `envx edit` says `.env` was edited outside envx**
Someone changed `.env` by hand. Run `envx pull` to keep those edits, or add `--force` to overwrite them.

**My app reads `.env.local`, not `.env`**
Import with `envx import --target .env.local`, or change **Target file** in the web app's project settings.

**`envx ui` says "already running"**
Another `envx ui` or `envx serve` is using port 4280. It opens that one instead. To run a second one, pass `--port <n>`.

**The hosted web app can't connect to my CLI**
- Make sure `envx serve` is running.
- Start it with `--origin` set to the exact web app URL, e.g. `envx serve --origin https://itsdefault.github.io/env-x`.
- Check that the token matches `envx token`.
- Chrome and Edge only let a website reach your machine after you allow it. If you dismissed or blocked the prompt, click the site settings icon in the address bar and allow **Local network access**.
- Brave and some privacy extensions block websites from talking to `localhost`. Allow it for the web app's site.
- `envx ui` always works: it serves the same app from your machine, so none of this applies.

**The app asks me to connect instead of opening a browser vault**
The browser vault needs the File System Access API, which only Chromium browsers (Chrome, Edge, Brave, Arc) have. In Firefox or Safari, use the CLI vault.

**The browser keeps asking for folder access**
Browsers drop folder permission after a restart unless the app is installed or you chose **Allow on every visit**. Click **Allow access** in the banner, or [install the app](web-app.md#install-it-as-an-app).

**My agent doesn't see a project**
Agents use the CLI vault. Import the project with `envx import`. Projects in the browser vault are invisible to agents.

**`envx use` exits with code 3, or says the environment "is marked secure"**
That environment asks for confirmation before you switch to it. In a terminal, answer the prompt. In scripts, CI or `--json` mode, add `--yes`. To stop asking, run `envx secure <env> --off`.

**My AI agent says it "can't ask" me before switching**
The environment is marked secure, and your agent app doesn't support MCP elicitation, so envx can't show you the question. Switch it yourself (`envx use <env>` or the web app), or remove the mark if you don't need it.

**Start from scratch**
Delete `~/.envx`. Your projects' `.env` files are not affected.
