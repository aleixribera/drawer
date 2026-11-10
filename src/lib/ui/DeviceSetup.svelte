<script lang="ts">
  import { copyText } from '$lib/api';
  import { DEVICES } from '$lib/cards';

  /**
   * How to connect each device, with this drawer's address and, right after one is made, the device's token already in
   * the commands. The iPhone gets Shortcuts recipes; the PC and laptop get the `drawer` companion.
   */
  let { origin, device, token = null, tokenFor = null }: { origin: string; device: string; token?: string | null; tokenFor?: string | null } =
    $props();

  let chosen = $state<string | null>(null);
  const shown = $derived(chosen ?? tokenFor ?? device);
  const key = $derived(token && tokenFor === shown ? token : 'YOUR_TOKEN');
  let copied = $state<string | null>(null);

  async function copy(id: string, text: string) {
    if (await copyText(text)) {
      copied = id;
      setTimeout(() => (copied = null), 1500);
    }
  }

  const windows = $derived(
    [
      `New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\\drawer" | Out-Null`,
      `curl.exe -fsSo "$env:LOCALAPPDATA\\drawer\\drawer.mjs" ${origin}/drawer.mjs`,
      `node "$env:LOCALAPPDATA\\drawer\\drawer.mjs" login ${origin} ${key}`,
      `node "$env:LOCALAPPDATA\\drawer\\drawer.mjs" setup`,
    ].join('\n'),
  );
  const fedora = $derived(
    [
      `sudo dnf install -y nodejs wl-clipboard`,
      `mkdir -p ~/.local/share/drawer && curl -fsSo ~/.local/share/drawer/drawer.mjs ${origin}/drawer.mjs`,
      `node ~/.local/share/drawer/drawer.mjs login ${origin} ${key}`,
      `node ~/.local/share/drawer/drawer.mjs setup`,
    ].join('\n'),
  );
</script>

<section class="panel" aria-labelledby="setup-heading">
  <div class="panel-head">
    <h2 id="setup-heading">Set up a device</h2>
    <div class="segmented" role="group" aria-label="Device">
      {#each DEVICES as d (d.name)}
        <button type="button" aria-pressed={shown === d.name} onclick={() => (chosen = d.name)}>{d.label}</button>
      {/each}
    </div>
  </div>

  {#if shown === 'iphone'}
    {#if key === 'YOUR_TOKEN'}
      <p class="muted lead">Make a token for the iPhone above first: it then appears here in place of YOUR_TOKEN.</p>
    {/if}
    <ol class="steps">
      <li>
        <strong>The app.</strong> Open <span class="mono">{origin}</span> in Safari, then Share, Add to Home Screen. From the home
        screen it opens full screen and can be shared to.
      </li>
      <li>
        <strong>Drawer, in the share sheet.</strong> In Shortcuts, make a shortcut called Drawer. In its details turn on Show
        in Share Sheet; if there's no input, Get Clipboard. Then:
        <ul class="recipe">
          <li>Repeat with Each item in Shortcut Input</li>
          <li class="in">Get URLs from Repeat Item</li>
          <li class="in">If URLs has any value: <em>Get Contents of URL</em>, Method POST, Request Body JSON with <span class="mono">text</span> = URLs</li>
          <li class="in">Otherwise: <em>Get Contents of URL</em>, Method POST, Request Body File = Repeat Item</li>
          <li>Both requests: URL and header below</li>
        </ul>
        <div class="kv-copy">
          <span class="small muted">URL</span>
          <code class="mono">{origin}/api/capture</code>
          <button class="btn quiet" type="button" onclick={() => copy('url', `${origin}/api/capture`)}>{copied === 'url' ? 'Copied' : 'Copy'}</button>
          <span class="small muted">Header</span>
          <code class="mono">Authorization: Bearer {key}</code>
          <button class="btn quiet" type="button" onclick={() => copy('auth', `Bearer ${key}`)}>{copied === 'auth' ? 'Copied' : 'Copy value'}</button>
        </div>
      </li>
      <li>
        <strong>Send to PC, Send to Laptop.</strong> Duplicate Drawer twice and add <span class="mono nowrap">?target=pc</span> or
        <span class="mono nowrap">?target=laptop</span> to both URLs. What you share lands on that computer's clipboard.
      </li>
      <li>
        <strong>Ask Drawer, on the Action Button.</strong> Dictate Text, then <em>Get Contents of URL</em> with
        <span class="mono">{origin}/api/ask?format=text</span>, Method POST, the same header, Request Body File = Dictated Text,
        then Speak Text with Contents of URL. In Settings, Action Button, pick Shortcut, Ask Drawer.
      </li>
    </ol>
  {:else}
    {@const commands = shown === 'pc' ? windows : fedora}
    <p class="muted lead">
      The companion keeps and sends from the clipboard, and puts what other devices send here on the clipboard.
      {shown === 'pc' ? 'In PowerShell, with Node installed' : 'In a terminal'}{key === 'YOUR_TOKEN'
        ? `, after making a token for the ${shown === 'pc' ? 'PC' : 'laptop'} above (it replaces YOUR_TOKEN):`
        : ':'}
    </p>
    <div class="code">
      <pre class="mono">{commands}</pre>
      <button class="btn" type="button" onclick={() => copy('cmd', commands)}>{copied === 'cmd' ? 'Copied' : 'Copy'}</button>
    </div>
    <dl class="kv small keys">
      <dt><kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>D</kbd></dt>
      <dd>keeps what is on the clipboard: text, a link, a screenshot or copied files</dd>
      <dt><kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>P</kbd></dt>
      <dd>sends it to the iPhone</dd>
    </dl>
    <p class="small muted terminal">
      In a terminal: <span class="mono">drawer send --to laptop notes.pdf</span>, or
      <span class="mono">drawer ask "which laptops was I comparing?"</span>
    </p>
  {/if}
</section>

<style>
  .panel-head {
    flex-wrap: wrap;
    gap: 8px;
  }
  .nowrap {
    white-space: nowrap;
  }
  .lead + .steps,
  .lead + .code {
    margin-top: 12px;
  }
  .steps {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 14px;
  }
  .steps li::marker {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .recipe {
    margin: 8px 0;
    padding-left: 18px;
    color: var(--muted);
    display: grid;
    gap: 2px;
  }
  .recipe .in {
    margin-left: 16px;
  }
  .kv-copy {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px 10px;
    margin-top: 8px;
  }
  .kv-copy code,
  .mono {
    overflow-wrap: anywhere;
  }
  .code {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 8px;
    padding: 12px;
    border-radius: var(--radius-control);
    background: var(--raised);
  }
  .code pre {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 12.5px;
    line-height: 20px;
  }
  .keys {
    margin-top: 12px;
  }
  .terminal {
    margin-top: 10px;
  }
  kbd {
    font: inherit;
    font-size: 11px;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
  }
  @media (max-width: 640px) {
    .kv-copy {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .kv-copy span.small {
      grid-column: 1 / -1;
    }
  }
</style>
