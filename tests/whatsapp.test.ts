import { describe, expect, it } from 'vitest';
import { parseWhatsAppChat } from '../src/lib/server/import/whatsapp';

// An anonymised cut of the real iOS export shapes: U+200E marks, U+202F before PM, captions before the attachment tag.
const LRM = '‎';
const NNBSP = ' ';
const MEDIA_EXPORT = [
  `[14/09/2024, 21:03:11] Owner: ${LRM}Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.`,
  `[14/09/2024, 21:03:40] Owner: buy filament`,
  `[14/09/2024, 21:05:02] Owner: ${LRM}<attached: 00000003-PHOTO-2024-09-14-21-05-02.jpg>`,
  `[02/03/2026, 9:15:00] Owner: cargo rocket setup ${LRM}<attached: 00000004-PHOTO-2026-03-02-09-15-00.jpg>`,
  `[02/03/2026, 9:16:00] Owner: first line`,
  `second line of the same note`,
  `[02/03/2026, 9:17:00] Owner: ${LRM}[Forwarded] https://example.com/post <This message was edited>`,
  `[02/03/2026, 9:18:00] Owner: ${LRM}You deleted this message.`,
  `[02/03/2026, 9:19:00] Owner: ${LRM}<attached: 00000007-STICKER-2026-03-02.webp>`,
  `[25/03/2026, 23:59:59] Owner: ${LRM}image omitted`,
  `[26/03/2026, 0:00:30] Owner: ${LRM}<image omitted>`,
].join('\n');

describe('parseWhatsAppChat', () => {
  it('reads day-first exports in Madrid time, skipping system lines, deletions and stickers', () => {
    const messages = parseWhatsAppChat(MEDIA_EXPORT);
    expect(messages.map((m) => m.text ?? `[${m.attachment ?? m.omitted}]`)).toEqual([
      'buy filament',
      '[00000003-PHOTO-2024-09-14-21-05-02.jpg]',
      'cargo rocket setup',
      'first line\nsecond line of the same note',
      'https://example.com/post',
      'image omitted',
      '[image]',
    ]);
    // 21:03 in Madrid summer time is 19:03 UTC.
    expect(messages[0]!.at.toISOString()).toBe('2024-09-14T19:03:40.000Z');
    // March 2 is winter time: 9:15 → 8:15 UTC.
    expect(messages[2]!.at.toISOString()).toBe('2026-03-02T08:15:00.000Z');
    expect(messages[2]!.attachment).toBe('00000004-PHOTO-2026-03-02-09-15-00.jpg');
    expect(messages[4]!.forwarded).toBe(true);
  });

  it('reads month-first two-digit-year exports with AM/PM', () => {
    const messages = parseWhatsAppChat(
      [`[8/1/26, 1:07:44${NNBSP}PM] Owner: lunch at 2`, `[8/13/26, 12:05:00${NNBSP}AM] Owner: late note`].join('\n'),
    );
    expect(messages).toHaveLength(2);
    // 1 August 2026, 13:07:44 Madrid (UTC+2).
    expect(messages[0]!.at.toISOString()).toBe('2026-08-01T11:07:44.000Z');
    // 12:05 AM is just after midnight.
    expect(messages[1]!.at.toISOString()).toBe('2026-08-12T22:05:00.000Z');
  });

  it('drops the "name • N pages" line WhatsApp writes before a document, but keeps a real caption', () => {
    const messages = parseWhatsAppChat(
      [
        `[3/11/26, 9:00:00${NNBSP}AM] Owner: Scanned Doc 2.pdf • ${LRM}3 pages ${LRM}<attached: 00000010-Scanned Doc 2.pdf>`,
        `[3/11/26, 9:01:00${NNBSP}AM] Owner: algebra exam ${LRM}<attached: 00000011-exam.pdf>`,
      ].join('\n'),
    );
    expect(messages.map((m) => m.text ?? null)).toEqual([null, 'algebra exam']);
  });
});
