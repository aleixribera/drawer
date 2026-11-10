// The bridge between the window's page and the app. Drawer's own pages get `drawerDesktop` (the Settings page uses it to
// connect the app); the address form, a local file, gets `drawerSetup`. Any other page gets nothing.
const { contextBridge, ipcRenderer } = require('electron');

const hello = ipcRenderer.sendSync('drawer:hello');
const here = location.protocol === 'file:' ? 'setup' : hello.origin && location.origin === hello.origin ? 'drawer' : null;

if (here === 'drawer') {
  contextBridge.exposeInMainWorld('drawerDesktop', {
    device: hello.device,
    version: hello.version,
    connected: () => ipcRenderer.invoke('drawer:connected'),
    connect: (token) => ipcRenderer.invoke('drawer:connect', String(token)),
    // The tray menu's actions, for desktops without a tray (stock GNOME).
    info: () => ipcRenderer.invoke('drawer:app-info'),
    act: (action) => ipcRenderer.invoke('drawer:app', String(action)),
  });
}

if (here === 'setup') {
  contextBridge.exposeInMainWorld('drawerSetup', {
    version: hello.version,
    info: () => ipcRenderer.invoke('drawer:setup-info'),
    setUrl: (url) => ipcRenderer.invoke('drawer:set-url', String(url)),
    retry: () => ipcRenderer.invoke('drawer:retry'),
  });
}
