// Deepavali Charm: a brass hanging lamp (thooku vilakku) with five living flames,
// hung from the top bar on a marigold and jasmine garland.
// Drag it to swing it or stretch the chain like a rubber band (it springs back),
// Ctrl+drag to set a new chain length, click it for a petal shower, press and hold to
// blow the flames out (they relight after 5 s), drag the hook to move it.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Cairo from 'cairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    useCairo, W, CHAIN_W, LAMP_W, LAMP_H, RIM_Y, DROP_W, DROP_H, DROP_Y, DEFAULT_LEN, MIN_LEN,
    WICKS, PETALS, spoutTip, rand, pick, clamp, Flicker,
    G, DAMP, DROP_K, DROP_DAMP, CLICK_SLOP, STRETCH_DEAD, LEN_K, LEN_DAMP,
    drawGarland, drawLamp, drawDrop, drawFlame, drawGlow, drawHook, drawPetal,
    isBack, drawOilDrop, spillRate, spoutWorld, Chimes, Lights, HOLD_MS,
} from './draw.js';

useCairo(Cairo);

const CONFIG = GLib.build_filenamev([GLib.get_user_config_dir(), 'deepavali-charm.json']);

// repaint an St.DrawingArea with one of the shared draw functions
function paint(fn, ...args) {
    return area => {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        fn(cr, w, h, ...args);
        cr.$dispose();
    };
}

// ---------- extension ----------

export default class DeepavaliCharm extends Extension {
    enable() {
        this._theta = 0.0;
        this._omega = 0.0;
        this._phi = 0.0;        // bell drop lag angle
        this._phiV = 0.0;
        this._petals = [];
        this._oil = [];
        this._spill = 0;
        this._dragging = null;
        this._chimes = new Chimes(name => this._playSound(name));
        this._signals = [];
        const cfg = this._loadConfig();
        this._frac = cfg.anchor;
        this._restLen = cfg.length;   // the set length the rubber band returns to
        this._len = cfg.length;       // the length right now
        this._lenV = 0;
        this._flare = 0;

        this._buildActors();
        this._lights = new Lights(this._flames.map(f => f.tx), name => this._playSound(name));
        this._place();

        this._timeline = new Clutter.Timeline({actor: this._root, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => this._tick());
        this._lastFrame = 0;
        this._timeline.start();   // the flames are always alive

        const wm = global.workspace_manager;
        this._lastWs = wm.get_active_workspace_index();
        this._connect(wm, 'active-workspace-changed', () => {
            const i = wm.get_active_workspace_index();
            const dir = Math.sign(i - this._lastWs) || 1;
            this._lastWs = i;
            // the screen slides one way, the lamp lags the other
            this._kick(-dir * rand(2.2, 2.9));
        });
        this._connect(Main.overview, 'showing', () => this._kick(rand(-1, 1) > 0 ? 1.2 : -1.2));
        this._connect(Main.overview, 'hiding', () => this._kick(rand(-1, 1) > 0 ? 0.9 : -0.9));
        this._connect(Main.layoutManager, 'monitors-changed', () => this._place());
        this._connect(Main.layoutManager.panelBox, 'notify::height', () => this._place());

        this._breezeId = 0;
        this._scheduleBreeze();

        this._theta = -0.9;   // swing in on arrival

        if (GLib.getenv('DEEPAVALI_CHARM_TEST'))
            this._runTest(GLib.getenv('DEEPAVALI_CHARM_TEST'));
    }

    disable() {
        if (this._breezeId)
            GLib.source_remove(this._breezeId);
        this._breezeId = 0;
        if (this._testId)
            GLib.source_remove(this._testId);
        this._testId = 0;
        this._cancelHold();
        this._endGrab();
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        this._timeline?.stop();
        this._timeline = null;
        for (const p of [...this._petals, ...this._oil])
            p.actor.destroy();
        this._petals = [];
        this._oil = [];
        this._hook?.destroy();
        this._hook = null;
        this._root?.destroy();
        this._root = null;
        this._vptr = null;
    }

    _connect(obj, sig, fn) {
        this._signals.push([obj, obj.connect(sig, fn)]);
    }

    _buildActors() {
        const s = St.ThemeContext.get_for_stage(global.stage).scale_factor * 1.2;
        this._s = s;

        this._root = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            pivot_point: new Graphene.Point({x: 0.5, y: 0}),
            reactive: false,
        });

        const glowSize = 250 * s;
        this._glow = new St.DrawingArea({
            width: glowSize, height: glowSize,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
        });
        this._glow.connect('repaint', paint(drawGlow));

        this._garland = new St.DrawingArea({width: CHAIN_W * s, reactive: true});
        this._garland.connect('repaint', a => paint(drawGarland, this._len)(a));

        this._drop = new St.DrawingArea({
            width: DROP_W * s, height: DROP_H * s, reactive: true,
            pivot_point: new Graphene.Point({x: 0.5, y: 0}),
        });
        this._drop.connect('repaint', paint(drawDrop));

        // two layers, so the flames on the far side sit behind the front chains
        this._lampBack = new St.DrawingArea({width: LAMP_W * s, height: LAMP_H * s});
        this._lampBack.connect('repaint', paint(drawLamp, 'back'));
        this._lamp = new St.DrawingArea({width: LAMP_W * s, height: LAMP_H * s, reactive: true});
        this._lamp.connect('repaint', paint(drawLamp, 'front'));

        this._flames = WICKS.map(([ang, fw, fh]) => {
            const [tx, ty] = spoutTip(ang);
            const f = {
                tx, ty, back: isBack(ang), bend: 0, flick: new Flicker(), sway: new Flicker(),
                actor: new St.DrawingArea({
                    width: Math.round(fw * 1.9 * s), height: Math.round(fh * 1.2 * s),
                    pivot_point: new Graphene.Point({x: 0.5, y: 1}),
                }),
            };
            f.actor.connect('repaint', paint(drawFlame, f));
            return f;
        });

        this._root.add_child(this._glow);
        this._root.add_child(this._drop);
        this._root.add_child(this._garland);
        this._root.add_child(this._lampBack);
        for (const f of this._flames.filter(fl => fl.back))
            this._root.add_child(f.actor);
        this._root.add_child(this._lamp);
        for (const f of this._flames.filter(fl => !fl.back))
            this._root.add_child(f.actor);

        for (const a of [this._lamp, this._garland, this._drop]) {
            a.connect('button-press-event', (_a, ev) => this._onPress(ev, 'charm', a));
            a.connect('motion-event', (_a, ev) => this._onMotion(ev));
            a.connect('button-release-event', (_a, ev) => this._onRelease(ev));
            a.connect('enter-event', () => {
                if (!this._dragging)
                    global.display.set_cursor(Meta.Cursor.POINTING_HAND);
            });
            a.connect('leave-event', () => {
                if (!this._dragging)
                    global.display.set_cursor(Meta.Cursor.DEFAULT);
            });
        }

        // the hook on the top bar: drag it sideways to move where the lamp hangs
        this._hook = new St.DrawingArea({width: 24 * s, height: 16 * s, reactive: true});
        this._hook.connect('repaint', paint(drawHook));
        this._hook.connect('button-press-event', (_a, ev) => this._onPress(ev, 'hook', this._hook));
        this._hook.connect('motion-event', (_a, ev) => this._onMotion(ev));
        this._hook.connect('button-release-event', (_a, ev) => this._onRelease(ev));
        this._hook.connect('enter-event', () => global.display.set_cursor(Meta.Cursor.MOVE_OR_RESIZE_WINDOW));
        this._hook.connect('leave-event', () => {
            if (!this._dragging)
                global.display.set_cursor(Meta.Cursor.DEFAULT);
        });

        Main.layoutManager.addChrome(this._root, {trackFullscreen: true});
        Main.layoutManager.addChrome(this._hook, {affectsInputRegion: true, trackFullscreen: true});
        this._layoutLength();
    }

    // position everything below the garland for the current chain length
    _layoutLength() {
        const s = this._s;
        const L = this._len;
        this._root.set_size(W * s, (L + DROP_Y + DROP_H + 4) * s);
        this._garland.set_height((L + 6) * s);
        this._garland.set_position((W - CHAIN_W) / 2 * s, 0);
        this._garland.queue_repaint();
        this._lamp.set_position((W - LAMP_W) / 2 * s, L * s);
        this._lampBack.set_position((W - LAMP_W) / 2 * s, L * s);
        this._drop.set_position((W - DROP_W) / 2 * s, (L + DROP_Y) * s);
        for (const f of this._flames) {
            const [aw, ah] = f.actor.get_size();
            f.actor.set_position(W / 2 * s + f.tx * s - aw / 2, (L + f.ty + 1) * s - ah);
        }
        const g = this._glow.width;
        this._glow.set_position((W * s - g) / 2, (L + RIM_Y - 8) * s - g / 2);
    }

    _maxLen() {
        const mon = this._mon ?? Main.layoutManager.primaryMonitor;
        const pb = Main.layoutManager.panelBox;
        return Math.max(MIN_LEN + 20, (mon.height - pb.height) / this._s - DROP_Y - DROP_H - 30);
    }

    _place() {
        if (!this._root)
            return;
        const mon = Main.layoutManager.primaryMonitor;
        if (!mon)
            return;
        this._mon = mon;
        const pb = Main.layoutManager.panelBox;
        const s = this._s;
        const margin = 40 * s;
        this._restLen = clamp(this._restLen, MIN_LEN, this._maxLen());
        const len = clamp(this._len, MIN_LEN, this._maxLen());
        if (len !== this._len) {
            this._len = len;
            this._layoutLength();
        }
        this._ax = Math.round(mon.x + margin + this._frac * (mon.width - 2 * margin));
        this._ay = pb.y + pb.height - 2 * s;
        this._root.set_position(this._ax - (W * s) / 2, this._ay);
        this._hook.set_position(this._ax - 12 * s, this._ay - 3 * s);
        this._apply();
    }

    _apply() {
        this._root.rotation_angle_z = (-this._theta * 180) / Math.PI;
        this._drop.rotation_angle_z = (-this._phi * 180) / Math.PI;
    }

    _kick(dw) {
        this._omega += dw;
    }

    _scheduleBreeze() {
        this._breezeId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, Math.round(rand(25, 50)), () => {
            if (Math.abs(this._omega) < 0.3) {
                this._kick(rand(0.18, 0.4) * (Math.random() < 0.5 ? -1 : 1));
                this._flare = Math.max(this._flare, 0.6);
            }
            this._scheduleBreeze();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ----- physics -----

    _tick() {
        const now = GLib.get_monotonic_time() / 1e6;
        let dt = this._lastFrame ? now - this._lastFrame : 1 / 60;
        this._lastFrame = now;
        dt = Math.min(dt, 1 / 20);

        const K = G / (this._len + 90);
        const steps = 4;
        const h = dt / steps;
        const held = this._dragging?.what === 'charm' && this._dragging.moved;
        let alpha = 0;
        for (let i = 0; i < steps; i++) {
            if (held) {
                alpha = 0;   // angle is set by the pointer
            } else {
                alpha = -K * Math.sin(this._theta) - DAMP * this._omega;
                this._omega += alpha * h;
                this._theta += this._omega * h;
                if (this._theta > Math.PI)
                    this._theta -= 2 * Math.PI;
                if (this._theta < -Math.PI)
                    this._theta += 2 * Math.PI;
            }
            // the bell drop lags behind the bowl's swing
            const phiA = -DROP_K * this._phi - DROP_DAMP * this._phiV - 0.9 * alpha;
            this._phiV += phiA * h;
            this._phi = clamp(this._phi + this._phiV * h, -0.9, 0.9);
        }
        if (held) {
            const d = this._dragging;
            this._phiV -= (d.omega - (d.lastOmega ?? 0)) * 0.6;
            d.lastOmega = d.omega;
        }
        this._stepLength(dt);
        this._apply();
        const omega = held ? this._dragging.omega : this._omega;
        this._stepFlames(now, dt, omega);
        this._stepPetals(dt);
        this._stepOil(dt, omega);
        this._chimes.tick(now, this._theta, omega);
    }

    // rubber band: when let go, the chain springs back to its set length
    _stepLength(dt) {
        if (this._dragging?.stretch && this._dragging.moved)
            return;
        const off = this._len - this._restLen;
        if (Math.abs(off) < 0.2 && Math.abs(this._lenV) < 1) {
            if (off !== 0) {
                this._len = this._restLen;
                this._lenV = 0;
                this._layoutLength();
            }
            return;
        }
        const steps = 4, h = dt / steps;
        for (let i = 0; i < steps; i++) {
            this._lenV += (-LEN_K * (this._len - this._restLen) - LEN_DAMP * this._lenV) * h;
            this._len += this._lenV * h;
        }
        this._len = clamp(this._len, MIN_LEN * 0.6, this._maxLen() + 40);
        this._layoutLength();
    }

    _stepFlames(t, dt, omega) {
        // lamp speed in px/s at the bowl; the flames trail behind it and stretch
        const speed = omega * (this._len + RIM_Y);
        this._flare = Math.max(0, this._flare - dt * 0.8);
        const lights = this._lights;
        lights.tick(t, dt);
        let glowSum = 0;
        this._flames.forEach((f, i) => {
            const n = f.flick.at(t, dt);
            const sw = f.sway.at(t * 0.7, dt);
            // world lean: hot air rises, motion pushes the tip back, a gust bends it over
            const lean = clamp(speed * 0.0012, -0.6, 0.6) + sw * 0.07 + lights.lean;
            const level = lights.levels[i], smoke = lights.smoke[i];
            const changed = Math.abs(level - (f.level ?? 1)) > 0.003 || smoke > 0 || (f.smoke ?? 0) > 0;
            f.level = level;
            f.smoke = smoke;
            f.t = t;
            // the root is rotated by theta, so undo it to keep the flame upright
            f.actor.rotation_angle_z = ((this._theta - lean) * 180) / Math.PI;
            f.actor.scale_y = 1 + 0.13 * n + Math.min(0.35, Math.abs(speed) * 0.0007) + 0.25 * this._flare;
            f.actor.scale_x = 1 - 0.07 * n + 0.1 * this._flare;
            const bend = clamp(sw * 0.55 - lean * 0.8, -1, 1);
            if (Math.abs(bend - f.bend) > 0.01 || changed) {
                f.bend = bend;
                f.actor.queue_repaint();
            }
            glowSum += n;
        });
        const g = glowSum / this._flames.length;
        this._glow.opacity = clamp(Math.round((215 + 40 * g + 40 * this._flare) * lights.glow), 0, 255);
        this._glow.scale_x = this._glow.scale_y = 1 + 0.05 * g + 0.12 * this._flare;
    }

    // ----- input -----

    _pointerAngle(x, y) {
        return Math.atan2(x - this._ax, y - this._ay);
    }

    _onPress(ev, what, actor) {
        if (ev.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = ev.get_coords();
        this._dragging = {
            what, x0: x, y0: y, moved: false,
            off: what === 'charm' ? this._theta - this._pointerAngle(x, y) : 0,
            r0: Math.hypot(x - this._ax, y - this._ay), len0: this._len,
            t: ev.get_time(), theta: this._theta, omega: 0,
            ax0: this._ax,
            ctrl: this._ctrl(ev),
        };
        this._lenV = 0;
        this._endGrab();
        this._grab = global.stage.grab(actor);
        // press and hold without moving: a gust blows the flames out
        this._cancelHold();
        if (what === 'charm') {
            this._holdId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOLD_MS, () => {
                this._holdId = 0;
                const d = this._dragging;
                if (d && !d.moved && this._lights.blowOut(this._now()))
                    d.held = true;
                return GLib.SOURCE_REMOVE;
            });
        }
        return Clutter.EVENT_STOP;
    }

    _cancelHold() {
        if (this._holdId)
            GLib.source_remove(this._holdId);
        this._holdId = 0;
    }

    _onMotion(ev) {
        const d = this._dragging;
        if (!d)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = ev.get_coords();
        if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > CLICK_SLOP * this._s) {
            d.moved = true;
            // mostly up/down pulls the chain longer or shorter; otherwise it's a swing
            d.stretch = Math.abs(y - d.y0) > 1.4 * Math.abs(x - d.x0);
            this._cancelHold();
        }
        if (!d.moved)
            return Clutter.EVENT_STOP;

        const t = ev.get_time();
        const dtMs = Math.max(1, t - d.t);
        if (d.what === 'charm') {
            let th = this._pointerAngle(x, y) + d.off;
            th = clamp(th, -2.6, 2.6);
            const w = ((th - d.theta) * 1000) / dtMs;
            d.omega = d.omega * 0.6 + w * 0.4;
            d.theta = th;
            this._theta = th;
            // pulling away from the hook lengthens the chain, pushing back shortens it
            const pull = !d.stretch ? 0 : Math.hypot(x - this._ax, y - this._ay) - d.r0;
            const eff = Math.sign(pull) * Math.max(0, Math.abs(pull) - STRETCH_DEAD * this._s);
            const len = clamp(d.len0 + eff / this._s, MIN_LEN, this._maxLen());
            const vNow = ((len - this._len) * 1000) / dtMs;
            d.lenV = (d.lenV ?? 0) * 0.6 + vNow * 0.4;
            if (d.stretch && Math.abs(len - this._len) > 0.5) {
                this._len = len;
                d.stretched = true;
                this._layoutLength();
                this._place();
            }
        } else {
            const mon = this._mon;
            const margin = 40 * this._s;
            const nx = clamp(d.ax0 + (x - d.x0), mon.x + margin, mon.x + mon.width - margin);
            const dx = nx - this._ax;
            this._frac = (nx - mon.x - margin) / (mon.width - 2 * margin);
            this._place();
            // moving the hook drags the lamp behind it
            this._omega -= dx * 0.012;
        }
        d.t = t;
        return Clutter.EVENT_STOP;
    }

    _onRelease(ev) {
        const d = this._dragging;
        if (!d)
            return Clutter.EVENT_PROPAGATE;
        this._endGrab();
        this._cancelHold();
        this._dragging = null;
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        if (d.what === 'charm') {
            if (d.moved) {
                // a stale velocity (pointer held still) shouldn't fling it
                const idle = ev.get_time() - d.t;
                this._omega = idle > 120 ? 0 : clamp(d.omega, -14, 14);
                this._chimes.melody(this._now());
                if (d.stretched) {
                    if (d.ctrl || this._ctrl(ev)) {
                        // Ctrl+drag: the new length sticks
                        this._restLen = this._len;
                        this._lenV = 0;
                        this._chimes.bell(this._now());
                        this._saveConfig();
                    } else {
                        // plain drag: let go and it snaps back like a rubber band
                        this._lenV = idle > 120 ? 0 : clamp(d.lenV ?? 0, -1500, 1500);
                    }
                }
            } else if (!d.held) {
                this._shower();
                this._chimes.melody(this._now(), 6);
                this._chimes.bell(this._now());
            }
        } else if (d.moved) {
            this._chimes.melody(this._now(), 3);
            this._saveConfig();
        }
        return Clutter.EVENT_STOP;
    }

    _ctrl(ev) {
        return (ev.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
    }

    _endGrab() {
        if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
        }
    }

    _now() {
        return GLib.get_monotonic_time() / 1e6;
    }

    // ----- sound -----

    _playSound(name) {
        const file = Gio.File.new_for_path(GLib.build_filenamev([this.path, 'sounds', `${name}.wav`]));
        try {
            global.display.get_sound_player().play_from_file(file, 'Deepavali charm chime', null);
        } catch (e) {
            console.warn(`deepavali-charm: could not play ${name}: ${e}`);
        }
        if (this._testId)
            console.log(`deepavali-charm test sound ${name}`);
    }

    // ----- oil -----

    // a hard swing or a steep tilt slops oil over the spouts
    _stepOil(dt, omega) {
        const s = this._s;
        this._spill += spillRate(this._theta, omega, this._len) * dt;
        while (this._spill >= 1 && this._oil.length < 40) {
            this._spill -= 1;
            // oil runs out of whichever spout is lowest right now
            const tips = this._flames.filter(f => !f.back)
                .map(f => spoutWorld(f.tx, f.ty, this._len, this._theta, omega, s));
            tips.sort((a, b) => b.y - a.y);
            const p = tips[Math.random() < 0.7 ? 0 : 1];
            const w = Math.round(rand(5.5, 8.5) * s), h = Math.round(w * 1.45);
            const actor = new St.DrawingArea({
                width: w, height: h, reactive: false,
                pivot_point: new Graphene.Point({x: 0.5, y: 0.6}),
            });
            actor.connect('repaint', paint(drawOilDrop));
            Main.layoutManager.uiGroup.add_child(actor);
            this._oil.push({
                actor, w, h, age: 0,
                x: this._ax + p.x + rand(-2, 2) * s, y: this._ay + p.y,
                vx: p.vx * 0.8 + rand(-20, 20) * s, vy: p.vy * 0.8 - rand(0, 40) * s,
            });
        }
        if (this._spill > 1)
            this._spill = 1;
        if (!this._oil.length)
            return;
        const floor = this._mon.y + this._mon.height + 20 * s;
        this._oil = this._oil.filter(o => {
            o.age += dt;
            o.vy += 1500 * s * dt;
            o.vx *= Math.exp(-0.8 * dt);
            o.x += o.vx * dt;
            o.y += o.vy * dt;
            const a = o.actor;
            a.set_position(o.x - o.w / 2, o.y - o.h * 0.6);
            // stretch along the fall
            a.rotation_angle_z = (Math.atan2(-o.vx, o.vy) * 180) / Math.PI;
            a.scale_y = 1 + Math.min(0.8, Math.hypot(o.vx, o.vy) / (1600 * s));
            a.opacity = Math.round(255 * clamp((2.2 - o.age) / 0.5, 0, 1));
            if (o.y > floor || o.age > 2.2) {
                a.destroy();
                return false;
            }
            return true;
        });
    }

    // ----- petals -----

    _lampCenter() {
        const L = (this._len + RIM_Y) * this._s;
        return [this._ax + Math.sin(this._theta) * L, this._ay + Math.cos(this._theta) * L];
    }

    _shower() {
        const [cx, cy] = this._lampCenter();
        const s = this._s;
        const total = PETALS.reduce((a, p) => a + p.w, 0);
        for (let i = 0; i < 60; i++) {
            let r = Math.random() * total;
            const spec = PETALS.find(p => (r -= p.w) < 0) ?? PETALS[0];
            const size = Math.round((spec.kind === 'spark' ? rand(10, 18) : rand(15, 21)) * s);
            const hue = spec.kind === 'marigold'
                ? pick(['#ff8c1a', '#ffa41b', '#ffb52e', '#f76707'])
                : pick(['#c2185b', '#d6336c', '#a61e4d', '#e64980']);
            const actor = new St.DrawingArea({
                width: size, height: size, reactive: false,
                pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            });
            actor.connect('repaint', paint(drawPetal, spec.kind, hue));
            Main.layoutManager.uiGroup.add_child(actor);
            const ang = rand(-Math.PI, 0);   // fan out upward and sideways
            const sp = rand(140, 460) * s;
            this._petals.push({
                actor, kind: spec.kind, size,
                x: cx + rand(-14, 14) * s, y: cy + rand(-14, 14) * s,
                vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.9 - 60 * s,
                rot: rand(0, 360), vr: rand(-260, 260),
                flutter: rand(1.5, 3.5), phase: rand(0, 6.28), amp: rand(18, 46) * s,
                age: 0, life: spec.kind === 'spark' ? rand(0.6, 1.2) : rand(5, 8),
            });
        }
        // the lamp jumps a little and the flames flare up
        this._kick(rand(0.6, 1.0) * (Math.random() < 0.5 ? -1 : 1));
        this._flare = 1;
        const parent = this._root.get_parent();
        parent?.set_child_above_sibling(this._root, null);
        parent?.set_child_above_sibling(this._hook, null);
    }

    _stepPetals(dt) {
        if (!this._petals.length)
            return;
        const s = this._s;
        const floor = this._mon.y + this._mon.height + 30 * s;
        this._petals = this._petals.filter(p => {
            p.age += dt;
            if (p.kind === 'spark') {
                p.vx *= Math.exp(-3 * dt);
                p.vy = p.vy * Math.exp(-3 * dt) + 60 * s * dt;
            } else {
                p.vy += 520 * s * dt;
                const term = 95 * s;
                if (p.vy > term)
                    p.vy += (term - p.vy) * Math.min(1, 4 * dt);
                p.vx *= Math.exp(-1.6 * dt);
            }
            const sway = p.kind === 'spark' ? 0 : Math.sin(p.age * p.flutter + p.phase) * p.amp * Math.min(1, p.age);
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
            const a = p.actor;
            a.set_position(p.x + sway - p.size / 2, p.y - p.size / 2);
            a.rotation_angle_z = p.rot;
            if (p.kind !== 'spark')
                a.scale_x = 0.35 + 0.65 * Math.abs(Math.cos(p.age * p.flutter * 0.8 + p.phase));
            const fade = Math.min(1, (p.life - p.age) / 0.8);
            a.opacity = Math.max(0, Math.round(255 * fade));
            if (p.age > p.life || p.y > floor) {
                a.destroy();
                return false;
            }
            return true;
        });
    }

    // ----- settings -----

    _loadConfig() {
        const cfg = {anchor: 0.93, length: DEFAULT_LEN};
        try {
            const [ok, bytes] = GLib.file_get_contents(CONFIG);
            if (ok) {
                const j = JSON.parse(new TextDecoder().decode(bytes));
                if (typeof j.anchor === 'number' && j.anchor >= 0 && j.anchor <= 1)
                    cfg.anchor = j.anchor;
                if (typeof j.length === 'number' && j.length >= MIN_LEN)
                    cfg.length = j.length;
            }
        } catch (e) {}
        return cfg;
    }

    _saveConfig() {
        try {
            GLib.file_set_contents(CONFIG, JSON.stringify({anchor: this._frac, length: Math.round(this._restLen)}));
        } catch (e) {
            console.warn(`deepavali-charm: could not save settings: ${e}`);
        }
    }

    // ----- self test (only when DEEPAVALI_CHARM_TEST=<dir> is set) -----
    // drives a virtual mouse so the real press/drag/release path is exercised

    _runTest(dir) {
        const seat = Clutter.get_default_backend().get_default_seat();
        this._vptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const us = () => GLib.get_monotonic_time();
        const move = (x, y) => this._vptr.notify_absolute_motion(us(), x, y);
        const button = down => this._vptr.notify_button(us(), Clutter.BUTTON_PRIMARY,
            down ? Clutter.ButtonState.PRESSED : Clutter.ButtonState.RELEASED);
        const log = tag => console.log(`deepavali-charm test ${tag}: len=${this._len.toFixed(1)} ` +
            `theta=${this._theta.toFixed(3)} omega=${this._omega.toFixed(3)} lights=${this._lights.state} oil=${this._oil.length}`);
        let px = 0, py = 0;
        const steps = [];
        const at = (t, fn, shot) => steps.push([t, fn, shot]);
        // glide the pointer from (px,py) by (dx,dy) over [t0, t1]
        const glide = (t0, t1, dx, dy) => {
            const n = 12;
            for (let k = 1; k <= n; k++) {
                at(t0 + ((t1 - t0) * k) / n, () => {
                    px += dx / n;
                    py += dy / n;
                    move(px, py);
                });
            }
        };
        const grabLamp = () => {
            const [cx, cy] = this._lampCenter();
            px = cx;
            py = cy + 12 * this._s;
            move(px, py);
        };

        at(4.0, () => log('rest'), 'rest');
        at(4.3, () => log('flame_a'), 'flame_a');
        at(4.5, () => log('flame_b'), 'flame_b');
        // plain pull down: stretches, then springs back on release
        at(4.65, grabLamp);
        at(4.7, () => button(true));
        glide(4.75, 5.4, 0, 160 * this._s);
        at(5.5, () => log('pulled'), 'pulled');
        at(5.6, () => button(false));
        at(5.75, () => log('snapping'), 'snapping');
        at(6.6, () => log('after_pull'), 'after_pull');
        // drag it sideways and throw it
        at(6.8, grabLamp);
        at(6.9, () => button(true));
        glide(6.95, 7.5, -260 * this._s, 0);
        at(7.55, () => log('drag_side'), 'drag_side');
        glide(7.6, 7.75, 120 * this._s, 0);
        at(7.76, () => button(false));
        at(7.95, () => log('thrown'), 'thrown');
        at(8.3, () => log('thrown_b'), 'thrown_b');
        // Ctrl+pull down: the new length sticks
        const kbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const ctrl = down => kbd.notify_keyval(us(), Clutter.KEY_Control_L,
            down ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED);
        at(10.5, () => {
            this._theta = this._omega = 0;
            grabLamp();
        });
        at(10.55, () => ctrl(true));
        at(10.6, () => button(true));
        glide(10.65, 11.2, 0, 110 * this._s);
        at(11.25, () => button(false));
        at(11.3, () => ctrl(false));
        at(12.0, () => log('ctrl_set'), 'ctrl_set');
        // click: petal shower
        at(12.2, grabLamp);
        at(12.3, () => button(true));
        at(12.38, () => button(false));
        at(12.8, () => log('shower'), 'shower');
        at(13.8, () => {}, 'shower_1.5s');
        // press and hold: blown out, then relit 5 s later
        at(14.0, grabLamp);
        at(14.1, () => button(true));
        at(15.25, () => log('blowing'), 'blowing');
        at(15.4, () => button(false));
        at(16.8, () => log('out'), 'out');
        at(22.3, () => log('relighting'), 'relighting');
        at(23.6, () => log('relit'), 'relit');

        const t0 = GLib.get_monotonic_time() / 1e6;
        let i = 0;
        const shooter = new Shell.Screenshot();
        this._testId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
            const t = GLib.get_monotonic_time() / 1e6 - t0;
            while (i < steps.length && t >= steps[i][0]) {
                const [, fn, shot] = steps[i++];
                fn();
                if (shot) {
                    const file = Gio.File.new_for_path(`${dir}/${shot}.png`);
                    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
                    shooter.screenshot(false, stream, (o, res) => {
                        try {
                            o.screenshot_finish(res);
                        } catch (e) {
                            console.error(`deepavali-charm test: ${e}`);
                        }
                        stream.close(null);
                    });
                }
            }
            if (i >= steps.length) {
                this._testId = 0;
                GLib.file_set_contents(`${dir}/done`, 'ok');
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }
}
