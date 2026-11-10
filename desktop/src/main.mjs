// Drawer for Windows and Linux: the self-hosted Drawer in its own window, plus what a browser tab can't do. It stays
// in the tray, receives what other devices send to this computer (onto the clipboard, files into Downloads/Drawer),
// keeps the clipboard with Ctrl+Alt+D, sends it to the phone with Ctrl+Alt+P, starts with the computer and updates
// itself from GitHub Releases.
//
// It shares its clipboard, capture and delivery code with the command-line companion (companion/drawer.mjs, copied
// into src/ by `npm run companion`).

import { app, BrowserWindow, ClipboardItem, Menu, Notification, Tray, clipboard, globalShortcut, ipcMain, nativeImage, nativeTheme, powerMonitor, shell } from 'electron';
import updater from 'electron-updater';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as companion from './companion.mjs';

const { autoUpdater } = updater;
const WIN = process.platform === 'win32';
const LINUX = process.platform === 'linux';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const ICON = join(HERE, 'assets', 'icon.png');
const SETUP = join(HERE, 'setup.html');
const SETUP_URL = pathToFileURL(SETUP).href;
/** What Drawer's pages may ask for: the microphone (voice on the Ask page), the clipboard, notifications. */
const PERMISSIONS = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen']);
/** The device this computer is in the drawer: Drawer knows a PC and a laptop. */
const DEVICE = LINUX ? 'fedora' : 'pc';
const LABEL = DEVICE === 'fedora' ? 'Laptop' : 'PC';
const KEEP = 'Control+Alt+D';
const PHONE = 'Control+Alt+P';
const HOUR = 3_600_000;

// ------------------------------------------------------------------ settings

/** @type {{ url?: string, token?: string, startAtLogin?: boolean }} */
let config = {};
const configFile = () => join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    config = JSON.parse(readFileSync(configFile(), 'utf8'));
  } catch {
    config = {};
  }
}

function saveConfig() {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

const origin = () => (config.url ? new URL(config.url).origin : null);
const connected = () => !!(config.url && config.token);
const cfg = () => ({ url: /** @type {string} */ (config.url), token: /** @type {string} */ (config.token), device: DEVICE });

/** "box.tail.ts.net", "https://box.tail.ts.net/settings" → "https://box.tail.ts.net/" */
function normalUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) throw new Error('Type the address you open Drawer at.');
  // A bare name is a Tailscale address (https); a bare localhost or LAN address is plain http.
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(text);
  const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `${local ? 'http' : 'https'}://${text}`);
  if (!/^https?:$/.test(url.protocol)) throw new Error('The address starts with https://');
  return `${url.origin}/`;
}

// ------------------------------------------------------------------ the window

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;
let live = false;
/** @type {import('electron-updater').UpdateInfo | null} */
let updateReady = null;
/** @type {string | null} */
let loadError = null;

/** The address form, and nothing else on disk: files received from other devices are local files too. */
const isSetup = (url) => String(url ?? '').split(/[?#]/)[0] === SETUP_URL;

const ours = (url) => {
  try {
    return isSetup(url) || new URL(url).origin === origin();
  } catch {
    return false;
  }
};

function openOutside(url) {
  try {
    if (['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)) void shell.openExternal(url);
  } catch {
    /* not a link */
  }
}

function createWindow(show) {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'Drawer',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0c' : '#f4f3f1', // Drawer's ground, so no flash before it paints
    webPreferences: { preload: join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
  });
  win.on('hide', () => installWaitingUpdate());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ours(url) && !isSetup(url)) win?.loadURL(url);
    else openOutside(url);
    return { action: 'deny' };
  });
  const stayHome = (event, url) => {
    if (ours(url)) return;
    event.preventDefault();
    openOutside(url);
  };
  win.webContents.on('will-navigate', stayHome);
  win.webContents.on('will-redirect', stayHome);
  const allowed = (permission, url) => PERMISSIONS.has(permission) && origin() !== null && ours(url) && !isSetup(url);
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(allowed(permission, contents.getURL())));
  win.webContents.session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => allowed(permission, requestingOrigin));
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || url.startsWith('file:')) return; // -3: replaced by another navigation
    loadError = `Drawer didn't answer at ${origin()} (${description}).`;
    void win?.loadFile(SETUP);
  });
  if (show) win.once('ready-to-show', () => win?.show());
  loadDrawer();
}

/** Drawer itself, its Settings page until this app is connected, or the address form. */
function loadDrawer(path = '') {
  if (!win) return;
  loadError = null;
  if (!config.url) void win.loadFile(SETUP);
  else void win.loadURL(new URL(path || (config.token ? '' : 'settings'), config.url).href);
}

function showWindow(link) {
  if (!win || win.isDestroyed()) createWindow(true);
  if (link && ours(link)) void win?.loadURL(link);
  // Drawer didn't answer earlier (Tailscale was still starting at login): try again rather than show the old error.
  else if (loadError && config.url) loadDrawer();
  win?.show();
  if (win?.isMinimized()) win.restore();
  win?.focus();
}

// ------------------------------------------------------------------ the clipboard

const WAYLAND = LINUX && !!process.env.WAYLAND_DISPLAY;

/** @type {Promise<boolean> | null} */
let wlClipboard = null;
/** Whether wl-clipboard is installed (`sudo dnf install wl-clipboard`); without it Electron reads the clipboard. */
const haveWlClipboard = () => (wlClipboard ??= run('wl-paste', ['--version']).then(() => true, () => false));

/**
 * What is on the clipboard: copied files, a picture (as a temporary PNG), or text. Electron's clipboard is the
 * asynchronous one from Electron 45 on: `read()` gives the formats as MIME types, files as a text/uri-list.
 * @returns {Promise<{ files: string[], text: string | null, temporary: string | null }>}
 */
async function readClipboard() {
  // Wayland hands the clipboard only to the focused window, and a hotkey leaves the focus elsewhere: wl-paste can.
  if (WAYLAND && (await haveWlClipboard())) return companion.readClipboard();
  const [item] = await clipboard.read();
  const types = item?.types ?? [];
  if (types.includes('text/uri-list')) {
    const list = await (await item.getType('text/uri-list')).text();
    const files = list
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('file://'))
      .map((line) => fileURLToPath(line));
    if (files.length) return { files, text: null, temporary: null };
  }
  const image = types.find((t) => /^image\/(png|jpeg|webp|gif)$/.test(t));
  if (image) {
    const ext = image === 'image/jpeg' ? 'jpg' : image.slice(6);
    const path = join(tmpdir(), `drawer-clipboard-${Date.now()}.${ext}`);
    writeFileSync(path, Buffer.from(await (await item.getType(image)).arrayBuffer()));
    return { files: [path], text: null, temporary: path };
  }
  const text = types.includes('text/plain') ? await clipboard.readText() : '';
  return { files: [], text: text || null, temporary: null };
}

/** Text arriving from another device. Private text stays out of clipboard history where the system allows. */
async function putText(text, secret = false) {
  if ((WIN && secret) || WAYLAND) {
    try {
      return await companion.copyText(text, secret);
    } catch {
      /* fall back to Electron's clipboard */
    }
  }
  await clipboard.writeText(text);
}

/** A file arriving: a picture goes on the clipboard as a picture, anything else as a file to paste into a folder. */
async function putFile(path, mime = '') {
  if (mime.startsWith('image/') && !WAYLAND) {
    const image = nativeImage.createFromPath(path); // JPEG and the rest go on as PNG, which every app pastes
    if (!image.isEmpty()) {
      return clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]);
    }
  }
  return companion.copyFile(path, mime);
}

// ------------------------------------------------------------------ notifications

const shown = new Set(); // a notification nobody holds on to can be collected before it's clicked

function notify(title, body = '', link) {
  console.log(`[drawer] ${title}${body ? `: ${body}` : ''}`);
  if (!Notification.isSupported()) return;
  const note = new Notification({ title, body, icon: ICON });
  shown.add(note);
  note.on('click', () => showWindow(link));
  note.on('close', () => shown.delete(note));
  setTimeout(() => shown.delete(note), 10 * 60_000);
  note.show();
}

// ------------------------------------------------------------------ keep and send

let busy = false;
/** Sends and deliveries under way: an update waits for them. */
let inFlight = 0;

/** @template T @param {() => Promise<T>} work */
async function tracked(work) {
  inFlight++;
  try {
    return await work();
  } finally {
    inFlight--;
  }
}

/** @param {number} ms @param {string} what @returns {Promise<never>} */
const tooLong = (ms, what) => new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took too long.`)), ms));

/** @param {'keep' | 'phone'} what */
async function send(what) {
  if (!connected()) return showWindow();
  if (busy) return;
  busy = true;
  inFlight++;
  /** @type {{ files: string[], text: string | null, temporary: string | null } | null} */
  let clip = null;
  try {
    // The app that owns the clipboard can fail to answer; the hotkeys must not stay stuck behind it.
    clip = await Promise.race([readClipboard(), tooLong(20_000, 'Reading the clipboard')]);
    if (!clip.text && !clip.files.length) return notify('Nothing to send', 'The clipboard is empty.');
    const done = await companion.capture(cfg(), { ...clip, to: what === 'phone' ? 'iphone' : null });
    notify(done.done, done.what, done.link);
  } catch (error) {
    notify('Not sent', /** @type {Error} */ (error).message);
  } finally {
    if (clip?.temporary) rmSync(clip.temporary, { force: true });
    busy = false;
    inFlight--;
  }
}

/** --keep and --to-phone: how GNOME's shortcuts reach the running app. */
const commandIn = (argv) => (argv.includes('--keep') ? 'keep' : argv.includes('--to-phone') ? 'phone' : null);

// ------------------------------------------------------------------ receiving

/** @type {AbortController | null} */
let listening = null;

function listen() {
  listening?.abort();
  listening = null;
  live = false;
  if (!connected()) return refreshTray();
  const controller = new AbortController();
  listening = controller;
  const here = cfg();
  const deliver = (card) => tracked(() => companion.deliver(here, card, DEVICE, { notify, copyText: putText, copyFile: putFile }));
  void companion.listenFor(here, deliver, {
    signal: controller.signal,
    log: (message) => {
      console.warn(`[drawer] ${message}`);
      if (/^401\b/.test(message)) disconnected();
    },
    onState: (state) => {
      live = state === 'live';
      if (live && loadError && win && !win.isDestroyed()) loadDrawer(); // Drawer answers again: leave the error page
      refreshTray();
    },
  });
  refreshTray();
}

/** The token was revoked or replaced on the Settings page. */
function disconnected() {
  listening?.abort();
  listening = null;
  live = false;
  delete config.token;
  saveConfig();
  bindHotkeys();
  refreshTray();
  notify('Drawer is not connected', `This ${LABEL}'s token was replaced or removed. Open Drawer to connect again.`);
}

// ------------------------------------------------------------------ hotkeys

const gnome = () => LINUX && /GNOME/i.test(process.env.XDG_CURRENT_DESKTOP ?? '');

/** How a shortcut or autostart entry starts this app. */
function launcher() {
  if (process.env.APPIMAGE) return `"${process.env.APPIMAGE}"`;
  return app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`;
}

const run = (file, args) =>
  new Promise((resolve, reject) => execFile(file, args, { windowsHide: true }, (error, out) => (error ? reject(error) : resolve(String(out)))));

function bindHotkeys() {
  globalShortcut.unregisterAll();
  if (!connected()) return;
  // GNOME doesn't hand global keys to apps on Wayland; its own custom shortcuts start this app with a flag instead,
  // and the running app picks the flag up.
  if (gnome()) return void gnomeShortcuts().catch((error) => console.warn(`[drawer] GNOME shortcuts: ${error.message}`));
  registerHotkeys(0);
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let hotkeyRetry;

/** Windows can hold on to the command-line companion's old shortcuts for a minute after they're removed: try again. */
function registerHotkeys(attempt) {
  clearTimeout(hotkeyRetry);
  if (!connected()) return;
  const keep = globalShortcut.isRegistered(KEEP) || globalShortcut.register(KEEP, () => void send('keep'));
  const phone = globalShortcut.isRegistered(PHONE) || globalShortcut.register(PHONE, () => void send('phone'));
  if (keep && phone) return;
  if (attempt < 4) hotkeyRetry = setTimeout(() => registerHotkeys(attempt + 1), 20_000);
  else notify('A hotkey is taken', 'Another app uses Ctrl+Alt+D or Ctrl+Alt+P. The tray menu and Settings do the same.');
}

async function gnomeShortcuts() {
  const schema = 'org.gnome.settings-daemon.plugins.media-keys';
  const base = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings';
  const keys = [
    { id: 'drawer-keep', name: 'Drawer: keep the clipboard', command: `${launcher()} --keep`, binding: '<Control><Alt>d' },
    { id: 'drawer-phone', name: 'Drawer: send the clipboard to the phone', command: `${launcher()} --to-phone`, binding: '<Control><Alt>p' },
  ];
  const current = await run('gsettings', ['get', schema, 'custom-keybindings']);
  await run('gsettings', ['set', schema, 'custom-keybindings', companion.withKeybindings(current, keys.map((k) => `${base}/${k.id}/`))]);
  for (const k of keys) {
    const at = `${schema}.custom-keybinding:${base}/${k.id}/`;
    await run('gsettings', ['set', at, 'name', k.name]);
    await run('gsettings', ['set', at, 'command', k.command]);
    await run('gsettings', ['set', at, 'binding', k.binding]);
  }
}

// ------------------------------------------------------------------ starting with the computer

const autostartFile = () => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'autostart', 'drawer.desktop');

function startsAtLogin() {
  if (WIN) return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  if (LINUX) return existsSync(autostartFile());
  return false;
}

function setStartAtLogin(on) {
  config.startAtLogin = on;
  saveConfig();
  if (!app.isPackaged) return refreshTray(); // a development run never registers itself
  if (WIN) app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  if (LINUX) {
    if (!on) rmSync(autostartFile(), { force: true });
    else {
      mkdirSync(join(autostartFile(), '..'), { recursive: true });
      writeFileSync(autostartFile(), desktopEntry('--hidden', true));
    }
  }
  refreshTray();
}

function desktopEntry(args = '', hidden = false) {
  const icon = join(app.getPath('userData'), 'drawer.png');
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Drawer',
    'Comment=Your self-hosted drawer: keep things, ask for them, send them between devices',
    `Exec=${launcher()}${args ? ` ${args}` : ''}`,
    `Icon=${icon}`,
    'Categories=Utility;',
    'StartupWMClass=Drawer',
    ...(hidden ? ['NoDisplay=true', 'X-GNOME-Autostart-enabled=true'] : []),
    '',
  ].join('\n');
}

/** An AppImage isn't in the app list until something puts it there; this does, at its current path. */
function linuxIntegration() {
  if (!LINUX || !process.env.APPIMAGE) return;
  try {
    copyFileSync(ICON, join(app.getPath('userData'), 'drawer.png'));
    const applications = join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'applications');
    mkdirSync(applications, { recursive: true });
    writeFileSync(join(applications, 'io.github.aleixribera.drawer.desktop'), desktopEntry());
    if (existsSync(autostartFile())) writeFileSync(autostartFile(), desktopEntry('--hidden', true));
  } catch (error) {
    console.warn(`[drawer] desktop entry: ${/** @type {Error} */ (error).message}`);
  }
}

/** The command-line companion's own login items, if it was set up here before: the app does their job now. */
function retireCompanion() {
  const gone = [];
  if (WIN) {
    const programs = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const home = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'drawer');
    // Its login item and hotkey shortcuts, and the launchers they ran. A companion still running loses its stream
    // when this app's token replaces its own, and stops.
    const launchers = ['listen.vbs', 'keep.vbs', 'phone.vbs'].map((name) => join(home, name));
    for (const path of [join(programs, 'Startup', 'Drawer listen.vbs'), join(programs, 'Drawer'), ...launchers]) {
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
        gone.push(path);
      }
    }
  }
  if (LINUX) {
    const path = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'autostart', 'drawer-listen.desktop');
    if (existsSync(path)) {
      rmSync(path, { force: true });
      gone.push(path);
    }
  }
  if (gone.length) console.log(`[drawer] retired the companion's login items: ${gone.join(', ')}`);
}

// ------------------------------------------------------------------ updates

function checkForUpdates(byHand = false) {
  if (!app.isPackaged) return;
  autoUpdater
    .checkForUpdates()
    .then((result) => {
      if (byHand && !result?.isUpdateAvailable) notify('Drawer is up to date', `Version ${app.getVersion()}`);
    })
    .catch((error) => {
      if (byHand) notify('Could not check for updates', /** @type {Error} */ (error).message);
    });
}

/**
 * An update installs quietly and starts the app again in the tray, once nothing is in the way: the window is closed,
 * nothing is being sent or received, and the computer has been idle for two minutes (so a page left half-edited in the
 * hidden window, or a hotkey about to be pressed, isn't cut off). Checked again every five minutes until then.
 */
function installWaitingUpdate() {
  if (!updateReady || inFlight > 0 || busy) return;
  if (win && !win.isDestroyed() && win.isVisible()) return;
  if (powerMonitor.getSystemIdleTime() < 120) return;
  quitting = true;
  autoUpdater.quitAndInstall(true, true);
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
/** @type {ReturnType<typeof setInterval> | undefined} */
let installTimer;
autoUpdater.on('update-downloaded', (info) => {
  updateReady = info;
  refreshTray();
  installWaitingUpdate();
  installTimer ??= setInterval(installWaitingUpdate, 5 * 60_000);
});
autoUpdater.on('error', (error) => console.warn(`[drawer] update: ${error.message}`));

// ------------------------------------------------------------------ the tray

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(
    !config.url
      ? 'Drawer: not set up'
      : !config.token
        ? 'Drawer: not connected'
        : live
          ? `Drawer: receiving as the ${LABEL}`
          : 'Drawer: reconnecting…',
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Drawer', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Keep the clipboard', accelerator: KEEP, registerAccelerator: false, enabled: connected(), click: () => void send('keep') },
      { label: 'Send the clipboard to the phone', accelerator: PHONE, registerAccelerator: false, enabled: connected(), click: () => void send('phone') },
      { type: 'separator' },
      { label: 'Start with the computer', type: 'checkbox', checked: startsAtLogin(), enabled: app.isPackaged, click: (item) => setStartAtLogin(item.checked) },
      updateReady
        ? { label: `Restart to update to ${updateReady.version}`, click: () => ((quitting = true), autoUpdater.quitAndInstall(true, true)) }
        : { label: 'Check for updates', enabled: app.isPackaged, click: () => checkForUpdates(true) },
      { label: 'Change Drawer’s address…', click: () => (showWindow(), void win?.loadFile(SETUP)) },
      { type: 'separator' },
      { label: `Drawer ${app.getVersion()}`, enabled: false },
      { label: 'Quit Drawer', click: () => ((quitting = true), app.quit()) },
    ]),
  );
}

function createTray() {
  const image = nativeImage.createFromPath(join(HERE, 'assets', 'tray.png')).resize({ width: WIN ? 16 : 22, quality: 'best' });
  tray = new Tray(image);
  tray.on('click', () => showWindow());
  refreshTray();
}

// ------------------------------------------------------------------ the pages' bridge

/** The window's page, if it is Drawer itself (not a page it linked to). */
const fromDrawer = (event) => !!event.senderFrame && origin() !== null && new URL(event.senderFrame.url).origin === origin();
const fromSetup = (event) => !!event.senderFrame && isSetup(event.senderFrame.url);

ipcMain.on('drawer:hello', (event) => {
  event.returnValue = { origin: origin(), device: DEVICE, version: app.getVersion() };
});

ipcMain.handle('drawer:connected', (event) => fromDrawer(event) && connected());

ipcMain.handle('drawer:connect', async (event, token) => {
  if (!fromDrawer(event) || typeof token !== 'string' || !token.startsWith('drw_')) return false;
  try {
    const me = await (await companion.api({ url: /** @type {string} */ (config.url), token }, 'api/me')).json();
    if (me.device !== DEVICE) return false;
  } catch {
    return false;
  }
  const first = config.startAtLogin === undefined;
  config.token = token;
  saveConfig();
  retireCompanion();
  if (first) setStartAtLogin(true);
  bindHotkeys();
  listen();
  notify(`Connected as the ${LABEL}`, 'Things sent here land on the clipboard. Ctrl+Alt+D keeps the clipboard, Ctrl+Alt+P sends it to the phone.');
  return true;
});

/** What the tray menu offers, for Drawer's Settings page: stock GNOME shows no tray icons without an extension. */
const appInfo = () => ({ startAtLogin: startsAtLogin(), packaged: app.isPackaged, update: updateReady?.version ?? null });

ipcMain.handle('drawer:app-info', (event) => (fromDrawer(event) ? appInfo() : null));

ipcMain.handle('drawer:app', (event, action) => {
  if (!fromDrawer(event)) return null;
  if (action === 'start-at-login' || action === 'no-start-at-login') setStartAtLogin(action === 'start-at-login');
  else if (action === 'check-updates') checkForUpdates(true);
  else if (action === 'install-update' && updateReady) {
    quitting = true;
    autoUpdater.quitAndInstall(true, true);
  } else if (action === 'change-address') void win?.loadFile(SETUP);
  else if (action === 'quit') {
    quitting = true;
    app.quit();
  }
  return appInfo();
});

ipcMain.handle('drawer:setup-info', (event) => (fromSetup(event) ? { url: config.url ?? '', error: loadError } : null));

ipcMain.handle('drawer:set-url', async (event, input) => {
  if (!fromSetup(event)) return { ok: false, message: 'Not allowed.' };
  let url;
  try {
    url = normalUrl(input);
  } catch (error) {
    return { ok: false, message: /** @type {Error} */ (error).message };
  }
  try {
    const response = await fetch(new URL('health', url), { signal: AbortSignal.timeout(8000) });
    const health = await response.json().catch(() => null);
    if (!response.ok || typeof health?.items !== 'number') throw new Error(`${url} answers, but it isn't a Drawer.`);
  } catch (error) {
    const message = /** @type {Error} */ (error).message;
    return { ok: false, message: /isn't a Drawer/.test(message) ? message : `Nothing answered at ${url}. Is this computer on Tailscale, and Drawer running?` };
  }
  if (origin() !== new URL(url).origin) {
    delete config.token; // a token belongs to one drawer
    listening?.abort();
  }
  config.url = url;
  saveConfig();
  bindHotkeys();
  listen();
  loadDrawer();
  return { ok: true };
});

ipcMain.handle('drawer:retry', (event) => {
  if (fromSetup(event) && config.url) loadDrawer();
});

// ------------------------------------------------------------------ start

// Windows' installer restarts an updated app with --updated; Linux's AppImage updater sets APPIMAGE_SILENT_INSTALL.
const hidden = process.argv.includes('--hidden') || process.argv.includes('--updated') || process.env.APPIMAGE_SILENT_INSTALL === 'true';
delete process.env.APPIMAGE_SILENT_INSTALL; // not for programs this app starts

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const command = commandIn(argv);
    if (command) void send(command);
    else showWindow();
  });
  // Closing the window keeps Drawer in the tray; quitting is in the tray menu.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.whenReady().then(() => {
    if (WIN) app.setAppUserModelId('io.github.aleixribera.drawer');
    loadConfig();
    Menu.setApplicationMenu(null);
    createTray();
    createWindow(!hidden || !connected());
    linuxIntegration();
    bindHotkeys();
    listen();
    const command = commandIn(process.argv);
    if (command) void send(command);
    checkForUpdates();
    setInterval(() => checkForUpdates(), 6 * HOUR).unref();
  });
}
