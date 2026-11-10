<script lang="ts">
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import type { Card } from '$lib/cards';
  import Icon from '$lib/ui/Icon.svelte';
  import Row from '$lib/ui/Row.svelte';
  import { shortDate } from '$lib/when';
  import { onMount, tick } from 'svelte';

  interface Exchange {
    question: string;
    answer: string | null;
    cards: Card[];
    mode: 'librarian' | 'search' | null;
    sent: number;
    error: string | null;
  }

  const STORE = 'drawer.ask';
  let exchanges = $state<Exchange[]>([]);
  let question = $state('');
  let busy = $state(false);
  let recording = $state(false);
  let transcribing = $state(false);
  let micError = $state<string | null>(null);
  let input: HTMLTextAreaElement | undefined = $state();
  let recorder: MediaRecorder | null = null;
  let spoken = $state('');
  let confirming = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  const now = new Date();

  /** Focusing the box on a phone opens the keyboard over the answer; only do it with a mouse or trackpad. */
  function focusInput() {
    if (matchMedia('(pointer: fine)').matches) input?.focus();
  }

  const EXAMPLES = [
    'What was the Schedule 1 recipe I saved last?',
    'Which laptops was I comparing?',
    'Send my uni timetable to the laptop',
    'What did I save this week?',
  ];

  function persist() {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(exchanges.slice(-12)));
    } catch {
      /* private mode */
    }
  }

  /** The answer with its [#12] marks turned into numbered references to the cards under it. */
  function pieces(exchange: Exchange): { text: string; ref?: number; id?: number }[] {
    const answer = exchange.answer ?? '';
    const order = exchange.cards.map((c) => c.id);
    const out: { text: string; ref?: number; id?: number }[] = [];
    let cursor = 0;
    for (const m of answer.matchAll(/\s?\[?#(\d+)\]?/g)) {
      const id = Number(m[1]);
      const at = order.indexOf(id);
      if (m.index > cursor) out.push({ text: answer.slice(cursor, m.index) });
      if (at >= 0) out.push({ text: String(at + 1), ref: at + 1, id });
      cursor = m.index + m[0].length;
    }
    if (cursor < answer.length) out.push({ text: answer.slice(cursor) });
    return out;
  }

  async function ask(text = question) {
    const q = text.trim();
    if (!q || busy) return;
    busy = true;
    question = '';
    const history = exchanges
      .filter((e) => e.answer)
      .slice(-3)
      .flatMap((e) => [
        { role: 'user', text: e.question },
        { role: 'assistant', text: e.answer! },
      ]);
    exchanges.push({ question: q, answer: null, cards: [], mode: null, sent: 0, error: null });
    const current = exchanges[exchanges.length - 1]!;
    await tick();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollTo({ top: document.body.scrollHeight, behavior: still ? 'auto' : 'smooth' });
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, history }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? response.statusText);
      current.answer = body.answer;
      current.cards = body.cards;
      current.mode = body.mode;
      current.sent = body.sent?.length ?? 0;
      spoken = `${body.answer.replace(/\s?\[?#\d+\]?/g, '')}${current.cards.length ? ` ${current.cards.length} items below.` : ''}`;
    } catch (error) {
      current.error = (error as Error).message;
      spoken = `No answer: ${current.error}`;
    } finally {
      busy = false;
      persist();
      focusInput();
    }
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask();
    }
  }

  async function toggleMic() {
    micError = null;
    if (recording) {
      recorder?.stop();
      return;
    }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      micError = 'This browser can’t record. On the iPhone, the Action Button shortcut asks by voice.';
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      micError = 'The microphone is blocked for this page.';
      return;
    }
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      recording = false;
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
      transcribing = true;
      try {
        const response = await fetch('/api/voice', { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.message ?? response.statusText);
        await ask(body.text);
      } catch (error) {
        micError = (error as Error).message;
      } finally {
        transcribing = false;
      }
    };
    recorder.start();
    recording = true;
  }

  /** Two presses: the first asks, the second clears; it forgets on its own after a few seconds. */
  function clear() {
    clearTimeout(confirmTimer);
    if (!confirming) {
      confirming = true;
      confirmTimer = setTimeout(() => (confirming = false), 4000);
      return;
    }
    confirming = false;
    exchanges = [];
    spoken = '';
    persist();
    input?.focus();
  }

  onMount(() => {
    try {
      const saved = sessionStorage.getItem(STORE);
      if (saved) exchanges = JSON.parse(saved);
    } catch {
      /* nothing saved */
    }
    const q = page.url.searchParams.get('q');
    if (q) {
      ask(q);
      // Drop ?q= so a reload doesn't ask again; the router isn't ready until after mount.
      setTimeout(() => {
        try {
          replaceState('/ask', {});
        } catch {
          /* keep the query */
        }
      });
    } else focusInput();
  });
</script>

<svelte:head>
  <title>Ask · Drawer</title>
</svelte:head>

<div class="column narrow">
  <div class="title-row">
    <div>
      <h1>Ask</h1>
      <p class="sub">The librarian looks through everything you kept and answers in a sentence, with the items it used.</p>
    </div>
    {#if exchanges.length}
      <button class="btn quiet" class:confirming type="button" onclick={clear}>{confirming ? 'Clear the conversation?' : 'Start over'}</button>
    {/if}
  </div>

  <div class="stack">
    {#each exchanges as exchange, i (i)}
      <section class="exchange" aria-label="Question {i + 1}">
        <p class="question">{exchange.question}</p>
        <div class="panel answer">
          {#if exchange.error}
            <p class="error">{exchange.error}</p>
            <a class="card-link small" href="/search?q={encodeURIComponent(exchange.question)}">Search for it instead</a>
          {:else if exchange.answer === null}
            <p class="muted thinking">Looking through the drawer…</p>
          {:else}
            <p class="answer-text">
              {#each pieces(exchange) as piece}{#if piece.ref}<a class="ref num" href="/item/{piece.id}" aria-label="Item {piece.ref}">{piece.text}</a>{:else}{piece.text}{/if}{/each}
            </p>
            {#if exchange.sent}<p class="small sent">Sent; it’s waiting on the other device.</p>{/if}
            {#if exchange.cards.length}
              <ol class="cards">
                {#each exchange.cards as card, n (card.id)}
                  <li><span class="n num" aria-hidden="true">{n + 1}</span><Row {card} when={shortDate(card.touchedAt, now)} /></li>
                {/each}
              </ol>
            {/if}
            {#if exchange.mode === 'search'}<p class="small muted by">Answered by search alone.</p>{/if}
          {/if}
        </div>
      </section>
    {:else}
      <section class="panel examples" aria-label="Examples">
        <h2 class="small muted">For example</h2>
        <ul>
          {#each EXAMPLES as example}
            <li><button type="button" class="card-link" onclick={() => ask(example)}>{example}</button></li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>

  <p class="visually-hidden" role="status" aria-live="polite">{spoken}</p>

  <form class="ask panel" onsubmit={(e) => { e.preventDefault(); ask(); }}>
    <label for="question" class="visually-hidden">Your question</label>
    <textarea
      id="question"
      bind:this={input}
      bind:value={question}
      onkeydown={keydown}
      rows="1"
      placeholder={recording ? 'Listening… tap the microphone again to stop' : transcribing ? 'Writing down what you said…' : 'Ask about anything you kept…'}
      disabled={recording || transcribing}
    ></textarea>
    <button class="btn icon mic" class:on={recording} type="button" onclick={toggleMic} aria-pressed={recording} aria-label="Ask by voice" title={recording ? 'Stop and ask' : 'Ask by voice'}>
      <Icon name={recording ? 'stop' : 'mic'} size={18} />
    </button>
    <button class="btn primary" type="submit" disabled={!question.trim() || busy}>{busy ? 'Asking…' : 'Ask'}</button>
  </form>
  {#if micError}<p class="small error mic-error" role="alert">{micError}</p>{/if}
</div>

<style>
  .narrow {
    max-width: 760px;
  }
  .exchange {
    display: grid;
    gap: 8px;
  }
  .question {
    justify-self: end;
    max-width: 85%;
    padding: 8px 12px;
    border-radius: var(--radius-card);
    background: var(--raised);
    font-weight: 500;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .answer-text {
    font-size: 15px;
    line-height: 24px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .ref {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    margin: 0 1px 0 3px;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--raised);
    font-size: 11px;
    font-weight: 600;
    vertical-align: 2px;
    line-height: 1;
  }
  .ref:hover {
    background: var(--text);
    color: var(--surface);
  }
  .cards {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
  }
  .cards li {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    align-items: start;
  }
  .n {
    padding-top: 13px;
    font-size: var(--fs-small);
    font-weight: 600;
    color: var(--muted);
  }
  .cards :global(.row) {
    grid-template-columns: 52px minmax(0, 1fr) auto;
  }
  .thinking {
    animation: breathe 1.4s ease-in-out infinite;
  }
  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }
  .sent {
    margin-top: 8px;
    color: var(--hue);
    font-weight: 500;
  }
  .by {
    margin-top: 8px;
  }
  .error {
    color: var(--negative);
  }
  .examples h2 {
    font-weight: 500;
    margin-bottom: 6px;
  }
  .examples ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .ask {
    position: sticky;
    bottom: 16px;
    margin-top: 16px;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 8px;
    transition: border-color var(--t-ui) ease;
  }
  .ask:focus-within {
    border-color: color-mix(in srgb, var(--text) 40%, var(--border));
  }
  .confirming {
    color: var(--negative);
  }
  @media (prefers-reduced-motion: reduce) {
    .thinking {
      animation: none;
    }
  }
  .ask textarea {
    flex: 1;
    min-height: 36px;
    max-height: 160px;
    resize: none;
    field-sizing: content;
    border: 0;
    outline: none;
    background: transparent;
    padding: 8px;
    font-size: 15px;
    line-height: 20px;
  }
  .mic.on {
    color: var(--negative);
    border-color: var(--negative);
  }
  .mic-error {
    margin-top: 8px;
  }
  @media (max-width: 760px) {
    .ask {
      bottom: calc(72px + env(safe-area-inset-bottom));
    }
  }
</style>
