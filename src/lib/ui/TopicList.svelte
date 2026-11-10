<script lang="ts">
  import { age } from '$lib/when';

  interface Topic {
    id: number;
    name: string;
    count: number;
    lastActivity: string | null;
    dormant: boolean;
  }

  /** Topics as a ledger: name, how many things, how long since the last one. */
  let { topics, now = new Date(), limit = Infinity }: { topics: Topic[]; now?: Date; limit?: number } = $props();
</script>

<ul class="topics">
  {#each topics.slice(0, limit) as topic (topic.id)}
    <li class:dormant={topic.dormant}>
      <a href="/topics/{topic.id}">
        <span class="name">{topic.name}</span>
        <span class="count num">{topic.count}</span>
        <span class="age num">{age(topic.lastActivity, now)}</span>
      </a>
    </li>
  {/each}
</ul>

<style>
  .topics {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  a {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 40px 40px;
    gap: 8px;
    align-items: center;
    min-height: 36px;
    padding: 0 8px;
    margin: 0 -8px;
    border-radius: var(--radius-control);
  }
  a:hover {
    background: var(--raised);
  }
  li + li a {
    border-top: 1px solid var(--rule);
    border-radius: 0;
  }
  li + li a:hover {
    border-radius: var(--radius-control);
  }
  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count,
  .age {
    text-align: right;
    color: var(--faint);
    font-size: var(--fs-small);
  }
  .dormant .name {
    color: var(--muted);
    font-weight: 400;
  }
</style>
