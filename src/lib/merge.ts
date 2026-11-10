import type { Card } from './cards';

/**
 * Fold a live change into a list sorted newest-touched first: replace it if it's there, add it if `belongs` says it
 * should be, drop it if it no longer belongs, and keep the order.
 */
export function merge(list: Card[], card: Card, belongs: (card: Card) => boolean): Card[] {
  const without = list.filter((c) => c.id !== card.id);
  if (!belongs(card)) return without.length === list.length ? list : without;
  const had = without.length !== list.length;
  // A new item older than everything shown belongs to a page not loaded yet.
  const oldest = list.at(-1);
  if (!had && oldest && list.length >= 20 && card.touchedAt < oldest.touchedAt) return list;
  const next = [...without, card];
  next.sort((a, b) => (a.touchedAt < b.touchedAt ? 1 : a.touchedAt > b.touchedAt ? -1 : b.id - a.id));
  return next;
}
