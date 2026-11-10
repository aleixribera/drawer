import { describe, expect, it } from 'vitest';
import { inputsFromRequest, isEmpty } from '../src/lib/server/intake';

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('http://drawer.test/share', { method: 'POST', body, headers });

describe('inputsFromRequest', () => {
  it('keeps a shared page title only when it adds something', async () => {
    const form = new FormData();
    form.set('title', 'Factorio wiki — Trains');
    form.set('url', 'https://wiki.factorio.com/Railway');
    const [onlyUrl] = (await inputsFromRequest(post(form), 'pc'))!;
    expect(onlyUrl).toMatchObject({ text: null, url: 'https://wiki.factorio.com/Railway', source: 'pc', lane: 'keep' });

    const withText = new FormData();
    withText.set('title', 'Mixing recipe');
    withText.set('text', 'banana + cuke');
    const [joined] = (await inputsFromRequest(post(withText), 'iphone'))!;
    expect(joined!.text).toBe('Mixing recipe\nbanana + cuke');
  });

  it('gives the caption to the first of several files, and reads the transit target', async () => {
    const form = new FormData();
    form.set('text', 'timetable');
    form.set('target', 'fedora');
    form.append('file', new File([new Uint8Array([1, 2])], 'a.pdf', { type: 'application/pdf' }));
    form.append('file', new File([new Uint8Array([3])], 'b.png', { type: 'image/png' }));
    const inputs = (await inputsFromRequest(post(form), 'pc'))!;
    expect(inputs.map((i) => [i.text, i.file?.name, i.lane, i.target])).toEqual([
      ['timetable', 'a.pdf', 'transit', 'fedora'],
      [null, 'b.png', 'transit', 'fedora'],
    ]);
  });

  it('takes JSON and plain text, and knows an empty capture', async () => {
    const [json] = (await inputsFromRequest(post(JSON.stringify({ text: 'hi', private: true }), { 'content-type': 'application/json' }), 'pc'))!;
    expect(json).toMatchObject({ text: 'hi', private: true });
    expect(await inputsFromRequest(post('{', { 'content-type': 'application/json' }), 'pc')).toBeNull();
    const plain = (await inputsFromRequest(post('   ', { 'content-type': 'text/plain' }), 'pc'))!;
    expect(isEmpty(plain)).toBe(true);
  });

  it('reads text a Shortcut put in the file field, and the device names people use', async () => {
    const form = new FormData();
    form.append('file', 'https://www.thinkpad.example/x1');
    form.set('target', 'Laptop');
    const [shared] = (await inputsFromRequest(post(form), 'iphone'))!;
    expect(shared).toMatchObject({ text: 'https://www.thinkpad.example/x1', lane: 'transit', target: 'fedora' });

    const [phone] = (await inputsFromRequest(post(JSON.stringify({ text: 'hi', target: 'phone' }), { 'content-type': 'application/json' }), 'pc'))!;
    expect(phone!.target).toBe('iphone');
  });

  it('takes a raw upload from a Shortcut as a file, and options from the address', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const request = new Request('http://drawer.test/api/capture?target=pc', {
      method: 'POST',
      body: png,
      headers: { 'content-type': 'image/png' },
    });
    const [input] = (await inputsFromRequest(request, 'iphone', new Date(2026, 10, 10, 9, 5)))!;
    expect(input).toMatchObject({ lane: 'transit', target: 'pc', text: null, file: { name: 'Shared 2026-11-10 09.05.png', mime: 'image/png' } });
    expect([...input!.file!.bytes]).toEqual([...png]);

    const named = new Request('http://drawer.test/api/capture', {
      method: 'POST',
      body: new Uint8Array([1]),
      headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="Horari GEI.pdf"' },
    });
    const [pdf] = (await inputsFromRequest(named, 'iphone'))!;
    expect(pdf).toMatchObject({ lane: 'keep', file: { name: 'Horari GEI.pdf' } });

    const link = new Request('http://drawer.test/api/capture?private=1', { method: 'POST', body: 'https://example.com/x', headers: { 'content-type': 'text/plain' } });
    const [text] = (await inputsFromRequest(link, 'iphone'))!;
    expect(text).toMatchObject({ text: 'https://example.com/x', private: true });
  });

  it('refuses a content type that could pass as two, and survives a broken encoded file name', async () => {
    const sneaky = new Request('http://drawer.test/api/capture', {
      method: 'POST',
      body: new Uint8Array([1]),
      headers: { 'content-type': 'video/mp4,text/html', 'content-disposition': "attachment; filename*=UTF-8''%E0%A4%A" },
    });
    const [input] = (await inputsFromRequest(sneaky, 'pc', new Date(2026, 10, 10, 9, 5)))!;
    expect(input!.file).toMatchObject({ mime: 'application/octet-stream', name: 'Shared 2026-11-10 09.05.bin' });
  });
});
