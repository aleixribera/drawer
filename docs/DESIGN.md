# Drawer: design

Drawer replaces the WhatsApp chat people keep with themselves. Looking at real self-chats, what goes in is a mix:
videos to watch later (often reels that can't be read without a login, so the short label typed after them is the
only clue), prompts and snippets typed on the phone for the computer, uni or work PDFs (the same one sent three
times), shopping comparisons that go stale in weeks, hobby notes and screenshots, one-shot pairing links, and a
handful of things that must never leave the house (licence codes, an address, an ID scan).

The rule that shapes everything: **this isn't a source of truth.** These are quick notes. Newer things matter more
than a game guide from two years ago, and everything should be on a recent page and also grouped by topic.

## Principles

1. **Capture in one gesture, from any device.** Nothing asks which folder.
2. **Recency first.** Every list ranks by how recently something was sent, re-sent, opened or pinned. Old things fade
   and are never deleted (transit excepted).
3. **Topics emerge.** The model assigns topics and creates new ones when a cluster forms. The owner can rename, merge
   or move things, but never has to.
4. **A librarian, not an oracle.** The agent reports what was saved and when ("in October you were looking at the
   ThinkPad L14"), and never presents a note as fact.
5. **Private stays home.** A local check runs before any model API call; flagged items are handled only on the server.
6. **Only reachable on the tailnet.** There is no login, so it is never exposed to the internet.

## What it does

### Capture

| Device | Gesture | Goes to |
|---|---|---|
| iPhone | Share sheet → **Drawer** (a Shortcut, since iOS web apps can't receive shares) | Keep |
| iPhone | Share sheet → **Send to PC** | Transit |
| iPhone | **Action Button** → dictation → Drawer decides: save it, or answer it | Keep, or an answer |
| Windows / Linux | Ctrl+Alt+D in the desktop app or the `drawer` CLI: clipboard text, image or copied files | Keep |
| Windows / Linux | Ctrl+Alt+P: the clipboard to the phone | Transit |
| Any browser | Paste, drag-and-drop or type into the app | Keep |

A short text (under ~40 characters) arriving within 2 minutes of an item from the same device becomes that item's
**label**. A file or link already in Drawer is not stored twice: the old item is bumped to the top.

### Two lanes

- **Keep:** the drawer itself. Enriched, topic-sorted, searchable, kept for good.
- **Transit:** "send this to my other device". On a computer it lands on the clipboard at once with a notification
  (it was sent there on purpose, so auto-copy is the point). On the phone it arrives as a Web Push. A transit item
  leaves Recent after 24 h and is deleted after 7 days unless kept.

### Enrichment (on arrival, in the background)

1. **Local first, always:** file type, sha256 for de-duplication, `pdftotext`, Tesseract OCR on images (Catalan,
   Spanish, English), link unfurl (YouTube oEmbed, Open Graph, short-link redirects), Whisper for voice notes.
2. **Sensitivity check (local rules):** keys and codes, pairing links with tokens, IBANs, DNI/NIE, card numbers, phone
   numbers and addresses, MAC addresses, passwords and PINs, file names like *certificat* or *factura*. Items can
   also be marked private at capture or later.
3. **Not private → the model:** title, summary, bilingual keywords, topic, and any future date (read as the owner's
   local time).
4. **Private → local only:** the title comes from the file name or the matched rule; the extracted text is indexed
   locally.

### Topics and ageing

- On import the model proposes a topic list from the whole history. Each new item joins a topic or waits in **Loose**;
  three loose items that belong together become a new topic.
- **Freshness** = the latest of sent, re-sent, opened, pinned. Within 30 days an item is *fresh*; after 6 months
  untouched it *fades*: it collapses under "Older", ranks lower, and the librarian gives its date. Pinned items never
  fade. A topic with nothing new in 3 months is **Dormant**.

### The librarian

- **Tools:** `search` (full text with kind and date filters), `recent`, `topics`, `read`, `send_to_device`. It never
  deletes; changes come back as a button to confirm.
- **Answers:** one to three short sentences, read aloud on the phone, with the items cited as `[#id]` and shown as
  cards. Private items show as a bare number.
- **Earlier turns** are sent along for follow-up questions, except any exchange that looks private.
- **Local models** get the same tools. Small ones often claim to have searched without calling anything, so Drawer
  does the first search for them and shows it as their own call; each question gets 90 seconds before Drawer answers
  with a plain search instead.

## Architecture

| Part | Choice | Why |
|---|---|---|
| App | SvelteKit + TypeScript on Node 24, one container | Server and UI in one place, no separate API service |
| Storage | SQLite (`node:sqlite`) with FTS5 (`unicode61 remove_diacritics 2`); files on disk by sha256 | One file to back up. At ~50 items a month, embeddings aren't needed: the model writes keywords in English and the original language, so full-text search works across languages |
| Model | Claude Haiku 5.5 with an API key, or a local OpenAI-compatible server | Haiku costs well under a dollar a month at this volume; a local model costs nothing and keeps everything home |
| Local tools | poppler, tesseract, ffmpeg in the image; whisper.cpp as a sidecar | All on the CPU |
| Live updates | Server-Sent Events to the app and the companions; Web Push (VAPID) to the phone | No socket server; Web Push reaches iOS home-screen apps |
| Desktop | An Electron app (tray, hotkeys, transit to the clipboard, auto-update from GitHub Releases) and a dependency-free CLI | The app for most people; the CLI for servers and minimal setups |
| Access | Tailscale HTTPS on the tailnet only. The UI trusts the tailnet; the API takes per-device bearer tokens | Nothing reaches the internet; a leaked token is revoked per device |
| Spend guard | Every API call logged with tokens and cost; a monthly cap switches the model off until the 1st | No surprise bills |

## Decisions

| # | Decision | Instead of | Why |
|---|---|---|---|
| 1 | Topics emerge, freshness ranks | Folders to file into | Filing is the chore being escaped; old notes matter less |
| 2 | Two lanes, Keep and Transit | One stream | About a third of self-chat messages are transfers, and they would clutter search forever |
| 3 | The agent finds and saves; changes need a tap | Full control by voice | Voice mistakes shouldn't delete things |
| 4 | Full-text search with bilingual keywords | A vector database | Small volume; one fewer service |
| 5 | Raw request bodies and `?target=` on `/api/capture` | Only multipart forms | An iPhone Shortcut posting "File" or "Text" is two actions; a form with named fields is ten |
| 6 | Items kept while the model is off wait for it (`waiting_for_model`) | Local titles forever | An import can run before a model is set up |
| 7 | Web Push keys made on first start and kept in the data folder; a private item pushes only "Something private" | Pushing the text, or asking the owner to make keys | The lock screen shows the payload; setup should need nothing |
| 8 | An API key or a local model, never a Claude.ai login | Letting people use their subscription | Anthropic's terms reserve subscription logins for its own apps; using one here could get the account banned |
| 9 | The local librarian's first search is done for it | Trusting a small model to call tools | Small models answer "I searched" without searching |
| 10 | Electron for the desktop app | Only OS hotkeys and the CLI | Auto-updates, a tray, native notifications and a window, on Windows and Linux alike |
| 11 | A release stays a draft until both installers are uploaded | Each build publishing as it finishes | An app that checks in between would find the update's manifest without its installer |
| 12 | The app connects with one button on Drawer's Settings page, which mints the computer's token | Pasting a token into the app | Nothing to copy; only Drawer's own page can ask, and a bearer token can't mint another |

## How it is verified

- **Unit tests (Vitest):** the importer against anonymised fixtures, labels, de-duplication, the sensitivity rules
  (every kind of secret found in real chats, with invented values), freshness and ranking, push, the local model
  client, and the librarian's tools with a scripted model.
- **Browser journeys (Playwright):** capture → appears in Recent → found by search; transit expiry;
  confirm-to-delete.
- **On the real thing:** each change that touches capture or transit is tried on a real phone and computer.
