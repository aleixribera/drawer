<script lang="ts">
  import { onMount } from 'svelte';

  /**
   * Shown only inside the Drawer desktop app (its preload script adds window.drawerDesktop): one button gives the app
   * a token for this computer, and then the app receives what is sent here and runs the hotkeys.
   */
  interface DesktopBridge {
    device: 'pc' | 'fedora';
    version: string;
    connected: () => Promise<boolean>;
    connect: (token: string) => Promise<boolean>;
    info?: () => Promise<AppInfo | null>;
    act?: (action: string) => Promise<AppInfo | null>;
  }
  interface AppInfo {
    startAtLogin: boolean;
    packaged: boolean;
    update: string | null;
  }

  let bridge = $state<DesktopBridge | null>(null);
  let connected = $state(false);
  let busy = $state(false);
  let problem = $state<string | null>(null);
  let app = $state<AppInfo | null>(null);
  const label = $derived(bridge?.device === 'fedora' ? 'Laptop' : 'PC');

  onMount(async () => {
    const found = (window as unknown as { drawerDesktop?: DesktopBridge }).drawerDesktop;
    if (!found) return;
    bridge = found;
    connected = await found.connected();
    app = (await found.info?.()) ?? null;
  });

  /** The tray menu's actions, here too: stock GNOME shows no tray icons. */
  async function act(action: string) {
    if (!bridge?.act) return;
    app = (await bridge.act(action)) ?? app;
  }

  async function connect() {
    if (!bridge) return;
    busy = true;
    problem = null;
    try {
      const response = await fetch('/api/desktop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device: bridge.device }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `Drawer answered ${response.status}`);
      const { token } = (await response.json()) as { token: string };
      connected = await bridge.connect(token);
      if (!connected) problem = 'The app could not reach Drawer with the new token. Try again.';
    } catch (error) {
      problem = (error as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

{#if bridge}
  <section class="panel desktop" aria-labelledby="desktop-heading">
    <div class="panel-head">
      <h2 id="desktop-heading">This app</h2>
      <span class="small muted mono">v{bridge.version}</span>
    </div>
    {#if connected}
      <p class="lead">
        Connected as the {label}. Things sent to the {label} land on its clipboard, files in Downloads/Drawer.
        <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> keeps what is on the clipboard,
        <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd> sends it to the iPhone.
      </p>
      <button class="btn quiet" type="button" disabled={busy} onclick={connect}>{busy ? 'Connecting…' : 'Connect again'}</button>
      {#if app}
        <div class="app">
          <label class="check">
            <input
              type="checkbox"
              checked={app.startAtLogin}
              disabled={!app.packaged}
              onchange={(event) => act(event.currentTarget.checked ? 'start-at-login' : 'no-start-at-login')}
            />
            Start with the computer
          </label>
          <div class="actions">
            {#if app.update}
              <button class="btn primary" type="button" onclick={() => act('install-update')}>Restart to update to {app.update}</button>
            {:else}
              <button class="btn quiet" type="button" disabled={!app.packaged} onclick={() => act('check-updates')}>Check for updates</button>
            {/if}
            <button class="btn quiet" type="button" onclick={() => act('change-address')}>Change Drawer’s address</button>
            <button class="btn quiet" type="button" onclick={() => act('quit')}>Quit the app</button>
          </div>
        </div>
      {/if}
    {:else}
      <p class="lead">
        Connect the app to receive what is sent to the {label} and to use the hotkeys. It gets its own token, which
        replaces any older token for the {label}.
      </p>
      <button class="btn primary" type="button" disabled={busy} onclick={connect}>{busy ? 'Connecting…' : 'Connect this app'}</button>
    {/if}
    {#if problem}<p class="small error" role="alert">{problem}</p>{/if}
  </section>
{/if}

<style>
  .lead {
    margin: 0 0 12px;
    max-width: 62ch;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 13px;
  }
  kbd {
    font-family: var(--font-mono);
    font-size: 0.85em;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .error {
    color: var(--negative);
    margin-top: 8px;
  }
  .app {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--rule);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: var(--control-height);
    cursor: pointer;
  }
  .check input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--primary);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
