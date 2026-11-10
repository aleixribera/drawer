<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { KIND_FILTERS, type Card } from '$lib/cards';
  import { listen } from '$lib/live.svelte';
  import { merge } from '$lib/merge';
  import Row from '$lib/ui/Row.svelte';
  import Stream from '$lib/ui/Stream.svelte';
  import { shortDate } from '$lib/when';
  import { onMount } from 'svelte';

  let { data, form } = $props();
  let cards = $derived(data.cards);
  let editing = $state<null | 'rename' | 'merge'>(null);
  let confirming: HTMLDialogElement | undefined = $state();
  const now = $derived(new Date(data.now));
  const title = $derived(data.topic?.name ?? 'Not in a topic');
  const filter = $derived(KIND_FILTERS.find((f) => f.kind === data.kind) ?? KIND_FILTERS[0]!);
  const total = $derived(data.pinned.length + cards.length);

  const belongs = (card: Card) =>
    card.lane === 'keep' &&
    !card.pinned &&
    (data.topic ? card.topic?.id === data.topic.id : !card.topic) &&
    (filter.kinds.length === 0 || filter.kinds.includes(card.kind));

  onMount(() =>
    listen({
      item(card) {
        cards = merge(cards, card, belongs);
      },
      removed(id) {
        cards = cards.filter((c) => c.id !== id);
      },
    }),
  );

  const href = (kind: string) => `${page.url.pathname}${kind === 'all' ? '' : `?kind=${kind}`}`;
</script>

<svelte:head>
  <title>{title} · Drawer</title>
</svelte:head>

<div class="column narrow">
  <div class="crumbs"><a class="card-link small" href="/topics">Topics</a></div>
  <div class="title-row">
    <div>
      <h1>{title}</h1>
      <p class="sub num">
        {total}{total >= 300 ? '+' : ''} {total === 1 ? 'thing' : 'things'}{#if data.topic?.dormant}, quiet for 3 months or more{/if}
      </p>
    </div>
    {#if data.topic && data.topic.name !== 'Private'}
      <div class="manage">
        <button class="btn" type="button" aria-expanded={editing === 'rename'} onclick={() => (editing = editing === 'rename' ? null : 'rename')}>Rename</button>
        {#if data.others.length}
          <button class="btn" type="button" aria-expanded={editing === 'merge'} onclick={() => (editing = editing === 'merge' ? null : 'merge')}>Merge</button>
        {/if}
        <button class="btn quiet danger" type="button" onclick={() => confirming?.showModal()}>Delete topic</button>
      </div>
    {/if}
  </div>

  {#if editing === 'rename' && data.topic}
    <form class="panel inline-form" method="POST" action="?/rename" use:enhance={() => async ({ update }) => { await update({ reset: false }); editing = null; }}>
      <label for="rename" class="small muted">New name (an existing topic's name merges the two)</label>
      <div class="row-fields">
        <input id="rename" class="input" name="name" value={data.topic.name} maxlength="40" required autocomplete="off" />
        <button class="btn primary" type="submit">Save</button>
      </div>
    </form>
  {:else if editing === 'merge'}
    <form class="panel inline-form" method="POST" action="?/merge" use:enhance>
      <label for="into" class="small muted">Move everything here into</label>
      <div class="row-fields">
        <select id="into" class="input" name="into" required>
          {#each data.others as other (other.id)}<option value={other.id}>{other.name} ({other.count})</option>{/each}
        </select>
        <button class="btn primary" type="submit">Merge</button>
      </div>
    </form>
  {/if}
  {#if form?.error}<p class="small error">{form.error}</p>{/if}

  <nav class="tabs" aria-label="Kind">
    {#each KIND_FILTERS as f (f.kind)}
      <a href={href(f.kind)} aria-current={data.kind === f.kind ? 'page' : undefined} data-sveltekit-noscroll>{f.label}</a>
    {/each}
  </nav>

  <div class="stack body">
    {#if data.pinned.length}
      <section class="panel list" aria-label="Pinned">
        <h2 class="small pinned-head">Pinned</h2>
        {#each data.pinned as card (card.id)}
          <Row {card} when={shortDate(card.touchedAt, now)} />
        {/each}
      </section>
    {/if}
    <section class="panel list" aria-label="Everything else">
      {#if cards.length}
        <Stream {cards} {now} />
      {:else}
        <p class="empty">{filter.kind === 'all' ? 'Nothing here.' : `No ${filter.label.toLowerCase()} in this topic.`}</p>
      {/if}
    </section>
  </div>
</div>

<dialog bind:this={confirming} class="confirm" aria-labelledby="confirm-title">
  <h2 id="confirm-title">Delete the topic “{title}”?</h2>
  <p class="muted">The {total} things in it stay in the drawer, just without a topic.</p>
  <form method="POST" action="?/remove" class="confirm-actions">
    <button class="btn" type="button" onclick={() => confirming?.close()}>Cancel</button>
    <button class="btn primary" type="submit">Delete topic</button>
  </form>
</dialog>

<style>
  .narrow {
    max-width: 860px;
  }
  .crumbs {
    margin-top: 20px;
  }
  .crumbs + .title-row {
    margin-top: 12px;
  }
  .manage {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .inline-form {
    display: grid;
    gap: 6px;
    margin-bottom: 16px;
  }
  .row-fields {
    display: flex;
    gap: 8px;
  }
  .error {
    color: var(--negative);
    margin-bottom: 12px;
  }
  .body {
    margin-top: 16px;
  }
  .list {
    padding: 4px 16px 16px;
  }
  .pinned-head {
    padding: 8px 0 8px 60px;
    font-weight: 600;
  }
  .confirm {
    width: min(420px, calc(100% - 32px));
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    color: var(--text);
  }
  .confirm::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  .confirm h2 {
    font-size: var(--fs-section);
    margin-bottom: 6px;
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }
  @media (max-width: 640px) {
    .title-row {
      flex-direction: column;
      align-items: stretch;
    }
    .list {
      padding: 0 12px 12px;
    }
    .pinned-head {
      padding-left: 48px;
    }
  }
</style>
