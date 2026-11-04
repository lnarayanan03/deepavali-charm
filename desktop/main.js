// Deepavali Charm for Windows and macOS: a transparent, always-on-top, click-through
// window across the screen with the lamp hanging from the top edge. Only the lamp
// itself catches the mouse; everything else clicks straight through to your apps.

const {app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell} = require('electron');
const fs = require('fs');
const path = require('path');

const testDir = (process.argv.find(a => a.startsWith('--test=')) || '').slice(7);
const iconOut = (process.argv.find(a => a.startsWith('--make-icon=')) || '').slice(12);
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
// your own voice clips for the Dragon Ball show (goku-kamehameha.wav and friends)
const voicesDir = () => path.join(app.getPath('userData'), 'voices');

let win = null;
let tray = null;

if (!testDir && !iconOut && !app.requestSingleInstanceLock())
    app.quit();

function loadSettings() {
    try {
        return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    } catch {
        return {};
    }
}

function fitToScreen() {
    const wa = screen.getPrimaryDisplay().workArea;
    win.setBounds(wa);
    win.webContents.send('resized', {width: wa.width, height: wa.height});
}

function createWindow() {
    const wa = screen.getPrimaryDisplay().workArea;
    win = new BrowserWindow({
        ...wa,
        transparent: true,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        focusable: false,          // clicking the lamp never steals focus from your app
        alwaysOnTop: true,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false,
        },
    });
    win.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin')
        win.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});
    // clicks pass through until the pointer is over the lamp (the page tells us)
    win.setIgnoreMouseEvents(true, {forward: true});
    win.loadFile('index.html', {query: {test: testDir ? '1' : '', icon: iconOut ? '1' : ''}});
    win.once('ready-to-show', () => win.showInactive());
    screen.on('display-metrics-changed', fitToScreen);
    screen.on('display-added', fitToScreen);
    screen.on('display-removed', fitToScreen);
}

function createTray() {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
    tray = new Tray(icon.isEmpty() ? icon : icon.resize({width: process.platform === 'darwin' ? 18 : 16}));
    tray.setToolTip('Deepavali Charm');
    const startAtLogin = app.getLoginItemSettings().openAtLogin;
    tray.setContextMenu(Menu.buildFromTemplate([
        {label: 'Shower petals', click: () => win.webContents.send('command', 'shower')},
        {label: 'Light crackers', click: () => win.webContents.send('command', 'crackers')},
        {label: 'Summon the dragon', click: () => win.webContents.send('command', 'dragon')},
        {label: 'Open voices folder', click: () => {
            fs.mkdirSync(voicesDir(), {recursive: true});
            shell.openPath(voicesDir());
        }},
        {label: 'Ring the bell', click: () => win.webContents.send('command', 'chime')},
        {label: 'Reset chain length', click: () => win.webContents.send('command', 'reset')},
        {label: 'Sound', type: 'checkbox', checked: loadSettings().sound !== false,
            click: item => win.webContents.send('command', item.checked ? 'sound-on' : 'sound-off')},
        {type: 'separator'},
        {label: 'Start at login', type: 'checkbox', checked: startAtLogin,
            click: item => app.setLoginItemSettings({openAtLogin: item.checked})},
        {label: 'Quit', click: () => app.quit()},
    ]));
}

ipcMain.on('interactive', (_e, on) => {
    win?.setIgnoreMouseEvents(!on, {forward: true});
});
// voice clips you've added, as data URLs; in the app's own voices/ folder too, for development
ipcMain.handle('load-voices', () => {
    const out = {};
    for (const dir of [path.join(__dirname, 'voices'), voicesDir()]) {
        try {
            for (const f of fs.readdirSync(dir)) {
                const m = f.match(/^(goku-[a-z]+)\.(wav|mp3|ogg)$/);
                if (m) {
                    const type = m[2] === 'mp3' ? 'mpeg' : m[2];
                    out[m[1]] = `data:audio/${type};base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`;
                }
            }
        } catch {}
    }
    return out;
});
// test runs start from the defaults and never touch the user's saved settings
ipcMain.handle('load-settings', () => (testDir ? {} : loadSettings()));
ipcMain.on('save-settings', (_e, s) => {
    if (testDir)
        return;
    try {
        fs.mkdirSync(path.dirname(settingsFile()), {recursive: true});
        fs.writeFileSync(settingsFile(), JSON.stringify({...loadSettings(), ...s}));
    } catch (err) {
        console.warn(`deepavali-charm: could not save settings: ${err}`);
    }
});

// ----- self test and icon export (used during development) -----
ipcMain.on('test-input', (_e, ev) => win.webContents.sendInputEvent(ev));
ipcMain.on('test-log', (_e, line) => console.log(`deepavali-charm test ${line}`));
ipcMain.on('test-shot', (_e, name, dataUrl) => {
    const out = name === '@icon' ? iconOut : path.join(testDir, `${name}.png`);
    fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
});
ipcMain.on('test-done', () => app.quit());

app.whenReady().then(() => {
    if (process.platform === 'darwin')
        app.dock?.hide();
    createWindow();
    if (!testDir && !iconOut)
        createTray();
});
app.on('window-all-closed', () => app.quit());
