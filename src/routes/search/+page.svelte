<script lang="ts">
  import { KIND_FILTERS } from '$lib/cards';
  import Row from '$lib/ui/Row.svelte';
  import { shortDate } from '$lib/when';

  let { data } = $props();
  const now = new Date();
  const link = (kind: string) => `/search?q=${encodeURIComponent(data.q)}${kind === 'all' ? '' : `&kind=${kind}`}`;
</script>

<svelte:head>
  <title>{data.q ? `${data.q} · Search` : 'Search'} · Drawer</title>
</svelte:head>

<div class="column narrow">
  <div class="title-row">
    <div>
      <h1>Search</h1>
      <p class="sub num">
        {#if !data.q}
          Notes, link titles, and the words inside PDFs, pictures and voice notes.
        {:else if data.total}
          {data.total === 200 ? '200+' : data.total} {data.total === 1 ? 'match' : 'matches'} for “{data.q}”, best and newest first
        {:else}
          Nothing matches “{data.q}”
        {/if}
      </p>
    </div>
  </div>

  {#if data.q && data.total}
    <nav class="tabs" aria-label="Kind">
      {#each KIND_FILTERS as f (f.kind)}
        {#if f.kind === 'all' || data.counts[f.kind]}
          <a href={link(f.kind)} aria-current={data.kind === f.kind ? 'page' : undefined} data-sveltekit-keepfocus data-sveltekit-noscroll>
            {f.label}<span class="count num">{data.counts[f.kind] ?? 0}</span>
          </a>
        {/if}
      {/each}
    </nav>
    <section class="panel results" aria-label="Results">
      {#each data.cards as card (card.id)}
        <Row {card} when={shortDate(card.touchedAt, now)} terms={data.terms} />
      {/each}
    </section>
  {:else if data.q}
    <div class="panel none">
      <p>Try fewer or different words, or a site name such as <em>youtube</em>.</p>
      <p>
        Or ask in your own words: <a class="card-link" href="/ask?q={encodeURIComponent(data.q)}">Ask the librarian about “{data.q}”</a>
      </p>
    </div>
  {:else}
    <div class="panel none">
      <p>Type in the search field above; <kbd>/</kbd> jumps to it from anywhere.</p>
      <p>Every word counts and the start of a word is enough: <em>lap mous</em> finds the mouse you saved for the laptop.</p>
      <p>For a question (“what was that ramen place?”), use <a class="card-link" href="/ask">Ask</a>.</p>
    </div>
  {/if}
</div>

<style>
  .narrow {
    max-width: 860px;
  }
  .tabs {
    margin-bottom: 16px;
  }
  .results {
    padding: 0 16px 4px;
  }
  .results :global(.row:first-child) {
    border-top: 0;
  }
  .none {
    display: grid;
    gap: 8px;
    color: var(--muted);
  }
  .none em {
    color: var(--text);
    font-style: normal;
    font-weight: 500;
  }
  kbd {
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: inherit;
    color: var(--text);
  }
  @media (max-width: 640px) {
    .results {
      padding: 0 12px 4px;
    }
  }
</style>
