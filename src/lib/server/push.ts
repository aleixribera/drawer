import { createECDH } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { deviceLabel } from './devices';
import type { DrawerEvent } from './events';
import { systemClock, type Clock } from './time';
import type { Item } from './types';

/**
 * Web Push: when something is sent to a device, every browser that device turned notifications on in hears about it,
 * even closed (the iPhone's home-screen app included). The payload is encrypted for the browser; a private item says
 * only that something private arrived.
 */

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Sends one message to one subscription; resolves with the push service's status code. */
export type PushSender = (subscription: PushSubscriptionJson, message: PushMessage) => Promise<number>;

/** The browsers' push services; the server posts to nothing else. */
const PUSH_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

function isPushService(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string') return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Something sent this long ago is old news by the time the server notices it (a restart, a backlog). */
const FRESH_MS = 2 * 60_000;

export function createPush(options: {
  db: DatabaseSync;
  publicKey: string | null;
  send: PushSender | null;
  clock?: Clock;
  log?: (m: string) => void;
}) {
  const { db } = options;
  const clock = options.clock ?? systemClock;
  const log = options.log ?? (() => {});
  const pushed = new Set<number>();

  function subscribe(device: string, subscription: PushSubscriptionJson): void {
    if (!isPushService(subscription?.endpoint) || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Error('That is not a push subscription.');
    }
    db.prepare(
      `INSERT INTO push_subscriptions (device, endpoint, keys, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET device = excluded.device, keys = excluded.keys`,
    ).run(device, subscription.endpoint, JSON.stringify(subscription.keys), clock.now().toISOString());
  }

  /** Drops a subscription; given a device, only if it is that device's. */
  function unsubscribe(endpoint: string, device?: string): void {
    if (device) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND device = ?').run(endpoint, device);
    else db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  function subscriptions(device?: string): (PushSubscriptionJson & { device: string })[] {
    const rows = (
      device
        ? db.prepare('SELECT device, endpoint, keys FROM push_subscriptions WHERE device = ?').all(device)
        : db.prepare('SELECT device, endpoint, keys FROM push_subscriptions').all()
    ) as { device: string; endpoint: string; keys: string }[];
    return rows.map((r) => ({ device: r.device, endpoint: r.endpoint, keys: JSON.parse(r.keys) }));
  }

  /** What the notification says about an item. */
  function messageFor(item: Item): PushMessage {
    const from = `From the ${deviceLabel(item.source)}`;
    let body: string;
    if (item.private) body = 'Something private. Open Drawer to see it.';
    else if (item.file) body = item.label ? `${item.label} · ${item.file.name}` : item.file.name;
    else body = (item.kind === 'note' ? item.text : (item.label ?? item.title ?? item.url)) ?? item.title;
    return { title: from, body: body.slice(0, 180), url: `/item/${item.id}`, tag: `transit-${item.id}` };
  }

  /** The devices an item is on its way to, other than the one that sent it. */
  function recipients(item: Item): string[] {
    if (item.lane !== 'transit' || item.deliveredAt || !item.target) return [];
    if (clock.now().getTime() - new Date(item.createdAt).getTime() > FRESH_MS) return [];
    const all = [...new Set(subscriptions().map((s) => s.device))];
    return (item.target === 'all' ? all : [item.target]).filter((d) => d !== item.source);
  }

  async function notify(item: Item): Promise<number> {
    if (!options.send || pushed.has(item.id)) return 0;
    const devices = recipients(item);
    if (!devices.length) return 0;
    pushed.add(item.id);
    const message = messageFor(item);
    let sent = 0;
    for (const device of devices) {
      for (const subscription of subscriptions(device)) {
        try {
          const status = await options.send(subscription, message);
          if (status === 404 || status === 410) unsubscribe(subscription.endpoint);
          else if (status < 300) sent++;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) unsubscribe(subscription.endpoint);
          else log(`push to ${device} failed: ${(error as Error).message}`);
        }
      }
    }
    return sent;
  }

  /** Listens to the drawer: anything new in transit is pushed to where it's going. */
  function onEvent(event: DrawerEvent): void {
    if (event.type === 'item') void notify(event.item);
  }

  return { publicKey: options.publicKey, enabled: !!options.send, subscribe, unsubscribe, subscriptions, notify, onEvent, messageFor };
}

export type Push = ReturnType<typeof createPush>;

/** The real sender: the web-push library, signed with this drawer's VAPID keys. */
export function webPushSender(publicKey: string, privateKey: string, subject = 'mailto:drawer@localhost'): PushSender {
  let ready: Promise<typeof import('web-push')> | null = null;
  return async (subscription, message) => {
    ready ??= import('web-push').then((m) => {
      const webpush = (m as unknown as { default?: typeof import('web-push') }).default ?? m;
      webpush.setVapidDetails(subject, publicKey, privateKey);
      return webpush;
    });
    const webpush = await ready;
    // An hour to reach a phone that is off; after that it's in the transit lane anyway.
    const result = await webpush.sendNotification(subscription, JSON.stringify(message), { TTL: 3600, urgency: 'high' });
    return result.statusCode;
  };
}

/**
 * The VAPID key pair push is signed with: from the environment when both keys are set, else made once and kept in the
 * data folder (vapid.json, readable by the owner only), so push works without any setup. New keys would mean every
 * device turns notifications on again, which is why they are never remade while the file exists.
 */
export function vapidKeys(dataDir: string, fromEnv: { publicKey?: string | null; privateKey?: string | null }): { publicKey: string; privateKey: string } {
  if (fromEnv.publicKey && fromEnv.privateKey) return { publicKey: fromEnv.publicKey, privateKey: fromEnv.privateKey };
  const file = join(dataDir, 'vapid.json');
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { publicKey?: string; privateKey?: string };
    if (saved.publicKey && saved.privateKey) return { publicKey: saved.publicKey, privateKey: saved.privateKey };
  }
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  // Node drops leading zero bytes; web-push wants exactly 32.
  const secret = ecdh.getPrivateKey();
  const privateKey = Buffer.concat([Buffer.alloc(32 - secret.length), secret]).toString('base64url');
  const keys = { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey };
  writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

/** Who the push services may contact about this sender: DRAWER_VAPID_SUBJECT, else the app's own https address. */
export function vapidSubject(subject: string | undefined, origin: string | undefined): string {
  if (subject) return subject;
  return origin?.startsWith('https://') ? origin : 'mailto:drawer@localhost';
}
