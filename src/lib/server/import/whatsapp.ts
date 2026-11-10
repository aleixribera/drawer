import { zonedToUtc } from '../time';

/**
 * A parser for iOS WhatsApp chat exports (`_chat.txt`, with or without media). One message per `[date, time] Name:`
 * header; lines without a header continue the message above. Handles both the day-first (`[08/05/2026, 8:08:50 PM]`)
 * and the month-first two-digit-year (`[8/1/26, 1:07:44 PM]`) layouts, U+200E marks, U+202F before AM/PM, captions
 * written before an `<attached: …>` tag, and the `<This message was edited>` marker.
 */

export interface ChatMessage {
  /** When it was sent (UTC). */
  at: Date;
  /** The text, if any (a caption when there's an attachment). */
  text?: string;
  /** The attachment's file name inside the export, if any. */
  attachment?: string;
  /** An attachment the export left out (`<image omitted>`): the kind WhatsApp printed. */
  omitted?: string;
  forwarded?: boolean;
}

const HEADER = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s(\d{1,2}):(\d{2})(?::(\d{2}))?[\s ]*([AP]M)?\]\s([^:]+):\s?(.*)$/i;
const MARKS = /[‎‏‪-‮]/g;

const SKIP = [
  /^Messages (?:and calls )?(?:to yourself )?are end-to-end encrypted/i,
  /^You deleted this message\.?$/i,
  /^This message was deleted\.?$/i,
  /^<album message>$/i,
  /^Missed (?:voice|video) call/i,
];

interface RawMessage {
  a: number;
  b: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  ampm?: string;
  lines: string[];
}

export function parseWhatsAppChat(source: string): ChatMessage[] {
  const raw: RawMessage[] = [];
  for (const rawLine of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(MARKS, '');
    const match = HEADER.exec(line);
    if (match) {
      const [, a, b, y, h, mi, s, ampm, , body] = match;
      const year = Number(y);
      raw.push({
        a: Number(a),
        b: Number(b),
        year: year < 100 ? 2000 + year : year,
        hour: Number(h),
        minute: Number(mi),
        second: Number(s ?? 0),
        ampm: ampm?.toUpperCase(),
        lines: [body ?? ''],
      });
    } else if (raw.length > 0) {
      raw.at(-1)!.lines.push(line);
    }
  }

  // Day-first unless a second field over 12 proves month-first (iOS in Spain writes 08/05/2026 for 8 May).
  const monthFirst = raw.some((m) => m.b > 12) && !raw.some((m) => m.a > 12);

  const messages: ChatMessage[] = [];
  for (const m of raw) {
    const day = monthFirst ? m.b : m.a;
    const month = monthFirst ? m.a : m.b;
    let hour = m.hour % 12;
    if (m.ampm === 'PM') hour += 12;
    if (!m.ampm) hour = m.hour;
    const at = zonedToUtc(m.year, month, day, hour, m.minute, m.second);

    let text = m.lines.join('\n').replace(/<This message was edited>/gi, '').replace(/​/g, '');
    let forwarded = false;
    if (/^\[Forwarded\]\s*/i.test(text)) {
      forwarded = true;
      text = text.replace(/^\[Forwarded\]\s*/i, '');
    }

    let attachment: string | undefined;
    const attached = /<attached:\s*([^>]+)>/i.exec(text);
    if (attached) {
      attachment = attached[1]!.trim();
      text = text.replace(attached[0], '');
    }
    let omitted: string | undefined;
    const omittedMatch = /<(image|video|audio|document|sticker|GIF|contact card) omitted>\s*(.*)$/im.exec(text);
    if (omittedMatch) {
      omitted = omittedMatch[1]!.toLowerCase();
      text = text.replace(omittedMatch[0], omittedMatch[2] ?? '');
    }

    text = text.replace(/[ \t]+$/gm, '').trim();
    // WhatsApp writes a document's name and page count before it ("notes.pdf • 3 pages"); that's not a caption.
    if (attachment && /^[^\n]+\.\w{2,5}\s*•\s*[‎‏]?\d+\s+pages?$/u.test(text)) text = '';
    if (!attachment && !omitted && SKIP.some((re) => re.test(text))) continue;
    if (!attachment && !omitted && !text) continue;
    // Stickers carry nothing worth keeping.
    if (attachment && /STICKER-/i.test(attachment) && !text) continue;
    if (omitted === 'sticker') continue;

    messages.push({
      at,
      ...(text ? { text } : {}),
      ...(attachment ? { attachment } : {}),
      ...(omitted ? { omitted } : {}),
      ...(forwarded ? { forwarded } : {}),
    });
  }
  return messages;
}
