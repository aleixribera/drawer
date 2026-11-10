import { afterEach, describe, expect, it } from 'vitest';
import { createPush, type PushMessage, type PushSubscriptionJson } from '../src/lib/server/push';
import { testDrawer } from './helpers';

let cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
});

const sub = (n: number): PushSubscriptionJson => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });

function setup(status: (s: PushSubscriptionJson) => number | Error = () => 201) {
  const t = testDrawer();
  cleanups.push(t.cleanup);
  const sent: { to: string; message: PushMessage }[] = [];
  const push = createPush({
    db: t.drawer.db,
    publicKey: 'BPUB',
    clock: t.clock,
    send: async (subscription, message) => {
      const result = status(subscription);
      if (result instanceof Error) throw result;
      sent.push({ to: subscription.endpoint, message });
      return result;
    },
  });
  const stop = t.drawer.events.subscribe(push.onEvent);
  cleanups.push(stop);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { ...t, push, sent, settle };
}

describe('push', () => {
  it('notifies the device something is sent to, and no other', async () => {
    const { drawer, push, sent, settle } = setup();
    push.subscribe('iphone', sub(1));
    push.subscribe('fedora', sub(2));
    drawer.capture({ text: 'the wifi password is in the drawer', source: 'pc', lane: 'transit', target: 'iphone' });
    await settle();
    expect(sent.map((s) => s.to)).toEqual(['https://fcm.googleapis.com/fcm/send/1']);
    expect(sent[0]!.message.title).toBe('From the PC');
    expect(sent[0]!.message.body).toContain('wifi password');
    expect(sent[0]!.message.url).toMatch(/^\/item\/\d+$/);
  });

  it('sends to every device but the sender when it goes everywhere', async () => {
    const { drawer, push, sent, settle } = setup();
    push.subscribe('iphone', sub(1));
    push.subscribe('pc', sub(2));
    push.subscribe('fedora', sub(3));
    drawer.capture({ text: 'meeting moved to 4', source: 'pc', lane: 'transit', target: 'all' });
    await settle();
    expect(sent.map((s) => s.to).sort()).toEqual(['https://fcm.googleapis.com/fcm/send/1', 'https://fcm.googleapis.com/fcm/send/3']);
  });

  it('says nothing about what a private item is', async () => {
    const { drawer, push, sent, settle } = setup();
    push.subscribe('iphone', sub(1));
    drawer.capture({ text: 'bank PIN 4821', source: 'pc', lane: 'transit', target: 'iphone', private: true });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.message.body).not.toContain('4821');
    expect(sent[0]!.message.body).toMatch(/private/i);
  });

  it('keeps something that looks private off the lock screen even when it was not marked', async () => {
    const { drawer, push, sent, settle } = setup();
    push.subscribe('iphone', sub(1));
    drawer.capture({ text: 'wifi password: hunter2', source: 'pc', lane: 'transit', target: 'iphone' });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.message.body).not.toContain('hunter2');
  });

  it('only lets a device turn off its own notifications, and only for real push services', () => {
    const { push } = setup();
    push.subscribe('iphone', sub(1));
    push.unsubscribe(sub(1).endpoint, 'pc');
    expect(push.subscriptions('iphone')).toHaveLength(1);
    push.unsubscribe(sub(1).endpoint, 'iphone');
    expect(push.subscriptions('iphone')).toHaveLength(0);
    expect(() => push.subscribe('iphone', { endpoint: 'https://192.168.1.20/admin', keys: { p256dh: 'p', auth: 'a' } })).toThrow();
  });

  it('does not push things kept, or the same item twice', async () => {
    const { drawer, push, sent, settle } = setup();
    push.subscribe('iphone', sub(1));
    drawer.capture({ text: 'just keeping this', source: 'pc' });
    const sentItem = drawer.capture({ text: 'go', source: 'pc', lane: 'transit', target: 'iphone' }).item;
    await settle();
    await push.notify(drawer.get(sentItem.id)!);
    expect(sent).toHaveLength(1);
  });

  it('does not push something sent long ago (after a restart)', async () => {
    const { drawer, push, sent, clock } = setup();
    push.subscribe('iphone', sub(1));
    const item = drawer.capture({ text: 'old', source: 'pc', lane: 'transit', target: 'iphone' }).item;
    clock.advance(10 * 60_000);
    // A fresh push module, as after a restart, seeing the old item again.
    const again = createPush({ db: drawer.db, publicKey: 'BPUB', clock, send: async (s, m) => (sent.push({ to: s.endpoint, message: m }), 201) });
    sent.length = 0;
    expect(await again.notify(drawer.get(item.id)!)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('forgets a subscription the push service says is gone', async () => {
    const gone = Object.assign(new Error('Gone'), { statusCode: 410 });
    const { drawer, push, settle } = setup((s) => (s.endpoint.endsWith('/1') ? gone : 201));
    push.subscribe('iphone', sub(1));
    push.subscribe('iphone', sub(2));
    drawer.capture({ text: 'hello', source: 'pc', lane: 'transit', target: 'iphone' });
    await settle();
    await settle();
    expect(push.subscriptions('iphone').map((s) => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/2']);
  });

  it('refuses something that is not a subscription, and re-subscribing moves it to the new device', () => {
    const { push } = setup();
    expect(() => push.subscribe('iphone', { endpoint: 'http://insecure', keys: { p256dh: 'p', auth: 'a' } })).toThrow();
    expect(() => push.subscribe('iphone', {} as PushSubscriptionJson)).toThrow();
    push.subscribe('pc', sub(1));
    push.subscribe('fedora', sub(1));
    expect(push.subscriptions().map((s) => s.device)).toEqual(['fedora']);
  });
});

describe('push keys', () => {
  it('are made once, kept in the data folder, and used from the environment when set', async () => {
    const { mkdtempSync, rmSync, statSync } = await import('node:fs');
    const { tmpdir, platform } = await import('node:os');
    const { join } = await import('node:path');
    const { vapidKeys, vapidSubject } = await import('../src/lib/server/push');
    const dir = mkdtempSync(join(tmpdir(), 'drawer-vapid-'));
    try {
      const made = vapidKeys(dir, {});
      expect(Buffer.from(made.publicKey, 'base64url')).toHaveLength(65);
      expect(Buffer.from(made.privateKey, 'base64url')).toHaveLength(32);
      expect(vapidKeys(dir, {})).toEqual(made);
      if (platform() !== 'win32') expect(statSync(join(dir, 'vapid.json')).mode & 0o777).toBe(0o600);
      expect(vapidKeys(dir, { publicKey: 'P', privateKey: 'Q' })).toEqual({ publicKey: 'P', privateKey: 'Q' });
      expect(vapidSubject(undefined, 'https://box.example.ts.net')).toBe('https://box.example.ts.net');
      expect(vapidSubject(undefined, 'http://localhost:3000')).toBe('mailto:drawer@localhost');
      expect(vapidSubject('mailto:me@example.com', 'https://x')).toBe('mailto:me@example.com');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
