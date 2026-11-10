import { describe, expect, it } from 'vitest';
import { deliveryFor, freeName, parseSend, parseSse, screenshotName, withKeybindings } from '../companion/drawer.mjs';

const card = (over: Record<string, unknown> = {}) => ({
  id: 1,
  lane: 'transit',
  source: 'iphone',
  target: 'pc',
  deliveredAt: null,
  kind: 'note',
  url: null,
  text: 'a prompt typed on the phone',
  file: null,
  ...over,
});

describe('the companion', () => {
  it('tells files from words, and reads the device names people use', () => {
    const files = new Set(['shot.png']);
    expect(parseSend(['--to', 'Laptop', 'shot.png', 'for', 'uni'], (p) => files.has(p))).toEqual({
      to: 'fedora',
      private: false,
      notify: false,
      files: ['shot.png'],
      words: ['for', 'uni'],
    });
    expect(parseSend(['--notify', '--private'], () => false)).toMatchObject({ notify: true, private: true, to: null });
    expect(() => parseSend(['--to', 'fridge'], () => false)).toThrow(/which device/);
  });

  it('reads server-sent events split across chunks, ignoring pings', () => {
    const first = parseSse('event: hello\ndata: {}\n\n: ping\n\nevent: item\ndata: {"id"');
    expect(first.events).toEqual([{ event: 'hello', data: '{}' }]);
    const second = parseSse(first.rest + ':7}\r\n\r\n');
    expect(second.events).toEqual([{ event: 'item', data: '{"id":7}' }]);
    expect(second.rest).toBe('');
  });

  it('delivers only what was sent here, once, and copies a link rather than its caption', () => {
    expect(deliveryFor(card(), 'pc')).toEqual({ kind: 'text', text: 'a prompt typed on the phone' });
    expect(deliveryFor(card({ target: 'all' }), 'pc').kind).toBe('text');
    expect(deliveryFor(card({ target: 'fedora' }), 'pc').kind).toBe('none');
    expect(deliveryFor(card({ source: 'pc', target: 'all' }), 'pc').kind).toBe('none');
    expect(deliveryFor(card({ deliveredAt: '2026-11-10T10:00:00Z' }), 'pc').kind).toBe('none');
    expect(deliveryFor(card({ lane: 'keep' }), 'pc').kind).toBe('none');
    expect(deliveryFor(card({ kind: 'link', url: 'https://example.com', text: 'look' }), 'pc')).toEqual({ kind: 'text', text: 'https://example.com' });
    expect(deliveryFor(card({ kind: 'image', text: null, file: { name: 'IMG_1.png' } }), 'pc')).toEqual({ kind: 'file', name: 'IMG_1.png' });
  });

  it('never overwrites a download, and keeps names Windows accepts', () => {
    const taken = new Set(['shot.png', 'shot (2).png']);
    expect(freeName('shot.png', (n) => taken.has(n))).toBe('shot (3).png');
    expect(freeName('a:b?.pdf', () => false)).toBe('a_b_.pdf');
  });

  it('adds its GNOME shortcuts without dropping the ones already there', () => {
    expect(withKeybindings('@as []', ['/k/drawer-keep/'])).toBe("['/k/drawer-keep/']");
    expect(withKeybindings("['/k/custom0/', '/k/drawer-keep/']", ['/k/drawer-keep/', '/k/drawer-phone/'])).toBe(
      "['/k/custom0/', '/k/drawer-keep/', '/k/drawer-phone/']",
    );
  });

  it('names a picture from the clipboard like a screenshot', () => {
    expect(screenshotName(new Date(2026, 10, 10, 9, 5), '.png')).toBe('Screenshot 2026-11-10 09.05.png');
  });
});
