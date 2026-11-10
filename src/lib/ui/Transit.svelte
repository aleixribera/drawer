<script lang="ts">
  import { changeItem, copyable, copyText } from '$lib/api';
  import { deviceWord, fileSize, KIND_WORD, type Card } from '$lib/cards';
  import { age } from '$lib/when';
  import Icon from './Icon.svelte';

  /**
   * What is on its way between devices in the last day: things sent to this device first, in the one hue, with the
   * action that finishes them (copy, open, download), then what this device sent and whether it arrived.
   */
  let { cards, device, now = new Date() }: { cards: Card[]; device: string; now?: Date } = $props();

  const incoming = $derived(cards.filter((c) => c.source !== device && (c.target === device || c.target === 'all')));
  const outgoing = $derived(cards.filter((c) => c.source === device));
  let done = $state<Record<number, string>>({});
  /** What the last action did, read out by screen readers (the row's own text changes silently). */
  let announce = $state('');
  let hidden = $state<Record<number, boolean>>({});

  function heading(card: Card): string {
    if (card.kind === 'note') return card.text ?? card.title;
    return card.label ?? card.title;
  }

  async function finish(card: Card, word: string) {
    done[card.id] = word;
    announce = `${word}: ${heading(card).slice(0, 60)}`;
    try {
      await changeItem(card.id, { delivered: true });
    } catch {
      /* the next load shows it again */
    }
  }

  async function copy(card: Card) {
    const text = copyable(card);
    if (text && (await copyText(text))) finish(card, 'Copied');
  }

  async function keep(card: Card, event: MouseEvent) {
    // The Keep button disappears; focus moves to the item's title so the keyboard keeps its place.
    const row = (event.currentTarget as HTMLElement).closest('li');
    done[card.id] = 'Kept';
    try {
      await changeItem(card.id, { keep: true });
      announce = `Kept in the drawer: ${heading(card).slice(0, 60)}`;
    } catch (error) {
      delete done[card.id];
      announce = `Not kept: ${(error as Error).message}. Try again.`;
    }
    row?.querySelector<HTMLElement>('a.title')?.focus();
  }
</script>

{#if incoming.length || outgoing.length}
  <section class="transit panel" aria-labelledby="transit-heading">
    <div class="panel-head">
      <h2 id="transit-heading">On the way</h2>
      <span class="small muted">last 24 hours</span>
    </div>
    {#if incoming.length}
      <ul class="list">
        {#each incoming as card (card.id)}
          {@const finished = done[card.id] ?? (card.deliveredAt ? 'Received' : null)}
          <li class="item" class:finished>
            {#if card.picture && !hidden[card.id]}
              <img
                src={card.picture}
                alt=""
                width="48"
                height="48"
                loading="lazy"
                referrerpolicy="no-referrer"
                onerror={() => (hidden[card.id] = true)}
              />
            {/if}
            <div class="what">
              <a class="title" href="/item/{card.id}">{heading(card)}</a>
              <p class="small from">
                From {deviceWord(card.source)}, {age(card.createdAt, now)} ago{#if card.file}&nbsp;· {KIND_WORD[card.kind]}, {fileSize(card.file.size)}{/if}
                {#if finished}&nbsp;· {finished}{/if}
              </p>
            </div>
            <div class="actions">
              {#if card.file}
                <a class="btn" href="/file/{card.id}?download" onclick={() => finish(card, 'Downloaded')}>
                  <Icon name="download" size={16} />Download
                </a>
              {:else if card.url}
                <a class="btn" href={card.url} target="_blank" rel="noreferrer noopener" onclick={() => finish(card, 'Opened')}>
                  <Icon name="open" size={16} />Open
                </a>
              {/if}
              {#if copyable(card)}
                <button class="btn" type="button" onclick={() => copy(card)}><Icon name="copy" size={16} />Copy</button>
              {/if}
              {#if done[card.id] !== 'Kept'}
                <button class="btn quiet" type="button" onclick={(event) => keep(card, event)}>Keep</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="visually-hidden" role="status" aria-live="polite">{announce}</p>
    {#if outgoing.length}
      <h3 class="small sent">Sent from this {deviceWord(device)}</h3>
      <ul class="list sent-list">
        {#each outgoing as card (card.id)}
          <li class="sent-item small">
            <a href="/item/{card.id}">{heading(card)}</a>
            <span class="muted">
              to {card.target === 'all' ? 'all devices' : deviceWord(card.target)} · {card.deliveredAt ? 'received' : 'waiting'}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .transit {
    border-color: color-mix(in srgb, var(--hue) 35%, var(--border));
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 10px 0 10px 12px;
    border-top: 1px solid var(--rule);
    box-shadow: inset 2px 0 0 var(--hue); /* taste-skill-ignore: a rule, not elevation */
  }
  .item:not(:has(img)) {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .item.finished {
    box-shadow: inset 2px 0 0 var(--control); /* taste-skill-ignore: a rule, not elevation */
  }
  .item img {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: var(--radius-control);
    border: 1px solid var(--border);
  }
  .what {
    min-width: 0;
  }
  .title {
    display: block;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .from {
    color: var(--hue);
  }
  .finished .from {
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .sent {
    margin: 12px 0 4px;
    color: var(--muted);
    font-weight: 500;
  }
  .sent-item {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    padding: 6px 0;
    border-top: 1px solid var(--rule);
  }
  .sent-item a {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sent-item span {
    flex: none;
  }
  @media (max-width: 640px) {
    .item,
    .item:not(:has(img)) {
      grid-template-columns: minmax(0, 1fr);
    }
    .item img {
      display: none;
    }
    .actions {
      flex-wrap: wrap;
    }
  }
</style>
