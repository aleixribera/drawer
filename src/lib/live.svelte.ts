import type { Card } from './cards';

/**
 * One EventSource per tab, shared by every page: new and changed items, removals and topic changes arrive here as
 * they happen on any device. Reconnects on its own; `connection.online` says whether the stream is up.
 */

export interface LiveHandlers {
  item?: (card: Card) => void;
  removed?: (id: number) => void;
  topics?: () => void;
}

export const connection = $state({ online: true });

const handlers = new Set<LiveHandlers>();
let source: EventSource | null = null;

function open(): void {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  source.addEventListener('hello', () => (connection.online = true));
  source.addEventListener('item', (event) => {
    const card = JSON.parse((event as MessageEvent).data) as Card;
    for (const h of handlers) h.item?.(card);
  });
  source.addEventListener('removed', (event) => {
    const { id } = JSON.parse((event as MessageEvent).data) as { id: number };
    for (const h of handlers) h.removed?.(id);
  });
  source.addEventListener('topics', () => {
    for (const h of handlers) h.topics?.();
  });
  source.onerror = () => {
    connection.online = source?.readyState === EventSource.OPEN;
  };
  source.onopen = () => (connection.online = true);
}

/** Listen for live changes; returns the function that stops listening. */
export function listen(h: LiveHandlers): () => void {
  handlers.add(h);
  open();
  return () => handlers.delete(h);
}
