<script lang="ts">
  import { tick } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { olderItems } from '$lib/api';
  import { KIND_FILTERS, type Card } from '$lib/cards';
  import { takeIntake } from '$lib/intake.svelte';
  import { listen } from '$lib/live.svelte';
  import { merge } from '$lib/merge';
  import Composer from '$lib/ui/Composer.svelte';
  import Stream from '$lib/ui/Stream.svelte';
  import TopicList from '$lib/ui/TopicList.svelte';
  import Transit from '$lib/ui/Transit.svelte';
  import { shortDate } from '$lib/when';
  import { onMount } from 'svelte';

  let { data } = $props();

  let cards = $derived(data.cards);
  let transit = $derived(data.transit);
  let more = $derived(data.cards.length >= 60);
  let loading = $state(false);
  let olderError = $state('');
  let streamEl: HTMLElement | undefined = $state();
  let composer: Composer | undefined = $state();
  const now = $derived(new Date(data.now));

  const filter = $derived(KIND_FILTERS.find((f) => f.kind === data.kind) ?? KIND_FILTERS[0]!);
  const belongs = (card: Card) =>
    card.lane === 'keep' && (filter.kinds.length === 0 || filter.kinds.includes(card.kind));
  const live = $derived(data.topics.filter((t) => !t.dormant));
  const dormant = $derived(data.topics.length - live.length);

  onMount(() => {
    const stopIntake = takeIntake((files, text) => {
      if (files.length) composer?.addFiles(files);
      if (text) composer?.addText(text);
    });
    let topicsTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = listen({
      item(card) {
        if (card.lane === 'transit') {
          transit = [card, ...transit.filter((c) => c.id !== card.id)];
          return;
        }
        transit = transit.filter((c) => c.id !== card.id);
        cards = merge(cards, card, belongs);
      },
      removed(id) {
        cards = cards.filter((c) => c.id !== id);
        transit = transit.filter((c) => c.id !== id);
      },
      topics() {
        clearTimeout(topicsTimer);
        topicsTimer = setTimeout(() => invalidate('drawer:topics'), 1500);
      },
    });
    return () => {
      stopIntake();
      stop();
      clearTimeout(topicsTimer);
    };
  });

  async function loadOlder() {
    const last = cards.at(-1);
    if (!last || loading) return;
    loading = true;
    olderError = '';
    const before = cards.length;
    try {
      const older = await olderItems(last.touchedAt, data.kind === 'all' ? undefined : data.kind);
      const seen = new Set(cards.map((c) => c.id));
      cards = [...cards, ...older.filter((c) => !seen.has(c.id))];
      more = older.length >= 60;
      // The button may vanish with the last page: keep the keyboard on the first new row instead.
      await tick();
      if (!more) streamEl?.querySelectorAll<HTMLElement>('a.cover')[before]?.focus();
    } catch (error) {
      olderError = `Couldn’t load older things: ${(error as Error).message}.`;
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Drawer</title>
</svelte:head>

<div class="column">
  <div class="title-row">
    <div>
      <h1>Recent</h1>
      <p class="sub num">
        {data.stats.items.toLocaleString('en-GB')} things kept{#if data.stats.reading && data.stats.pending > 0}, {data.stats.pending} still being read{/if}
      </p>
    </div>
    <nav class="segmented kinds" aria-label="Show">
      {#each KIND_FILTERS as f (f.kind)}
        <a href={f.kind === 'all' ? '/' : `/?kind=${f.kind}`} aria-current={f.kind === data.kind ? 'true' : undefined}>{f.label}</a>
      {/each}
    </nav>
  </div>

  <div class="split">
    <div class="stack">
      <Composer bind:this={composer} device={data.device} />
      <Transit cards={transit} device={data.device} {now} />
      <section class="panel stream" aria-label="Kept items" bind:this={streamEl}>
        {#if cards.length}
          <Stream {cards} {now} />
          {#if more}
            <div class="older">
              <button class="btn" type="button" onclick={loadOlder} disabled={loading}>
                {loading ? 'Loading…' : olderError ? 'Try again' : `Older than ${shortDate(cards.at(-1)!.touchedAt, now)}`}
              </button>
              {#if olderError}<p class="small error" role="alert">{olderError}</p>{/if}
            </div>
          {/if}
        {:else if data.kind !== 'all'}
          <p class="empty">No {filter.label.toLowerCase()} in the drawer yet.</p>
        {:else}
          <p class="empty">
            The drawer is empty. Type above, paste anything, or drop a file on this page.
          </p>
        {/if}
      </section>
    </div>

    <aside class="stack rail" aria-label="Topics and pins">
      {#if data.upcoming.length}
        <section class="panel">
          <div class="panel-head"><h2>Coming up</h2></div>
          <ul class="mini">
            {#each data.upcoming as card (card.id)}
              <li>
                <a href="/item/{card.id}">{card.label ?? card.title}</a>
                <span class="small muted num">{new Date(card.dueAt!).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <section class="panel">
        <div class="panel-head">
          <h2>Topics</h2>
          <a class="card-link small" href="/topics">All {data.topics.length}</a>
        </div>
        {#if live.length}
          <TopicList topics={live} {now} limit={14} />
          {#if dormant > 0}
            <p class="small muted dormant-note">{dormant} quiet for 3 months or more.</p>
          {/if}
        {:else if data.topics.length}
          <TopicList topics={data.topics} {now} limit={10} />
        {:else}
          <p class="empty small">Topics appear on their own once a few things share a subject.</p>
        {/if}
      </section>

      {#if data.pinned.length}
        <section class="panel">
          <div class="panel-head"><h2>Pinned</h2></div>
          <ul class="mini">
            {#each data.pinned as card (card.id)}
              <li>
                <a href="/item/{card.id}">{card.label ?? card.title}</a>
                {#if card.topic}<span class="small muted">{card.topic.name}</span>{/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </aside>
  </div>
</div>

<style>
  .older .error {
    color: var(--negative);
  }
  .kinds {
    overflow-x: auto;
    scrollbar-width: none;
  }
  .stream {
    padding: 4px 16px 16px;
  }
  .older {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding-top: 16px;
    border-top: 1px solid var(--rule);
  }
  .rail {
    position: sticky;
    top: 64px;
  }
  .mini {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .mini li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid var(--rule);
  }
  .mini li:first-child {
    border-top: 0;
  }
  .mini a {
    min-width: 0;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mini a:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .mini span {
    flex: none;
  }
  .dormant-note {
    margin-top: 8px;
  }
  @media (max-width: 1100px) {
    .rail {
      position: static;
    }
  }
  @media (max-width: 760px) {
    .title-row {
      flex-direction: column;
      align-items: stretch;
    }
    .kinds {
      max-width: 100%;
    }
    .stream {
      padding: 0 12px 12px;
    }
  }
</style>
