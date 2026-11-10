<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidate } from '$app/navigation';
  import { listen } from '$lib/live.svelte';
  import { age } from '$lib/when';
  import { onMount } from 'svelte';

  let { data, form } = $props();
  const now = $derived(new Date(data.now));
  const active = $derived(data.topics.filter((t) => !t.dormant));
  const quiet = $derived(data.topics.filter((t) => t.dormant));
  let creating = $state(false);

  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = listen({
      topics() {
        clearTimeout(timer);
        timer = setTimeout(() => invalidate('drawer:topics'), 1000);
      },
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  });
</script>

<svelte:head>
  <title>Topics · Drawer</title>
</svelte:head>

{#snippet table(rows: typeof data.topics, caption: string)}
  <table class="ledger">
    <caption class="visually-hidden">{caption}</caption>
    <thead>
      <tr>
        <th scope="col">Topic</th>
        <th scope="col" class="n">Things</th>
        <th scope="col" class="n">Last</th>
        <th scope="col" class="latest-col">Latest</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as topic (topic.id)}
        <tr>
          <th scope="row"><a href="/topics/{topic.id}">{topic.name}</a></th>
          <td class="n num">{topic.count}</td>
          <td class="n num">{age(topic.lastActivity, now)}</td>
          <td class="latest-col"><span class="latest">{topic.latest.join(' · ')}</span></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<div class="column narrow">
  <div class="title-row">
    <div>
      <h1>Topics</h1>
      <p class="sub">They form on their own as things pile up around a subject. Rename or merge them freely.</p>
    </div>
    {#if !creating}
      <button class="btn" type="button" onclick={() => (creating = true)}>New topic</button>
    {/if}
  </div>

  {#if creating}
    <form class="panel create" method="POST" action="?/create" use:enhance>
      <label for="new-topic" class="visually-hidden">Topic name</label>
      <input id="new-topic" class="input" name="name" placeholder="Name, e.g. Laptop hunt" maxlength="40" autocomplete="off" required />
      <button class="btn primary" type="submit">Create</button>
      <button class="btn quiet" type="button" onclick={() => (creating = false)}>Cancel</button>
      {#if form?.error}<p class="small error">{form.error}</p>{/if}
    </form>
  {/if}

  <div class="stack">
    <section class="panel">
      <div class="panel-head">
        <h2>Active</h2>
        <span class="small muted">touched in the last 3 months</span>
      </div>
      {#if active.length}
        {@render table(active, 'Active topics')}
      {:else}
        <p class="empty">No topic has had anything new in 3 months.</p>
      {/if}
    </section>

    {#if quiet.length}
      <section class="panel quiet">
        <div class="panel-head">
          <h2>Quiet</h2>
          <span class="small muted">nothing new for 3 months or more</span>
        </div>
        {@render table(quiet, 'Quiet topics')}
      </section>
    {/if}

    {#if data.loose}
      <a class="panel loose" href="/topics/loose">
        <span><strong>Not in a topic</strong> <span class="muted">· things that don't share a subject with anything yet</span></span>
        <span class="num muted">{data.loose}</span>
      </a>
    {/if}
  </div>
</div>

<style>
  .narrow {
    max-width: 960px;
  }
  .create {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
  }
  .create .input {
    flex: 1;
    min-width: 200px;
  }
  .error {
    width: 100%;
    color: var(--negative);
  }
  .ledger {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .ledger th,
  .ledger td {
    text-align: left;
    padding: 0 8px;
    height: 40px;
    border-top: 1px solid var(--rule);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ledger th:first-child,
  .ledger td:first-child {
    padding-left: 0;
  }
  .ledger thead th {
    border-top: 0;
    height: 32px;
    font-size: var(--fs-small);
    font-weight: 500;
    color: var(--muted);
  }
  .ledger thead th:first-child {
    width: 30%;
  }
  .ledger .n {
    width: 64px;
    text-align: right;
    color: var(--muted);
  }
  .ledger tbody th {
    font-weight: 500;
  }
  .ledger tbody th a:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .latest {
    color: var(--faint);
  }
  .quiet tbody th {
    font-weight: 400;
    color: var(--muted);
  }
  .loose {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }
  .loose:hover strong {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  @media (max-width: 640px) {
    .latest-col {
      display: none;
    }
    .ledger thead th:first-child {
      width: auto;
    }
    .loose .muted:not(.num) {
      display: none;
    }
  }
</style>
