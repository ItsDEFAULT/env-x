# Getting started

## 1. Install

envx isn't published to npm. You install it from this repository (Node.js 20 or later):

```sh
git clone https://github.com/ItsDEFAULT/env-x.git
cd env-x
npm install
npm run build
npm link -w @env-x/cli
```

Check it worked:

```sh
envx --version
```

`npm link` points `envx` at your clone, so keep the folder.

To **update**, run this in the clone:

```sh
git pull && npm install && npm run build
```

To **uninstall**, run `npm uninstall -g @env-x/cli` and delete the clone. Your vault stays in `~/.envx` until you delete it.

Prefer not to install anything? The [web app](web-app.md) can manage `.env` files on its own in Chrome or Edge.

## 2. Import a project

Run `envx import` inside a project that has `.env` files:

```sh
cd ~/code/my-app
envx import
```

```
✔ Imported my-app
  + default from .env
  + staging from .env.staging
  + production from .env.production
  active: default → .env
```

Each `.env*` file becomes an environment. Templates such as `.env.example` are skipped.

Only have one `.env` full of commented-out alternatives? Create the other environments from it, then edit each one:

```sh
envx new staging        # copy of the active env
envx edit staging       # opens in $EDITOR
```

## 3. Switch

```sh
envx use staging
```

envx rewrites the project's `.env` with the `staging` values. Restart your dev server if it doesn't reload `.env` on its own.

```sh
envx status             # which env is active
envx envs               # all environments of this project
envx ls                 # all projects
envx use production --all   # switch every project that has "production"
```

## 4. Open the GUI

```sh
envx ui
```

This opens the web app in your browser, already connected. Click an environment to switch to it. See [Web app](web-app.md).

## 5. Let your AI agent switch for you

```sh
claude mcp add envx -- envx mcp
```

Then ask: *"switch my-app to staging"*. See [AI agents](ai-agents.md) for other tools.

## Good to know

- **Hand edits are safe.** If you edit `.env` directly, envx saves your edits into the active environment on the next switch. See [How it works](how-it-works.md#hand-edits).
- **Keep `.env` out of git.** envx doesn't change your `.gitignore`.
- **Different file name?** Use `envx import --target .env.local` for projects that read `.env.local`.
