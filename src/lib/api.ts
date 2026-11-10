import type { Card } from './cards';

/** The browser's calls to the drawer's API. Each throws with the server's message when it fails. */

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      /* not json */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

const jsonBody = (body: unknown): RequestInit => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export interface ItemChange {
  pinned?: boolean;
  private?: boolean | null;
  label?: string | null;
  topic?: string | number | null;
  keep?: true;
  opened?: true;
  delivered?: true;
  restore?: true;
}

export const changeItem = (id: number, change: ItemChange) =>
  call<{ item: Card | null }>(`/api/items/${id}`, { method: 'PATCH', ...jsonBody(change) }).then((r) => r.item);

export const removeItem = (id: number) => call<{ item: Card | null }>(`/api/items/${id}`, { method: 'DELETE' }).then((r) => r.item);

export const sendItem = (id: number, target: string) =>
  call<{ item: Card | null }>(`/api/items/${id}`, { method: 'POST', ...jsonBody({ target }) }).then((r) => r.item);

export interface CaptureOutcome {
  outcome: 'created' | 'bumped' | 'labelled';
  item: Card;
}

export const capture = (form: FormData) =>
  call<{ results: CaptureOutcome[] }>('/api/capture', { method: 'POST', body: form }).then((r) => r.results);

export const olderItems = (before: string, kind?: string) =>
  call<{ items: Card[] }>(`/api/items?before=${encodeURIComponent(before)}${kind ? `&kind=${kind}` : ''}`).then((r) => r.items);

/** What can be copied from a card: its text or its link. */
export function copyable(card: Card): string | null {
  if (card.url && (card.kind === 'link' || card.kind === 'video')) return card.url;
  return card.text ?? card.url ?? null;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
