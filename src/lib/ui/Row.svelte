<script lang="ts">
  import { deviceWord, fileSize, KIND_WORD, type Card } from '$lib/cards';
  import { copyable, copyText } from '$lib/api';
  import Icon from './Icon.svelte';
  import Marked from './Marked.svelte';

  /**
   * One item in a list: a time (or date) column, what it is, and its picture on the right. The whole row opens the
   * item; a link's title opens the link itself, and Copy takes its text or link in one click.
   */
  let {
    card,
    when,
    terms = [],
  }: {
    card: Card;
    /** The left column: a clock time in the day stream, a short date in mixed lists. */
    when: string;
    /** Search words to mark in the title and snippet. */
    terms?: string[];
  } = $props();

  const isNote = $derived(card.kind === 'note');
  const heading = $derived(isNote && !card.label ? (card.text ?? card.title) : (card.label ?? card.title));
  const body = $derived.by(() => {
    if (card.snippet) return card.snippet;
    if (isNote) return card.label ? card.text : null;
    if (card.note) return card.note;
    return card.summary;
  });
  const external = $derived(card.url && (card.kind === 'link' || card.kind === 'video') ? card.url : null);
  let copied = $state(false);
  /** A hotlinked picture the site refused; the row goes on without it. */
  let broken = $state<string | null>(null);
  const picture = $derived(card.picture && card.picture !== broken ? card.picture : null);

  const meta = $derived.by(() => {
    const parts: string[] = [];
    if (card.kind === 'link' || card.kind === 'video') {
      parts.push(card.siteName ?? card.host ?? KIND_WORD[card.kind]);
      if (card.label && card.title !== card.label) parts.push(card.title);
    } else if (card.file) {
      parts.push(KIND_WORD[card.kind]);
      if (card.pages) parts.push(`${card.pages} ${card.pages === 1 ? 'page' : 'pages'}`);
      parts.push(fileSize(card.file.size));
    }
    return parts;
  });

  async function copy(event: MouseEvent) {
    event.preventDefault();
    const text = copyable(card);
    if (text && (await copyText(text))) {
      copied = true;
      setTimeout(() => (copied = false), 1400);
    }
  }
</script>

<article
  class="row"
  class:faded={card.freshness === 'faded'}
  class:transit={card.lane === 'transit'}
  class:has-picture={!!picture}
>
  <a class="cover" href="/item/{card.id}" aria-label="Open: {heading.slice(0, 80)}"></a>
  <div class="when num">{when}</div>
  <div class="main">
    <h3 class="heading" class:note={isNote && !card.label}>
      {#if external}
        <a class="out" href={external} target="_blank" rel="noreferrer noopener"><Marked text={heading} {terms} /></a>
      {:else}
        <Marked text={heading} {terms} />
      {/if}
    </h3>
    {#if body && body !== heading}
      <p class="body"><Marked text={body} {terms} /></p>
    {/if}
    {#if meta.length || card.topic || card.pinned || card.private || card.lane === 'transit'}
      <p class="meta small">
        {#if card.lane === 'transit'}
          <span class="to">{deviceWord(card.source)} <span aria-hidden="true">→</span><span class="visually-hidden">to</span> {card.target === 'all' ? 'all devices' : deviceWord(card.target)}</span>
        {/if}
        {#each meta as part, i}<span>{part}</span>{#if i < meta.length - 1}<span aria-hidden="true">&nbsp;·&nbsp;</span>{/if}{/each}
        {#if card.topic && card.lane === 'keep'}
          {#if meta.length}<span aria-hidden="true">&nbsp;·&nbsp;</span>{/if}<a class="topic" href="/topics/{card.topic.id}"
            >{card.topic.name}</a
          >
        {/if}
        {#if card.pinned}<span class="flag"><Icon name="pin" size={12} />Pinned</span>{/if}
        {#if card.private && card.topic?.name !== 'Private'}<span class="flag"><Icon name="lock" size={12} />Private</span>{/if}
      </p>
    {/if}
  </div>
  {#if picture}
    <img
      class="picture"
      class:wide={card.kind === 'video' || card.kind === 'link' || card.kind === 'clip'}
      src={picture}
      onerror={() => (broken = picture)}
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      width="64"
      height="64"
    />
  {:else}
    <span></span>
  {/if}
  {#if copyable(card)}
    <button class="copy" type="button" onclick={copy} aria-label={isNote ? 'Copy text' : 'Copy link'} title={isNote ? 'Copy text' : 'Copy link'}>
      {#if copied}<Icon name="check" size={16} />{:else}<Icon name="copy" size={16} />{/if}
      <span class="visually-hidden" aria-live="polite">{copied ? 'Copied' : ''}</span>
    </button>
  {/if}
</article>

<style>
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) auto;
    column-gap: 12px;
    align-items: start;
    padding: 12px 12px 12px 0;
    border-top: 1px solid var(--rule);
    min-height: var(--row-height);
  }
  .row:hover {
    background: color-mix(in srgb, var(--raised) 40%, transparent);
  }
  .cover {
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: 4px;
  }
  .when {
    padding-top: 1px;
    color: var(--faint);
    font-size: var(--fs-small);
    text-align: right;
    white-space: nowrap;
  }
  .main {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .heading {
    font-size: var(--fs-body);
    line-height: 20px;
    font-weight: 500;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .heading.note {
    font-weight: 400;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    white-space: pre-line;
  }
  .out {
    position: relative;
    z-index: 1;
    text-underline-offset: 3px;
  }
  .out:hover {
    text-decoration: underline;
  }
  .body {
    color: var(--muted);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    white-space: pre-line;
  }
  .meta {
    color: var(--faint);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    row-gap: 2px;
    margin-top: 2px;
  }
  .meta > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .topic {
    position: relative;
    z-index: 1;
    color: var(--muted);
    font-weight: 500;
  }
  .topic:hover {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .flag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 10px;
    color: var(--muted);
  }
  .to {
    color: var(--hue);
    font-weight: 500;
    margin-right: 8px;
  }
  .picture {
    width: 64px;
    height: 64px;
    object-fit: cover;
    border-radius: var(--radius-control);
    background: var(--raised);
    border: 1px solid var(--border);
  }
  .picture.wide {
    width: 96px;
    height: 64px;
  }
  .copy {
    position: absolute;
    z-index: 1;
    right: 8px;
    top: 8px;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-control);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--t-hover) ease;
  }
  .row:hover .copy,
  .copy:focus-visible {
    opacity: 1;
  }
  .copy:hover {
    color: var(--text);
  }
  .faded .heading,
  .faded .body {
    color: var(--faint);
  }
  .faded .picture {
    opacity: 0.55;
  }
  .transit {
    box-shadow: inset 2px 0 0 var(--hue); /* taste-skill-ignore: a rule, not elevation */
  }
  @media (hover: none) {
    .copy {
      display: none;
    }
  }
  @media (max-width: 640px) {
    .row {
      grid-template-columns: 38px minmax(0, 1fr) auto;
      column-gap: 10px;
      padding-right: 0;
    }
    .picture {
      width: 52px;
      height: 52px;
    }
    .picture.wide {
      width: 72px;
      height: 52px;
    }
  }
</style>
