<script lang="ts">
  import { onMount } from 'svelte';
  import { deviceWord } from '$lib/cards';

  /**
   * The switch for notifications in this browser: when something is sent to this device, it pops up even with Drawer
   * closed. On the iPhone that only works from the app added to the Home Screen, so Safari is told so.
   */
  let { device }: { device: string } = $props();

  type State = 'loading' | 'desktop' | 'unsupported' | 'ios-browser' | 'server-off' | 'blocked' | 'off' | 'on';
  let status = $state<State>('loading');
  let busy = $state(false);
  let problem = $state<string | null>(null);
  let publicKey: string | null = null;

  async function registration(): Promise<ServiceWorkerRegistration | null> {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    // In development the worker may not be registered yet; ready waits for it.
    return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
  }

  async function refresh() {
    // The desktop app shows its own notifications; Electron has no push service to subscribe to.
    if ('drawerDesktop' in window) {
      status = 'desktop';
      return;
    }
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      status = ios && !standalone ? 'ios-browser' : 'unsupported';
      return;
    }
    type Info = { enabled: boolean; publicKey: string | null; subscribed: boolean };
    const ask = (endpoint?: string): Promise<Info> =>
      fetch(`/api/push${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ''}`).then((r) => r.json());
    // The worker can take a moment to start on a first visit, so the answers that don't need it come first.
    const pending = registration().then((reg) => reg?.pushManager.getSubscription() ?? null);
    const info = await ask();
    publicKey = info.publicKey;
    if (!info.enabled || !publicKey) status = 'server-off';
    else if (Notification.permission === 'denied') status = 'blocked';
    else {
      const subscription = await pending;
      status = subscription && (await ask(subscription.endpoint)).subscribed ? 'on' : 'off';
    }
  }

  function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
    const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  async function turnOn() {
    busy = true;
    problem = null;
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        status = Notification.permission === 'denied' ? 'blocked' : 'off';
        return;
      }
      const reg = await registration();
      if (!reg || !publicKey) throw new Error('The app’s background worker isn’t running; reload and try again.');
      const subscription =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const response = await fetch('/api/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? 'The server said no.');
      status = 'on';
    } catch (error) {
      problem = (error as Error).message;
    } finally {
      busy = false;
    }
  }

  async function turnOff() {
    busy = true;
    problem = null;
    try {
      const subscription = await (await registration())?.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      status = 'off';
    } catch (error) {
      problem = (error as Error).message;
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    refresh().catch((error) => {
      problem = (error as Error).message;
      status = 'unsupported';
    });
  });
</script>

<div class="notify" aria-live="polite">
  <div class="line">
    <div>
      <p class="name">Notifications</p>
      <p class="small muted">
        {#if status === 'loading'}
          Checking this browser…
        {:else if status === 'desktop'}
          The app shows them itself while it runs in the tray, so nothing to turn on here.
        {:else if status === 'on'}
          On. Things sent to {deviceWord(device)} pop up here, even with Drawer closed.
        {:else if status === 'off'}
          Off. Turn on to hear about things sent to {deviceWord(device)} with Drawer closed.
        {:else if status === 'blocked'}
          Blocked for this site in the browser’s settings. Allow notifications there, then reload.
        {:else if status === 'server-off'}
          Not set up on the server yet: it needs its push keys.
        {:else if status === 'ios-browser'}
          On the iPhone they work in the app on the Home Screen, not in Safari. Add it (Share, Add to Home Screen), open it
          from there and come back here.
        {:else}
          This browser can’t receive them.
        {/if}
      </p>
    </div>
    {#if status === 'off'}
      <button class="btn primary" type="button" disabled={busy} onclick={turnOn}>{busy ? 'Turning on…' : 'Turn on'}</button>
    {:else if status === 'on'}
      <button class="btn quiet" type="button" disabled={busy} onclick={turnOff}>Turn off</button>
    {/if}
  </div>
  {#if problem}<p class="small error" role="alert">{problem}</p>{/if}
</div>

<style>
  .notify {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .name {
    margin: 0 0 2px;
    font-weight: 600;
  }
  .line p.small {
    margin: 0;
  }
  .line .btn {
    flex: none;
  }
  .error {
    margin: 8px 0 0;
    color: var(--negative);
  }
</style>
