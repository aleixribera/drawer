# Drawer

A self-hosted place for everything you used to send yourself on WhatsApp: links, reels, screenshots, PDFs, voice
notes, "remember this" texts. Drop things in from your phone or computer in one gesture; they come back newest
first, grouped into topics nobody had to file, and findable by asking out loud. Something sent to "my other device"
pops up there and is already on its clipboard.

It runs on your own machine, for one person, reachable only from your own devices over Tailscale.

- **Recent** is a stream by day. Old things fade but are never lost; re-sending something moves it back to the top.
- **Topics** form on their own from what you keep (a model files each item), and quiet ones drift to the bottom.
- **Ask** ("the mouse I was looking at", "what did I save yesterday") answers in a line with the items it used.
- **Transit**: send to the phone, the PC or the laptop. It arrives as a notification and on the clipboard, and
  leaves the stream after a day.
- **Private stays home**: codes, keys, IBANs, ID documents and anything you mark private are found by local rules
  and never sent to a model API.
- **WhatsApp import**: bring your old "message yourself" chat in, media included, with its real dates.

## Running it

You need a computer that stays on (a home server, a NAS, an old laptop) with Docker, and
[Tailscale](https://tailscale.com) on it and on your devices. Tailscale gives Drawer an HTTPS address that only your
devices can reach, which the phone needs to install it, use the microphone and get notifications.

```bash
git clone https://github.com/aleixribera/drawer.git
cd drawer
cp .env.example .env          # then edit it: ORIGIN, TZ, and a model (below)
docker compose up -d --build
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
```

`tailscale serve status` prints the address (`https://<machine>.<tailnet>.ts.net`); put it in `.env` as `ORIGIN`
and run `docker compose up -d` again. Open it on each device.

Drawer has **no login**: anyone who can reach the address can read everything. Keep it on your tailnet, never use
`tailscale funnel` or forward the port, and don't share the machine into a tailnet with people who shouldn't see it.

Data lives in the `drawer-data` Docker volume (`/data`: one SQLite file and the files by hash). Back that up.

## Choosing a model

Drawer works without one: you get capture, search over everything (PDF and image text included), files and transit.
A model adds titles, summaries, topics, and the librarian that answers questions. There are two ways in.

**Claude Haiku, with an API key** (`ANTHROPIC_API_KEY`). Best results and fast. You pay per use at
[console.anthropic.com](https://console.anthropic.com): filing a few hundred items and asking questions daily stays
well under a dollar a month, and `DRAWER_SPEND_CAP_USD` stops it at a cap you choose. Private items never reach it.

**A local model** (`DRAWER_LOCAL_URL` and `DRAWER_LOCAL_MODEL`). Free and nothing leaves your machine, but slower and
less sharp. Any OpenAI-compatible server works: [Ollama](https://ollama.com), LM Studio, llama.cpp, vLLM. With
Ollama:

| Your machine | Model | What to expect |
|---|---|---|
| A GPU with 24 GB, or a Mac with 32 GB+ | `qwen3.6:35b` | Good titles and topics, answers close to Haiku's |
| 8–12 GB of GPU memory | `qwen3.5:9b` | Good filing (a few seconds an item), plainer answers that sometimes add details that aren't there |
| CPU only | `qwen3.5:4b` | Filing works, slowly; the librarian is weak |

Start Ollama with `OLLAMA_CONTEXT_LENGTH=16384`: its 4k default is too short, and it silently drops the start of a
long conversation, instructions first. If Ollama runs on the same machine as Docker, also set `OLLAMA_HOST=0.0.0.0`
and use `DRAWER_LOCAL_URL=http://host.docker.internal:11434/v1`. Or run it in the stack:
`docker compose --profile ollama up -d`, then `docker compose exec ollama ollama pull qwen3.5:9b` and
`DRAWER_LOCAL_URL=http://ollama:11434/v1`.

### Why no Claude login

Drawer can't use a Claude.ai Pro or Max subscription, and won't. Anthropic's terms keep subscription logins for its
own apps (Claude.ai, Claude Code and the like) and don't allow other apps to offer a Claude login or route requests
through a subscription; accounts that do can be cut off without warning
([Anthropic's legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance)). An API key, or a
local model, keeps your account safe.

## Your devices

Drawer knows three devices: the **iPhone**, the **PC** and the **Laptop**. Each gets a token on the Settings page,
and Settings has step-by-step setup for each.

- **iPhone:** open the address in Safari and add it to the Home Screen (an Android phone works the same way in Chrome, in the iPhone slot). Settings has two Shortcuts for
  the share sheet ("Drawer" keeps it, "Send to PC" sends it on) and one for the Action Button that asks or saves by
  voice. Turn on notifications in Settings to get things sent to the phone.
- **Windows and Linux:** the desktop app (below), or the `drawer` command line companion that Drawer serves at
  `/drawer.mjs` (Node 20+): `drawer send` keeps the clipboard, `drawer listen` receives, `drawer setup` binds
  Ctrl+Alt+D and Ctrl+Alt+P.

### The desktop app

Download it from [Releases](https://github.com/aleixribera/drawer/releases): the `.exe` for Windows, the
`.AppImage` for Linux. It updates itself.

It opens Drawer in its own window and stays in the tray: things sent to this computer land on its clipboard (files
in Downloads/Drawer) with a notification, Ctrl+Alt+D keeps whatever is on the clipboard, Ctrl+Alt+P sends it to the
phone, and it starts with the computer. On first start it asks for Drawer's address; then press **Connect this app**
on the Settings page it opens.

The installer isn't code-signed (a certificate costs money every year), so Windows SmartScreen warns the first time:
**More info → Run anyway**. Updates install quietly after that.

On Linux, make the AppImage executable (`chmod +x`). Fedora needs `sudo dnf install fuse-libs` for AppImages to run,
and on GNOME's Wayland the app sets the two shortcuts up in GNOME's keyboard settings. Stock GNOME shows no tray icons; the
AppIndicator extension adds them, and without it the app's Settings panel has the same switches (start with the
computer, updates, quit). Install `wl-clipboard` so the hotkeys can read the clipboard on Wayland.

## Importing a WhatsApp chat

Export the chat from WhatsApp on the phone (chat → Export Chat → Attach Media), unzip it into `import/` next to
`compose.yaml` (one folder per chat, each with `_chat.txt`), then, with Drawer stopped so the import is the only
writer:

```bash
docker compose stop drawer
docker compose --profile tools run --rm --build import /import/<folder>
docker compose up -d drawer
```

Running it twice is safe: the same links, files and notes move to the top instead of being kept twice. It prints
counts, never content. Items imported without a model are filed when one is set up.

## What leaves your machine

- With an API key: the text of items that are not private (and their pictures) goes to Anthropic to be filed, and
  your questions with the search results the librarian reads. Private items appear to it as a bare number.
- Link previews: Drawer fetches the pages you save, to read their titles.
- Push notifications go through Apple's, Google's or Mozilla's push service, encrypted; a private item's
  notification says only "Something private".
- Nothing else. There is no telemetry.

## Developing

Node 24. `npm install`, then `npm run dev`. `npm test` runs the unit tests, `npm run typecheck` the types, and
`npm run test:browser` the Playwright journeys. `docs/DESIGN.md` explains how it is built and why;
`CONTEXT.md` is the vocabulary the code uses.

The desktop app lives in `desktop/`: `npm install` and `npm start` there run it against any Drawer. To release it, raise
the version in `desktop/package.json` and push a matching tag (`git tag v0.1.1 && git push origin v0.1.1`): the Release
workflow builds both installers, and every installed app updates itself from that release.

## License

MIT. See [LICENSE](LICENSE).
