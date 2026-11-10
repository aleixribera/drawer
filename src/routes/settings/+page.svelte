<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { copyText } from '$lib/api';
  import { DEVICES, deviceWord } from '$lib/cards';
  import { age } from '$lib/when';
  import { page } from '$app/state';
  import DesktopConnect from '$lib/ui/DesktopConnect.svelte';
  import DeviceSetup from '$lib/ui/DeviceSetup.svelte';
  import Notifications from '$lib/ui/Notifications.svelte';

  let { data, form } = $props();
  let copied = $state(false);
  const spent = $derived(data.stats.spentThisMonthUsd);
  const cap = $derived(data.stats.spendCapUsd);
  const share = $derived(cap > 0 ? Math.min(1, spent / cap) : 0);

  async function copyToken() {
    if (form?.token && (await copyText(form.token))) {
      copied = true;
      setTimeout(() => (copied = false), 1500);
    }
  }
</script>

<svelte:head>
  <title>Settings · Drawer</title>
</svelte:head>

<div class="column narrow">
  <div class="title-row">
    <div>
      <h1>Settings</h1>
      <p class="sub">This device, the API tokens for Shortcuts and the companion, and what the librarian costs.</p>
    </div>
  </div>

  <div class="stack">
    <DesktopConnect />
    <section class="panel">
      <div class="panel-head"><h2>This device</h2></div>
      <p class="muted lead">
        Things sent “to {deviceWord(data.device)}” show up here.
        {data.chosen ? '' : `Drawer guessed ${deviceWord(data.device)} from this browser; set it if that's wrong.`}
      </p>
      <form method="POST" action="?/device" use:enhance={() => async ({ update }) => { await update(); await invalidateAll(); }}>
        <div class="segmented" role="group" aria-label="This device is">
          {#each DEVICES as d (d.name)}
            <button name="device" value={d.name} aria-pressed={data.device === d.name}>{d.label}</button>
          {/each}
        </div>
      </form>
      <Notifications device={data.device} />
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Device tokens</h2></div>
      <p class="muted lead">
        The iPhone Shortcut and the <code>drawer</code> command on the PC and laptop sign in with a token. A new token
        replaces the old one for that device.
      </p>
      {#if data.devices.length}
        <table class="ledger">
          <thead>
            <tr><th scope="col">Device</th><th scope="col">Since</th><th scope="col">Last used</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {#each data.devices as d (d.id)}
              <tr>
                <th scope="row">{deviceWord(d.name)}</th>
                <td class="num muted">{new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                <td class="num muted">{d.lastSeenAt ? `${age(d.lastSeenAt)} ago` : 'never'}</td>
                <td class="end">
                  <form method="POST" action="?/forget" use:enhance>
                    <button class="btn quiet danger" name="name" value={d.name}>Remove</button>
                  </form>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <form class="new-token" method="POST" action="?/token" use:enhance>
        <label for="token-for" class="small muted">New token for</label>
        <select id="token-for" class="input" name="name">
          {#each DEVICES as d (d.name)}<option value={d.name}>{d.label}</option>{/each}
        </select>
        <button class="btn" type="submit">Make token</button>
      </form>
      {#if form?.token}
        <div class="token" role="status">
          <p class="small">Token for {deviceWord(form.tokenFor)}. It is shown once; copy it into the Shortcut or run <code>drawer login</code>.</p>
          <div class="token-row">
            <input class="input mono" readonly value={form.token} aria-label="New token" onfocus={(e) => e.currentTarget.select()} />
            <button class="btn primary" type="button" onclick={copyToken}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      {/if}
      {#if form?.done}<p class="small done" role="status">{form.done}</p>{/if}
      {#if form?.error}<p class="small error" role="alert">{form.error}</p>{/if}
    </section>

    <DeviceSetup origin={page.url.origin} device={data.device} token={form?.token ?? null} tokenFor={form?.tokenFor ?? null} />

    <section class="panel">
      <div class="panel-head"><h2>Librarian</h2></div>
      {#if data.modelAvailable}
        <p class="muted lead">
          {data.stats.model} reads new things to title, summarise and file them, and answers in Ask. Private things are
          never sent.
        </p>
      {:else}
        <p class="muted lead">
          Off: there is no API key on the server{spent >= cap && cap > 0 ? ', or this month’s cap is reached' : ''}. Search and
          everything else still work; new things keep a plain title until it’s back.
        </p>
      {/if}
      <div class="meter-row">
        <span class="num"><strong>${spent.toFixed(2)}</strong> <span class="muted">of ${cap.toFixed(0)} this month</span></span>
        <span class="num muted">{Math.round(share * 100)}%</span>
      </div>
      <div class="meter" role="meter" aria-label="Spent this month" aria-valuemin="0" aria-valuemax={cap} aria-valuenow={spent}>
        <span style="width: {share * 100}%"></span>
      </div>
      <dl class="kv small counts">
        <dt>Things kept</dt><dd class="num">{data.stats.items}</dd>
        <dt>Waiting to be read</dt><dd class="num">{data.stats.pending ?? 0}</dd>
        <dt>Failed, will retry</dt><dd class="num">{data.stats.failed ?? 0}</dd>
        <dt>Private</dt><dd class="num">{data.stats.private ?? 0}</dd>
      </dl>
    </section>
  </div>
</div>

<style>
  .narrow {
    max-width: 760px;
  }
  .lead {
    margin-bottom: 12px;
  }
  code,
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Menlo, monospace;
    font-size: 13px;
  }
  .ledger {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
  }
  .ledger th,
  .ledger td {
    text-align: left;
    height: 40px;
    padding: 0 8px 0 0;
    border-top: 1px solid var(--rule);
  }
  .ledger thead th {
    border-top: 0;
    height: 28px;
    font-size: var(--fs-small);
    font-weight: 500;
    color: var(--muted);
  }
  .ledger tbody th {
    font-weight: 500;
  }
  .end {
    text-align: right;
  }
  .new-token {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .new-token select {
    width: auto;
  }
  .token {
    margin-top: 12px;
    padding: 12px;
    border-radius: var(--radius-control);
    background: var(--raised);
    display: grid;
    gap: 8px;
  }
  .token-row {
    display: flex;
    gap: 8px;
  }
  .done {
    margin-top: 10px;
    color: var(--positive);
  }
  .error {
    margin-top: 10px;
    color: var(--negative);
  }
  .meter-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .meter {
    height: 6px;
    border-radius: 3px;
    background: var(--raised);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    background: var(--text);
  }
  .counts {
    margin-top: 16px;
  }
</style>
