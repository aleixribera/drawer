import type { Item } from './types';

/** What the core announces, so open pages and companions update live (SSE) and transits reach their device. */
export type DrawerEvent =
  | { type: 'item'; item: Item }
  | { type: 'removed'; id: number }
  | { type: 'topics' }
  | { type: 'topic-created'; name: string; count: number };

export interface Events {
  emit(event: DrawerEvent): void;
  subscribe(listener: (event: DrawerEvent) => void): () => void;
}

export function createEvents(): Events {
  const listeners = new Set<(event: DrawerEvent) => void>();
  return {
    emit(event) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          /* one broken listener must not stop the others */
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
