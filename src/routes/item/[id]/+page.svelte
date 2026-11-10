<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { changeItem, copyable, copyText, removeItem, sendItem } from '$lib/api';
  import { DEVICES, deviceWord, fileSize, KIND_WORD } from '$lib/cards';
  import { listen } from '$lib/live.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Linked from '$lib/ui/Linked.svelte';
  import Row from '$lib/ui/Row.svelte';
  import { fullDate, shortDate } from '$lib/when';
  import { onMount, tick } from 'svelte';

  let { data } = $props();

  let card = $derived(data.card);
  let deleted = $derived(data.deleted);
  let label = $derived(data.card.label ?? '');
  let topic = $derived(data.card.topic?.name ?? '');
  let message = $state<string | null>(null);
  let confirming: HTMLDialogElement | undefined = $state();
  let putBack: HTMLButtonElement | undefined = $state();
  let messageTimer: ReturnType<typeof setTimeout> | undefined;

  const heading = $derived(card.label ?? card.title);
  const others = $derived(DEVICES.filter((d) => d.name !== data.device));
  const text = $derived(copyable(card));
  const isImage = $derived(card.kind === 'image' && card.file);
  const isVideoFile = $derived((card.kind === 'clip' || card.kind === 'video') && card.file);

  function say(value: string) {
    message = value;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => (message = null), 3500);
  }

  async function act<T>(work: () => Promise<T>, done?: string) {
    try {
      await work();
      if (done) say(done);
    } catch (error) {
      say(`That didn’t work: ${(error as Error).message}`);
    }
  }

  const update = (change: Parameters<typeof changeItem>[1], done?: string) =>
    act(async () => {
      const next = await changeItem(card.id, change);
      if (next) card = next;
    }, done);

  async function copy() {
    if (text && (await copyText(text))) say(card.kind === 'note' ? 'Text copied.' : 'Link copied.');
  }

  function saveLabel() {
    const value = label.trim();
    if (value === (card.label ?? '')) return;
    update({ label: value || null }, value ? 'Label saved.' : 'Label removed.');
  }

  function saveTopic() {
    const value = topic.trim();
    if (value === (card.topic?.name ?? '')) return;
    update({ topic: value || null }, value ? `Filed under ${value}.` : 'Taken out of its topic.');
  }

  async function remove() {
    confirming?.close();
    await act(async () => {
      await removeItem(card.id);
      deleted = true;
    }, 'Moved to the trash.');
    // The Delete button is gone; the keyboard lands on the way back.
    await tick();
    putBack?.focus();
  }

  async function restore() {
    await act(async () => {
      await changeItem(card.id, { restore: true });
      await invalidateAll();
    }, 'Back in the drawer.');
  }

  function back() {
    if (history.length > 1) history.back();
    else goto('/');
  }

  onMount(() =>
    listen({
      item(next) {
        if (next.id === card.id) card = next;
      },
      removed(id) {
        if (id === card.id) deleted = true;
      },
    }),
  );
</script>

<svelte:head>
  <title>{heading} · Drawer</title>
</svelte:head>

<div class="column">
  <div class="crumbs">
    <button class="card-link small" type="button" onclick={back}><Icon name="back" size={14} />Back</button>
  </div>

  <div class="title-row">
    <div class="titles">
      <h1>{heading}</h1>
      <p class="sub">
        {KIND_WORD[card.kind]}{#if card.lane === 'transit'}, on its way to {card.target === 'all' ? 'all devices' : deviceWord(card.target)}{/if}
        · from {deviceWord(card.source)} · {fullDate(card.createdAt)}
        {#if card.topic}· <a class="topic" href="/topics/{card.topic.id}">{card.topic.name}</a>{/if}
      </p>
    </div>
  </div>

  {#if deleted}
    <div class="panel trash">
      <p>This is in the trash and goes for good 30 days after it was deleted.</p>
      <button class="btn" type="button" bind:this={putBack} onclick={restore}>Put it back</button>
    </div>
  {/if}

  <div class="split">
    <div class="stack">
      <section class="panel preview" class:flush={isImage || isVideoFile || data.youtube} aria-label="Preview">
        {#if isImage}
          <a href="/file/{card.id}" target="_blank" rel="noopener"><img class="full" src="/file/{card.id}" alt={card.summary ?? heading} /></a>
        {:else if isVideoFile}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video class="full" controls preload="metadata" src="/file/{card.id}" poster={card.picture ?? undefined}></video>
        {:else if data.youtube}
          <div class="embed">
            <iframe
              src="https://www.youtube-nocookie.com/embed/{data.youtube}"
              title={heading}
              loading="lazy"
              allow="encrypted-media; picture-in-picture; fullscreen"
              referrerpolicy="strict-origin-when-cross-origin"
            ></iframe>
          </div>
        {:else if card.kind === 'audio' && card.file}
          <audio class="audio" controls preload="metadata" src="/file/{card.id}"></audio>
        {:else if card.kind === 'pdf' && card.file}
          <div class="pdf">
            {#if card.picture}<img src={card.picture} alt="First page" width="160" />{/if}
            <div>
              <p class="file-name">{card.file.name}</p>
              <p class="small muted">{card.pages ? `${card.pages} pages · ` : ''}{fileSize(card.file.size)}</p>
            </div>
          </div>
          <iframe class="pdf-frame" src="/file/{card.id}" title={card.file.name}></iframe>
        {:else if card.kind === 'link' || card.kind === 'video'}
          <a class="link-card" href={card.url} target="_blank" rel="noreferrer noopener">
            {#if card.picture}<img src={card.picture} alt="" referrerpolicy="no-referrer" onerror={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)} />{/if}
            <span class="site small">{card.siteName ?? card.host}</span>
            <span class="link-title">{card.title}</span>
            {#if data.description}<span class="desc">{data.description}</span>{/if}
            <span class="url small">{card.url}</span>
          </a>
        {:else if card.file}
          <div class="pdf">
            <div>
              <p class="file-name">{card.file.name}</p>
              <p class="small muted">{card.file.mime} · {fileSize(card.file.size)}</p>
            </div>
          </div>
        {/if}

        {#if card.kind === 'note' && card.text}
          <p class="note"><Linked text={card.text} /></p>
        {/if}
      </section>

      {#if card.summary || (card.text && card.kind !== 'note') || card.note}
        <section class="panel">
          {#if card.summary}<p class="summary">{card.summary}</p>{/if}
          {#if card.text && card.kind !== 'note'}
            <h2 class="small label-head">Sent with it</h2>
            <p class="note"><Linked text={card.text} /></p>
          {/if}
          {#if card.note}
            <h2 class="small label-head">Your note</h2>
            <p class="note"><Linked text={card.note} /></p>
          {/if}
        </section>
      {/if}

      {#if data.extracted}
        <details class="panel extracted">
          <summary>
            {card.kind === 'audio' ? 'Transcript' : 'Text read from the file'}
            <span class="small muted num">{Math.round(data.extractedLength / 5).toLocaleString('en-GB')} words</span>
          </summary>
          <pre>{data.extracted}{data.extractedLength > data.extracted.length ? '\n…' : ''}</pre>
        </details>
      {/if}

      {#if data.related.length && card.topic}
        <section class="panel related">
          <div class="panel-head">
            <h2>Also in {card.topic.name}</h2>
            <a class="card-link small" href="/topics/{card.topic.id}">All</a>
          </div>
          {#each data.related as other (other.id)}
            <Row card={other} when={shortDate(other.touchedAt)} />
          {/each}
        </section>
      {/if}
    </div>

    <aside class="stack">
      <section class="panel actions" aria-label="Actions">
        <div class="primary-actions">
          {#if card.file}
            <a class="btn primary" href="/file/{card.id}" target="_blank" rel="noopener"><Icon name="open" size={16} />Open</a>
            <a class="btn" href="/file/{card.id}?download"><Icon name="download" size={16} />Download</a>
          {:else if card.url}
            <a class="btn primary" href={card.url} target="_blank" rel="noreferrer noopener"><Icon name="open" size={16} />Open link</a>
          {/if}
          {#if text}
            <button class="btn" class:primary={!card.file && !card.url} type="button" onclick={copy}>
              <Icon name="copy" size={16} />{card.kind === 'note' ? 'Copy text' : 'Copy link'}
            </button>
          {/if}
        </div>

        <div class="send">
          <span class="small muted">Send to</span>
          <div class="send-buttons">
            {#each others as other (other.name)}
              <button class="btn" type="button" onclick={() => act(() => sendItem(card.id, other.name), `Sent to ${other.label}.`)}>
                {other.label}
              </button>
            {/each}
          </div>
        </div>

        <p class="message small" role="status">{message ?? ''}</p>
      </section>

      <section class="panel">
        <div class="field">
          <label for="label" class="small muted">Label</label>
          <input
            id="label"
            class="input"
            bind:value={label}
            onblur={saveLabel}
            onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            placeholder="A few words to find it by"
            maxlength="100"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label for="topic" class="small muted">Topic</label>
          <input
            id="topic"
            class="input"
            list="topic-names"
            bind:value={topic}
            onchange={saveTopic}
            onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            placeholder="Pick one or name a new one"
            autocomplete="off"
          />
          <datalist id="topic-names">
            {#each data.topicNames as name}<option value={name}></option>{/each}
          </datalist>
        </div>

        <div class="toggles">
          <button class="btn" type="button" aria-pressed={card.pinned} onclick={() => update({ pinned: !card.pinned }, card.pinned ? 'Unpinned.' : 'Pinned: it stays fresh.')}>
            <Icon name="pin" size={16} />{card.pinned ? 'Pinned' : 'Pin'}
          </button>
          <button
            class="btn"
            type="button"
            aria-pressed={card.private}
            onclick={() => update({ private: !card.private }, card.private ? 'No longer private.' : 'Private: it stays on the server.')}
          >
            <Icon name="lock" size={16} />Private
          </button>
          {#if card.lane === 'transit'}
            <button class="btn" type="button" onclick={() => update({ keep: true }, 'Kept for good.')}>Keep</button>
          {/if}
        </div>
        {#if card.private}
          <p class="small muted private-note">
            {#if data.sensitiveReasons.length}
              Marked private on its own because it looks like {data.sensitiveReasons.join(', ').replace(/-/g, ' ')}.
            {/if}
            Private things are never sent to the model.
          </p>
        {/if}
      </section>

      <section class="panel">
        <dl class="kv small">
          <dt>Kept</dt>
          <dd>{fullDate(card.createdAt)}</dd>
          {#if card.touchedAt !== card.createdAt}
            <dt>Last saved</dt>
            <dd>{fullDate(card.touchedAt)}</dd>
          {/if}
          <dt>From</dt>
          <dd>{deviceWord(card.source)}{data.chat ? `, chat “${data.chat}”` : ''}</dd>
          {#if card.file}
            <dt>File</dt>
            <dd class="file-cell">{card.file.name} · {fileSize(card.file.size)}</dd>
          {/if}
          {#if card.dueAt}
            <dt>Date in it</dt>
            <dd>{fullDate(card.dueAt)}</dd>
          {/if}
          {#if data.keywords.length}
            <dt>Words</dt>
            <dd>{data.keywords.join(', ')}</dd>
          {/if}
          <dt>Read by</dt>
          <dd>
            {#if card.enrichState === 'done'}the librarian{:else if card.enrichState === 'local'}this server only{:else if card.enrichState === 'pending'}waiting to be read{:else}failed, will retry{/if}
          </dd>
        </dl>
      </section>

      {#if !deleted}
        <button class="btn danger delete" type="button" onclick={() => confirming?.showModal()}>
          <Icon name="trash" size={16} />Delete
        </button>
      {/if}
    </aside>
  </div>
</div>

<dialog bind:this={confirming} class="confirm" aria-labelledby="confirm-title">
  <h2 id="confirm-title">Delete this?</h2>
  <p class="muted">It goes to the trash, where you can still put it back for 30 days.</p>
  <div class="confirm-actions">
    <button class="btn" type="button" onclick={() => confirming?.close()}>Cancel</button>
    <button class="btn primary" type="button" onclick={remove}>Delete</button>
  </div>
</dialog>

<style>
  .crumbs {
    margin-top: 20px;
  }
  .crumbs + .title-row {
    margin-top: 12px;
  }
  .titles {
    min-width: 0;
  }
  .titles h1 {
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
  }
  .topic {
    font-weight: 500;
    color: var(--text);
  }
  .topic:hover {
    text-decoration: underline;
  }
  .trash {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
    background: var(--pill-warning-bg);
    color: var(--pill-warning-ink);
  }
  .preview.flush {
    padding: 0;
    overflow: hidden;
  }
  .full {
    width: 100%;
    max-height: 72vh;
    object-fit: contain;
    background: var(--raised);
  }
  .embed {
    aspect-ratio: 16 / 9;
  }
  .embed iframe {
    width: 100%;
    height: 100%;
    border: 0;
  }
  .audio {
    width: 100%;
  }
  .pdf {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .pdf img {
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .file-name {
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .pdf-frame {
    display: block;
    width: 100%;
    height: 78vh;
    margin-top: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .link-card {
    display: grid;
    gap: 4px;
  }
  .link-card img {
    width: 100%;
    max-height: 360px;
    object-fit: cover;
    border-radius: var(--radius-control);
    margin-bottom: 8px;
    border: 1px solid var(--border);
  }
  .site {
    color: var(--muted);
    font-weight: 500;
  }
  .link-title {
    font-size: var(--fs-section);
    line-height: 22px;
    font-weight: 600;
  }
  .link-card:hover .link-title {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .desc {
    color: var(--muted);
  }
  .url {
    color: var(--faint);
    overflow-wrap: anywhere;
  }
  .note {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 15px;
    line-height: 23px;
  }
  .flush .note {
    padding: var(--card-pad);
  }
  .summary {
    font-size: 15px;
    line-height: 23px;
  }
  .label-head {
    margin: 12px 0 4px;
    color: var(--muted);
    font-weight: 500;
  }
  .summary + .label-head {
    margin-top: 16px;
  }
  .label-head:first-child {
    margin-top: 0;
  }
  .extracted summary {
    cursor: pointer;
    font-weight: 600;
  }
  .extracted summary .muted {
    margin-left: 6px;
    font-weight: 400;
  }
  .extracted pre {
    margin: 12px 0 0;
    max-height: 480px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
    color: var(--muted);
  }
  .related {
    padding-bottom: 4px;
  }
  .primary-actions,
  .send-buttons,
  .toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .send {
    display: grid;
    gap: 6px;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--rule);
  }
  .send .btn:hover {
    border-color: var(--hue);
    color: var(--hue);
  }
  .message:empty {
    margin: 0;
  }
  .message {
    margin-top: 12px;
    color: var(--text);
    font-weight: 500;
  }
  .field {
    display: grid;
    gap: 4px;
    margin-bottom: 12px;
  }
  .toggles [aria-pressed='true'] {
    background: var(--raised);
    border-color: var(--text);
  }
  .private-note {
    margin-top: 10px;
  }
  .file-cell {
    overflow-wrap: anywhere;
  }
  .delete {
    justify-self: start;
  }
  .confirm {
    width: min(400px, calc(100% - 32px));
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
    .pdf-frame {
      display: none;
    }
  }
</style>
