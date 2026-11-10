import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { sha256 } from './files';

/**
 * The owner's devices. Each has a name ("iphone", "pc", "fedora") and a bearer token for the API; only the token's
 * hash is stored. The web app itself trusts the tailnet; tokens are for Shortcuts and the companion CLI.
 */

export interface Device {
  id: number;
  name: string;
  kind: string;
  createdAt: string;
  lastSeenAt: string | null;
}

/** The devices transits can go to, in the order the UI offers them, with how the owner calls them. */
export const DEVICE_NAMES: Record<string, string> = { iphone: 'iPhone', pc: 'PC', fedora: 'Laptop' };

export function deviceLabel(name: string | null | undefined): string {
  if (!name) return '';
  if (name === 'all') return 'every device';
  if (name.startsWith('whatsapp:')) return 'WhatsApp';
  return DEVICE_NAMES[name] ?? name;
}

export function addDevice(db: DatabaseSync, name: string, kind = 'device'): string {
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!clean) throw new Error('A device needs a name made of letters, digits or dashes.');
  const token = `drw_${randomBytes(24).toString('base64url')}`;
  db.prepare(
    `INSERT INTO devices (name, kind, token_hash, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET token_hash = excluded.token_hash, kind = excluded.kind`,
  ).run(clean, kind, sha256(token), new Date().toISOString());
  return token;
}

export function deviceForToken(db: DatabaseSync, token: string): Device | null {
  const row = db.prepare('SELECT id, name, kind, created_at, last_seen_at FROM devices WHERE token_hash = ?').get(sha256(token)) as
    | { id: number; name: string; kind: string; created_at: string; last_seen_at: string | null }
    | undefined;
  if (!row) return null;
  db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return { id: row.id, name: row.name, kind: row.kind, createdAt: row.created_at, lastSeenAt: row.last_seen_at };
}

export function listDevices(db: DatabaseSync): Device[] {
  return (
    db.prepare('SELECT id, name, kind, created_at, last_seen_at FROM devices ORDER BY name').all() as {
      id: number;
      name: string;
      kind: string;
      created_at: string;
      last_seen_at: string | null;
    }[]
  ).map((r) => ({ id: r.id, name: r.name, kind: r.kind, createdAt: r.created_at, lastSeenAt: r.last_seen_at }));
}

export function removeDevice(db: DatabaseSync, name: string): boolean {
  return Number(db.prepare('DELETE FROM devices WHERE name = ?').run(name).changes) > 0;
}
