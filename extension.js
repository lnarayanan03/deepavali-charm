// Deepavali Charm: a lit akash kandil (star lantern) hanging from the top bar.
// Drag it and let go to throw it; it swings when you switch workspaces;
// a click showers marigold, rose and jasmine petals.

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

// Layout (px, at scale 1)
const W = 120;            // charm actor width
const CORD = 118;         // cord length from hook to the top of the star
const STAR_R = 46;        // star outer radius
const STAR_CY = CORD + STAR_R;   // star centre, measured from the hook
const TASSEL_LEN = 92;
const H = STAR_CY + STAR_R + TASSEL_LEN + 10;

// Pendulum
const K = 15.5;           // (2*pi/period)^2, period ~1.6 s
const DAMP = 0.55;        // per second
const TASSEL_K = 55;
const TASSEL_DAMP = 5.5;
const CLICK_SLOP = 6;     // px of movement before a press becomes a drag

const CONFIG = GLib.build_filenamev([GLib.get_user_config_dir(), 'deepavali-charm.json']);

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function rgba(cr, hex, a = 1) {
    const n = parseInt(hex.slice(1), 16);
    cr.setSourceRGBA(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
}

function stop(g, off, hex, a = 1) {
    const n = parseInt(hex.slice(1), 16);
    g.addColorStopRGBA(off, ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
}

// ---------- drawing ----------

function drawMarigold(cr, x, y, r) {
    // ruffled outer ring, then two inner layers
    const layers = [[r, '#e8590c', 14, 0.18], [r * 0.74, '#ff8c1a', 11, 0.2], [r * 0.46, '#ffb52e', 8, 0.22]];
    for (const [rr, col, lobes, amp] of layers) {
        cr.newPath();
        for (let i = 0; i <= 72; i++) {
            const t = (i / 72) * Math.PI * 2;
            const k = rr * (1 + amp * Math.abs(Math.sin(t * lobes / 2)));
            const px = x + Math.cos(t) * k, py = y + Math.sin(t) * k;
            if (i === 0)
                cr.moveTo(px, py);
            else
                cr.lineTo(px, py);
        }
        cr.closePath();
        rgba(cr, col);
        cr.fillPreserve();
        rgba(cr, '#9c3200', 0.35);
        cr.setLineWidth(0.6);
        cr.stroke();
    }
    rgba(cr, '#a8430a', 0.8);
    cr.arc(x, y, r * 0.16, 0, Math.PI * 2);
    cr.fill();
}

function drawLeaf(cr, x, y, ang, len) {
    cr.save();
    cr.translate(x, y);
    cr.rotate(ang);
    cr.newPath();
    cr.moveTo(0, 0);
    cr.curveTo(len * 0.35, -len * 0.32, len * 0.8, -len * 0.22, len, 0);
    cr.curveTo(len * 0.8, len * 0.22, len * 0.35, len * 0.32, 0, 0);
    rgba(cr, '#2f9e44');
    cr.fillPreserve();
    rgba(cr, '#1b5e20', 0.7);
    cr.setLineWidth(0.7);
    cr.stroke();
    cr.restore();
}

function starPoints(cx, cy, R, r, n = 5) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / n;
        const rr = i % 2 === 0 ? R : r;
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return pts;
}

function drawCord(area) {
    const cr = area.get_context();
    const [w] = area.get_surface_size();
    const cx = w / 2;
    // twisted gold cord
    cr.setLineCap(Cairo.LineCap.ROUND);
    rgba(cr, '#8a5a00');
    cr.setLineWidth(3.2);
    cr.moveTo(cx, 2);
    cr.lineTo(cx, CORD + 4);
    cr.stroke();
    rgba(cr, '#ffd56b');
    cr.setLineWidth(1.4);
    for (let y = 4; y < CORD + 2; y += 6) {
        cr.moveTo(cx - 1.4, y);
        cr.lineTo(cx + 1.4, y + 3);
        cr.stroke();
    }
    // marigolds threaded on the cord, a leaf pair under the top one
    drawLeaf(cr, cx, 40, Math.PI * 0.82, 15);
    drawLeaf(cr, cx, 40, Math.PI * 0.18, 15);
    drawMarigold(cr, cx, 30, 9.5);
    drawMarigold(cr, cx, 62, 11);
    drawMarigold(cr, cx, 96, 12.5);
    cr.$dispose();
}

function drawStar(area) {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    const cx = w / 2, cy = h / 2;
    const R = STAR_R, r = STAR_R * 0.46;
    const pts = starPoints(cx, cy, R, r);
    const path = () => {
        cr.newPath();
        pts.forEach(([x, y], i) => (i ? cr.lineTo(x, y) : cr.moveTo(x, y)));
        cr.closePath();
    };

    // paper body lit from inside
    const g = new Cairo.RadialGradient(cx, cy, 2, cx, cy, R);
    stop(g, 0, '#fff6d0');
    stop(g, 0.28, '#ffd24a');
    stop(g, 0.55, '#ff7a1a');
    stop(g, 0.85, '#e0245e');
    stop(g, 1, '#9e1048');
    path();
    cr.setSource(g);
    cr.fill();

    // 3D facets: each point split into a light and a dark half
    for (let i = 0; i < 10; i += 2) {
        const [px, py] = pts[i];
        const [qx, qy] = pts[(i + 1) % 10];
        cr.newPath();
        cr.moveTo(cx, cy);
        cr.lineTo(px, py);
        cr.lineTo(qx, qy);
        cr.closePath();
        cr.setSourceRGBA(0.35, 0, 0.12, 0.22);
        cr.fill();
    }
    // facet creases
    cr.setLineWidth(0.9);
    for (const [x, y] of pts) {
        cr.moveTo(cx, cy);
        cr.lineTo(x, y);
    }
    cr.setSourceRGBA(1, 0.86, 0.45, 0.55);
    cr.stroke();

    // gold trim with little mirror dots along the edges
    path();
    rgba(cr, '#ffcf40');
    cr.setLineWidth(2.4);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.stroke();
    for (let i = 0; i < 10; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % 10];
        for (const t of [0.33, 0.66]) {
            const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
            rgba(cr, '#fffbe6');
            cr.arc(x, y, 1.5, 0, Math.PI * 2);
            cr.fill();
        }
    }

    // centre mandala
    for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        cr.save();
        cr.translate(cx, cy);
        cr.rotate(a);
        cr.newPath();
        cr.moveTo(0, 0);
        cr.curveTo(4, -4, 10, -3, 12, 0);
        cr.curveTo(10, 3, 4, 4, 0, 0);
        rgba(cr, '#fffaf0', 0.85);
        cr.fill();
        cr.restore();
    }
    const c = new Cairo.RadialGradient(cx, cy, 0, cx, cy, 6);
    stop(c, 0, '#ffffff');
    stop(c, 1, '#ffb703');
    cr.setSource(c);
    cr.arc(cx, cy, 5, 0, Math.PI * 2);
    cr.fill();
    rgba(cr, '#c2185b');
    cr.arc(cx, cy, 2, 0, Math.PI * 2);
    cr.fill();

    // top cap where the cord ties on
    rgba(cr, '#b8860b');
    cr.rectangle(cx - 4, cy - R - 5, 8, 7);
    cr.fill();
    rgba(cr, '#ffd56b');
    cr.rectangle(cx - 4, cy - R - 5, 8, 2);
    cr.fill();
    cr.$dispose();
}

const RIBBONS = ['#e0245e', '#ff8c1a', '#ffd24a', '#2f9e44', '#9c27b0', '#ff8c1a', '#e0245e'];

function drawTassels(area) {
    const cr = area.get_context();
    const [w] = area.get_surface_size();
    const cx = w / 2;
    const n = RIBBONS.length;
    // bead bar
    rgba(cr, '#ffcf40');
    cr.setLineWidth(2);
    cr.moveTo(cx - 22, 6);
    cr.lineTo(cx + 22, 6);
    cr.stroke();
    for (let i = 0; i < n; i++) {
        const x = cx - 21 + (i * 42) / (n - 1);
        const len = TASSEL_LEN - 14 - Math.abs(i - (n - 1) / 2) * 7;
        cr.newPath();
        cr.moveTo(x - 2.4, 6);
        cr.curveTo(x - 3, 6 + len * 0.4, x + 2, 6 + len * 0.7, x - 1, 6 + len);
        cr.lineTo(x + 2.2, 6 + len - 3);
        cr.curveTo(x + 4.5, 6 + len * 0.7, x - 0.5, 6 + len * 0.4, x + 2.4, 6);
        cr.closePath();
        rgba(cr, RIBBONS[i]);
        cr.fillPreserve();
        cr.setSourceRGBA(0, 0, 0, 0.18);
        cr.setLineWidth(0.6);
        cr.stroke();
        rgba(cr, '#fff3c4');
        cr.arc(x, 6, 2.1, 0, Math.PI * 2);
        cr.fill();
    }
    // bell at the bottom of the middle ribbon
    const by = 6 + TASSEL_LEN - 14 + 2;
    const bell = new Cairo.LinearGradient(cx - 6, 0, cx + 6, 0);
    stop(bell, 0, '#a86f00');
    stop(bell, 0.45, '#ffe08a');
    stop(bell, 1, '#a86f00');
    cr.newPath();
    cr.moveTo(cx - 6, by + 9);
    cr.curveTo(cx - 6, by, cx - 3, by - 1, cx, by - 1);
    cr.curveTo(cx + 3, by - 1, cx + 6, by, cx + 6, by + 9);
    cr.closePath();
    cr.setSource(bell);
    cr.fill();
    rgba(cr, '#7a4f00');
    cr.arc(cx, by + 10, 1.8, 0, Math.PI * 2);
    cr.fill();
    cr.$dispose();
}

function drawGlow(area) {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    const g = new Cairo.RadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    stop(g, 0, '#ffb347', 0.55);
    stop(g, 0.35, '#ff8c1a', 0.22);
    stop(g, 1, '#ff5e1a', 0);
    cr.setSource(g);
    cr.paint();
    cr.$dispose();
}

function drawHook(area) {
    const cr = area.get_context();
    const [w] = area.get_surface_size();
    const cx = w / 2;
    const g = new Cairo.LinearGradient(cx - 7, 0, cx + 7, 0);
    stop(g, 0, '#8a5a00');
    stop(g, 0.5, '#ffe08a');
    stop(g, 1, '#8a5a00');
    cr.setSource(g);
    cr.rectangle(cx - 9, 0, 18, 4);
    cr.fill();
    cr.setSource(g);
    cr.setLineWidth(2.6);
    cr.arc(cx, 9, 4.5, 0, Math.PI * 2);
    cr.stroke();
    cr.$dispose();
}

// petals: marigold, rose, jasmine, sparkle
const PETALS = [
    {kind: 'marigold', w: 3}, {kind: 'rose', w: 3}, {kind: 'jasmine', w: 2}, {kind: 'spark', w: 2},
];

function drawPetal(area, kind, hue) {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    const cx = w / 2, cy = h / 2;
    if (kind === 'marigold') {
        cr.newPath();
        cr.moveTo(cx, cy - 7);
        cr.curveTo(cx + 7, cy - 6, cx + 7, cy + 5, cx + 2, cy + 7);
        cr.lineTo(cx, cy + 5);
        cr.lineTo(cx - 2, cy + 7);
        cr.curveTo(cx - 7, cy + 5, cx - 7, cy - 6, cx, cy - 7);
        rgba(cr, hue);
        cr.fillPreserve();
        rgba(cr, '#b33d00', 0.5);
        cr.setLineWidth(0.7);
        cr.stroke();
    } else if (kind === 'rose') {
        cr.newPath();
        cr.moveTo(cx, cy + 8);
        cr.curveTo(cx - 9, cy + 1, cx - 6, cy - 8, cx, cy - 6);
        cr.curveTo(cx + 6, cy - 8, cx + 9, cy + 1, cx, cy + 8);
        const g = new Cairo.RadialGradient(cx - 2, cy - 2, 0, cx, cy, 9);
        stop(g, 0, '#ff6b8b');
        stop(g, 1, hue);
        cr.setSource(g);
        cr.fill();
    } else if (kind === 'jasmine') {
        for (let i = 0; i < 5; i++) {
            cr.save();
            cr.translate(cx, cy);
            cr.rotate((i * Math.PI * 2) / 5);
            cr.newPath();
            cr.moveTo(0, 0);
            cr.curveTo(-3.5, -3, -2.5, -7.5, 0, -8);
            cr.curveTo(2.5, -7.5, 3.5, -3, 0, 0);
            rgba(cr, '#fffdf5');
            cr.fillPreserve();
            cr.setSourceRGBA(0.85, 0.82, 0.7, 0.6);
            cr.setLineWidth(0.5);
            cr.stroke();
            cr.restore();
        }
        rgba(cr, '#ffd24a');
        cr.arc(cx, cy, 1.6, 0, Math.PI * 2);
        cr.fill();
    } else {
        const g = new Cairo.RadialGradient(cx, cy, 0, cx, cy, w / 2);
        stop(g, 0, '#ffffff', 1);
        stop(g, 0.25, '#ffe066', 0.9);
        stop(g, 1, '#ff9f1a', 0);
        cr.setSource(g);
        cr.paint();
    }
    cr.$dispose();
}

// ---------- extension ----------

export default class DeepavaliCharm extends Extension {
    enable() {
        this._theta = 0.0;
        this._omega = 0.0;
        this._phi = 0.0;        // tassel lag angle
        this._phiV = 0.0;
        this._petals = [];
        this._dragging = null;
        this._signals = [];
        this._frac = this._loadFrac();

        this._buildActors();
        this._place();

        this._timeline = new Clutter.Timeline({actor: this._root, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => this._tick());
        this._lastFrame = 0;

        const wm = global.workspace_manager;
        this._lastWs = wm.get_active_workspace_index();
        this._connect(wm, 'active-workspace-changed', () => {
            const i = wm.get_active_workspace_index();
            const dir = Math.sign(i - this._lastWs) || 1;
            this._lastWs = i;
            // the screen slides one way, the charm lags the other
            this._kick(-dir * rand(2.2, 2.9));
        });
        this._connect(Main.overview, 'showing', () => this._kick(rand(-1, 1) > 0 ? 1.2 : -1.2));
        this._connect(Main.overview, 'hiding', () => this._kick(rand(-1, 1) > 0 ? 0.9 : -0.9));
        this._connect(Main.layoutManager, 'monitors-changed', () => this._place());
        this._connect(Main.layoutManager.panelBox, 'notify::height', () => this._place());

        // a gentle breeze now and then
        this._breezeId = 0;
        this._scheduleBreeze();

        // swing in on arrival
        this._theta = -0.9;
        this._wake();

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
        this._endGrab();
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        this._timeline?.stop();
        this._timeline = null;
        for (const p of this._petals)
            p.actor.destroy();
        this._petals = [];
        this._hook?.destroy();
        this._hook = null;
        this._root?.destroy();
        this._root = null;
    }

    _connect(obj, sig, fn) {
        this._signals.push([obj, obj.connect(sig, fn)]);
    }

    _buildActors() {
        const s = St.ThemeContext.get_for_stage(global.stage).scale_factor * 1.2;
        this._s = s;

        this._root = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            width: W * s, height: H * s,
            pivot_point: new Graphene.Point({x: 0.5, y: 0}),
            reactive: false,
        });

        const glowSize = 210 * s;
        this._glow = new St.DrawingArea({width: glowSize, height: glowSize});
        this._glow.set_position((W * s - glowSize) / 2, STAR_CY * s - glowSize / 2);
        this._glow.connect('repaint', drawGlow);

        const cord = new St.DrawingArea({width: W * s, height: (CORD + 8) * s});
        cord.connect('repaint', drawCord);

        this._tassels = new St.DrawingArea({
            width: 60 * s, height: (TASSEL_LEN + 4) * s,
            pivot_point: new Graphene.Point({x: 0.5, y: 0}),
            reactive: true,
        });
        // hang from the star's bottom inner corner
        this._tassels.set_position((W - 60) / 2 * s, (STAR_CY + STAR_R * 0.36) * s);
        this._tassels.connect('repaint', drawTassels);

        const box = (STAR_R * 2 + 14) * s;
        this._star = new St.DrawingArea({width: box, height: box, reactive: true, track_hover: true});
        this._star.set_position((W * s - box) / 2, STAR_CY * s - box / 2);
        this._star.connect('repaint', drawStar);

        this._root.add_child(this._glow);
        this._root.add_child(cord);
        this._root.add_child(this._tassels);
        this._root.add_child(this._star);

        for (const a of [this._star, this._tassels]) {
            a.connect('button-press-event', (_a, ev) => this._onPress(ev, 'charm'));
            a.connect('motion-event', (_a, ev) => this._onMotion(ev));
            a.connect('button-release-event', (_a, ev) => this._onRelease(ev));
            a.connect('enter-event', () => global.display.set_cursor(Meta.Cursor.POINTING_HAND));
            a.connect('leave-event', () => {
                if (!this._dragging)
                    global.display.set_cursor(Meta.Cursor.DEFAULT);
            });
        }

        // the hook on the top bar: drag it sideways to move where the charm hangs
        this._hook = new St.DrawingArea({width: 24 * s, height: 16 * s, reactive: true});
        this._hook.connect('repaint', drawHook);
        this._hook.connect('button-press-event', (_a, ev) => this._onPress(ev, 'hook'));
        this._hook.connect('motion-event', (_a, ev) => this._onMotion(ev));
        this._hook.connect('button-release-event', (_a, ev) => this._onRelease(ev));
        this._hook.connect('enter-event', () => global.display.set_cursor(Meta.Cursor.MOVE_OR_RESIZE_WINDOW));
        this._hook.connect('leave-event', () => {
            if (!this._dragging)
                global.display.set_cursor(Meta.Cursor.DEFAULT);
        });

        Main.layoutManager.addChrome(this._root, {affectsInputRegion: true, trackFullscreen: true});
        Main.layoutManager.addChrome(this._hook, {affectsInputRegion: true, trackFullscreen: true});
    }

    _place() {
        if (!this._root)
            return;
        const mon = Main.layoutManager.primaryMonitor;
        if (!mon)
            return;
        const pb = Main.layoutManager.panelBox;
        const s = this._s;
        const margin = 40 * s;
        this._ax = Math.round(mon.x + margin + this._frac * (mon.width - 2 * margin));
        this._ay = pb.y + pb.height - 2 * s;
        this._root.set_position(this._ax - (W * s) / 2, this._ay);
        this._hook.set_position(this._ax - 12 * s, this._ay - 3 * s);
        this._mon = mon;
        this._apply();
    }

    _apply() {
        this._root.rotation_angle_z = (-this._theta * 180) / Math.PI;
        this._tassels.rotation_angle_z = (-this._phi * 180) / Math.PI;
    }

    _kick(dw) {
        this._omega += dw;
        this._wake();
    }

    _wake() {
        if (this._timeline && !this._timeline.is_playing()) {
            this._lastFrame = 0;
            this._timeline.start();
        }
    }

    _scheduleBreeze() {
        this._breezeId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, Math.round(rand(25, 50)), () => {
            if (Math.abs(this._omega) < 0.3)
                this._kick(rand(0.18, 0.4) * (Math.random() < 0.5 ? -1 : 1));
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

        const steps = 4;
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
            let alpha;
            if (this._dragging?.what === 'charm') {
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
            // tassels lag behind the star's swing
            const phiA = -TASSEL_K * this._phi - TASSEL_DAMP * this._phiV - 0.9 * alpha;
            this._phiV += phiA * h;
            this._phi = Math.max(-0.9, Math.min(0.9, this._phi + this._phiV * h));
        }
        if (this._dragging?.what === 'charm') {
            // feed the drag's angular speed into the tassels
            const d = this._dragging;
            this._phiV -= (d.omega - (d.lastOmega ?? 0)) * 0.6;
            d.lastOmega = d.omega;
        }
        this._apply();
        this._stepPetals(dt);

        const still = Math.abs(this._theta) < 0.0015 && Math.abs(this._omega) < 0.003 &&
            Math.abs(this._phi) < 0.002 && Math.abs(this._phiV) < 0.005;
        if (still && !this._dragging && this._petals.length === 0) {
            this._theta = this._omega = this._phi = this._phiV = 0;
            this._apply();
            this._timeline.stop();
        }
    }

    // ----- input -----

    _pointerAngle(x, y) {
        return Math.atan2(x - this._ax, y - this._ay);
    }

    _onPress(ev, what) {
        if (ev.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = ev.get_coords();
        this._dragging = {
            what, x0: x, y0: y, moved: false,
            off: what === 'charm' ? this._theta - this._pointerAngle(x, y) : 0,
            t: ev.get_time(), theta: this._theta, omega: 0,
            ax0: this._ax, lastX: x,
        };
        this._grab = global.stage.grab(what === 'hook' ? this._hook : this._star);
        // the star might be released over the tassels; route both to the same handlers
        this._wake();
        return Clutter.EVENT_STOP;
    }

    _onMotion(ev) {
        const d = this._dragging;
        if (!d)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = ev.get_coords();
        if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > CLICK_SLOP * this._s)
            d.moved = true;
        if (!d.moved)
            return Clutter.EVENT_STOP;

        const t = ev.get_time();
        const dtMs = Math.max(1, t - d.t);
        if (d.what === 'charm') {
            let th = this._pointerAngle(x, y) + d.off;
            th = Math.max(-2.6, Math.min(2.6, th));
            const w = ((th - d.theta) * 1000) / dtMs;
            d.omega = d.omega * 0.6 + w * 0.4;
            d.theta = th;
            this._theta = th;
        } else {
            const mon = this._mon;
            const margin = 40 * this._s;
            const nx = Math.max(mon.x + margin, Math.min(mon.x + mon.width - margin, d.ax0 + (x - d.x0)));
            const dx = nx - this._ax;
            this._frac = (nx - mon.x - margin) / (mon.width - 2 * margin);
            this._place();
            // moving the hook drags the charm behind it
            this._omega -= dx * 0.012;
        }
        d.t = t;
        this._wake();
        return Clutter.EVENT_STOP;
    }

    _onRelease(ev) {
        const d = this._dragging;
        if (!d)
            return Clutter.EVENT_PROPAGATE;
        this._endGrab();
        this._dragging = null;
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        if (d.what === 'charm') {
            if (d.moved) {
                // a stale velocity (pointer held still) shouldn't fling it
                const idle = ev.get_time() - d.t;
                this._omega = idle > 120 ? 0 : Math.max(-14, Math.min(14, d.omega));
            } else {
                this._shower();
            }
        } else if (d.moved) {
            this._saveFrac();
        }
        this._wake();
        return Clutter.EVENT_STOP;
    }

    _endGrab() {
        if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
        }
    }

    // ----- petals -----

    _starCenter() {
        const s = this._s;
        const L = STAR_CY * s;
        return [this._ax + Math.sin(this._theta) * L, this._ay + Math.cos(this._theta) * L];
    }

    _shower() {
        const [cx, cy] = this._starCenter();
        const s = this._s;
        const total = PETALS.reduce((a, p) => a + p.w, 0);
        const n = 60;
        for (let i = 0; i < n; i++) {
            let r = Math.random() * total;
            const spec = PETALS.find(p => (r -= p.w) < 0) ?? PETALS[0];
            const size = (spec.kind === 'spark' ? rand(10, 18) : rand(15, 21)) * s;
            const hue = spec.kind === 'marigold'
                ? pick(['#ff8c1a', '#ffa41b', '#ffb52e', '#f76707'])
                : pick(['#c2185b', '#d6336c', '#a61e4d', '#e64980']);
            const actor = new St.DrawingArea({
                width: size, height: size, reactive: false,
                pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            });
            actor.connect('repaint', a => drawPetal(a, spec.kind, hue));
            Main.layoutManager.uiGroup.add_child(actor);
            const ang = rand(-Math.PI, 0);   // fan out upward and sideways
            const sp = rand(140, 460) * s;
            const p = {
                actor, kind: spec.kind, size,
                x: cx + rand(-14, 14) * s, y: cy + rand(-14, 14) * s,
                vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.9 - 60 * s,
                rot: rand(0, 360), vr: rand(-260, 260),
                flutter: rand(1.5, 3.5), phase: rand(0, 6.28), amp: rand(18, 46) * s,
                age: 0, life: spec.kind === 'spark' ? rand(0.6, 1.2) : rand(5, 8),
            };
            this._petals.push(p);
        }
        // the star jumps a little when tapped
        this._kick(rand(0.6, 1.0) * (Math.random() < 0.5 ? -1 : 1));
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
                // falling leaf: gravity, strong air drag, side-to-side drift
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
            // a tumbling petal shows its edge now and then
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

    _loadFrac() {
        try {
            const [ok, bytes] = GLib.file_get_contents(CONFIG);
            if (ok) {
                const v = JSON.parse(new TextDecoder().decode(bytes)).anchor;
                if (typeof v === 'number' && v >= 0 && v <= 1)
                    return v;
            }
        } catch (e) {}
        return 0.93;   // top right
    }

    _saveFrac() {
        try {
            GLib.file_set_contents(CONFIG, JSON.stringify({anchor: this._frac}));
        } catch (e) {
            console.warn(`deepavali-charm: could not save position: ${e}`);
        }
    }

    // ----- self test (only when DEEPAVALI_CHARM_TEST=<dir> is set) -----

    _runTest(dir) {
        const shots = [
            [2.5, 'rest', () => {}],
            [3.0, 'swing', () => {
                this._theta = 0.0;
                this._omega = 0;
                this._kick(2.6);
            }],
            [3.35, 'swing_peak', () => {}],
            [4.5, 'shower', () => this._shower()],
            [4.85, 'shower_0.35s', () => {}],
            [5.7, 'shower_1.2s', () => {}],
            [7.5, 'shower_3s', () => {}],
        ];
        const t0 = GLib.get_monotonic_time() / 1e6;
        let i = 0;
        const shooter = new Shell.Screenshot();
        this._testId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            const t = GLib.get_monotonic_time() / 1e6 - t0;
            if (i >= shots.length) {
                this._testId = 0;
                GLib.file_set_contents(`${dir}/done`, 'ok');
                return GLib.SOURCE_REMOVE;
            }
            if (t >= shots[i][0]) {
                const [, name, fn] = shots[i++];
                fn();
                const file = Gio.File.new_for_path(`${dir}/${name}.png`);
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
            return GLib.SOURCE_CONTINUE;
        });
    }
}
