<script lang="ts">
  /** Plain text with its web addresses made into links. */
  let { text }: { text: string } = $props();

  const parts = $derived.by(() => {
    const out: { text: string; href?: string }[] = [];
    const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
    let cursor = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > cursor) out.push({ text: text.slice(cursor, m.index) });
      out.push({ text: m[0], href: m[0] });
      cursor = m.index + m[0].length;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor) });
    return out;
  });
</script>

{#each parts as part}{#if part.href}<a href={part.href} target="_blank" rel="noreferrer noopener">{part.text}</a>{:else}{part.text}{/if}{/each}

<style>
  a {
    text-decoration: underline;
    text-decoration-color: var(--control);
    text-underline-offset: 3px;
    overflow-wrap: anywhere;
  }
  a:hover {
    text-decoration-color: currentColor;
  }
</style>
