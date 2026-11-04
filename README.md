# Deepavali Charm

A brass hanging lamp (thooku vilakku) on a marigold, jasmine and mango-leaf garland that hangs from the top of your screen. Five spouts sit evenly round the rim, the main one at the front, each with an oil-lamp flame that flickers, sways and trails behind the lamp as it swings.

Runs on **Linux (GNOME Shell extension)**, **Windows** and **macOS** (desktop app). Both draw the same lamp from the shared `draw.js`.

## Using it

- **Drag** the lamp to swing it. Drag it down (or up) to stretch the chain like a rubber band; let go and it springs back.
- **Ctrl+drag** (or **Cmd+drag** on a Mac) to set a new chain length. It stays and is remembered.
- **Click** it for a shower of marigold, rose and jasmine petals.
- **Press and hold** it: a gust of wind blows the flames out, leaving smoke. Five seconds later they catch again one by one.
- Swing it hard and oil spills from the spouts.
- Wind chimes play a short tune when you touch it, and knock as it swings.
- Drag the little gold hook to move where it hangs.
- On GNOME it also swings when you switch workspaces or open the overview.

## Linux (GNOME 45-47)

Link this folder to `~/.local/share/gnome-shell/extensions/deepavali-charm@ranga`, log out and back in, then `gnome-extensions enable deepavali-charm@ranga`. Sounds use GNOME's event sounds, so they follow the system "Alert sound" setting.

Test without touching your desktop: `./test.sh /tmp/out` (headless GNOME Shell with a simulated mouse, saves screenshots).

## Windows and macOS

Download the installer from the [Releases](../../releases) page, or from the latest run of the **Desktop app** workflow under Actions:

- Windows: `Deepavali-Charm-Setup-*.exe` (installs) or `Deepavali-Charm-Portable-*.exe` (no install)
- macOS: the `.dmg` (universal, Intel and Apple Silicon). It isn't signed, so the first time, right-click the app and choose **Open**.

The lamp lives in a transparent window over everything; clicks pass straight through except on the lamp. Use the tray / menu-bar icon for petals, chimes, resetting the chain, sound on/off, start at login, and quit.

Run from source (any OS):

```
cd desktop
npm install
npm start
```

Build installers locally with `npm run dist` (Windows builds on Windows, Mac builds on a Mac).

## Layout

- `draw.js`: the lamp, flames, garland, petals, oil, chimes and blow-out logic, shared by both versions
- `extension.js`, `metadata.json`: the GNOME Shell extension
- `desktop/`: the Electron app for Windows and macOS (`cairo-canvas.js` lets `draw.js` draw on an HTML canvas)
- `sounds/`: chime, bell, wind and flame sounds, made by `tools/make-sounds.py`
