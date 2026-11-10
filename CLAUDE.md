# Drawer

A self-hosted replacement for sending things to yourself on WhatsApp: capture from the phone, PC and laptop, newest on
top, topics without filing, a librarian you can ask, and a transit lane between devices. One person, one instance,
reachable only over Tailscale.

- `README.md` says how to run it; `docs/DESIGN.md` how it is built and the decisions taken. Update DESIGN.md when a
  decision changes.
- `CONTEXT.md` is the vocabulary (Item, Lane, Label, Freshness, Librarian…). Use these words in code and UI.
- `desktop/` is the Electron app for Windows and Linux (tray, hotkeys, transit to the clipboard, auto-update from
  GitHub Releases). `companion/drawer.mjs` is the dependency-free CLI it shares its clipboard code with.
- If `CLAUDE.local.md` exists, it describes the owner's own instance and how it is deployed. It and `private/`,
  `import/`, `.env` and `deploy.local.env` are git-ignored: nothing from them goes into tracked files.

## Rules

- Private items never reach a model API: the local check (`sensitivity.ts`) runs before every Anthropic call, and
  every kind of secret it knows has a test case with invented values.
- Models: `claude-haiku-5-5` through the official TypeScript SDK with an API key, or a local OpenAI-compatible server
  (`local.ts`). Never a Claude.ai subscription login: Anthropic's terms don't allow it in third-party apps.
  Every call is logged with its tokens and cost, under the monthly cap.
- Tests: `npx vitest run tests/<file>` while working, `npm test` and `npm run typecheck` before a commit. CI runs both
  on every push.
- UI goes through the design skills; no generic AI look. Check it at desktop and phone width.
