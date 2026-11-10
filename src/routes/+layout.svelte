<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { capture } from '$lib/api';
  import { deviceWord } from '$lib/cards';
  import { intakeHandler } from '$lib/intake.svelte';
  import { connection, listen } from '$lib/live.svelte';
  import Icon, { type IconName } from '$lib/ui/Icon.svelte';
  import { onMount } from 'svelte';

  let { children, data } = $props();

  const NAV: { href: string; label: string; icon: IconName }[] = [
    { href: '/', label: 'Recent', icon: 'recent' },
    { href: '/topics', label: 'Topics', icon: 'topics' },
    { href: '/ask', label: 'Ask', icon: 'ask' },
  ];

  let search: HTMLInputElement | undefined = $state();
  let query = $state(page.url.pathname === '/search' ? (page.url.searchParams.get('q') ?? '') : '');
  let dragging = $state(false);
  let toast = $state<{ message: string; id?: number } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const current = (href: string) => (href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href));

  $effect(() => {
    if (page.url.pathname === '/search') query = page.url.searchParams.get('q') ?? '';
  });

  function say(message: string, id?: number) {
    toast = { message, id };
    clearTimeout(toastTimer);
    hideToastLater();
  }

  /** Long enough to reach its "Open" link; held while the pointer or focus is on it. */
  function hideToastLater() {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 8000);
  }

  /** Paste or drop with no composer on the page: keep it now. */
  async function keepNow(files: File[], text: string | null) {
    const form = new FormData();
    if (text) form.set('text', text);
    for (const f of files) form.append('file', f, f.name);
    form.set('lane', 'keep');
    try {
      const results = await capture(form);
      say(results.length > 1 ? `Kept ${results.length} things.` : 'Kept.', results.length === 1 ? results[0]?.item.id : undefined);
    } catch (error) {
      say(`Not saved: ${(error as Error).message}. Try again, or paste it into the box on Recent.`);
    }
  }

  function intake(files: File[], text: string | null) {
    const handler = intakeHandler();
    if (handler) handler(files, text);
    else keepNow(files, text);
  }

  const typing = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

  onMount(() => {
    const stop = listen({});
    const keydown = (event: KeyboardEvent) => {
      if (typing(event.target)) return;
      if (event.key === '/' || (event.key === 'k' && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        search?.focus();
        search?.select();
      }
    };
    const paste = (event: ClipboardEvent) => {
      if (typing(event.target)) return;
      const files = [...(event.clipboardData?.files ?? [])];
      const text = event.clipboardData?.getData('text/plain')?.trim() || null;
      if (!files.length && !text) return;
      event.preventDefault();
      intake(files, files.length ? null : text);
    };
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const dragenter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      dragging = true;
    };
    const dragleave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) dragging = false;
    };
    const dragover = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      depth = 0;
      dragging = false;
      const files = [...(event.dataTransfer?.files ?? [])];
      if (!files.length) return;
      event.preventDefault();
      intake(files, null);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('paste', paste);
    window.addEventListener('dragenter', dragenter);
    window.addEventListener('dragleave', dragleave);
    window.addEventListener('dragover', dragover);
    window.addEventListener('drop', drop);
    return () => {
      stop();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('paste', paste);
      window.removeEventListener('dragenter', dragenter);
      window.removeEventListener('dragleave', dragleave);
      window.removeEventListener('dragover', dragover);
      window.removeEventListener('drop', drop);
    };
  });

  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  /** On the search page, results follow the typing. */
  function searchInput() {
    if (page.url.pathname !== '/search') return;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      const q = query.trim();
      const kind = page.url.searchParams.get('kind');
      const target = q ? `/search?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}` : '/search';
      goto(target, { keepFocus: true, replaceState: true, noScroll: true });
    }, 220);
  }

  function submitSearch(event: SubmitEvent) {
    event.preventDefault();
    const q = query.trim();
    goto(q ? `/search?q=${encodeURIComponent(q)}` : '/search', { keepFocus: true });
  }
</script>

<a class="skip" href="#main">Skip to content</a>

<header class="top">
  <div class="column top-inner">
    <a class="mark" href="/" aria-label="Drawer, recent">Drawer</a>
    <nav class="nav" aria-label="Main">
      {#each NAV as item (item.href)}
        <a href={item.href} aria-current={current(item.href) ? 'page' : undefined}>{item.label}</a>
      {/each}
    </nav>
    <form class="search" role="search" onsubmit={submitSearch} action="/search">
      <Icon name="search" size={16} />
      <label class="visually-hidden" for="global-search">Search the drawer</label>
      <input
        id="global-search"
        bind:this={search}
        bind:value={query}
        oninput={searchInput}
        name="q"
        type="search"
        placeholder="Search everything…"
        autocomplete="off"
        enterkeyhint="search"
      />
      <kbd class="hint small" aria-hidden="true">/</kbd>
    </form>
    <a
      class="device small"
      href="/settings"
      aria-current={current('/settings') ? 'page' : undefined}
      aria-label="Settings, this is the {deviceWord(data.device)}{connection.online ? '' : ', offline'}"
      title="This device and settings"
    >
      {#if !connection.online}<span class="offline">Offline ·</span>{/if}
      {deviceWord(data.device)}
    </a>
  </div>
</header>

<main id="main">
  {@render children()}
</main>

<nav class="bottom" aria-label="Main">
  {#each [...NAV, { href: '/settings', label: deviceWord(data.device), icon: 'more' as IconName }] as item (item.href)}
    <a
      href={item.href}
      aria-current={current(item.href) ? 'page' : undefined}
      aria-label={item.href === '/settings' ? `Settings, this is the ${item.label}` : undefined}
    >
      {#if item.href === '/settings'}<span class="device-dot" aria-hidden="true">{item.label.slice(0, 1)}</span>{:else}<Icon
          name={item.icon}
          size={20}
        />{/if}
      <span>{item.label}</span>
    </a>
  {/each}
</nav>

{#if dragging}
  <div class="drop" aria-hidden="true"><p>Drop to put it in the drawer</p></div>
{/if}

<div class="toast-region" role="status" aria-live="polite">
  {#if toast}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <p
      class="toast"
      onmouseenter={() => clearTimeout(toastTimer)}
      onmouseleave={hideToastLater}
      onfocusin={() => clearTimeout(toastTimer)}
      onfocusout={hideToastLater}
    >
      {toast.message}
      {#if toast.id}<a href="/item/{toast.id}">Open</a>{/if}
    </p>
  {/if}
</div>

<style>
  .skip {
    position: absolute;
    left: -9999px;
  }
  .skip:focus {
    left: 16px;
    top: 8px;
    z-index: 50;
    padding: 8px 12px;
    background: var(--surface);
    border-radius: var(--radius-control);
  }
  .top {
    position: sticky;
    top: 0;
    z-index: 10;
    height: 48px;
    background: color-mix(in srgb, var(--ground) 92%, transparent);
    backdrop-filter: blur(8px); /* taste-skill-ignore: the sticky top bar */
    border-bottom: 1px solid var(--border);
  }
  .top-inner {
    height: 100%;
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .mark {
    font-weight: 700;
    font-size: 16px;
    letter-spacing: -0.02em;
  }
  .nav {
    display: flex;
    gap: 4px;
  }
  .nav a {
    height: 32px;
    display: inline-flex;
    align-items: center;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--muted);
    font-weight: 500;
  }
  .nav a:hover {
    color: var(--text);
    background: var(--raised);
  }
  .nav a[aria-current='page'] {
    color: var(--text);
    background: var(--raised);
  }
  .search {
    flex: 1;
    max-width: 440px;
    margin-left: auto;
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 8px 0 10px;
    border: 1px solid var(--control);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--faint);
  }
  .search:focus-within {
    border-color: var(--text);
  }
  .search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
  }
  .search input::-webkit-search-cancel-button {
    display: none;
  }
  .hint {
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: inherit;
    color: var(--faint);
  }
  .search:focus-within .hint {
    display: none;
  }
  .device {
    font-weight: 500;
    color: var(--muted);
    white-space: nowrap;
  }
  .device:hover,
  .device[aria-current='page'] {
    color: var(--text);
  }
  .offline {
    color: var(--negative);
  }
  main {
    padding-bottom: 64px;
  }
  .bottom {
    display: none;
  }
  .drop {
    position: fixed;
    inset: 12px;
    z-index: 40;
    display: grid;
    place-items: center;
    border: 2px dashed var(--text);
    border-radius: 12px;
    background: color-mix(in srgb, var(--ground) 88%, transparent);
    pointer-events: none;
  }
  .drop p {
    font-size: var(--fs-section);
    font-weight: 600;
  }
  .toast-region {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 30;
  }
  .toast {
    display: flex;
    gap: 12px;
    padding: 10px 14px;
    border-radius: var(--radius-card);
    background: var(--primary);
    color: var(--on-primary);
    font-weight: 500;
  }
  .toast a {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  @media (max-width: 760px) {
    :global(html) {
      scroll-padding-bottom: calc(88px + env(safe-area-inset-bottom));
    }
    .nav,
    .device,
    .hint {
      display: none;
    }
    .top-inner {
      gap: 12px;
    }
    .search {
      max-width: none;
    }
    main {
      padding-bottom: calc(80px + env(safe-area-inset-bottom));
    }
    .bottom {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 10;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      padding: 4px 8px calc(4px + env(safe-area-inset-bottom));
      background: color-mix(in srgb, var(--ground) 94%, transparent);
      backdrop-filter: blur(8px); /* taste-skill-ignore: the phone bottom bar */
      border-top: 1px solid var(--border);
    }
    .bottom a {
      display: grid;
      justify-items: center;
      gap: 2px;
      padding: 6px 0;
      font-size: 11px;
      line-height: 14px;
      font-weight: 500;
      color: var(--muted);
    }
    .bottom a[aria-current='page'] {
      color: var(--text);
    }
    .device-dot {
      display: grid;
      place-items: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 1.5px solid currentColor;
      font-size: 10px;
      font-weight: 700;
    }
    .toast-region {
      bottom: calc(76px + env(safe-area-inset-bottom));
      width: calc(100% - 32px);
    }
  }
</style>
