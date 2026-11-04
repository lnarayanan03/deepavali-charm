# Deepavali Charm

A brass hanging lamp (thooku vilakku) on a marigold, jasmine and mango-leaf garland that hangs from the top of your screen. The round dish is pinched into five pointed lips, the main one at the front, each with a cotton wick lying in its groove and a little flame that flickers, sways and trails behind the lamp as it swings. A brass swan sits on top where the chains meet.

It comes with a second charm living alongside it: seven **dragon balls** scattered round your screen.

Runs on **Linux (GNOME Shell extension)**, **Windows** and **macOS** (desktop app). Both draw the same lamp from the shared `draw.js`, and the dragon balls from `dragon.js`.

## Using it

- **Drag** the lamp to swing it. Drag it down (or up) to stretch the chain like a rubber band; let go and it springs back.
- **Ctrl+drag** (or **Cmd+drag** on a Mac) to set a new chain length. It stays and is remembered.
- **Click** it for a shower of marigold, rose and jasmine petals.
- **Double-click** it for a 10-second crackers show: big bright bursts (peonies, rings, willows, glitter) across the sky, ending with one that bursts into the words **Happy Diwali** written in sparks.
- **Press and hold** it: a gust of air sweeps across the whole screen and blows the flames out, leaving smoke and glowing wick ends. A few seconds later the wicks glow, catch, and the flames slowly grow back one by one.
- Swing it hard and a few drops of oil drip from the lips.
- Soft sounds: the chain jingles when you pick it up, the little bell under the lamp knocks as it swings, a temple bell rings with the petals, a breath when you blow it out and a soft catch as each wick relights.
- Drag the little gold hook to move where it hangs.
- On GNOME it also swings when you switch workspaces or open the overview.

## The dragon balls

- **Drag** the seven balls together. Touching balls glow brighter; when all seven touch, the wish begins.
- Storm clouds roll in and lightning strikes the balls, which burst into a pillar of light. The eternal dragon coils up out of it, crackling, looks at you for a moment, and melts into golden light. The balls fly off.
- Then the hero runs in, powers up (his hair flickers, then flares gold, with lightning, rocks lifting and a shockwave), charges his energy wave and fires it across the screen, flashes over to the other side, catches it himself, turns to you with a two-finger salute and teleports away.
- The balls fall back to new places as grey **stones**. For a minute they can't be used; when the colour comes back, they're ready again.
- Desktop app: the tray menu also has **Summon the dragon**.

### Voices

No voice clips come with it. To add your own, save the clip on your computer (WAV, or mp3/m4a if ffmpeg is installed) and run:

```
tools/add-voice.py <file> kamehameha [start-seconds] [length-seconds]
tools/add-voice.py <file> scream ...
tools/add-voice.py <file> bye ...
```

It trims and levels the clip and saves it as `voices/goku-<name>.wav` (GNOME) and into the desktop app's voices folder (tray menu: **Open voices folder**). Restart the app, or log out and in on GNOME, to pick them up. Without a clip, the show uses its own effects (a power-up roar, a charging hum). `voices/` is never committed.

## Linux (GNOME 45-47)

Link this folder to `~/.local/share/gnome-shell/extensions/deepavali-charm@ranga`, log out and back in, then `gnome-extensions enable deepavali-charm@ranga`. Sounds use GNOME's event sounds, so they follow the system "Alert sound" setting.

Test without touching your desktop: `./test.sh /tmp/out` (headless GNOME Shell with a simulated mouse, saves screenshots).

## Windows and macOS

Download the installer from the [Releases](../../releases) page, or from the latest run of the **Desktop app** workflow under Actions:

- Windows: `Deepavali-Charm-Setup-*.exe` (installs) or `Deepavali-Charm-Portable-*.exe` (no install)
- macOS: the `.dmg` (universal, Intel and Apple Silicon). It isn't signed, so the first time, right-click the app and choose **Open**.

The lamp lives in a transparent window over everything; clicks pass straight through except on the lamp. Use the tray / menu-bar icon for petals, crackers, ringing the bell, resetting the chain, sound on/off, start at login, and quit.

Run from source (any OS):

```
cd desktop
npm install
npm start
```

Build installers locally with `npm run dist` (Windows builds on Windows, Mac builds on a Mac).

## Layout

- `draw.js`: the lamp, flames, garland, petals, oil, wind, sound and blow-out logic, shared by both versions
- `extension.js`, `metadata.json`: the GNOME Shell extension
- `desktop/`: the Electron app for Windows and macOS (`cairo-canvas.js` lets `draw.js` draw on an HTML canvas)
- `dragon.js`: the dragon balls, the dragon, the hero and the whole show, shared by both versions
- `sounds/`: bell, chain, breath, wick, crackers and dragon ball sounds, made by `tools/make-sounds.py` (needs numpy and scipy)
