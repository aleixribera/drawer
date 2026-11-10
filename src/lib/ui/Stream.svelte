<script lang="ts">
  import type { Card } from '$lib/cards';
  import { clock, dayHeading, dayKey } from '$lib/when';
  import Row from './Row.svelte';

  /** The signature view: items grouped by the day they were last touched, newest day first, a clock time on the left. */
  let { cards, now = new Date() }: { cards: Card[]; now?: Date } = $props();

  const days = $derived.by(() => {
    const out: { key: string; heading: string; cards: Card[] }[] = [];
    for (const card of cards) {
      const key = dayKey(card.touchedAt);
      const last = out.at(-1);
      if (last && last.key === key) last.cards.push(card);
      else out.push({ key, heading: dayHeading(card.touchedAt, now), cards: [card] });
    }
    return out;
  });
</script>

{#each days as day (day.key)}
  <section class="day" aria-label={day.heading}>
    <h2 class="day-heading small">{day.heading}<span class="count num">{day.cards.length}</span></h2>
    {#each day.cards as card (card.id)}
      <Row {card} when={clock(card.touchedAt)} />
    {/each}
  </section>
{/each}

<style>
  .day + .day {
    margin-top: 16px;
  }
  .day-heading {
    position: sticky;
    top: 48px;
    z-index: 2;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 8px 0 8px 60px;
    background: var(--surface);
    font-weight: 600;
    color: var(--text);
  }
  .count {
    color: var(--faint);
    font-weight: 400;
  }
  @media (max-width: 640px) {
    .day-heading {
      padding-left: 48px;
    }
  }
</style>
