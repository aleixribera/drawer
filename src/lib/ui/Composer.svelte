<script lang="ts">
  import { capture, type CaptureOutcome } from '$lib/api';
  import { DEVICES, deviceWord, fileSize } from '$lib/cards';
  import Icon from './Icon.svelte';

  /**
   * The first job of the drawer: put something in it, or send it to another device, as fast as typing a message.
   * Enter keeps it (Shift+Enter for a new line; on a phone the button does it). Files come from Attach, paste or drop,
   * which the page forwards here.
   */
  let {
    device,
    onCaptured,
  }: {
    device: string;
    onCaptured?: (results: CaptureOutcome[]) => void;
  } = $props();

  let text = $state('');
  let files = $state<File[]>([]);
  let destination = $state('keep');
  let busy = $state(false);
  let status = $state<{ message: string; id?: number; error?: boolean } | null>(null);
  let textarea: HTMLTextAreaElement | undefined = $state();
  let picker: HTMLInputElement | undefined = $state();
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  const others = $derived(DEVICES.filter((d) => d.name !== device));
  const empty = $derived(!text.trim() && files.length === 0);
  const sending = $derived(destination !== 'keep');

  export function addFiles(list: Iterable<File>) {
    files = [...files, ...list];
    textarea?.focus();
  }
  export function addText(value: string) {
    text = text ? `${text}\n${value}` : value;
    textarea?.focus();
  }
  export function focus() {
    textarea?.focus();
  }

  function say(message: string, extra: { id?: number; error?: boolean } = {}) {
    status = { message, ...extra };
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status = null), extra.error ? 8000 : 4000);
  }

  function describe(results: CaptureOutcome[]): string {
    if (sending) return `Sent to ${deviceWord(destination)}.`;
    const first = results[0];
    if (!first) return 'Nothing to keep.';
    if (results.length > 1) return `Kept ${results.length} things.`;
    if (first.outcome === 'bumped') return 'Already in the drawer; moved it to the top.';
    if (first.outcome === 'labelled') return `Added as the label of “${first.item.title.slice(0, 60)}”.`;
    return first.item.private ? 'Kept, and marked private.' : 'Kept.';
  }

  async function submit(event?: Event) {
    event?.preventDefault();
    if (empty || busy) return;
    busy = true;
    const form = new FormData();
    if (text.trim()) form.set('text', text.trim());
    for (const file of files) form.append('file', file, file.name);
    if (sending) form.set('target', destination);
    else form.set('lane', 'keep');
    try {
      const results = await capture(form);
      say(describe(results), { id: results.length === 1 ? results[0]?.item.id : undefined });
      text = '';
      files = [];
      destination = 'keep';
      onCaptured?.(results);
    } catch (error) {
      say(`Not saved: ${(error as Error).message}. Your text is still here.`, { error: true });
    } finally {
      busy = false;
      textarea?.focus();
    }
  }

  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return;
    const touch = matchMedia('(pointer: coarse)').matches;
    if (event.ctrlKey || event.metaKey || (!touch && !event.shiftKey)) submit(event);
  }

  function picked(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files) addFiles(input.files);
    input.value = '';
  }

  $effect(() => {
    // Grow with the text, up to about twelve lines.
    void text;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 260)}px`;
  });
</script>

<form class="composer panel" class:sending onsubmit={submit} aria-label="Put something in the drawer">
  <label class="visually-hidden" for="composer-text">Text or link</label>
  <textarea
    id="composer-text"
    bind:this={textarea}
    bind:value={text}
    onkeydown={keydown}
    rows="2"
    placeholder="Text, a link, or drop a file…"
    autocomplete="off"
    spellcheck="true"
  ></textarea>

  {#if files.length}
    <ul class="files" aria-label="Attached files">
      {#each files as file, i (i)}
        <li>
          <span class="name">{file.name}</span>
          <span class="size num">{fileSize(file.size)}</span>
          <button type="button" class="remove" onclick={() => (files = files.filter((_, j) => j !== i))} aria-label="Remove {file.name}">
            <Icon name="close" size={14} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="bar">
    <button type="button" class="btn quiet attach" onclick={() => picker?.click()}>
      <Icon name="clip" size={16} />Attach
    </button>
    <input bind:this={picker} type="file" multiple hidden onchange={picked} />

    <div class="segmented destination" role="group" aria-label="Where it goes">
      <button type="button" aria-pressed={destination === 'keep'} onclick={() => (destination = 'keep')}>Keep</button>
      {#each others as other (other.name)}
        <button type="button" aria-pressed={destination === other.name} onclick={() => (destination = other.name)}>
          <span class="arrow" aria-hidden="true">→</span>{other.label}
        </button>
      {/each}
    </div>

    <button class="btn primary go" type="submit" disabled={empty || busy}>
      {#if busy}Saving…{:else if sending}Send to {deviceWord(destination)}{:else}Keep{/if}
    </button>
  </div>

  <p class="status small" role="status" aria-live="polite">
    {#if status}
      <span class:error={status.error}>{status.message}</span>
      {#if status.id}<a href="/item/{status.id}">Open</a>{/if}
    {/if}
  </p>
</form>

<style>
  .composer {
    padding: 12px;
    display: grid;
    gap: 8px;
    transition: border-color var(--t-ui) ease;
  }
  .composer:focus-within {
    border-color: color-mix(in srgb, var(--text) 40%, var(--border));
  }
  .composer.sending {
    border-color: var(--hue);
  }
  textarea {
    width: 100%;
    min-height: 48px;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    padding: 4px 4px 0;
    font-size: 15px;
    line-height: 22px;
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .files li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    height: 32px;
    padding: 0 4px 0 10px;
    border-radius: var(--radius-control);
    background: var(--raised);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .size {
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .remove {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .remove:hover {
    background: var(--active);
    color: var(--text);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .attach {
    padding: 0 8px;
    color: var(--muted);
  }
  .destination {
    margin-left: auto;
  }
  .arrow {
    margin-right: 3px;
  }
  .sending .destination [aria-pressed='true'] {
    color: var(--hue);
  }
  .sending .go {
    background: var(--hue);
    border-color: var(--hue);
    color: var(--on-hue);
  }
  .status {
    min-height: 16px;
    display: flex;
    gap: 10px;
    padding: 0 4px;
    color: var(--muted);
  }
  /* Kept in the page while empty, so screen readers hear the next message; the grid gap is taken back. */
  .status:empty {
    min-height: 0;
    margin-top: -8px;
  }
  .status a {
    font-weight: 500;
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .error {
    color: var(--negative);
  }
  @media (max-width: 640px) {
    .bar {
      flex-wrap: wrap;
    }
    .destination {
      order: 3;
      margin-left: 0;
      width: 100%;
      max-width: none;
    }
    .destination button {
      flex: 1;
      justify-content: center;
      height: 34px;
    }
    .go {
      margin-left: auto;
    }
  }
</style>
