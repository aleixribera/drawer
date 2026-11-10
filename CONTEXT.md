# Vocabulary

| Term | Meaning |
|---|---|
| **Item** | One thing in Drawer: a note, link, image, PDF, file, voice note or video. |
| **Capture** | An item arriving from a device (Share Shortcut, Action Button, `drawer send`, the app) or from the WhatsApp import. |
| **Lane** | **Keep** (the drawer, kept for good) or **Transit** (sent to another device, leaves Recent after 24 h, deleted after 7 days unless kept). |
| **Label** | A short text sent within 2 minutes after an item from the same device, attached to that item instead of becoming one. |
| **Enrichment** | What happens on arrival: local extraction (text, OCR, unfurl, transcript), the sensitivity check, then the model's title, summary, keywords and topic (Haiku, or a local model). |
| **Sensitive** | An item the local rules flagged, or that the owner marked private. Its content never goes to the Anthropic API. |
| **Topic** | A group the model assigns. Topics emerge from clusters of **Loose** items; a topic quiet for 3 months is **Dormant**. |
| **Freshness** | The latest of sent, re-sent, opened or pinned. Within 30 days an item is **fresh**; after 6 months untouched it is **faded**. Pinned items never fade. |
| **Librarian** | The model's agent behind the ask bar, the mic button and the Action Button. It finds and saves; changes need a confirming tap. |
| **Companion** | The `drawer` CLI on the PC and laptop: `send` (hotkeys) and `listen` (transit notifications with auto-copy). |
