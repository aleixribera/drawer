<script lang="ts">
  /** Text with the search words marked. */
  let { text, terms = [] }: { text: string; terms?: string[] } = $props();

  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  const parts = $derived.by(() => {
    if (!terms.length || !text) return [{ text, hit: false }];
    const folded = fold(text);
    // Only mark when folding kept the positions (true for Latin text); otherwise show it plain.
    if (folded.length !== text.length) return [{ text, hit: false }];
    const hits: [number, number][] = [];
    for (const term of terms.map(fold)) {
      let at = folded.indexOf(term);
      while (at >= 0 && term) {
        hits.push([at, at + term.length]);
        at = folded.indexOf(term, at + term.length);
      }
    }
    hits.sort((a, b) => a[0] - b[0]);
    const out: { text: string; hit: boolean }[] = [];
    let cursor = 0;
    for (const [start, end] of hits) {
      if (start < cursor) continue;
      if (start > cursor) out.push({ text: text.slice(cursor, start), hit: false });
      out.push({ text: text.slice(start, end), hit: true });
      cursor = end;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
    return out;
  });
</script>

{#each parts as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}

<style>
  mark {
    background: var(--hue-soft);
    color: inherit;
    border-radius: 2px;
  }
</style>
