# Web app

The web app does everything the CLI does, with a click: import projects, switch environments, and edit, compare and reveal variables.

## Run it locally

```sh
envx ui
```

It opens at `http://127.0.0.1:4280`, connected to the same vault as the CLI and your AI agents.

## Install it as an app

The web app is a Progressive Web App. In Chrome or Edge, click the install icon in the address bar, or the **Install** button in the app. It then opens in its own window and works offline.

## Two ways to store your vault

The web app opens straight into a vault. `envx ui` uses your CLI vault; otherwise Chrome and Edge start with a browser vault. Use **Switch vault** in the top bar to change it at any time.

| | **Browser vault** | **CLI vault** |
| --- | --- | --- |
| Vault stored in | This browser | `~/.envx` on your machine |
| Needs the CLI | No | Yes, running `envx serve` |
| Shared with terminal and AI agents | No | Yes |
| Browsers | Chrome, Edge, Brave, Arc | Any modern browser |

**Browser vault:** click **Import a project** (or **+**) and pick a project folder. The browser asks for permission to edit that folder. After a restart it may ask again; click **Allow access**.

**CLI vault:** see the next section. In Firefox and Safari, which can't open local folders, this is the only option, so the app asks you to connect when it opens. To import, click **Import a project** and pick the folder in envx's folder browser: browsers never reveal a folder's real path, so envx on your machine lists your folders instead. Folders with `.env` files are marked.

## Connect a hosted copy

To use the hosted web app (or the installed app) with your CLI vault:

```sh
envx serve --origin https://itsdefault.github.io/env-x
```

It prints a link. Open it, or click **Switch vault** and paste the printed token under **envx CLI**. The connection is remembered in that browser.

The first time, Chrome and Edge ask whether the site may **access other apps and services on this device**. Choose **Allow**: that's how the page reaches envx on your machine.

`--origin` tells the local server which web app may connect. Without it, only `envx ui` can.

## Using it

- **Switch:** click an environment under **Active environment**.
- **View or edit** any environment from its tab below. Edits to the active one are written to `.env` immediately.
- **Variables:** values are masked; click the eye icon to reveal one, or the eye at the top to reveal all.
- **Raw:** edit the file as text. Comments and order are kept. Save with Ctrl/⌘ + S.
- **Compare:** see which keys differ between two environments.
- **Settings:** rename the project, change its target file (e.g. `.env.local`), or remove it.
- **Secure environments:** click the lock in an environment's toolbar to mark it secure, for example `production`. Switching to it then asks for confirmation, in the app, the terminal and AI agents alike. Secure environments show a lock on their card and tab. Removing the mark asks first.
- **Theme:** the sun/moon button in the top bar switches between light and dark. It starts from your system setting and remembers your choice.

If `.env` was edited outside envx, a yellow banner offers **Save edits now** (keep them in the active environment) or **Discard edits**.

## Host your own copy

The app is a static site. To publish it on GitHub Pages:

1. Push the repo to GitHub.
2. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`. The [Deploy web app](../.github/workflows/pages.yml) workflow publishes it at `https://<user>.github.io/<repo>/`.

Any static host works too: build with `npm run build` and serve `packages/web/dist`. Then pass that URL to `envx serve --origin`.
