#!/usr/bin/env node
// Drawer's companion for the PC and the laptop. Node 20 or newer, nothing to install.
//
//   drawer login <url> <token>     once per computer; the token comes from Drawer's Settings page
//   drawer send [text|file …]      keep it; with nothing given, takes what is on the clipboard (a screenshot too)
//   drawer send --to iphone …      send it to another device instead (iphone, pc, laptop, all)
//   drawer ask <question>          the librarian's one-line answer
//   drawer listen                  runs at login: what other devices send here lands on the clipboard
//   drawer setup                   start `listen` at login, and the hotkeys Ctrl+Alt+D (keep) and Ctrl+Alt+P (to the phone)
//   drawer status                  what this computer is called and whether the drawer answers
//
// Options for send: --private, --notify (a desktop notification instead of printing; the hotkeys use it).

import { execFile, spawn } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WIN = platform() === 'win32';
const CONFIG_DIR = WIN
  ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'drawer')
  : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'drawer');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
/** @type {Record<string, string>} */
export const DEVICE_WORDS = { iphone: 'iPhone', pc: 'PC', fedora: 'Laptop', all: 'every device' };
/** @type {Record<string, string>} */
const TARGETS = { iphone: 'iphone', phone: 'iphone', pc: 'pc', laptop: 'fedora', fedora: 'fedora', all: 'all' };
/** @type {Record<string, string>} */
export const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.heic': 'image/heic', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.txt': 'text/plain', '.zip': 'application/zip',
};

// ------------------------------------------------------------------ pure parts (tested)

/**
 * Splits the arguments of `send`: options, then each word is a file when such a file exists, else text.
 * @param {string[]} args
 * @param {(path: string) => boolean} isFile
 */
export function parseSend(args, isFile) {
  /** @type {{ to: string | null, private: boolean, notify: boolean, files: string[], words: string[] }} */
  const out = { to: null, private: false, notify: false, files: [], words: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = /** @type {string} */ (args[i]);
    if (arg === '--to' || arg === '-t') {
      const name = (args[++i] ?? '').toLowerCase();
      const target = /** @type {Record<string, string>} */ (TARGETS)[name];
      if (!target) throw new Error(`Send to which device? iphone, pc, laptop or all (not "${name}").`);
      out.to = target;
    } else if (arg === '--private') out.private = true;
    else if (arg === '--notify') out.notify = true;
    else if (isFile(arg)) out.files.push(arg);
    else out.words.push(arg);
  }
  return out;
}

/**
 * Reads Server-Sent Events out of a growing buffer: the complete events, and what is left over.
 * @param {string} buffer
 * @returns {{ events: { event: string, data: string }[], rest: string }}
 */
export function parseSse(buffer) {
  const events = [];
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

/**
 * What `listen` does with a card: nothing, or deliver it here (copy its text or link, or fetch its file).
 * @param {{ id: number, lane: string, source: string, target: string | null, deliveredAt: string | null, kind: string, url: string | null, text: string | null, file: { name: string } | null }} card
 * @param {string} me this computer's device name
 * @returns {{ kind: 'none' } | { kind: 'file', name: string } | { kind: 'text', text: string }}
 */
export function deliveryFor(card, me) {
  if (card.lane !== 'transit' || card.deliveredAt || card.source === me) return { kind: 'none' };
  if (card.target !== me && card.target !== 'all') return { kind: 'none' };
  if (card.file) return { kind: 'file', name: card.file.name };
  const text = card.url && (card.kind === 'link' || card.kind === 'video') ? card.url : (card.text ?? card.url);
  return text ? { kind: 'text', text } : { kind: 'none' };
}

/**
 * A free name in a folder: "shot.png", then "shot (2).png"…
 * @param {string} name
 * @param {(name: string) => boolean} taken
 */
export function freeName(name, taken) {
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
  if (!taken(safe)) return safe;
  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  for (let n = 2; ; n++) if (!taken(`${stem} (${n})${ext}`)) return `${stem} (${n})${ext}`;
}

/**
 * What a picture taken from the clipboard is called: "Screenshot 2026-11-10 12.21.png".
 * @param {Date} at @param {string} ext
 */
export function screenshotName(at, ext) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `Screenshot ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}.${p(at.getMinutes())}${ext}`;
}

/**
 * Adds Drawer's two GNOME shortcuts to the list gsettings prints, keeping the others.
 * @param {string} printed e.g. "@as []" or "['/org/…/custom0/']"
 * @param {string[]} paths
 */
export function withKeybindings(printed, paths) {
  const existing = [...printed.matchAll(/'([^']+)'/g)].map((m) => /** @type {string} */ (m[1]));
  const all = [...existing, ...paths.filter((p) => !existing.includes(p))];
  return `[${all.map((p) => `'${p}'`).join(', ')}]`;
}

// ------------------------------------------------------------------ config and the API

/** @returns {Promise<{ url: string, token: string, device: string }>} */
async function config() {
  try {
    const saved = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
    if (saved.url && saved.token && saved.device) return saved;
  } catch {
    /* not logged in */
  }
  throw new Error('Not set up on this computer yet: run `drawer login <url> <token>` with a token from Drawer’s Settings page.');
}

/**
 * @param {{ url: string, token: string }} cfg
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function api(cfg, path, init = {}) {
  const response = await fetch(new URL(path, cfg.url), {
    ...init,
    headers: { authorization: `Bearer ${cfg.token}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let message = body;
    try {
      message = JSON.parse(body).message ?? body;
    } catch {
      /* plain text */
    }
    throw new Error(`${response.status} ${message || response.statusText}`.trim());
  }
  return response;
}

// ------------------------------------------------------------------ the operating system

/**
 * Runs a program and returns what it printed. Never opens a window on Windows.
 * @param {string} file
 * @param {string[]} args
 * @param {{ env?: Record<string, string>, input?: Buffer | string, encoding?: 'utf8' | 'buffer' }} [options]
 * @returns {Promise<any>}
 */
function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        // wl-paste waits for the app that owns the clipboard, which may never answer.
        timeout: 60_000,
        encoding: options.encoding ?? 'utf8',
        env: { ...process.env, ...(options.env ?? {}) },
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}

/** @param {string} script @param {Record<string, string>} [env] */
const powershell = (script, env) =>
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], { env });

const wayland = () => !!process.env.WAYLAND_DISPLAY;

/**
 * What is on the clipboard: an image (saved to a temporary PNG), copied files, or text.
 * @returns {Promise<{ files: string[], text: string | null, temporary: string | null }>}
 */
export async function readClipboard() {
  if (WIN) {
    const out = String(
      await powershell(`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
if ([Windows.Forms.Clipboard]::ContainsImage()) {
  $p = Join-Path $env:TEMP ('drawer-clipboard-' + [guid]::NewGuid() + '.png')
  [Windows.Forms.Clipboard]::GetImage().Save($p, [Drawing.Imaging.ImageFormat]::Png)
  'IMAGE ' + $p
} elseif ([Windows.Forms.Clipboard]::ContainsFileDropList()) {
  foreach ($f in [Windows.Forms.Clipboard]::GetFileDropList()) { 'FILE ' + $f }
} else {
  'TEXT ' + [Windows.Forms.Clipboard]::GetText()
}`),
    );
    return fromMarked(out);
  }
  const types = String(await (wayland() ? run('wl-paste', ['--list-types']) : run('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o'])).catch(() => ''));
  const image = types.split('\n').find((t) => /^image\/(png|jpeg)$/.test(t.trim()))?.trim();
  if (image) {
    const path = join(tmpdir(), `drawer-clipboard-${Date.now()}.${image === 'image/png' ? 'png' : 'jpg'}`);
    const bytes = await (wayland()
      ? run('wl-paste', ['--type', image], { encoding: 'buffer' })
      : run('xclip', ['-selection', 'clipboard', '-t', image, '-o'], { encoding: 'buffer' }));
    await writeFile(path, bytes);
    return { files: [path], text: null, temporary: path };
  }
  if (types.includes('text/uri-list')) {
    const list = String(await (wayland() ? run('wl-paste', ['--type', 'text/uri-list']) : run('xclip', ['-selection', 'clipboard', '-t', 'text/uri-list', '-o'])));
    const files = list.split(/\r?\n/).filter((l) => l.startsWith('file://')).map((l) => fileURLToPath(l.trim()));
    if (files.length) return { files, text: null, temporary: null };
  }
  const text = String(await (wayland() ? run('wl-paste', ['--no-newline']) : run('xclip', ['-selection', 'clipboard', '-o'])).catch(() => ''));
  return { files: [], text: text || null, temporary: null };
}

/** @param {string} out */
function fromMarked(out) {
  /** @type {{ files: string[], text: string | null, temporary: string | null }} */
  const result = { files: [], text: null, temporary: null };
  if (out.startsWith('TEXT ')) {
    result.text = out.slice(5).replace(/\r?\n$/, '') || null;
    return result;
  }
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('IMAGE ')) result.temporary = line.slice(6).trim();
    if (line.startsWith('IMAGE ') || line.startsWith('FILE ')) result.files.push(line.slice(line.indexOf(' ') + 1).trim());
  }
  return result;
}

/** @param {string} text */
export async function copyText(text, secret = false) {
  if (WIN) {
    if (!secret) return void (await powershell('Set-Clipboard -Value $env:DRAWER_CLIP', { DRAWER_CLIP: text }));
    // Something private: pasteable, but kept out of Win+V history and cloud clipboard sync.
    return void (await powershell(
      `Add-Type -AssemblyName System.Windows.Forms
$d = New-Object Windows.Forms.DataObject
$d.SetText($env:DRAWER_CLIP)
$no = New-Object IO.MemoryStream(,[byte[]](0,0,0,0))
$d.SetData('CanIncludeInClipboardHistory', $no)
$d.SetData('CanUploadToCloudClipboard', (New-Object IO.MemoryStream(,[byte[]](0,0,0,0))))
$d.SetData('ExcludeClipboardContentFromMonitorProcessing', (New-Object IO.MemoryStream(,[byte[]](0,0,0,0))))
[Windows.Forms.Clipboard]::SetDataObject($d, $true)`,
      { DRAWER_CLIP: text },
    ));
  }
  if (wayland()) {
    // --sensitive asks clipboard managers not to keep it (wl-clipboard 2.2+); older ones copy plainly.
    if (secret) {
      try {
        return void (await run('wl-copy', ['--sensitive'], { input: text }));
      } catch {
        /* an older wl-copy */
      }
    }
    return void (await run('wl-copy', [], { input: text }));
  }
  await run('xclip', ['-selection', 'clipboard', '-i'], { input: text });
}

/** An image goes on the clipboard as a picture; anything else as a file to paste into a folder or a chat. @param {string} path */
export async function copyFile(path, mime = '') {
  if (WIN) {
    await powershell(
      `Add-Type -AssemblyName System.Windows.Forms, System.Drawing
try { $i = [Drawing.Image]::FromFile($env:DRAWER_FILE); [Windows.Forms.Clipboard]::SetImage($i) }
catch { Set-Clipboard -Path $env:DRAWER_FILE }`,
      { DRAWER_FILE: path },
    );
    return;
  }
  const bytes = await readFile(path);
  const type = mime.startsWith('image/') ? mime : 'text/uri-list';
  const payload = type === 'text/uri-list' ? `file://${path}\n` : bytes;
  if (wayland()) await run('wl-copy', ['--type', type], { input: payload });
  else await run('xclip', ['-selection', 'clipboard', '-t', type, '-i'], { input: payload });
}

/**
 * A desktop notification; clicking it opens `link` where the system allows.
 * @param {string} title @param {string} body @param {string} [link]
 */
async function notify(title, body, link) {
  try {
    if (WIN) {
      await powershell(
        `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$e = { param($s) [Security.SecurityElement]::Escape($s) }
$launch = if ($env:DRAWER_LINK) { " activationType='protocol' launch='" + (& $e $env:DRAWER_LINK) + "'" } else { '' }
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml("<toast$launch><visual><binding template='ToastGeneric'><text>" + (& $e $env:DRAWER_TITLE) + "</text><text>" + (& $e $env:DRAWER_BODY) + "</text></binding></visual></toast>")
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))`,
        { DRAWER_TITLE: title, DRAWER_BODY: body, DRAWER_LINK: link ?? '' },
      );
    } else {
      await run('notify-send', ['--app-name=Drawer', '--icon=folder-documents', '--', title, body]);
    }
  } catch {
    console.log(`${title}: ${body}`);
  }
}

export function downloadsFolder() {
  const base = join(homedir(), 'Downloads');
  return join(existsSync(base) ? base : homedir(), 'Drawer');
}

// ------------------------------------------------------------------ commands

/** @param {string[]} args */
async function login(args) {
  const [url, token] = args;
  if (!url || !token) throw new Error('Usage: drawer login <url> <token>   (the token is made on Drawer’s Settings page)');
  const cfg = { url: url.replace(/\/+$/, '') + '/', token };
  const me = await (await api(cfg, 'api/me')).json();
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify({ ...cfg, device: me.device }, null, 2), { mode: 0o600 });
  if (!WIN) await chmod(CONFIG_FILE, 0o600);
  console.log(`This computer is the ${me.label} in the drawer. Next: drawer setup`);
}

/** @param {string[]} args */
async function send(args) {
  const cfg = await config();
  const opts = parseSend(args, (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  });
  let text = opts.words.join(' ').trim() || null;
  let files = opts.files;
  let temporary = null;
  if (!text && !files.length) {
    if (!process.stdin.isTTY && !opts.notify) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      text = Buffer.concat(chunks).toString('utf8').trim() || null;
    } else {
      const clip = await readClipboard();
      ({ files, text, temporary } = clip);
    }
  }
  if (!text && !files.length) {
    const message = 'Nothing to send: the clipboard is empty.';
    if (opts.notify) return notify('Drawer', message);
    throw new Error(message);
  }

  try {
    const { done, what, link } = await capture(cfg, { text, files, temporary, to: opts.to, private: opts.private });
    if (opts.notify) await notify(done, what, link);
    else console.log(what ? `${done}: ${what}` : done);
  } catch (error) {
    if (opts.notify) await notify('Not sent', /** @type {Error} */ (error).message);
    else throw error;
  } finally {
    if (temporary) await rm(temporary, { force: true });
  }
}

/**
 * Sends text and files to the drawer: kept, or on their way to another device.
 * @param {{ url: string, token: string }} cfg
 * @param {{ text: string | null, files: string[], temporary?: string | null, to?: string | null, private?: boolean }} what
 * @returns {Promise<{ done: string, what: string, link: string | undefined }>} what to tell the person
 */
export async function capture(cfg, { text, files, temporary = null, to = null, private: secret = false }) {
  const form = new FormData();
  if (text) form.set('text', text);
  for (const path of files) {
    const bytes = await readFile(path);
    const name = path === temporary ? screenshotName(new Date(), extname(path)) : basename(path);
    const type = /** @type {Record<string, string>} */ (MIME)[extname(name).toLowerCase()] ?? 'application/octet-stream';
    form.append('file', new Blob([bytes], { type }), name);
  }
  if (to) form.set('target', to);
  if (secret) form.set('private', 'true');
  const { results } = await (await api(cfg, 'api/capture', { method: 'POST', body: form })).json();
  const first = results[0]?.item;
  const done = to
    ? `Sent to ${/** @type {Record<string, string>} */ (DEVICE_WORDS)[to] ?? to}`
    : results.length > 1
      ? `Kept ${results.length} things`
      : results[0]?.outcome === 'bumped'
        ? 'Already in the drawer; moved to the top'
        : 'Kept';
  const shown = first ? (first.private ? 'Something private' : (first.label ?? first.title ?? '').slice(0, 80)) : '';
  return { done, what: shown, link: first ? new URL(`item/${first.id}`, cfg.url).href : undefined };
}

/** @param {string[]} args */
async function ask(args) {
  const cfg = await config();
  const question = args.join(' ').trim();
  if (!question) throw new Error('Usage: drawer ask <question>');
  const answer = await (await api(cfg, 'api/ask?format=text', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: question })).text();
  console.log(answer);
}

async function status() {
  const cfg = await config();
  const me = await (await api(cfg, 'api/me')).json();
  const health = await (await fetch(new URL('health', cfg.url))).json();
  const { items } = await (await api(cfg, `api/transit?pending`)).json();
  console.log(`${cfg.url}  ${health.items} things kept, librarian ${health.model ? 'on' : 'off (no key)'}`);
  console.log(`This computer: ${me.label}. Waiting here: ${items.length}.`);
}

/**
 * Delivers one card here, once: text and links to the clipboard, files to Downloads/Drawer.
 * @param {{ url: string, token: string }} cfg @param {any} card @param {string} me
 * @param {{ notify?: (title: string, body: string, link?: string) => unknown, copyText?: typeof copyText, copyFile?: typeof copyFile }} [via]
 */
export async function deliver(cfg, card, me, via = {}) {
  const tell = via.notify ?? notify;
  const putText = via.copyText ?? copyText;
  const putFile = via.copyFile ?? copyFile;
  const action = deliveryFor(card, me);
  if (action.kind === 'none') return false;
  const from = /** @type {Record<string, string>} */ (DEVICE_WORDS)[card.source] ?? card.source;
  const link = new URL(`item/${card.id}`, cfg.url).href;
  if (action.kind === 'text') {
    await putText(action.text, !!card.private);
    await tell(`From ${from}, copied`, card.private ? 'Something private. It is on the clipboard.' : action.text.slice(0, 140), link);
  } else {
    const folder = downloadsFolder();
    await mkdir(folder, { recursive: true });
    const name = freeName(action.name, (n) => existsSync(join(folder, n)));
    const path = join(folder, name);
    const response = await api(cfg, `file/${card.id}?download`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
    let copied = false;
    try {
      await putFile(path, card.file?.mime ?? '');
      copied = true;
    } catch {
      /* the file is saved either way */
    }
    await tell(`From ${from}${copied ? ', copied' : ''}`, `${card.private ? 'A private file' : name} is in Downloads${WIN ? '\\' : '/'}Drawer`, link);
  }
  await api(cfg, `api/items/${card.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delivered: true }),
  });
  return true;
}

async function listen() {
  const cfg = await config();
  console.log(`[drawer] listening for things sent to the ${DEVICE_WORDS[cfg.device] ?? cfg.device}`);
  await listenFor(cfg, (card) => deliver(cfg, card, cfg.device), {
    log: (message) => console.error(`[drawer] ${message}`),
  });
}

/**
 * Receives what other devices send here, until `signal` aborts: everything waiting first, then the live stream,
 * reconnecting with a growing pause. `handle` runs once per card meant for this device.
 * @param {{ url: string, token: string, device: string }} cfg
 * @param {(card: any) => Promise<unknown>} handle
 * @param {{ signal?: AbortSignal, log?: (message: string) => void, onState?: (state: 'live' | 'retrying') => void }} [options]
 */
export async function listenFor(cfg, handle, options = {}) {
  const me = cfg.device;
  const log = options.log ?? (() => {});
  const handled = new Set();
  let wait = 1000;
  /** @param {any} card */
  const take = async (card) => {
    if (options.signal?.aborted || handled.has(card.id)) return;
    if (deliveryFor(card, me).kind === 'none') return;
    handled.add(card.id);
    try {
      await handle(card);
    } catch (error) {
      handled.delete(card.id);
      log(`could not deliver ${card.id}: ${/** @type {Error} */ (error).message}`);
    }
  };
  while (!options.signal?.aborted) {
    const abort = new AbortController();
    const stop = () => abort.abort();
    options.signal?.addEventListener('abort', stop);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let idle;
    const quiet = () => {
      clearTimeout(idle);
      idle = setTimeout(() => abort.abort(), 70_000); // the server pings every 25 s
    };
    try {
      const response = await api(cfg, 'api/events', { headers: { accept: 'text/event-stream' }, signal: abort.signal });
      // Anything sent while this computer was off or asleep.
      const { items } = await (await api(cfg, 'api/transit?pending', { signal: abort.signal })).json();
      for (const card of items.reverse()) await take(card);
      if (options.signal?.aborted) return;
      wait = 1000;
      options.onState?.('live');
      quiet();
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (response.body))) {
        quiet();
        const parsed = parseSse(buffer + decoder.decode(chunk, { stream: true }));
        buffer = parsed.rest;
        for (const event of parsed.events) if (event.event === 'item') await take(JSON.parse(event.data));
      }
    } catch (error) {
      const message = /** @type {Error} */ (error).message;
      // The token was replaced or removed on the Settings page: retrying can't help.
      if (/^401\b/.test(message)) {
        log(`${message}; this device's token no longer works, so listening stops`);
        return;
      }
      if (!abort.signal.aborted) log(`${message}; trying again in ${wait / 1000}s`);
    } finally {
      clearTimeout(idle);
      options.signal?.removeEventListener('abort', stop);
    }
    if (options.signal?.aborted) return;
    options.onState?.('retrying');
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 30_000);
  }
}

async function setup() {
  await config();
  const node = process.execPath;
  const script = fileURLToPath(import.meta.url);
  if (WIN) {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    const programs = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const home = join(local, 'drawer');
    await mkdir(home, { recursive: true });
    // A command on the PATH (WindowsApps is on it by default).
    await writeFile(join(local, 'Microsoft', 'WindowsApps', 'drawer.cmd'), `@"${node}" "${script}" %*\r\n`);
    // Small launchers that run node without a console window.
    /** @param {string} name @param {string} args */
    const vbs = (name, args) =>
      writeFile(
        join(home, name),
        `CreateObject("WScript.Shell").Run """${node}"" ""${script}"" ${args}", 0, False\r\n`,
      );
    await vbs('listen.vbs', 'listen');
    await vbs('keep.vbs', 'send --notify');
    await vbs('phone.vbs', 'send --notify --to iphone');
    await writeFile(join(programs, 'Startup', 'Drawer listen.vbs'), `CreateObject("WScript.Shell").Run "wscript.exe ""${join(home, 'listen.vbs')}""", 0, False\r\n`);
    // Hotkeys: Windows gives them to Start menu shortcuts.
    await mkdir(join(programs, 'Drawer'), { recursive: true });
    await powershell(
      `$s = New-Object -ComObject WScript.Shell
foreach ($k in @(@('Drawer keep clipboard', 'keep.vbs', 'CTRL+ALT+D'), @('Drawer send clipboard to iPhone', 'phone.vbs', 'CTRL+ALT+P'))) {
  $l = $s.CreateShortcut((Join-Path $env:DRAWER_PROGRAMS ($k[0] + '.lnk')))
  $l.TargetPath = 'wscript.exe'
  $l.Arguments = '"' + (Join-Path $env:DRAWER_HOME $k[1]) + '"'
  $l.Hotkey = $k[2]
  $l.Save()
}`,
      { DRAWER_PROGRAMS: join(programs, 'Drawer'), DRAWER_HOME: home },
    );
    spawn('wscript.exe', [join(home, 'listen.vbs')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    console.log('Done. `drawer` works in any new terminal; listen runs now and at every login.');
    console.log('Hotkeys: Ctrl+Alt+D keeps what is on the clipboard, Ctrl+Alt+P sends it to the iPhone');
    console.log('(they start working within a minute, or after signing out and in).');
    return;
  }
  // Linux (GNOME): a command in ~/.local/bin, an autostart entry, two custom shortcuts.
  const bin = join(homedir(), '.local', 'bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'drawer'), `#!/bin/sh\nexec "${node}" "${script}" "$@"\n`, { mode: 0o755 });
  const autostart = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'autostart');
  await mkdir(autostart, { recursive: true });
  await writeFile(
    join(autostart, 'drawer-listen.desktop'),
    `[Desktop Entry]\nType=Application\nName=Drawer listen\nComment=Things sent from the other devices land on the clipboard\nExec="${node}" "${script}" listen\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`,
  );
  const base = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings';
  const keys = [
    { id: 'drawer-keep', name: 'Drawer: keep the clipboard', command: `"${node}" "${script}" send --notify`, binding: '<Control><Alt>d' },
    { id: 'drawer-phone', name: 'Drawer: send the clipboard to the iPhone', command: `"${node}" "${script}" send --notify --to iphone`, binding: '<Control><Alt>p' },
  ];
  try {
    const schema = 'org.gnome.settings-daemon.plugins.media-keys';
    const current = String(await run('gsettings', ['get', schema, 'custom-keybindings']));
    await run('gsettings', ['set', schema, 'custom-keybindings', withKeybindings(current, keys.map((k) => `${base}/${k.id}/`))]);
    for (const k of keys) {
      const at = `${schema}.custom-keybinding:${base}/${k.id}/`;
      await run('gsettings', ['set', at, 'name', k.name]);
      await run('gsettings', ['set', at, 'command', k.command]);
      await run('gsettings', ['set', at, 'binding', k.binding]);
    }
    console.log('Hotkeys: Ctrl+Alt+D keeps what is on the clipboard, Ctrl+Alt+P sends it to the iPhone.');
  } catch {
    console.log('No GNOME here: bind `drawer send --notify` to a key in your desktop’s keyboard settings.');
  }
  spawn(node, [script, 'listen'], { detached: true, stdio: 'ignore' }).unref();
  if (wayland()) {
    await run('wl-copy', ['--version']).catch(() => console.log('Install the clipboard tools first: sudo dnf install wl-clipboard'));
  }
  console.log('Done. `drawer` is in ~/.local/bin; listen runs now and at every login.');
}

const COMMANDS = { login, send, ask, listen, setup, status };

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const run = command ? /** @type {Record<string, (args: string[]) => Promise<unknown>>} */ (COMMANDS)[command] : undefined;
  if (!run) {
    const usage = (await readFile(fileURLToPath(import.meta.url), 'utf8')).split('\n').slice(1, 13);
    console.log(usage.map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(command ? 2 : 0);
  }
  await run(args);
}

/** Run as a command, not imported (by the desktop app, whose argv[1] can be a flag or nothing). */
function invokedDirectly() {
  if (process.versions.electron || !process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((error) => {
    console.error(`drawer: ${error.message}`);
    process.exit(1);
  });
}
