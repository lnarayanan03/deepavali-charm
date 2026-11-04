// The lamp, its physics and the mouse handling for the desktop app. This mirrors
// extension.js (the GNOME version) and draws with the same shared draw.js.

import {
    useCairo, W, CHAIN_W, LAMP_W, LAMP_H, RIM_Y, DROP_W, DROP_H, DROP_Y, DEFAULT_LEN, MIN_LEN,
    WICKS, PETALS, spoutTip, rand, pick, clamp, Flicker,
    G, DAMP, DROP_K, DROP_DAMP, CLICK_SLOP, STRETCH_DEAD, LEN_K, LEN_DAMP,
    drawGarland, drawLamp, drawDrop, drawFlame, drawGlow, drawHook, drawPetal,
    isBack, drawOilDrop, Spill, spoutWorld, dropStart, DROP_GRAVITY, Sounds, Lights, HOLD_MS,
    drawSky, Crackers, DOUBLE_MS,
} from './draw.js';
import {CanvasCairo, wrap} from './cairo-canvas.js';

useCairo(CanvasCairo);

const api = window.charm;
const params = new URLSearchParams(location.search);
const S = 1.2;                      // same size as on GNOME at scale 1
const dpr = () => window.devicePixelRatio || 1;

// an offscreen picture, redrawn only when marked dirty (like an St.DrawingArea)
class Sprite {
    constructor(w, h, fn) {
        this.w = w;
        this.h = h;
        this.fn = fn;
        this.canvas = document.createElement('canvas');
        this.dirty = true;
    }

    resize(w, h) {
        if (w !== this.w || h !== this.h) {
            this.w = w;
            this.h = h;
            this.dirty = true;
        }
    }

    get() {
        if (this.dirty) {
            const k = dpr();
            const pw = Math.max(1, Math.round(this.w * k)), ph = Math.max(1, Math.round(this.h * k));
            this.canvas.width = pw;
            this.canvas.height = ph;
            const ctx = this.canvas.getContext('2d');
            ctx.clearRect(0, 0, pw, ph);
            this.fn(wrap(ctx), pw, ph);
            this.dirty = false;
        }
        return this.canvas;
    }

    draw(ctx, x, y) {
        ctx.drawImage(this.get(), x, y, this.w, this.h);
    }
}

// ---------- sound ----------

let soundOn = true;
const sounds = {};
function playSound(name) {
    if (params.get('test'))
        api.test.log(`sound ${name}`);
    if (!soundOn)
        return;
    // the files carry their own gentle levels; play them as they are
    sounds[name] ??= new Audio(`sounds/${name}.wav`);
    const a = sounds[name].cloneNode();
    a.volume = 0.9;
    a.play().catch(() => {});
}

// ---------- state ----------

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let view = {width: window.innerWidth, height: window.innerHeight};

const st = {
    theta: -0.9, omega: 0, phi: 0, phiV: 0,     // swing, and the bell drop's lag
    len: DEFAULT_LEN, restLen: DEFAULT_LEN, lenV: 0,
    frac: 0.93, flare: 0,
    drag: null, interactive: false,
    petals: [], oil: [],
};
const sfx = new Sounds(playSound);
const spill = new Spill();

const glowSize = 250 * S;
const glow = new Sprite(glowSize, glowSize, (cr, w, h) => drawGlow(cr, w, h));
const drop = new Sprite(DROP_W * S, DROP_H * S, (cr, w, h) => drawDrop(cr, w, h));
const lampBack = new Sprite(LAMP_W * S, LAMP_H * S, (cr, w, h) => drawLamp(cr, w, h, 'back'));
const lampFront = new Sprite(LAMP_W * S, LAMP_H * S, (cr, w, h) => drawLamp(cr, w, h, 'front'));
const garland = new Sprite(CHAIN_W * S, (DEFAULT_LEN + 6) * S, (cr, w, h) => drawGarland(cr, w, h, st.len));
const hook = new Sprite(24 * S, 16 * S, (cr, w, h) => drawHook(cr, w, h));
const glowState = {opacity: 1, scale: 1};

const flames = WICKS.map(([ang, fw, fh]) => {
    const [tx, ty] = spoutTip(ang);
    const f = {tx, ty, back: isBack(ang), bend: 0, rot: 0, sx: 1, sy: 1,
        flick: new Flicker(), sway: new Flicker()};
    f.sprite = new Sprite(Math.round(fw * 1.9 * S), Math.round(fh * 1.2 * S), (cr, w, h) => drawFlame(cr, w, h, f));
    return f;
});
const lights = new Lights(flames.map(f => f.tx), playSound);
const crackers = new Crackers(playSound);
// the whole-screen layer for the gust and the crackers
const sky = {
    get W() {
        return view.width;
    },
    get H() {
        return view.height;
    },
    get gust() {
        return {...lights.gust, y: lampCenter()[1] - 14 * S, s: S};
    },
    crackers,
};
let clickTimer = 0;
const cancelClick = () => {
    clearTimeout(clickTimer);
    clickTimer = 0;
};
// double-click: a few rockets go up across the screen
function crackersUp() {
    if (crackers.launch(performance.now() / 1000, view.width, view.height, S)) {
        st.flare = 1;
        st.omega += rand(0.2, 0.35) * (Math.random() < 0.5 ? -1 : 1);
    }
}
let holdTimer = 0;
const cancelHold = () => {
    clearTimeout(holdTimer);
    holdTimer = 0;
};

// the hook point, in page px
const anchor = () => {
    const margin = 40 * S;
    return [Math.round(margin + st.frac * (view.width - 2 * margin)), 3 * S];
};
const maxLen = () => Math.max(MIN_LEN + 20, view.height / S - DROP_Y - DROP_H - 30);

function setLen(len) {
    if (len === st.len)
        return;
    st.len = len;
    garland.resize(CHAIN_W * S, (len + 6) * S);
    garland.dirty = true;
}

function resize() {
    const k = dpr();
    canvas.width = Math.round(view.width * k);
    canvas.height = Math.round(view.height * k);
    st.restLen = clamp(st.restLen, MIN_LEN, maxLen());
    setLen(clamp(st.len, MIN_LEN, maxLen()));
    for (const sp of [glow, drop, lampBack, lampFront, garland, hook, ...flames.map(f => f.sprite)])
        sp.dirty = true;
}

// ---------- physics ----------

function stepSwing(dt) {
    const K = G / (st.len + 90);
    const steps = 4, h = dt / steps;
    const held = st.drag?.what === 'charm' && st.drag.moved;
    let alpha = 0;
    for (let i = 0; i < steps; i++) {
        if (!held) {
            alpha = -K * Math.sin(st.theta) - DAMP * st.omega;
            st.omega += alpha * h;
            st.theta += st.omega * h;
            if (st.theta > Math.PI)
                st.theta -= 2 * Math.PI;
            if (st.theta < -Math.PI)
                st.theta += 2 * Math.PI;
        }
        // the bell drop lags behind the bowl's swing
        const phiA = -DROP_K * st.phi - DROP_DAMP * st.phiV - 0.9 * alpha;
        st.phiV += phiA * h;
        st.phi = clamp(st.phi + st.phiV * h, -0.9, 0.9);
    }
    if (held) {
        const d = st.drag;
        st.phiV -= (d.omega - (d.lastOmega ?? 0)) * 0.6;
        d.lastOmega = d.omega;
    }
    return held;
}

// rubber band: when let go, the chain springs back to its set length
function stepLength(dt) {
    if (st.drag?.stretch && st.drag.moved)
        return;
    const off = st.len - st.restLen;
    if (Math.abs(off) < 0.2 && Math.abs(st.lenV) < 1) {
        st.lenV = 0;
        setLen(st.restLen);
        return;
    }
    const steps = 4, h = dt / steps;
    let len = st.len;
    for (let i = 0; i < steps; i++) {
        st.lenV += (-LEN_K * (len - st.restLen) - LEN_DAMP * st.lenV) * h;
        len += st.lenV * h;
    }
    setLen(clamp(len, MIN_LEN * 0.6, maxLen() + 40));
}

function stepFlames(t, dt, omega) {
    // the flames trail behind the lamp as it moves and stretch with speed
    const speed = omega * (st.len + RIM_Y);
    st.flare = Math.max(0, st.flare - dt * 0.8);
    lights.tick(t, dt);
    let sum = 0;
    flames.forEach((f, i) => {
        const n = f.flick.at(t, dt);
        const sw = f.sway.at(t * 0.7, dt);
        // hot air rises, motion pushes the tip back, a gust bends it over
        const lean = clamp(speed * 0.0012, -0.6, 0.6) + sw * 0.07 + lights.lean;
        const level = lights.levels[i], smoke = lights.smoke[i], ember = lights.ember[i];
        const changed = Math.abs(level - (f.level ?? 1)) > 0.003 || smoke > 0 || (f.smoke ?? 0) > 0 ||
            ember > 0 || (f.ember ?? 0) > 0;
        f.level = level;
        f.smoke = smoke;
        f.ember = ember;
        f.t = t;
        f.rot = st.theta - lean;           // undo the lamp's tilt so the flame stays upright
        f.sy = 1 + 0.13 * n + Math.min(0.35, Math.abs(speed) * 0.0007) + 0.25 * st.flare;
        f.sx = 1 - 0.07 * n + 0.1 * st.flare;
        const bend = clamp(sw * 0.55 - lean * 0.8, -1, 1);
        if (Math.abs(bend - f.bend) > 0.01 || changed) {
            f.bend = bend;
            f.sprite.dirty = true;
        }
        sum += n;
    });
    const g = sum / flames.length;
    glowState.opacity = clamp(((215 + 40 * g + 40 * st.flare) / 255) * lights.glow, 0, 1);
    glowState.scale = 1 + 0.05 * g + 0.12 * st.flare;
}

const oilDrop = new Sprite(5 * S, 7.5 * S, (cr, pw, ph) => drawOilDrop(cr, pw, ph));

// a hard swing slops a few drops of oil off the lowest lip; they drip and fade
function stepOil(now, dt, omega) {
    const [ax, ay] = anchor();
    let n = spill.tick(now, dt, st.theta, omega);
    while (n-- > 0 && st.oil.length < 24) {
        const tips = flames.map(f => spoutWorld(f.tx, f.ty, st.len, st.theta, omega, S));
        tips.sort((a, b) => b.y - a.y);
        const p = tips[Math.random() < 0.75 ? 0 : 1];
        const d = dropStart(p, S);
        st.oil.push({...d, x: ax + d.x, y: ay + d.y, age: 0});
    }
    st.oil = st.oil.filter(o => {
        o.age += dt;
        o.vy += DROP_GRAVITY * S * dt;
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        return o.y < view.height + 20 * S && o.age < o.life;
    });
}

function stepPetals(dt) {
    st.petals = st.petals.filter(p => {
        p.age += dt;
        if (p.kind === 'spark') {
            p.vx *= Math.exp(-3 * dt);
            p.vy = p.vy * Math.exp(-3 * dt) + 60 * S * dt;
        } else {
            p.vy += 520 * S * dt;
            const term = 95 * S;
            if (p.vy > term)
                p.vy += (term - p.vy) * Math.min(1, 4 * dt);
            p.vx *= Math.exp(-1.6 * dt);
        }
        p.sway = p.kind === 'spark' ? 0 : Math.sin(p.age * p.flutter + p.phase) * p.amp * Math.min(1, p.age);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        return p.age < p.life && p.y < view.height + 30 * S;
    });
}

function lampCenter() {
    const [ax, ay] = anchor();
    const L = (st.len + RIM_Y) * S;
    return [ax + Math.sin(st.theta) * L, ay + Math.cos(st.theta) * L];
}

function shower() {
    const [cx, cy] = lampCenter();
    const total = PETALS.reduce((a, p) => a + p.w, 0);
    for (let i = 0; i < 60; i++) {
        let r = Math.random() * total;
        const spec = PETALS.find(p => (r -= p.w) < 0) ?? PETALS[0];
        const size = (spec.kind === 'spark' ? rand(10, 18) : rand(15, 21)) * S;
        const hue = spec.kind === 'marigold'
            ? pick(['#ff8c1a', '#ffa41b', '#ffb52e', '#f76707'])
            : pick(['#c2185b', '#d6336c', '#a61e4d', '#e64980']);
        const ang = rand(-Math.PI, 0);
        const sp = rand(140, 460) * S;
        st.petals.push({
            kind: spec.kind, size,
            sprite: new Sprite(size, size, (cr, w, h) => drawPetal(cr, w, h, spec.kind, hue)),
            x: cx + rand(-14, 14) * S, y: cy + rand(-14, 14) * S,
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.9 - 60 * S,
            rot: rand(0, 360), vr: rand(-260, 260),
            flutter: rand(1.5, 3.5), phase: rand(0, 6.28), amp: rand(18, 46) * S, sway: 0,
            age: 0, life: spec.kind === 'spark' ? rand(0.6, 1.2) : rand(5, 8),
        });
    }
    st.omega += rand(0.6, 1.0) * (Math.random() < 0.5 ? -1 : 1);
    st.flare = 1;
}

// ---------- drawing ----------

function render() {
    const k = dpr();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    const [ax, ay] = anchor();
    const L = st.len;

    // everything hanging rotates about the hook
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(-st.theta);
    ctx.translate(-W * S / 2, 0);

    ctx.save();
    ctx.globalAlpha = glowState.opacity;
    ctx.translate(W * S / 2, (L + RIM_Y - 8) * S);
    ctx.scale(glowState.scale, glowState.scale);
    glow.draw(ctx, -glowSize / 2, -glowSize / 2);
    ctx.restore();

    ctx.save();
    ctx.translate(W * S / 2, (L + DROP_Y) * S);
    ctx.rotate(-st.phi);
    drop.draw(ctx, -DROP_W * S / 2, 0);
    ctx.restore();

    garland.draw(ctx, (W - CHAIN_W) / 2 * S, 0);
    const lx = (W - LAMP_W) / 2 * S, ly = L * S;
    lampBack.draw(ctx, lx, ly);
    const drawFlames = back => {
        for (const f of flames) {
            if (f.back !== back)
                continue;
            ctx.save();
            ctx.translate(W / 2 * S + f.tx * S, (L + f.ty + 1) * S);
            ctx.rotate(f.rot);
            ctx.scale(f.sx, f.sy);
            f.sprite.draw(ctx, -f.sprite.w / 2, -f.sprite.h);
            ctx.restore();
        }
    };
    drawFlames(true);
    lampFront.draw(ctx, lx, ly);
    drawFlames(false);
    ctx.restore();

    hook.draw(ctx, ax - 12 * S, ay - 3 * S);

    // the gust sweeps the whole screen, level with the flames near the lamp
    if (lights.wind > 0 || crackers.active)
        drawSky(wrap(ctx), view.width, view.height, sky);

    for (const o of st.oil) {
        ctx.save();
        // fade in as it leaves the lip, out as it falls
        ctx.globalAlpha = clamp(o.age / 0.08, 0, 1) * clamp((o.life - o.age) / 0.4, 0, 1);
        ctx.translate(o.x, o.y);
        ctx.rotate(Math.atan2(-o.vx, o.vy));
        const k = o.size / oilDrop.w;
        ctx.scale(k, k * (1 + Math.min(0.9, Math.hypot(o.vx, o.vy) / (900 * S))));
        oilDrop.draw(ctx, -oilDrop.w / 2, -oilDrop.h * 0.6);
        ctx.restore();
    }
    for (const p of st.petals) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, (p.life - p.age) / 0.8));
        ctx.translate(p.x + p.sway, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        if (p.kind !== 'spark')
            ctx.scale(0.35 + 0.65 * Math.abs(Math.cos(p.age * p.flutter * 0.8 + p.phase)), 1);
        p.sprite.draw(ctx, -p.size / 2, -p.size / 2);
        ctx.restore();
    }
}

// ---------- frame loop ----------

let last = 0;
function frame(ms) {
    const now = ms / 1000;
    const dt = Math.min(last ? now - last : 1 / 60, 1 / 20);
    last = now;
    const held = stepSwing(dt);
    stepLength(dt);
    const omega = held ? st.drag.omega : st.omega;
    stepFlames(now, dt, omega);
    stepPetals(dt);
    crackers.tick(now, dt);
    stepOil(now, dt, omega);
    sfx.tick(now, st.theta, omega);
    render();
    requestAnimationFrame(frame);
}

// a gentle breeze now and then
function breeze() {
    if (Math.abs(st.omega) < 0.3) {
        st.omega += rand(0.18, 0.4) * (Math.random() < 0.5 ? -1 : 1);
        st.flare = Math.max(st.flare, 0.6);
    }
    setTimeout(breeze, rand(25, 50) * 1000);
}

// ---------- mouse ----------

// what's under the pointer: 'hook', 'charm' or null
function hitTest(x, y) {
    const [ax, ay] = anchor();
    if (Math.abs(x - ax) < 14 * S && y >= ay - 4 * S && y <= ay + 14 * S)
        return 'hook';
    // into the lamp's own frame (undo the swing)
    const dx = x - ax, dy = y - ay;
    const c = Math.cos(st.theta), n = Math.sin(st.theta);
    const lx = (dx * c - dy * n) / S + W / 2, ly = (dx * n + dy * c) / S;
    const L = st.len;
    const inBox = (x0, y0, w, h) => lx >= x0 && lx <= x0 + w && ly >= y0 && ly <= y0 + h;
    if (inBox((W - CHAIN_W) / 2 + 12, 0, CHAIN_W - 24, L + 6) ||
        inBox((W - LAMP_W) / 2 + 2, L, LAMP_W - 4, LAMP_H - 8) ||
        inBox((W - DROP_W) / 2 + 8, L + DROP_Y, DROP_W - 16, DROP_H))
        return 'charm';
    return null;
}

function setInteractive(on) {
    if (on !== st.interactive) {
        st.interactive = on;
        api.setInteractive(on);
    }
}

function hover(x, y) {
    const what = hitTest(x, y);
    canvas.style.cursor = what === 'hook' ? 'ew-resize' : what ? 'pointer' : 'default';
    setInteractive(!!what);
}

const pointerAngle = (x, y) => {
    const [ax, ay] = anchor();
    return Math.atan2(x - ax, y - ay);
};
// Ctrl+drag sets the length; on a Mac, Cmd works too
const setMode = e => e.ctrlKey || e.metaKey;

canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0)
        return;
    const what = hitTest(e.clientX, e.clientY);
    if (!what)
        return;
    const [ax, ay] = anchor();
    canvas.setPointerCapture(e.pointerId);
    st.lenV = 0;
    st.drag = {
        what, x0: e.clientX, y0: e.clientY, moved: false,
        off: what === 'charm' ? st.theta - pointerAngle(e.clientX, e.clientY) : 0,
        r0: Math.hypot(e.clientX - ax, e.clientY - ay), len0: st.len,
        t: e.timeStamp, theta: st.theta, omega: 0, lenV: 0, frac0: st.frac,
        ctrl: setMode(e),
    };
    canvas.style.cursor = 'grabbing';
    sfx.touch(performance.now() / 1000);
    // press and hold without moving: a gust blows the flames out
    cancelHold();
    if (what === 'charm') {
        holdTimer = setTimeout(() => {
            holdTimer = 0;
            const d = st.drag;
            if (d && !d.moved && lights.blowOut(performance.now() / 1000))
                d.held = true;
        }, HOLD_MS);
    }
});

canvas.addEventListener('pointermove', e => {
    const d = st.drag;
    if (!d) {
        hover(e.clientX, e.clientY);
        return;
    }
    const x = e.clientX, y = e.clientY;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > CLICK_SLOP) {
        d.moved = true;
        // mostly up/down stretches the chain; otherwise it's a swing
        d.stretch = Math.abs(y - d.y0) > 1.4 * Math.abs(x - d.x0);
        cancelHold();
    }
    if (!d.moved)
        return;
    const dtMs = Math.max(1, e.timeStamp - d.t);
    const [ax, ay] = anchor();
    if (d.what === 'charm') {
        const th = clamp(pointerAngle(x, y) + d.off, -2.6, 2.6);
        d.omega = d.omega * 0.6 + (((th - d.theta) * 1000) / dtMs) * 0.4;
        d.theta = th;
        st.theta = th;
        if (d.stretch) {
            const pull = Math.hypot(x - ax, y - ay) - d.r0;
            const eff = Math.sign(pull) * Math.max(0, Math.abs(pull) - STRETCH_DEAD * S);
            const len = clamp(d.len0 + eff / S, MIN_LEN, maxLen());
            d.lenV = d.lenV * 0.6 + (((len - st.len) * 1000) / dtMs) * 0.4;
            if (Math.abs(len - st.len) > 0.5) {
                d.stretched = true;
                setLen(len);
            }
        }
    } else {
        const margin = 40 * S;
        st.frac = clamp(d.frac0 + (x - d.x0) / (view.width - 2 * margin), 0, 1);
        // moving the hook drags the lamp behind it
        st.omega -= (anchor()[0] - ax) * 0.012;
    }
    d.t = e.timeStamp;
});

function release(e) {
    const d = st.drag;
    if (!d)
        return;
    st.drag = null;
    cancelHold();
    const now = performance.now() / 1000;
    if (d.what === 'charm') {
        if (d.moved) {
            // a stale velocity (pointer held still) shouldn't fling it
            const idle = e.timeStamp - d.t;
            st.omega = idle > 120 ? 0 : clamp(d.omega, -14, 14);
            sfx.release(now, st.omega);
            if (d.stretched) {
                if (d.ctrl || setMode(e)) {
                    // Ctrl+drag: the new length sticks
                    st.restLen = st.len;
                    st.lenV = 0;
                    sfx.lengthSet(now);
                    api.saveSettings({length: Math.round(st.restLen)});
                } else {
                    // plain drag: let go and it snaps back like a rubber band
                    st.lenV = idle > 120 ? 0 : clamp(d.lenV, -1500, 1500);
                }
            }
        } else if (!d.held) {
            // wait a moment to see whether this is a double-click
            if (clickTimer) {
                cancelClick();
                crackersUp();
            } else {
                clickTimer = setTimeout(() => {
                    clickTimer = 0;
                    shower();
                    sfx.shower(performance.now() / 1000);
                }, DOUBLE_MS);
            }
        }
    } else if (d.moved) {
        sfx.hook(now);
        api.saveSettings({anchor: st.frac});
    }
    hover(e.clientX, e.clientY);
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('contextmenu', e => e.preventDefault());
// when the pointer leaves the window entirely, let clicks through again
document.addEventListener('mouseleave', () => {
    if (!st.drag)
        setInteractive(false);
});

api.onCommand(c => {
    const now = performance.now() / 1000;
    if (c === 'shower') {
        shower();
        sfx.shower(now);
    } else if (c === 'crackers') {
        crackersUp();
    } else if (c === 'chime') {
        sfx.ringBells(now);
        st.omega += rand(0.6, 1) * (Math.random() < 0.5 ? -1 : 1);
    } else if (c === 'reset') {
        st.restLen = DEFAULT_LEN;
        api.saveSettings({length: DEFAULT_LEN});
    } else if (c === 'sound-on' || c === 'sound-off') {
        soundOn = c === 'sound-on';
        api.saveSettings({sound: soundOn});
    }
});
api.onResized(size => {
    view = size;
    resize();
});
window.addEventListener('resize', () => {
    view = {width: window.innerWidth, height: window.innerHeight};
    resize();
});

// ---------- start ----------

const cfg = await api.loadSettings();
if (typeof cfg.anchor === 'number' && cfg.anchor >= 0 && cfg.anchor <= 1)
    st.frac = cfg.anchor;
if (typeof cfg.length === 'number' && cfg.length >= MIN_LEN)
    st.restLen = cfg.length;
soundOn = cfg.sound !== false;
setLen(st.restLen);
resize();

if (params.get('icon')) {
    exportIcon();
} else {
    requestAnimationFrame(frame);
    setTimeout(breeze, rand(25, 50) * 1000);
    if (params.get('test'))
        runTest();
}

// the app icon: the lamp, lit, on a transparent square
function exportIcon() {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const sc = size / (LAMP_W + 10);
    x.translate(5 * sc, size / 2 - (LAMP_H / 2 + 10) * sc);
    const draw = fn => {
        const t = document.createElement('canvas');
        t.width = Math.round(LAMP_W * sc);
        t.height = Math.round(LAMP_H * sc);
        fn(wrap(t.getContext('2d')), t.width, t.height);
        x.drawImage(t, 0, 0);
    };
    const flame = f => {
        const [, fw, fh] = WICKS.find(wk => spoutTip(wk[0])[0] === f.tx);
        const t = document.createElement('canvas');
        t.width = Math.round(fw * 1.9 * sc);
        t.height = Math.round(fh * 1.2 * sc);
        drawFlame(wrap(t.getContext('2d')), t.width, t.height, {bend: 0});
        x.drawImage(t, (LAMP_W / 2 + f.tx) * sc - t.width / 2, (f.ty + 1) * sc - t.height);
    };
    draw((cr, w, h) => drawLamp(cr, w, h, 'back'));
    flames.filter(f => f.back).forEach(flame);
    draw((cr, w, h) => drawLamp(cr, w, h, 'front'));
    flames.filter(f => !f.back).forEach(flame);
    api.test.shot('@icon', c.toDataURL('image/png'));
    api.test.done();
}

// ---------- self test (only with --test=<dir>) ----------
// drives real mouse events through Electron, logs the state and saves frames

function runTest() {
    const t = api.test;
    const log = tag => t.log(`${tag}: len=${st.len.toFixed(1)} rest=${st.restLen.toFixed(1)} ` +
        `theta=${st.theta.toFixed(3)} omega=${st.omega.toFixed(3)} oil=${st.oil.length} lights=${lights.state}`);
    const shot = name => {
        // composite over a dark desktop colour so the picture is easy to look at
        const c = document.createElement('canvas');
        c.width = canvas.width;
        c.height = canvas.height;
        const x = c.getContext('2d');
        x.fillStyle = '#2a3a55';
        x.fillRect(0, 0, c.width, c.height);
        x.drawImage(canvas, 0, 0);
        t.shot(name, c.toDataURL('image/png'));
    };
    let px = 0, py = 0, mods = [];
    const ev = (type, extra = {}) => t.input({type, x: Math.round(px), y: Math.round(py), modifiers: mods, ...extra});
    const move = () => ev('mouseMove');
    const down = () => ev('mouseDown', {button: 'left', clickCount: 1});
    const up = () => ev('mouseUp', {button: 'left', clickCount: 1});
    const steps = [];
    const at = (s, fn) => steps.push([s, fn]);
    const glide = (t0, t1, dx, dy) => {
        for (let k = 1; k <= 12; k++) {
            at(t0 + ((t1 - t0) * k) / 12, () => {
                px += dx / 12;
                py += dy / 12;
                move();
            });
        }
    };
    const grabLamp = () => {
        const [cx, cy] = lampCenter();
        px = cx;
        py = cy + 12 * S;
        move();
    };
    at(3.0, () => {
        log('rest');
        shot('rest');
    });
    at(3.3, grabLamp);
    at(3.4, down);
    glide(3.45, 4.1, 0, 160 * S);
    at(4.2, () => {
        log('pulled');
        shot('pulled');
    });
    at(4.3, up);
    at(5.3, () => {
        log('after_pull');
        shot('after_pull');
    });
    at(5.5, grabLamp);
    at(5.6, down);
    glide(5.65, 6.2, -260 * S, 0);
    glide(6.3, 6.45, 120 * S, 0);
    at(6.46, up);
    at(6.7, () => {
        log('thrown');
        shot('thrown');
    });
    // a big swing: a few drops of oil drip off the lowest lip
    at(7.2, () => {
        st.theta = 0;
        st.omega = 4.2;
    });
    at(8.1, () => {
        log('spill');
        shot('spill');
    });
    at(9.5, () => {
        st.theta = st.omega = 0;
        grabLamp();
        mods = ['control'];
    });
    at(9.6, down);
    glide(9.65, 10.2, 0, 110 * S);
    at(10.25, up);
    at(10.3, () => {
        mods = [];
    });
    at(11.0, () => {
        log('ctrl_set');
        shot('ctrl_set');
    });
    at(11.2, grabLamp);
    at(11.3, down);
    at(11.38, up);
    at(12.2, () => {
        log('shower');
        shot('shower');
    });
    // press and hold: blown out, then relit 5 s later
    at(12.6, grabLamp);
    at(12.7, down);
    at(14.4, () => {
        log('blowing');
        shot('blowing');
    });
    at(14.5, up);
    at(15.0, () => {
        log('blowing_b');
        shot('blowing_b');
    });
    at(16.6, () => {
        log('out');
        shot('out');
    });
    at(21.2, () => {
        log('relighting');
        shot('relighting');
    });
    at(23.0, () => {
        log('relighting_b');
        shot('relighting_b');
    });
    at(26.6, () => {
        log('relit');
        shot('relit');
    });
    // double-click: crackers go up across the screen, and no petals
    at(27.0, grabLamp);
    at(27.1, down);
    at(27.16, up);
    at(27.26, () => ev('mouseDown', {button: 'left', clickCount: 2}));
    at(27.32, () => ev('mouseUp', {button: 'left', clickCount: 2}));
    at(27.9, () => {
        t.log(`crackers: rockets=${crackers.rockets.length} queued=${crackers.queue.length} petals=${st.petals.length}`);
        shot('crackers_rise');
    });
    at(28.9, () => {
        t.log(`crackers_b: sparks=${crackers.sparks.length}`);
        shot('crackers_burst');
    });
    at(29.9, () => shot('crackers_bloom'));
    at(33.2, () => t.log(`crackers_done: active=${crackers.active}`));
    at(33.4, () => t.done());

    const t0 = performance.now() / 1000;
    let i = 0;
    const timer = setInterval(() => {
        const now = performance.now() / 1000 - t0;
        while (i < steps.length && now >= steps[i][0])
            steps[i++][1]();
        if (i >= steps.length)
            clearInterval(timer);
    }, 10);
}
