// The small bridge between the page and the main process.
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('charm', {
    setInteractive: on => ipcRenderer.send('interactive', on),
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    saveSettings: s => ipcRenderer.send('save-settings', s),
    onCommand: fn => ipcRenderer.on('command', (_e, c) => fn(c)),
    onResized: fn => ipcRenderer.on('resized', (_e, size) => fn(size)),
    test: {
        input: ev => ipcRenderer.send('test-input', ev),
        log: line => ipcRenderer.send('test-log', line),
        shot: (name, dataUrl) => ipcRenderer.send('test-shot', name, dataUrl),
        done: () => ipcRenderer.send('test-done'),
    },
});
