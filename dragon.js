// Dragon Ball charm: seven little star balls scattered round the screen. Drag them
// together; when all seven touch, the sky goes dark and the eternal dragon rises out of
// them, looks at you for a moment and vanishes, the balls flying off. Then the hero
// runs in, powers up to golden hair, fires his energy wave across the screen, flashes
// over to the other side to catch it himself, gives you a two-finger salute and
// teleports away. The balls come back a minute later.
//
// Everything is drawn here with Cairo (or the canvas look-alike), in screen px.
// Shared by the GNOME extension and the desktop app, like draw.js.

let Cairo = null;
export function useCairo(c) {
    Cairo = c;
}

export const BALL_R = 14;          // ball radius at scale 1
export const BALL_SPRITE = 4;      // the ball's picture is this many radii across (room for its glow)
// voice clips you can add yourself (voices/<name>.wav); without one, this plays instead
export const VOICES = {'goku-scream': 'db-power', 'goku-kamehameha': 'db-charge', 'goku-bye': null};
export const REST_S = 60;          // after a wish, the balls lie as stone this long

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = x => {
    const t = clamp(x, 0, 1);
    return t * t * (3 - 2 * t);
};
// 0 before a, 1 after b, smooth between
const span = (t, a, b) => smooth((t - a) / (b - a));

function rgba(cr, hex, a = 1) {
    const n = parseInt(hex.slice(1), 16);
    cr.setSourceRGBA(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
}

function stop(g, off, hex, a = 1) {
    const n = parseInt(hex.slice(1), 16);
    g.addColorStopRGBA(off, ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
}

function mixHex(h1, h2, u) {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const ch = sh => Math.round(lerp((a >> sh) & 255, (b >> sh) & 255, clamp(u, 0, 1)));
    return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

function ellipse(cr, x, y, rx, ry) {
    cr.save();
    cr.translate(x, y);
    cr.scale(rx, ry);
    cr.newPath();
    cr.arc(0, 0, 1, 0, Math.PI * 2);
    cr.restore();
}

function poly(cr, pts, close = true) {
    cr.newPath();
    cr.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++)
        cr.lineTo(pts[i][0], pts[i][1]);
    if (close)
        cr.closePath();
}

function line(cr, x0, y0, x1, y1, w, hex, a = 1) {
    cr.newPath();
    cr.moveTo(x0, y0);
    cr.lineTo(x1, y1);
    rgba(cr, hex, a);
    cr.setLineWidth(w);
    cr.stroke();
}

function glow(cr, x, y, r, hex, a) {
    if (a <= 0.003 || r <= 0)
        return;
    const g = new Cairo.RadialGradient(x, y, 0, x, y, r);
    stop(g, 0, hex, a);
    stop(g, 0.35, hex, a * 0.45);
    stop(g, 1, hex, 0);
    cr.setSource(g);
    cr.newPath();
    cr.arc(x, y, r, 0, Math.PI * 2);
    cr.fill();
}

// ---------- the balls ----------

// where the stars sit on each ball, as fractions of its radius
const STARS = [
    [],
    [[0, 0]],
    [[-0.28, -0.12], [0.28, 0.12]],
    [[0, -0.32], [-0.3, 0.2], [0.3, 0.2]],
    [[-0.27, -0.27], [0.27, -0.27], [-0.27, 0.27], [0.27, 0.27]],
    [[0, 0], [-0.34, -0.3], [0.34, -0.3], [-0.34, 0.3], [0.34, 0.3]],
    [[-0.3, -0.36], [0.3, -0.36], [-0.38, 0], [0.38, 0], [-0.3, 0.36], [0.3, 0.36]],
    [[0, 0], [0, -0.4], [0, 0.4], [-0.36, -0.2], [0.36, -0.2], [-0.36, 0.2], [0.36, 0.2]],
];

function star(cr, x, y, r) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.42 : r;
        pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    poly(cr, pts);
}

// one ball at (x, y) of radius r. lit: 0..1, how strongly it glows
// stone: 0..1, how far it has turned to plain grey stone (after a wish)
export function paintBall(cr, x, y, r, stars, lit = 0, t = 0, stone = 0) {
    const m = (hex, grey) => mixHex(hex, grey, stone);
    glow(cr, x, y, r * (1.9 + 0.2 * Math.sin(t * 3)), '#ffae3a', (0.16 + 0.5 * lit) * (1 - stone));
    // the glassy orange sphere (or a dull grey stone)
    const g = new Cairo.RadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    stop(g, 0, m('#fff0b0', '#b9b6b0'));
    stop(g, 0.25, m('#ffc24a', '#8f8b85'));
    stop(g, 0.75, m('#f08a12', '#6a6660'));
    stop(g, 1, m('#b8540a', '#45423e'));
    cr.setSource(g);
    cr.newPath();
    cr.arc(x, y, r, 0, Math.PI * 2);
    cr.fill();
    // red stars, a little blurred by the glass
    for (const [sx, sy] of STARS[stars]) {
        star(cr, x + sx * r, y + sy * r, r * (stars === 1 ? 0.42 : 0.24));
        rgba(cr, m('#d8240e', '#4a4744'), 0.95);
        cr.fill();
    }
    // the shine, and a rim of light
    ellipse(cr, x - r * 0.38, y - r * 0.45, r * 0.3, r * 0.17);
    rgba(cr, '#ffffff', 0.75 * (1 - 0.75 * stone));
    cr.fill();
    cr.newPath();
    cr.arc(x, y, r * 0.97, 0, Math.PI * 2);
    rgba(cr, m('#ffe3a0', '#2f2d2a'), 0.25 + 0.5 * lit);
    cr.setLineWidth(r * 0.08);
    cr.stroke();
}

// a ball's own small picture: w x h, ball in the middle
export function drawBall(cr, w, h, ball) {
    const r = w / BALL_SPRITE;
    paintBall(cr, w / 2, h / 2, r, ball.stars, ball.lit ?? 0, 0, ball.stone ?? 0);
}

// ---------- the eternal dragon ----------

// a smooth curve through the points (Catmull-Rom), as an arc-length table
function pathTable(wp, n = 500) {
    const pts = [];
    const P = i => wp[clamp(i, 0, wp.length - 1)];
    for (let k = 0; k <= n; k++) {
        const f = (k / n) * (wp.length - 1);
        const i = Math.min(wp.length - 2, Math.floor(f)), u = f - i;
        const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
        const c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u * u +
            (-a + 3 * b - 3 * cc + d) * u * u * u);
        pts.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
    const len = [0];
    for (let k = 1; k < pts.length; k++)
        len.push(len[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    return {pts, len, total: len[len.length - 1]};
}

function pathAt(tb, d) {
    d = clamp(d, 0, tb.total);
    let lo = 0, hi = tb.len.length - 1;
    while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (tb.len[m] < d)
            lo = m;
        else
            hi = m;
    }
    const u = (d - tb.len[lo]) / Math.max(1e-6, tb.len[hi] - tb.len[lo]);
    return [lerp(tb.pts[lo][0], tb.pts[hi][0], u), lerp(tb.pts[lo][1], tb.pts[hi][1], u)];
}

const SEGS = 120;
const D_GREEN = '#2c6a2a', GREEN = '#3f9a3c', LIGHT = '#6cc35a', BELLY = '#e6d690', LINE = '#16321a';

// the long body, tail first so the head end sits on top
function drawSerpent(cr, body, s, t) {
    const n = body.length;
    const r = k => s * lerp(44, 9, (k / Math.max(1, SEGS)) ** 0.9);
    const N = [];
    for (let k = 0; k < n; k++) {
        const a = body[Math.max(0, k - 1)], b = body[Math.min(n - 1, k + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        N.push([-dy / l, dx / l, dx / l, dy / l]);   // normal, then tangent
    }
    const strokeAlong = (off, wf, hex, a = 1) => {
        for (let k = n - 1; k > 0; k--) {
            const rr = r(k);
            const p0 = body[k], p1 = body[k - 1];
            const o0 = off * rr, o1 = off * r(k - 1);
            line(cr, p0[0] + N[k][0] * o0, p0[1] + N[k][1] * o0, p1[0] + N[k - 1][0] * o1, p1[1] + N[k - 1][1] * o1,
                wf(rr), hex, a);
        }
    };
    // claws: four short legs reaching out from the belly
    for (const f of [0.13, 0.19, 0.56, 0.62]) {
        const k = Math.round(f * (n - 1));
        const [x, y] = body[k], [nx, ny, tx, ty] = N[k];
        const rr = r(k), sw = Math.sin(t * 3 + k) * 0.3;
        const kx = x + nx * rr * 1.7 + tx * rr * (0.6 + sw), ky = y + ny * rr * 1.7 + ty * rr * (0.6 + sw);
        line(cr, x, y, kx, ky, rr * 0.7, LINE);
        line(cr, x, y, kx, ky, rr * 0.5, GREEN);
        for (const c of [-0.6, 0, 0.6]) {
            const cx = kx + (nx * Math.cos(c) - tx * Math.sin(c)) * rr * 0.55;
            const cy = ky + (ny * Math.cos(c) - ty * Math.sin(c)) * rr * 0.55;
            line(cr, kx, ky, cx, cy, s * 2.2, '#efe6c0');
        }
    }
    // back fins, sweeping toward the tail
    for (let k = n - 4; k > 2; k -= 4) {
        const [x, y] = body[k], [nx, ny, tx, ty] = N[k], rr = r(k);
        poly(cr, [
            [x - nx * rr * 0.8 - tx * rr * 0.45, y - ny * rr * 0.8 - ty * rr * 0.45],
            [x - nx * rr * 1.65 + tx * rr * 0.7, y - ny * rr * 1.65 + ty * rr * 0.7],
            [x - nx * rr * 0.8 + tx * rr * 0.55, y - ny * rr * 0.8 + ty * rr * 0.55],
        ]);
        rgba(cr, D_GREEN);
        cr.fillPreserve();
        rgba(cr, LINE);
        cr.setLineWidth(s * 1.2);
        cr.stroke();
    }
    strokeAlong(0, rr => 2 * rr + 3.2 * s, LINE);
    strokeAlong(0, rr => 2 * rr, GREEN);
    strokeAlong(-0.42, rr => rr * 0.5, LIGHT, 0.75);
    strokeAlong(0.55, rr => rr * 0.62, BELLY);
    // belly plates
    for (let k = n - 2; k > 1; k -= 2) {
        const [x, y] = body[k], [nx, ny, tx, ty] = N[k], rr = r(k);
        const cx = x + nx * rr * 0.55, cy = y + ny * rr * 0.55;
        line(cr, cx - nx * rr * 0.28 + tx * rr * 0.1, cy - ny * rr * 0.28 + ty * rr * 0.1,
            cx + nx * rr * 0.3 + tx * rr * 0.1, cy + ny * rr * 0.3 + ty * rr * 0.1, s * 1.3, '#a99550', 0.8);
    }
    // a little flame-like tuft at the tip of the tail
    const [ex, ey] = body[n - 1];
    glow(cr, ex, ey, s * 14, '#ffe08a', 0.3);
}

// the dragon's head, seen from the front, centred between the eyes
function drawDragonHead(cr, x, y, k, t, eyes) {
    cr.save();
    cr.translate(x, y);
    cr.scale(k, k);
    // whiskers, long and waving
    for (const sd of [-1, 1]) {
        cr.newPath();
        cr.moveTo(sd * 26, 30);
        for (let i = 1; i <= 16; i++) {
            const u = i / 16;
            cr.lineTo(sd * (26 + u * 170), 30 + u * 40 + Math.sin(u * 6 - t * 3 + sd) * 18 * u);
        }
        rgba(cr, LINE, 0.9);
        cr.setLineWidth(3.2 * (1 - 0.0));
        cr.stroke();
    }
    // antlers
    for (const sd of [-1, 1]) {
        const branch = [[[sd * 20, -30], [sd * 34, -70], [sd * 50, -104]], [[sd * 30, -58], [sd * 14, -92]],
            [[sd * 42, -82], [sd * 68, -100]]];
        for (const [wv, hex] of [[9, '#4a3218'], [6, '#d8b47a']]) {
            for (const b of branch) {
                poly(cr, b, false);
                rgba(cr, hex);
                cr.setLineWidth(wv);
                cr.stroke();
            }
        }
    }
    // spiky ear fins
    for (const sd of [-1, 1]) {
        poly(cr, [[sd * 36, -14], [sd * 84, -38], [sd * 66, -10], [sd * 92, 4], [sd * 62, 8], [sd * 74, 26], [sd * 40, 14]]);
        rgba(cr, D_GREEN);
        cr.fillPreserve();
        rgba(cr, LINE);
        cr.setLineWidth(2);
        cr.stroke();
    }
    // skull and brow
    ellipse(cr, 0, -10, 46, 34);
    const g = new Cairo.LinearGradient(0, -44, 0, 24);
    stop(g, 0, '#62b852');
    stop(g, 1, GREEN);
    cr.setSource(g);
    cr.fillPreserve();
    rgba(cr, LINE);
    cr.setLineWidth(2.6);
    cr.stroke();
    // scales on the forehead
    for (const [sx, sy] of [[-12, -30], [12, -30], [0, -36], [-24, -24], [24, -24]]) {
        cr.newPath();
        cr.arc(sx, sy, 6, 0.2, Math.PI - 0.2);
        rgba(cr, D_GREEN, 0.8);
        cr.setLineWidth(1.6);
        cr.stroke();
    }
    // the snout coming towards you, and the open jaw under it
    ellipse(cr, 0, 54, 28, 11);
    rgba(cr, '#5a0f12');
    cr.fill();
    for (const sd of [-1, 1]) {
        poly(cr, [[sd * 17, 46], [sd * 12, 63], [sd * 8, 46]]);
        rgba(cr, '#fffbe8');
        cr.fill();
    }
    ellipse(cr, 0, 66, 24, 7);
    rgba(cr, BELLY);
    cr.fillPreserve();
    rgba(cr, LINE);
    cr.setLineWidth(1.8);
    cr.stroke();
    ellipse(cr, 0, 26, 32, 24);
    const g2 = new Cairo.RadialGradient(0, 18, 4, 0, 26, 34);
    stop(g2, 0, '#7cd068');
    stop(g2, 1, GREEN);
    cr.setSource(g2);
    cr.fillPreserve();
    rgba(cr, LINE);
    cr.setLineWidth(2.4);
    cr.stroke();
    for (const sd of [-1, 1]) {
        ellipse(cr, sd * 11, 36, 5, 3.2);
        rgba(cr, LINE);
        cr.fill();
        cr.newPath();
        cr.arc(sd * 11, 33, 8, Math.PI * 1.05, Math.PI * 1.95);
        cr.setLineWidth(2);
        cr.stroke();
    }
    // the red eyes under heavy brows; they blaze while it looks at you
    for (const sd of [-1, 1]) {
        glow(cr, sd * 21, -8, 30, '#ff2a12', 0.25 + 0.55 * eyes);
        poly(cr, [[sd * 33, -14], [sd * 10, -7], [sd * 14, -1], [sd * 31, -4]]);
        rgba(cr, mixHex('#c4180c', '#ff5a3a', eyes));
        cr.fillPreserve();
        rgba(cr, LINE);
        cr.setLineWidth(1.6);
        cr.stroke();
        ellipse(cr, sd * 20, -6.5, 2.2, 2.6);
        rgba(cr, '#fff6e0', 0.6 + 0.4 * eyes);
        cr.fill();
        line(cr, sd * 38, -24, sd * 8, -13, 6, D_GREEN);
        line(cr, sd * 38, -24, sd * 8, -13, 2, LINE);
    }
    // chin tufts
    for (const sx of [-14, -5, 5, 14]) {
        cr.newPath();
        cr.moveTo(sx, 70);
        cr.curveTo(sx * 1.2, 82, sx * 1.4 + Math.sin(t * 2 + sx) * 3, 90, sx * 1.6, 98);
        rgba(cr, D_GREEN);
        cr.setLineWidth(3);
        cr.stroke();
    }
    cr.restore();
}

// ---------- the hero ----------

// poses: lean (+ forward), crouch (px down), legs [far, near] as [thigh, knee bend],
// arms [far, near] as [shoulder, elbow bend]; 0 is straight down, + swings forward
const POSES = {
    stand: {lean: 0.03, crouch: 0, legs: [[-0.1, 0.1], [0.12, 0.12]], arms: [[-0.12, 0.3], [0.1, 0.35]], head: 0},
    power: {lean: -0.04, crouch: 9, legs: [[-0.5, 0.55], [0.5, 0.6]], arms: [[-0.35, 1.7], [-0.25, 1.7]], head: 0},
    scream: {lean: -0.12, crouch: 12, legs: [[-0.55, 0.5], [0.55, 0.55]], arms: [[-0.75, 0.35], [0.6, 0.35]], head: -0.35},
    charge: {lean: -0.14, crouch: 15, legs: [[-0.6, 0.45], [0.55, 0.75]], arms: [[-1.15, 1.95], [-1.0, 1.85]], head: 0.05},
    fire: {lean: 0.16, crouch: 15, legs: [[-0.65, 0.35], [0.6, 0.75]], arms: [[1.45, 0.05], [1.55, 0.0]], head: 0.05},
    brace: {lean: 0.22, crouch: 17, legs: [[-0.75, 0.3], [0.55, 0.85]], arms: [[1.35, 0.35], [1.45, 0.3]], head: 0.1},
    salute: {lean: 0.0, crouch: 0, legs: [[-0.12, 0.1], [0.14, 0.12]], arms: [[-0.12, 0.3], [2.6, 2.1]], head: -0.05},
    it: {lean: 0.0, crouch: 2, legs: [[-0.15, 0.12], [0.15, 0.15]], arms: [[-0.2, 0.3], [2.25, 2.55]], head: 0},
};

function mixPose(a, b, u) {
    const m = (x, y) => lerp(x, y, u);
    return {
        lean: m(a.lean, b.lean), crouch: m(a.crouch, b.crouch), head: m(a.head, b.head),
        legs: a.legs.map((l, i) => [m(l[0], b.legs[i][0]), m(l[1], b.legs[i][1])]),
        arms: a.arms.map((l, i) => [m(l[0], b.arms[i][0]), m(l[1], b.arms[i][1])]),
    };
}

function runPose(ph) {
    const sn = Math.sin(ph);
    return {
        lean: 0.32, crouch: 4 + 3 * Math.abs(Math.cos(ph)), head: 0.1,
        legs: [[-0.85 * sn, 0.35 + 0.9 * Math.max(0, sn)], [0.85 * sn, 0.35 + 0.9 * Math.max(0, -sn)]],
        arms: [[0.9 * sn, 1.5], [-0.9 * sn, 1.5]],
    };
}

// the joints of a pose, in body units (feet on y = 0, facing +x)
function skeleton(p) {
    const hip = [0, -64 + p.crouch];
    const up = [Math.sin(p.lean), -Math.cos(p.lean)];
    const sh = [hip[0] + up[0] * 42, hip[1] + up[1] * 42];
    const neck = [hip[0] + up[0] * 50, hip[1] + up[1] * 50];
    const head = [hip[0] + up[0] * 64, hip[1] + up[1] * 64];
    const limb = (o, a, k, l1, l2, sign) => {
        const j = [o[0] + Math.sin(a) * l1, o[1] + Math.cos(a) * l1];
        const b = a + sign * k;
        return [j, [j[0] + Math.sin(b) * l2, j[1] + Math.cos(b) * l2]];
    };
    const legs = p.legs.map(([a, k]) => limb(hip, a, k, 31, 33, -1));
    const arms = p.arms.map(([a, k]) => limb(sh, a + p.lean, k, 21, 21, 1));
    // keep the lower foot on the ground
    const low = Math.max(legs[0][1][1], legs[1][1][1]);
    const dy = -low;
    const sft = q => [q[0], q[1] + dy];
    return {
        hip: sft(hip), sh: sft(sh), neck: sft(neck), head: sft(head), up, headTilt: p.head,
        legs: legs.map(l => l.map(sft)), arms: arms.map(l => l.map(sft)),
    };
}

const SKIN = '#ffd3a6', GI = '#ff7a12', GI_D = '#d55d08', BLUE = '#1f4fa8', BLUE_D = '#163a7c', INK = '#1a1208';

function limbLine(cr, a, b, c, w, hex, ow = 2.4) {
    poly(cr, [a, b, c], false);
    rgba(cr, INK);
    cr.setLineWidth(w + ow);
    cr.stroke();
    poly(cr, [a, b, c], false);
    rgba(cr, hex);
    cr.setLineWidth(w);
    cr.stroke();
}

// hair: spikes round the head; ssj 0..1 morphs black into tall golden spikes
const HAIR_BASE = [[-12, 11], [-45, 17], [-78, 21], [-108, 21], [-138, 19], [-165, 16], [-195, 13], [150, 9]];
const HAIR_SSJ = [[-28, 17], [-55, 27], [-80, 36], [-102, 37], [-124, 34], [-148, 29], [-172, 23], [160, 13]];

function drawHead(cr, sk, ssj, t, look) {
    const [hx, hy] = sk.head;
    cr.save();
    cr.translate(hx, hy);
    cr.rotate(sk.headTilt + Math.atan2(sk.up[0], -sk.up[1]) * 0.5);
    const R = 13;
    const hairCol = mixHex('#121018', '#ffe04a', ssj);
    // spiky hair behind the head
    const pts = [];
    const spikes = HAIR_BASE.map((b, i) => [lerp(b[0], HAIR_SSJ[i][0], ssj), lerp(b[1], HAIR_SSJ[i][1], ssj)]);
    pts.push([R * Math.cos(0.3), R * Math.sin(-0.3) - 2]);
    for (let i = 0; i < spikes.length; i++) {
        const [deg, len] = spikes[i];
        const a = (deg * Math.PI) / 180;
        const wob = ssj > 0.5 ? Math.sin(t * 20 + i) * 1.2 : 0;
        const aPrev = i ? (spikes[i - 1][0] * Math.PI) / 180 : 0.1;
        const mid = (a + aPrev) / 2;
        const fill = R + 1 + Math.min(len, i ? spikes[i - 1][1] : len) * 0.38;
        pts.push([Math.cos(mid) * fill, Math.sin(mid) * fill]);
        pts.push([Math.cos(a) * (R + len + wob), Math.sin(a) * (R + len + wob)]);
    }
    pts.push([Math.cos(2.4) * R, Math.sin(2.4) * R + 4]);
    if (ssj > 0.05)
        glow(cr, 0, -14, 52, '#fff2a0', 0.35 * ssj);
    poly(cr, pts);
    rgba(cr, hairCol);
    cr.fillPreserve();
    rgba(cr, INK);
    cr.setLineWidth(2);
    cr.stroke();
    // face
    cr.newPath();
    cr.arc(1, 2, R, 0, Math.PI * 2);
    rgba(cr, SKIN);
    cr.fillPreserve();
    rgba(cr, INK);
    cr.setLineWidth(2);
    cr.stroke();
    // ear
    ellipse(cr, -3, 3, 3.2, 4.2);
    rgba(cr, '#f2b98a');
    cr.fillPreserve();
    rgba(cr, INK);
    cr.setLineWidth(1.2);
    cr.stroke();
    // bangs over the forehead
    poly(cr, [[-4, -10], [14, -9], [9, -4], [12, -1], [4, -4], [2, 0], [-2, -6]]);
    rgba(cr, hairCol);
    cr.fillPreserve();
    rgba(cr, INK);
    cr.setLineWidth(1.4);
    cr.stroke();
    // eye and brow: looking ahead, or turned towards you
    if (look > 0.5) {
        // turned to face you: a wink and a grin
        line(cr, 5, 1.5, 11, 1, 1.8, INK);
        cr.newPath();
        cr.arc(8, 7.5, 4, 0.2, Math.PI - 0.6);
        rgba(cr, INK);
        cr.setLineWidth(1.6);
        cr.stroke();
    } else {
        poly(cr, [[6, -1], [12, -1.5], [11.5, 3.2], [6.5, 2.8]]);
        rgba(cr, '#ffffff');
        cr.fill();
        ellipse(cr, 10, 0.9, 1.5, 2);
        rgba(cr, mixHex('#111111', '#18b8a8', ssj));
        cr.fill();
        line(cr, 5, -3.2 + ssj, 13, -3.8 - ssj * 0.8, 1.8, INK);
        line(cr, 9, 9, 13, 8.6, 1.4, INK);
    }
    cr.restore();
}

function drawAura(cr, sk, aura, ssj, t) {
    if (aura <= 0.01)
        return;
    const col = mixHex('#cfe8ff', '#ffd83a', ssj);
    const cx = sk.hip[0], cy = sk.hip[1] - 14;
    // a flickering flame-shaped shell round the body, licking upward
    const pts = [];
    const n = 28;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const up = Math.max(0, -Math.sin(a));
        const lick = up * (22 + 18 * Math.sin(t * 17 + i * 1.7) + 14 * Math.sin(t * 11 + i * 2.9));
        pts.push([cx + Math.cos(a) * (52 + 6 * Math.sin(t * 13 + i)), cy + Math.sin(a) * (86 + lick * 0.4) - lick]);
    }
    poly(cr, pts);
    const g = new Cairo.RadialGradient(cx, cy, 10, cx, cy - 20, 140);
    stop(g, 0, '#ffffff', 0.5 * aura);
    stop(g, 0.45, col, 0.45 * aura);
    stop(g, 1, col, 0);
    cr.setSource(g);
    cr.fill();
    glow(cr, cx, cy, 160, col, 0.25 * aura);
}

function drawHero(cr, h) {
    const sk = skeleton(h.pose);
    cr.save();
    cr.translate(h.x, h.y);
    cr.scale(h.dir * h.k, h.k);
    drawAura(cr, sk, h.aura, h.ssj, h.t);
    const [farLeg, nearLeg] = sk.legs, [farArm, nearArm] = sk.arms;
    const boot = (leg, shade) => {
        const [knee, foot] = leg;
        const bx = lerp(knee[0], foot[0], 0.55), by = lerp(knee[1], foot[1], 0.55);
        limbLine(cr, [bx, by], [foot[0], foot[1]], [foot[0] + 0.01, foot[1]], 11, shade ? BLUE_D : BLUE);
        // the foot, pointing forward
        ellipse(cr, foot[0] + 5, foot[1] - 2, 9, 4.6);
        rgba(cr, INK);
        cr.fill();
        ellipse(cr, foot[0] + 5, foot[1] - 2.4, 7.6, 3.4);
        rgba(cr, shade ? BLUE_D : BLUE);
        cr.fill();
        line(cr, bx - 5, by, bx + 5, by, 2.4, '#e43a2a');   // the red band at the top of the boot
    };
    const leg = (l, shade) => {
        limbLine(cr, sk.hip, l[0], l[1], 13, shade ? GI_D : GI);
        boot(l, shade);
    };
    const arm = (a, shade) => {
        const [el, hand] = a;
        limbLine(cr, sk.sh, el, hand, 8, shade ? '#f2b98a' : SKIN);
        // blue undershirt sleeve, wristband and fist
        limbLine(cr, sk.sh, [lerp(sk.sh[0], el[0], 0.45), lerp(sk.sh[1], el[1], 0.45)],
            [lerp(sk.sh[0], el[0], 0.46), lerp(sk.sh[1], el[1], 0.46)], 10, shade ? BLUE_D : BLUE, 2);
        const wx = lerp(el[0], hand[0], 0.7), wy = lerp(el[1], hand[1], 0.7);
        limbLine(cr, [wx, wy], [lerp(el[0], hand[0], 0.92), lerp(el[1], hand[1], 0.92)],
            [lerp(el[0], hand[0], 0.93), lerp(el[1], hand[1], 0.93)], 9, shade ? BLUE_D : BLUE, 2);
        cr.newPath();
        cr.arc(hand[0], hand[1], 5.2, 0, Math.PI * 2);
        rgba(cr, shade ? '#f2b98a' : SKIN);
        cr.fillPreserve();
        rgba(cr, INK);
        cr.setLineWidth(1.6);
        cr.stroke();
    };
    arm(farArm, true);
    leg(farLeg, true);
    // torso: orange gi over a blue undershirt, blue sash
    limbLine(cr, sk.hip, sk.sh, [sk.sh[0] + sk.up[0] * 0.1, sk.sh[1] + sk.up[1] * 0.1], 27, GI);
    const nx = sk.neck[0], ny = sk.neck[1];
    poly(cr, [[nx - 6, ny + 2], [nx + 8, ny + 4], [nx + 4, ny + 14]]);
    rgba(cr, BLUE);
    cr.fill();
    const bx = lerp(sk.hip[0], sk.sh[0], 0.1), by = lerp(sk.hip[1], sk.sh[1], 0.1);
    line(cr, bx - sk.up[0] * 4, by - sk.up[1] * 4, bx + sk.up[0] * 4, by + sk.up[1] * 4, 30, INK);
    line(cr, bx - sk.up[0] * 3, by - sk.up[1] * 3, bx + sk.up[0] * 3, by + sk.up[1] * 3, 28, BLUE);
    // the round crest on his chest
    const cx = lerp(sk.hip[0], sk.sh[0], 0.62) + 6, cy = lerp(sk.hip[1], sk.sh[1], 0.62);
    cr.newPath();
    cr.arc(cx, cy, 4.6, 0, Math.PI * 2);
    rgba(cr, '#fff8ec');
    cr.fillPreserve();
    rgba(cr, INK);
    cr.setLineWidth(1);
    cr.stroke();
    line(cr, cx - 2, cy - 1.5, cx + 2, cy + 1.8, 1.3, INK);
    line(cr, cx + 2, cy - 1.5, cx - 1, cy + 0.5, 1.3, INK);
    leg(nearLeg, false);
    drawHead(cr, sk, h.ssj, h.t, h.look);
    arm(nearArm, false);
    cr.restore();
    // hands in screen px, for the energy ball
    const hand = sk.arms[1][1], hand2 = sk.arms[0][1];
    const hx = (hand[0] + hand2[0]) / 2, hy = (hand[1] + hand2[1]) / 2;
    return [h.x + h.dir * h.k * hx, h.y + h.k * hy];
}

// the energy wave: from x0 to the head at x1, along y
function drawBeam(cr, x0, x1, y, r, t, a = 1) {
    if (a <= 0)
        return;
    const dir = Math.sign(x1 - x0) || 1;
    const len = Math.abs(x1 - x0);
    const n = Math.max(2, Math.round(len / 18));
    const wave = (k, amp) => {
        cr.newPath();
        for (let i = 0; i <= n; i++) {
            const x = x0 + (dir * len * i) / n;
            const yy = y + Math.sin(i * 0.9 - t * 40 + k) * amp;
            if (i)
                cr.lineTo(x, yy);
            else
                cr.moveTo(x, yy);
        }
    };
    for (const [wf, hex, al, k] of [[3.6, '#2a8cff', 0.18, 0], [2.4, '#4fb4ff', 0.5, 1], [1.6, '#9ee0ff', 0.85, 2],
        [0.8, '#ffffff', 1, 3]]) {
        wave(k, r * 0.08);
        rgba(cr, hex, al * a);
        cr.setLineWidth(r * wf);
        cr.stroke();
    }
    // spiralling rings rolling along the wave
    for (let d = (t * 900) % 70; d < len - r; d += 70) {
        const x = x0 + dir * d;
        ellipse(cr, x, y, r * 0.35, r * 1.35);
        rgba(cr, '#dff4ff', 0.45 * a);
        cr.setLineWidth(r * 0.12);
        cr.stroke();
    }
    // the blazing head of the wave
    glow(cr, x1, y, r * 4.5, '#5ab8ff', 0.6 * a);
    glow(cr, x1, y, r * 2.2, '#dff6ff', 0.9 * a);
    cr.newPath();
    cr.arc(x1, y, r * 1.2, 0, Math.PI * 2);
    rgba(cr, '#ffffff', a);
    cr.fill();
}

function drawOrb(cr, x, y, r, t) {
    if (r <= 0.5)
        return;
    // rays of light spinning out from between his hands
    for (let i = 0; i < 10; i++) {
        const a = t * 2.5 + (i / 10) * Math.PI * 2;
        const l = r * (3 + 1.5 * Math.sin(t * 13 + i * 2));
        line(cr, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, r * 0.18, '#bfe6ff', 0.35);
    }
    glow(cr, x, y, r * 3.5, '#4fb4ff', 0.55);
    glow(cr, x, y, r * 1.6, '#e8f8ff', 0.9);
    for (let i = 0; i < 4; i++) {
        const a = t * 9 + i * 1.6;
        line(cr, x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, x + Math.cos(a) * r * 1.7, y + Math.sin(a) * r * 1.7,
            1.4, '#cfefff', 0.7);
    }
}

// the flickering lines of instant transmission
function drawBlink(cr, x, y, k, u) {
    if (u <= 0 || u >= 1)
        return;
    const a = Math.sin(Math.PI * u);
    for (let i = 0; i < 9; i++) {
        const dx = (i - 4) * 9 * k;
        const h = (60 + 70 * Math.sin(i * 1.7 + u * 9) ** 2) * k * a;
        line(cr, x + dx, y - 80 * k - h, x + dx, y - 80 * k + h, 2.2 * k, '#e8f4ff', 0.8 * a);
    }
    glow(cr, x, y - 80 * k, 90 * k * a, '#ffffff', 0.5 * a);
}

// jagged lightning from the sky
function drawBolt(cr, x0, y0, x1, y1, seed, a) {
    let r = seed;
    const rnd = () => {
        r = (r * 16807) % 2147483647;
        return r / 2147483647 - 0.5;
    };
    const pts = [[x0, y0]];
    for (let i = 1; i < 12; i++)
        pts.push([lerp(x0, x1, i / 12) + rnd() * 60, lerp(y0, y1, i / 12) + rnd() * 20]);
    pts.push([x1, y1]);
    const branch = [pts[5]];
    for (let i = 1; i < 6; i++)
        branch.push([pts[5][0] + i * 22 + rnd() * 30, pts[5][1] + i * 26 + rnd() * 16]);
    for (const [w, hex, al] of [[26, '#6fa8ff', 0.14], [12, '#a8d4ff', 0.35], [4.5, '#ffffff', 1]]) {
        for (const pp of [pts, branch]) {
            poly(cr, pp, false);
            rgba(cr, hex, al * a * (pp === branch ? 0.7 : 1));
            cr.setLineWidth(pp === branch ? w * 0.6 : w);
            cr.stroke();
        }
    }
}

// heavy storm clouds rolling over the top of the screen; flash lights them up
function drawClouds(cr, W, H, s, a, t, flash) {
    if (a <= 0.01)
        return;
    const puffs = 22;
    for (const [layer, col, lit] of [[0, '#0b0e16', '#3a4660'], [1, '#161b28', '#55658a']]) {
        for (let i = 0; i < puffs; i++) {
            const u = i / (puffs - 1);
            const drift = Math.sin(t * 0.25 + i * 1.3) * 30 * s + t * (8 + layer * 6) * s;
            const x = ((u * 1.2 - 0.1) * W + drift) % (W * 1.25) - W * 0.05;
            const y = H * (0.02 + 0.13 * layer + 0.07 * Math.sin(i * 2.7)) - (1 - a) * 260 * s;
            const r = (120 + 70 * Math.sin(i * 3.1) ** 2) * s * (1 - 0.25 * layer);
            ellipse(cr, x, y, r * 1.5, r * 0.8);
            const g = new Cairo.RadialGradient(x, y - r * 0.4, r * 0.1, x, y, r * 1.5);
            stop(g, 0, mixHex(mixHex(col, '#2a3348', 0.6), lit, flash), 0.95 * a);
            stop(g, 0.7, mixHex(col, lit, flash * 0.7), 0.92 * a);
            stop(g, 1, mixHex(col, lit, flash * 0.5), 0);
            cr.setSource(g);
            cr.fill();
        }
    }
    // the soft, ragged underside
    const g = new Cairo.LinearGradient(0, H * 0.18, 0, H * 0.42);
    stop(g, 0, '#161b28', 0.7 * a);
    stop(g, 1, '#161b28', 0);
    cr.setSource(g);
    cr.rectangle(0, H * 0.18 - (1 - a) * 260 * s, W, H * 0.24);
    cr.fill();
}

// the balls burst into a pillar of golden light reaching up into the clouds
function drawPillar(cr, x, y, H, s, a, t) {
    if (a <= 0.01)
        return;
    const w = (34 + 6 * Math.sin(t * 30)) * s;
    for (const [wf, hex, al] of [[4, '#ffb43a', 0.18], [2.2, '#ffd86a', 0.4], [1, '#fff6d0', 0.85], [0.4, '#ffffff', 1]]) {
        const g = new Cairo.LinearGradient(0, y, 0, 0);
        stop(g, 0, hex, al * a);
        stop(g, 0.85, hex, al * a * 0.8);
        stop(g, 1, hex, 0);
        cr.setSource(g);
        cr.rectangle(x - (w * wf) / 2, 0, w * wf, y);
        cr.fill();
    }
    glow(cr, x, y, 160 * s, '#fff0a0', 0.8 * a);
}

// a little crackle of electricity round a point
function drawSparkArc(cr, x, y, r, seed, a, col = '#cfe6ff') {
    let q = seed | 0 || 1;
    const rnd = () => {
        q = (q * 16807) % 2147483647;
        return q / 2147483647;
    };
    const a0 = rnd() * Math.PI * 2;
    const pts = [];
    for (let i = 0; i <= 6; i++) {
        const ang = a0 + i * 0.35;
        const rr = r * (0.7 + 0.5 * rnd());
        pts.push([x + Math.cos(ang) * rr, y + Math.sin(ang) * rr]);
    }
    for (const [w, al, c] of [[5, 0.25, col], [1.8, 1, '#ffffff']]) {
        poly(cr, pts, false);
        rgba(cr, c, al * a);
        cr.setLineWidth(w);
        cr.stroke();
    }
}

function drawRock(cr, x, y, r, rot) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
        const a = rot + (i / 6) * Math.PI * 2;
        const rr = r * (0.7 + 0.3 * Math.sin(i * 2.3 + r));
        pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8]);
    }
    poly(cr, pts);
    rgba(cr, '#6b5f52');
    cr.fillPreserve();
    rgba(cr, '#2a231c');
    cr.setLineWidth(1.4);
    cr.stroke();
}

// ---------- the show ----------

// seconds from the moment all seven touch
const T = {
    gather: 1.1, dark: [0.3, 1.4], thunder: 0.9, zaps: [0.9, 1.25, 1.55, 1.8],
    pillar: [1.9, 3.6], rise: [2.3, 5.2], stare: [5.2, 6.6], vanish: [6.6, 7.6], fly: 7.0, clear: [7.4, 8.4],
    run: [8.2, 9.8], power: [9.9, 12.6], ssj: [10.9, 11.9], burst: 11.9,
    charge: [12.8, 14.4], fire: 14.4, it: [14.9, 15.2], gone: 15.25, appear: 15.55,
    hit: 16.6, held: [16.6, 17.8], absorb: 17.9,
    turn: [18.4, 18.9], salute: [19.0, 20.4], blink: [20.5, 20.9], end: 21.3,
};
export const SHOW_LEN = T.end;

export class DragonBalls {
    constructor(play) {
        this.play = play;
        this.balls = Array.from({length: 7}, (_, i) => ({stars: i + 1, x: 0, y: 0, lit: 0, stone: 0, hidden: false}));
        // new | idle | show (the wish) | back (falling back as stones) | rest (stone, a minute) | wake (colour returns)
        this.state = 'new';
        this.W = 0;
        this.H = 0;
        this.s = 1;
        this.held = -1;
        this.motes = [];
        this.avoid = null;     // {x, w}: a strip of the screen to keep balls out of (the lamp)
        this.t = 0;
    }

    // the balls can be touched (and should be on screen as their own little pictures)
    get idle() {
        return this.state === 'idle';
    }

    // the balls sit on screen as their own pictures (touchable only when idle)
    get resting() {
        return this.state === 'idle' || this.state === 'rest' || this.state === 'wake';
    }

    // something is happening that needs the whole-screen layer
    get showing() {
        return this.state === 'show' || this.state === 'back';
    }

    get radius() {
        return BALL_R * this.s;
    }

    screen(W, H, s, now) {
        const first = !this.W;
        this.W = W;
        this.H = H;
        this.s = s;
        if (first) {
            this.state = 'idle';
            this._spread();
        } else {
            const r = this.radius;
            for (const b of this.balls) {
                b.x = clamp(b.x, r * 2, W - r * 2);
                b.y = clamp(b.y, r * 4, H - r * 2);
            }
        }
        this.now ??= now;
    }

    // scatter them round the screen, well apart, away from the lamp
    _spread() {
        const {W, H} = this;
        const r = this.radius;
        const placed = [];
        for (const b of this.balls) {
            let best = null;
            for (let tries = 0; tries < 60; tries++) {
                const x = rand(0.06, 0.94) * W, y = rand(0.16, 0.86) * H;
                if (this.avoid && Math.abs(x - this.avoid.x) < this.avoid.w)
                    continue;
                const near = Math.min(Infinity, ...placed.map(p => Math.hypot(p[0] - x, p[1] - y)));
                if (!best || near > best[2])
                    best = [x, y, near];
                if (near > Math.min(W, H) * 0.18)
                    break;
            }
            best ??= [rand(0.1, 0.9) * W, rand(0.2, 0.8) * H, 0];
            b.x = best[0];
            b.y = best[1];
            b.lit = 0;
            placed.push(best);
        }
        void r;
    }

    hit(x, y) {
        if (!this.idle)
            return -1;
        const r = this.radius * 1.25;
        for (let i = this.balls.length - 1; i >= 0; i--) {
            const b = this.balls[i];
            if (Math.hypot(x - b.x, y - b.y) <= r)
                return i;
        }
        return -1;
    }

    grab(i, x, y) {
        const b = this.balls[i];
        this.held = i;
        this.off = [b.x - x, b.y - y];
        this.play('db-pick');
    }

    drag(x, y) {
        if (this.held < 0)
            return;
        const b = this.balls[this.held], r = this.radius;
        b.x = clamp(x + this.off[0], r, this.W - r);
        b.y = clamp(y + this.off[1], r, this.H - r);
        // a soft clink the moment it touches another
        const touching = this.balls.some((o, j) => j !== this.held && Math.hypot(o.x - b.x, o.y - b.y) < r * 2.3);
        if (touching && !this._touching)
            this.play('db-clink');
        this._touching = touching;
        this._light();
    }

    // let go: snap against a ball it is touching; if all seven are now together, the
    // wish begins. Returns true if it did.
    drop(now) {
        if (this.held < 0)
            return false;
        const b = this.balls[this.held], r = this.radius;
        this.held = -1;
        this._touching = false;
        let near = null, nd = Infinity;
        for (const o of this.balls) {
            if (o === b)
                continue;
            const d = Math.hypot(o.x - b.x, o.y - b.y);
            if (d < nd) {
                nd = d;
                near = o;
            }
        }
        if (near && nd < r * 2.7) {
            const dx = (b.x - near.x) / (nd || 1), dy = (b.y - near.y) / (nd || 1);
            b.x = near.x + (nd ? dx : 1) * r * 2.08;
            b.y = near.y + (nd ? dy : 0) * r * 2.08;
        }
        this._light();
        if (this._together()) {
            this.summon(now);
            return true;
        }
        return false;
    }

    // which balls touch one another (in chains); all seven in one chain = together
    _groups() {
        const r = this.radius, n = this.balls.length;
        const g = Array.from({length: n}, (_, i) => i);
        const find = i => (g[i] === i ? i : (g[i] = find(g[i])));
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = this.balls[i], b = this.balls[j];
                if (Math.hypot(a.x - b.x, a.y - b.y) < r * 2.45)
                    g[find(i)] = find(j);
            }
        }
        return this.balls.map((_, i) => find(i));
    }

    _together() {
        const g = this._groups();
        return g.every(x => x === g[0]);
    }

    // balls glow brighter the more of them are touching
    _light() {
        const g = this._groups();
        for (let i = 0; i < this.balls.length; i++) {
            const size = g.filter(x => x === g[i]).length;
            this.balls[i].lit = size > 1 ? (size - 1) / 6 : 0;
        }
    }

    // start the wish from wherever the balls are (also used by the tray menu)
    summon(now) {
        if (this.state !== 'idle')
            return false;
        const {W, H} = this, r = this.radius;
        const cx = this.balls.reduce((a, b) => a + b.x, 0) / 7, cy = this.balls.reduce((a, b) => a + b.y, 0) / 7;
        // the dragon rises out of them, so keep them low enough to have room above
        const c = [clamp(cx, W * 0.15, W * 0.85), clamp(cy, H * 0.55, H * 0.82)];
        this.c = c;
        this.balls.forEach((b, i) => {
            b.from = [b.x, b.y];
            const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
            b.ring = [Math.cos(a) * r * 2.35, Math.sin(a) * r * 2.35];
            b.flyDir = a + rand(-0.2, 0.2);
        });
        const sd = c[0] < W / 2 ? 1 : -1;
        // it coils up out of the light in big loops, its head ending high in the middle
        const m = W * 0.5;
        this.path = pathTable([c, [c[0], c[1] - H * 0.12], [m + 0.2 * W * sd, H * 0.48], [m + 0.05 * W * sd, H * 0.7],
            [m - 0.2 * W * sd, H * 0.56], [m - 0.14 * W * sd, H * 0.3], [m + 0.16 * W * sd, H * 0.22], [m + 0.1 * W * sd, H * 0.42],
            [m, H * 0.4]]);
        this.state = 'show';
        this.t0 = now;
        this.motes = [];
        this.cues = new Set();
        this.groundY = H - 34 * this.s;
        this.play('db-gather');
        return true;
    }

    _cue(name, at, el, fn) {
        if (el >= at && !this.cues.has(name)) {
            this.cues.add(name);
            fn();
        }
    }

    tick(now, dt) {
        this.t = now;
        if (this.state === 'back' && now - this.t0 > 2.2) {
            // landed: grey stones for a minute, no use to anyone
            this.balls.forEach(b => {
                [b.x, b.y] = b.to;
                b.hidden = false;
                b.stone = 1;
                b.lit = 0;
            });
            this.state = 'rest';
            this.until = now + REST_S;
        }
        if (this.state === 'rest' && now >= this.until) {
            this.state = 'wake';
            this.t0 = now;
            this.play('db-awake');
        }
        if (this.state === 'wake') {
            // the colour seeps back, with a little glow, and they're ready again
            const u = clamp((now - this.t0) / 1.6, 0, 1);
            this.balls.forEach(b => {
                b.stone = 1 - smooth(u);
                b.lit = Math.sin(Math.PI * u) * 0.8;
            });
            if (u >= 1) {
                this.balls.forEach(b => {
                    b.stone = 0;
                    b.lit = 0;
                });
                this.state = 'idle';
            }
        }
        if (this.state !== 'show')
            return;
        const el = now - this.t0;
        const s = this.s;
        this._cue('thunder', T.thunder, el, () => this.play('db-thunder'));
        T.zaps.forEach((at, i) => this._cue(`zap${i}`, at, el, () => this.play(`db-zap-${i % 2}`)));
        this._cue('pillar', T.pillar[0], el, () => this.play('db-pillar'));
        this._cue('rise', T.rise[0], el, () => this.play('db-rise'));
        this._cue('growl', T.stare[0] + 0.1, el, () => this.play('db-growl'));
        this._cue('vanish', T.vanish[0], el, () => this.play('db-vanish'));
        if (el > T.vanish[0] && el < T.vanish[1]) {
            // a rising swarm of golden motes where the body melts away
            const body = this._body(el);
            for (let i = 0; i < 10 && body.length > 1; i++) {
                const [x, y] = body[Math.max(0, body.length - 1 - Math.floor(Math.random() * 6))];
                this.motes.push({x: x + rand(-30, 30) * s, y: y + rand(-30, 30) * s, vx: rand(-30, 30) * s,
                    vy: rand(-110, -30) * s, age: 0, life: rand(0.8, 1.5), col: Math.random() < 0.5 ? '#ffe08a' : '#9fe28a'});
            }
        }
        this._cue('fly', T.fly, el, () => this.play('db-scatter'));
        this._cue('run', T.run[0], el, () => this.play('db-run'));
        this._cue('power', T.power[0], el, () => this.play('goku-scream'));
        this._cue('burst', T.burst, el, () => this.play('db-burst'));
        this._cue('charge', T.charge[0], el, () => this.play('goku-kamehameha'));
        this._cue('fire', T.fire, el, () => this.play('db-blast'));
        this._cue('it', T.it[0], el, () => this.play('db-zip'));
        this._cue('appear', T.appear, el, () => this.play('db-zip'));
        this._cue('hit', T.hit, el, () => this.play('db-catch'));
        this._cue('absorb', T.absorb, el, () => this.play('db-absorb'));
        this._cue('bye', T.salute[0], el, () => this.play('goku-bye'));
        this._cue('blink', T.blink[0], el, () => this.play('db-zip'));
        this.motes = this.motes.filter(m => {
            m.age += dt;
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            m.vy -= 20 * s * dt;
            return m.age < m.life;
        });
        if (el >= T.end) {
            // they fall back to earth, scattered, already turned to stone
            this._spread();
            this.balls.forEach(b => {
                b.to = [b.x, b.y];
                b.from = [b.x + rand(-0.3, 0.3) * this.W, -40 * this.s];
                b.delay = rand(0, 0.8);
                b.stone = 1;
                b.hidden = true;
            });
            this.state = 'back';
            this.t0 = now;
            this.play('db-return');
        }
    }

    // where the dragon's body is (head first), el s into the show
    _body(el) {
        const tb = this.path, s = this.s;
        const u = smooth((el - T.rise[0]) / (T.rise[1] - T.rise[0]));
        const head = u * tb.total;
        const seg = tb.total / SEGS;
        const pts = [];
        // vanishing: it turns to light from the tail up to the head
        const gone = span(el, T.vanish[0], T.vanish[1] - 0.25);
        const keep = Math.ceil(SEGS * (1 - gone));
        for (let k = 0; k <= Math.min(SEGS, keep); k++) {
            const d = head - k * seg;
            if (d < 0)
                break;
            const [x, y] = pathAt(tb, d);
            // a slow ripple runs down the body
            const [x2, y2] = pathAt(tb, d + 2);
            const l = Math.hypot(x2 - x, y2 - y) || 1;
            const w = Math.sin(k * 0.22 - el * 4) * 7 * s * Math.min(1, k / 12) * Math.min(1, d / (40 * s));
            pts.push([x - ((y2 - y) / l) * w, y + ((x2 - x) / l) * w]);
        }
        return pts;
    }

    // the balls during the show and on their way back, plus everything else, in screen px
    draw(cr) {
        if (!this.showing)
            return;
        cr.save();
        cr.setLineCap(Cairo.LineCap.ROUND);
        const now = this.t, el = now - this.t0, s = this.s, r = this.radius;
        if (this.state === 'back') {
            for (const b of this.balls) {
                const u = clamp((el - b.delay) / 1.2, 0, 1);
                if (u <= 0)
                    continue;
                const e = 1 - (1 - u) ** 3;
                const x = lerp(b.from[0], b.to[0], e), y = lerp(b.from[1], b.to[1], e);
                if (u < 1) {
                    const tx = lerp(b.from[0], b.to[0], Math.max(0, e - 0.15)), ty = lerp(b.from[1], b.to[1], Math.max(0, e - 0.15));
                    line(cr, tx, ty, x, y, r * 0.9, mixHex('#ffc24a', '#9a968f', u), 0.35);
                }
                paintBall(cr, x, y, r * (0.6 + 0.4 * e), b.stars, 0, now, smooth(u * 1.4));
            }
            cr.restore();
            return;
        }
        const {W, H} = this;
        // the sky goes dark
        const dark = 0.68 * span(el, ...T.dark) * (1 - span(el, ...T.clear)) + 0.12 * span(el, ...T.clear) *
            (1 - span(el, T.end - 0.8, T.end));
        if (dark > 0) {
            rgba(cr, '#03060c', dark);
            cr.rectangle(0, 0, W, H);
            cr.fill();
        }
        // storm clouds roll in; lightning zaps down out of them into the balls
        let flash = 0;
        const zaps = [...T.zaps, T.pillar[0], 2.7, 3.1, 3.6, 4.0, 4.4, 4.9];
        zaps.forEach((at, i) => {
            const a = 1 - clamp((el - at) / 0.22, 0, 1);
            if (el >= at && a > 0)
                flash = Math.max(flash, a);
        });
        const clouds = span(el, T.dark[0] - 0.2, T.dark[1]) * (1 - span(el, T.vanish[1] - 0.4, T.clear[1]));
        drawClouds(cr, W, H, s, clouds, el, flash);
        zaps.forEach((at, i) => {
            const a = 1 - clamp((el - at) / 0.22, 0, 1);
            if (el >= at && a > 0 && el < T.vanish[0]) {
                rgba(cr, '#cfe6ff', 0.14 * a);
                cr.rectangle(0, 0, W, H);
                cr.fill();
                // the first ones strike the balls, the later ones crackle round the dragon
                const x0 = this.c[0] + (i % 2 ? 1 : -1) * (80 + 50 * i) * s;
                const tx = i < 5 ? this.c[0] : W * (0.3 + 0.4 * (i % 2));
                const ty = i < 5 ? this.c[1] : H * 0.45;
                drawBolt(cr, x0, H * 0.12, tx, ty, (i + 3) * 7919, a);
                if (i < 5)
                    glow(cr, tx, ty, 120 * s, '#cfe6ff', 0.6 * a);
            }
        });
        // the seven balls, gathered in a ring, pulsing
        const c = this.c;
        if (el < T.fly + 1.2) {
            const g = span(el, 0, T.gather);
            const pulse = 0.5 + 0.5 * Math.sin(el * 8);
            glow(cr, c[0], c[1], r * (5 + 3 * span(el, 0.8, 2)), '#ffb43a', (0.3 + 0.3 * pulse) * g *
                (1 - span(el, T.fly, T.fly + 0.6)));
            this.balls.forEach((b, i) => {
                const spin = el * 0.6;
                const ca = Math.cos(spin), sa = Math.sin(spin);
                let x = lerp(b.from[0], c[0] + b.ring[0] * ca - b.ring[1] * sa, g);
                let y = lerp(b.from[1], c[1] + b.ring[0] * sa + b.ring[1] * ca, g);
                let rr = r;
                if (el > T.fly) {
                    // up and away in seven directions, as streaks of light
                    const u = (el - T.fly) / 1.1;
                    const d = u * u * Math.max(W, H) * 1.1;
                    const ox = x, oy = y;
                    x += Math.cos(b.flyDir) * d;
                    y += Math.sin(b.flyDir) * d - u * 120 * s;
                    rr = r * (1 - u * 0.5);
                    line(cr, lerp(ox, x, 0.6), lerp(oy, y, 0.6), x, y, rr * 1.2, '#ffc24a', 0.4 * (1 - u));
                }
                paintBall(cr, x, y, rr, b.stars, Math.max(b.lit, g * (0.6 + 0.4 * pulse)), now + i);
            });
        }
        // the balls become a beam of light, and the dragon comes out of it
        const pil = span(el, T.pillar[0], T.pillar[0] + 0.15) * (1 - span(el, T.rise[0] + 0.6, T.pillar[1]));
        drawPillar(cr, c[0], c[1], H, s, pil, el);
        // electricity crackling along the dragon as it takes shape
        if (el > T.pillar[0] && el < T.vanish[0]) {
            const body = this._body(el);
            const n = Math.floor(el * 20);
            for (let i = 0; i < 4 && body.length > 8; i++) {
                const p = body[(n * 7 + i * 31) % body.length];
                drawSparkArc(cr, p[0], p[1], 46 * s, n * 13 + i * 101, 0.8, '#bfe0ff');
            }
            if (el < T.rise[0] + 0.6)
                for (let i = 0; i < 3; i++)
                    drawSparkArc(cr, c[0], c[1] - r, 60 * s, n * 7 + i * 53, 1, '#fff0a0');
        }
        // the dragon
        if (el >= T.rise[0] && el < T.vanish[1]) {
            const body = this._body(el);
            const gone = span(el, T.vanish[0], T.vanish[1] - 0.25);
            if (body.length > 5)
                drawSerpent(cr, body, s, el);
            if (body.length && gone < 0.97) {
                const [hx, hy] = body[0];
                const stare = span(el, T.stare[0], T.stare[0] + 0.4) * (1 - span(el, T.vanish[0], T.vanish[0] + 0.3));
                const k = s * (1.3 + 0.15 * stare + 0.35 * span(el, T.rise[0], T.rise[1]));
                drawDragonHead(cr, hx, hy - 30 * s, k, el, stare);
                // at the last the head itself goes up in light
                glow(cr, hx, hy - 30 * s, 220 * s, '#fff2b0', 0.95 * span(gone, 0.6, 0.95));
            }
        }
        for (const m of this.motes) {
            const a = 1 - m.age / m.life;
            glow(cr, m.x, m.y, 7 * s, m.col, 0.6 * a);
            cr.newPath();
            cr.arc(m.x, m.y, 1.6 * s, 0, Math.PI * 2);
            rgba(cr, '#fffbe8', a);
            cr.fill();
        }
        this._drawHero(cr, el);
        cr.restore();
    }

    _drawHero(cr, el) {
        if (el < T.run[0] || el > T.blink[1])
            return;
        const {W, s} = this;
        const k = s * 0.95;
        const gy = this.groundY;
        const xL = W * 0.2, xR = W * 0.8;
        const h = {x: xL, y: gy, dir: 1, k, t: el, aura: 0, ssj: 0, look: 0, pose: POSES.stand};
        const ssj = span(el, ...T.ssj);
        let orb = 0, beam = null;
        const beamY = () => gy - 62 * k;
        const tFire = T.fire, beamSpeed = (xR - xL - 30 * k) / (T.hit - tFire);
        if (el < T.run[1]) {
            // running in from the edge
            const u = (el - T.run[0]) / (T.run[1] - T.run[0]);
            h.x = lerp(-60 * k, xL, 1 - (1 - u) ** 1.6);
            h.pose = mixPose(runPose(el * 15), POSES.stand, span(u, 0.85, 1));
        } else if (el < T.power[0]) {
            h.pose = POSES.stand;
        } else if (el < T.charge[0]) {
            // powering up: clenched, then the scream as the hair flares gold
            const p = span(el, T.power[0], T.power[0] + 0.4);
            const sc = span(el, T.ssj[0] - 0.2, T.ssj[0] + 0.2) * (1 - span(el, T.burst + 0.3, T.power[1]));
            h.pose = mixPose(mixPose(POSES.stand, POSES.power, p), POSES.scream, sc);
            h.aura = span(el, T.power[0] + 0.3, T.ssj[0]) * 0.6 + 0.6 * ssj;
            h.x += Math.sin(el * 70) * 1.5 * s * h.aura;   // he shakes with it
        } else if (el < T.gone) {
            // ka-me-ha-me... then HA!
            const c = span(el, T.charge[0], T.charge[0] + 0.4);
            const f = span(el, tFire - 0.1, tFire + 0.08);
            const itu = span(el, T.it[0], T.it[1]);
            h.pose = mixPose(mixPose(mixPose(POSES.power, POSES.charge, c), POSES.fire, f), POSES.it, itu);
            h.aura = 0.8;
            orb = el < tFire ? (6 + 12 * span(el, T.charge[0], tFire)) * k : 0;
        } else if (el < T.appear) {
            h.x = -1e4;   // gone
        } else {
            // over on the far side, facing back, bracing for his own wave
            h.x = xR;
            h.dir = -1;
            h.aura = 0.8;
            const held = span(el, T.hit, T.held[1]);
            h.x += 18 * k * span(el, T.hit, T.hit + 0.25) - 8 * k * held;   // pushed back a step
            h.pose = mixPose(POSES.it, POSES.brace, span(el, T.appear, T.appear + 0.2));
            if (el > T.absorb) {
                const down = span(el, T.absorb + 0.2, T.turn[0]);
                h.pose = mixPose(POSES.brace, POSES.stand, down);
                h.aura = 0.8 * (1 - down) + 0.4 * down;
            }
            if (el > T.turn[0]) {
                // turns round to you: hair stays gold, a wink and two fingers off the brow
                h.dir = el < (T.turn[0] + T.turn[1]) / 2 ? -1 : 1;
                h.look = span(el, T.turn[0], T.turn[1]);
                h.pose = mixPose(POSES.stand, POSES.salute, span(el, T.salute[0], T.salute[0] + 0.3) *
                    (1 - span(el, T.salute[1] - 0.2, T.salute[1])));
                h.pose = mixPose(h.pose, POSES.it, span(el, T.salute[1] - 0.1, T.blink[0]));
                h.aura = 0.4 * (1 - span(el, T.turn[0], T.salute[0]));
            }
        }
        h.ssj = el >= T.appear ? 1 : ssj;
        // just before it takes hold, his hair flickers between black and gold
        if (el > T.ssj[0] - 0.9 && el < T.ssj[0] + 0.3)
            h.ssj = Math.max(h.ssj, Math.sin(el * 47) > 0.2 ? 0.9 : 0);
        const powering = el > T.power[0] && el < T.charge[0] + 0.3;
        if (powering) {
            // rocks lift off the ground round his feet, then the burst flings them away
            const lift = span(el, T.power[0] + 0.3, T.ssj[0] + 0.4);
            const fling = span(el, T.burst, T.burst + 0.9);
            for (let i = 0; i < 9; i++) {
                const side = i % 2 ? 1 : -1;
                const bx = h.x + side * (30 + i * 11) * k;
                const by = gy - lift * (25 + (i * 37) % 90) * k + Math.sin(el * 3 + i) * 3 * k;
                drawRock(cr, bx + side * fling * 500 * k, by - fling * 160 * k + fling * fling * 300 * k,
                    (4 + (i * 5) % 7) * k, el * (0.5 + i * 0.1));
            }
            // a glowing crack along the ground
            const crack = span(el, T.burst - 0.05, T.burst + 0.1) * (1 - span(el, T.burst + 0.8, T.charge[0]));
            if (crack > 0) {
                for (const sd of [-1, 1]) {
                    const pts = [[h.x, gy]];
                    for (let i = 1; i <= 7; i++)
                        pts.push([h.x + sd * i * 26 * k, gy + Math.sin(i * 2.7 + sd) * 4 * k]);
                    for (const [w, al, col] of [[8, 0.35, '#ffd83a'], [2.5, 1, '#fff6c0']]) {
                        poly(cr, pts, false);
                        rgba(cr, col, al * crack);
                        cr.setLineWidth(w * k);
                        cr.stroke();
                    }
                }
                // the shockwave ring
                const u = span(el, T.burst, T.burst + 0.6);
                ellipse(cr, h.x, gy - 4 * k, (40 + 380 * u) * k, (10 + 60 * u) * k);
                rgba(cr, '#fff2b0', 0.6 * (1 - u));
                cr.setLineWidth(6 * k * (1 - u) + 1);
                cr.stroke();
            }
        }
        // the golden flash as he transforms
        if (el > T.ssj[1] - 0.15 && el < T.ssj[1] + 0.5) {
            const a = 1 - clamp((el - T.ssj[1] + 0.15) / 0.65, 0, 1);
            rgba(cr, '#fff3b0', 0.22 * a);
            cr.rectangle(0, 0, W, this.H);
            cr.fill();
            glow(cr, h.x, gy - 70 * k, 300 * k * (1.4 - a), '#ffe25a', 0.7 * a);
        }
        // the wave crossing the screen, launched from the left hands
        if (el >= tFire && el < T.absorb + 0.3) {
            const x0 = xL + 30 * k;
            let tail = x0, head = Math.min(x0 + (el - tFire) * beamSpeed, xR - 30 * k);
            let rad = 24 * k;
            if (el > T.hit) {
                // caught: he squeezes it into a ball between his hands, the tail draining in
                head = xR - 30 * k + 18 * k * span(el, T.hit, T.hit + 0.25) - 8 * k * span(el, T.hit, T.held[1]);
                tail = lerp(x0, head, span(el, T.hit + 0.2, T.absorb) ** 1.3);
                rad = 24 * k * (1 - 0.45 * span(el, T.hit, T.absorb));
            }
            beam = {tail, head, y: beamY(), rad, a: 1 - span(el, T.absorb, T.absorb + 0.3)};
        }
        // the blink out on the left, then in on the right, then away for good
        drawBlink(cr, xL, gy, k, (el - T.gone + 0.1) / 0.35);
        drawBlink(cr, xR, gy, k, (el - T.appear + 0.15) / 0.35);
        drawBlink(cr, xR, gy, k, (el - T.blink[0]) / 0.4);
        if (beam && beam.tail < beam.head - 2 && el < T.absorb)
            drawBeam(cr, beam.tail, beam.head, beam.y, beam.rad, el, beam.a);
        if (h.x > -1000 && el < T.blink[0] + 0.15) {
            const hands = drawHero(cr, h);
            // lightning arcs round him while he's powered up
            if (h.aura > 0.3 && (powering || el > T.appear) && el < T.turn[0]) {
                const n = Math.floor(el * 14);
                for (let i = 0; i < (powering && el > T.ssj[0] - 0.9 ? 4 : 2); i++) {
                    if ((n + i) % 3 === 0)
                        continue;
                    drawSparkArc(cr, h.x + ((n * 17 + i * 29) % 70 - 35) * k, gy - (40 + (n * 23 + i * 41) % 110) * k,
                        22 * k, n * 31 + i * 7, 0.9, h.ssj > 0.5 ? '#9fd8ff' : '#cfe6ff');
                }
            }
            if (orb > 0)
                drawOrb(cr, hands[0], hands[1], orb, el);
            if (beam && el > T.hit && el < T.absorb + 0.3)
                drawOrb(cr, hands[0], hands[1], 22 * k * beam.a * (1 - 0.4 * span(el, T.hit, T.absorb)), el);
            if (el >= T.absorb && el < T.absorb + 0.6) {
                const a = 1 - (el - T.absorb) / 0.6;
                glow(cr, hands[0], hands[1], 200 * k * (1.5 - a), '#bfe8ff', 0.7 * a);
            }
        }
    }
}
