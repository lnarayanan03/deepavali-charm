// Shared drawing code and physics tuning for the Deepavali Charm lamp. Used by the GNOME Shell
// extension (with real Cairo) and by the Windows/Mac desktop app (with a small
// Cairo-on-canvas adapter), so both draw exactly the same lamp.
// Every draw function takes a Cairo-style context plus the surface size in px.

let Cairo = null;

// call once with the Cairo namespace (GJS 'cairo' module, or the canvas adapter)
export function useCairo(c) {
    Cairo = c;
}

// Layout (px, at scale 1)
export const W = 164;            // root width
export const CHAIN_W = 64;       // garland strip width
export const LAMP_W = 160, LAMP_H = 132;
export const RIM_Y = 84;         // height of the basin's rim, inside the lamp area
export const DROP_W = 50, DROP_H = 96;
export const DROP_Y = 124;       // where the bell drop hangs, inside the lamp area
export const DEFAULT_LEN = 150;  // garland chain length, hook to lamp
export const MIN_LEN = 50;

// The basin is a round brass dish whose rim is pinched out into five pointed lips
// ("mugam"), like a five-faced thooku vilakku seen from slightly above. A cotton wick
// lies in the groove of each lip with its end just over the point, where it burns.
export const BASIN_R = 44;       // radius of the round dish
export const LIP = 18;           // how far each lip reaches out past the dish
const LIP_W = 0.56;              // half-width of a lip, as an angle round the rim (rad)
const LIP_LIFT = 4.5;             // lips curl upward towards their points
const SQ = 0.24;                 // perspective: how flat the circle looks from the side

// the five lips, 72 degrees apart with the main one facing us:
// [angle round the rim in degrees (0 = right, 90 = nearest the viewer, 270 = far side),
//  flame width, flame height]
export const WICKS = [[234, 12, 22], [306, 12, 22], [162, 14, 26], [18, 14, 26], [90, 17, 32]];
export const isBack = a => Math.sin((a * Math.PI) / 180) < 0;
const CHAINS = [126, 54];        // front chains hang from the dips between lips
const BACK_CHAIN = 270;

// Pendulum
export const G = 3720;           // K = G / (len + 90): ~1.6 s period at the default length
export const DAMP = 0.55;
export const DROP_K = 55;
export const DROP_DAMP = 5.5;
export const CLICK_SLOP = 6;     // px of movement before a press becomes a drag
export const STRETCH_DEAD = 14;  // px of radial pull before the chain starts to lengthen
export const LEN_K = 95;         // rubber band spring pulling the chain back to its set length
export const LEN_DAMP = 6.5;

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = x => {
    x = clamp(x, 0, 1);
    return x * x * (3 - 2 * x);
};

function rgba(cr, hex, a = 1) {
    const n = parseInt(hex.slice(1), 16);
    cr.setSourceRGBA(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
}

function stop(g, off, hex, a = 1) {
    const n = parseInt(hex.slice(1), 16);
    g.addColorStopRGBA(off, ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
}

function brass(cr, x0, x1) {
    const g = new Cairo.LinearGradient(x0, 0, x1, 0);
    stop(g, 0, '#7a4b05');
    stop(g, 0.22, '#c99a2e');
    stop(g, 0.4, '#ffe9a8');
    stop(g, 0.55, '#e0b041');
    stop(g, 0.85, '#94600c');
    stop(g, 1, '#5c3a03');
    return g;
}

// ---------- basin geometry ----------

const RAD = Math.PI / 180;

// 0 in the dips between lips, rising to 1 at a lip's point
function lipness(phi) {
    let best = 0;
    for (const [a] of WICKS) {
        let d = Math.abs(phi - a * RAD) % (2 * Math.PI);
        if (d > Math.PI)
            d = 2 * Math.PI - d;
        best = Math.max(best, 1 - d / LIP_W);
    }
    return best;
}

// a point on the basin's rim at angle phi (rad), relative to the lamp centre line.
// k scales the radius (k < 1 goes inside the dish), drop moves it down the page.
function rimAt(phi, k = 1, drop = 0) {
    const t = lipness(phi);
    const r = (BASIN_R + LIP * Math.pow(t, 1.7)) * k;
    const lift = LIP_LIFT * Math.pow(t, 2.4) * k;
    return [r * Math.cos(phi), RIM_Y + r * Math.sin(phi) * SQ - lift + drop];
}

// a point on a circle of radius r round the dish, at angle phi, raised by lift
function circleAt(phi, r, lift = 0) {
    return [r * Math.cos(phi), RIM_Y + r * Math.sin(phi) * SQ - lift];
}

// a point along a lip's centre line, u = 0 at the dish edge to 1 at the point
function lipAt(a, u) {
    const phi = a * RAD;
    const t = clamp(u, 0, 1.1);
    const r = BASIN_R - 8 + (LIP + 8) * t;
    const lift = LIP_LIFT * Math.pow(Math.max(0, (r - BASIN_R) / LIP), 2.4);
    return [r * Math.cos(phi), RIM_Y + r * Math.sin(phi) * SQ - lift];
}

// where the wick burns: just past the point of the lip
export function spoutTip(a) {
    const [x, y] = lipAt(a, 1.02);
    return [x, y - 2.2];
}

// trace the rim outline (lips and all) as a closed path
function rimPath(cr, cx, k = 1, drop = 0) {
    cr.newPath();
    const n = 240;
    // sample evenly, plus exactly on each point so the tips stay sharp
    const angles = [];
    for (let i = 0; i < n; i++)
        angles.push((i / n) * 2 * Math.PI);
    for (const [a] of WICKS)
        angles.push(a * RAD);
    angles.sort((p, q) => p - q);
    angles.forEach((phi, i) => {
        const [x, y] = rimAt(phi, k, drop);
        if (i === 0)
            cr.moveTo(cx + x, y);
        else
            cr.lineTo(cx + x, y);
    });
    cr.closePath();
}

function ellipsePath(cr, x, y, rx, ry) {
    cr.newPath();
    cr.save();
    cr.translate(x, y);
    cr.scale(rx, ry);
    cr.arc(0, 0, 1, 0, Math.PI * 2);
    cr.restore();
}

// ---------- garland pieces ----------

function drawMarigold(cr, x, y, r, warm = true) {
    const layers = warm
        ? [[r, '#e8590c', 14, 0.18], [r * 0.74, '#ff8c1a', 11, 0.2], [r * 0.46, '#ffb52e', 8, 0.22]]
        : [[r, '#f59f00', 14, 0.18], [r * 0.74, '#fcc419', 11, 0.2], [r * 0.46, '#ffe066', 8, 0.22]];
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

// pointed mango leaf with a midrib
function drawMangoLeaf(cr, x, y, ang, len) {
    cr.save();
    cr.translate(x, y);
    cr.rotate(ang);
    cr.newPath();
    cr.moveTo(0, 0);
    cr.curveTo(len * 0.3, -len * 0.24, len * 0.75, -len * 0.18, len, 0);
    cr.curveTo(len * 0.75, len * 0.18, len * 0.3, len * 0.24, 0, 0);
    const g = new Cairo.LinearGradient(0, -len * 0.2, 0, len * 0.2);
    stop(g, 0, '#40c057');
    stop(g, 1, '#1b6b2a');
    cr.setSource(g);
    cr.fillPreserve();
    rgba(cr, '#14501f', 0.8);
    cr.setLineWidth(0.6);
    cr.stroke();
    rgba(cr, '#b2f2bb', 0.7);
    cr.setLineWidth(0.6);
    cr.moveTo(1, 0);
    cr.lineTo(len * 0.9, 0);
    cr.stroke();
    cr.restore();
}

// a little cluster of jasmine buds
function drawJasmine(cr, x, y, r) {
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const bx = x + Math.cos(a) * r * 0.55, by = y + Math.sin(a) * r * 0.55;
        cr.save();
        cr.translate(bx, by);
        cr.rotate(a + Math.PI / 2);
        cr.scale(r * 0.32, r * 0.5);
        cr.arc(0, 0, 1, 0, Math.PI * 2);
        cr.restore();
        rgba(cr, '#fffdf2');
        cr.fillPreserve();
        rgba(cr, '#c9c3a3', 0.8);
        cr.setLineWidth(0.5);
        cr.stroke();
    }
    rgba(cr, '#e9f5c9');
    cr.arc(x, y, r * 0.25, 0, Math.PI * 2);
    cr.fill();
}

function drawLinks(cr, x0, y0, x1, y1, w = 2.2) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    cr.save();
    cr.translate(x0, y0);
    cr.rotate(ang);
    for (let t = 0, i = 0; t < len; t += 5.5, i++) {
        cr.newPath();
        if (i % 2 === 0) {
            cr.save();
            cr.translate(t + 3, 0);
            cr.scale(3.6, 2.4);
            cr.arc(0, 0, 1, 0, Math.PI * 2);
            cr.restore();
            rgba(cr, '#ffd970');
            cr.setLineWidth(1.2);
            cr.stroke();
        } else {
            cr.moveTo(t + 0.5, 0);
            cr.lineTo(t + 5.5, 0);
            rgba(cr, '#a8740f');
            cr.setLineWidth(w);
            cr.stroke();
        }
    }
    cr.restore();
}

export function drawGarland(cr, w, h, len) {
    const s = w / CHAIN_W;
    cr.scale(s, s);
    const cx = CHAIN_W / 2;
    cr.setLineCap(Cairo.LineCap.ROUND);

    // brass chain right down the middle
    drawLinks(cr, cx, 8, cx, len + 2);

    // the garland: a tuft of mango leaves at the top, then marigolds strung
    // with jasmine, a leaf pair every third flower
    drawMangoLeaf(cr, cx, 12, Math.PI * 0.62, 22);
    drawMangoLeaf(cr, cx, 12, Math.PI * 0.38, 22);
    drawMangoLeaf(cr, cx, 12, Math.PI * 0.5, 18);
    const top = 20, bottom = len - 6;
    const step = 17;
    let i = 0;
    for (let y = top; y <= bottom; y += step, i++) {
        if (i % 3 === 1) {
            drawMangoLeaf(cr, cx, y + 4, Math.PI * 0.78, 17);
            drawMangoLeaf(cr, cx, y + 4, Math.PI * 0.22, 17);
        }
        if (y + step / 2 <= bottom) {
            drawJasmine(cr, cx - 6.5, y + step / 2, 4.2);
            drawJasmine(cr, cx + 6.5, y + step / 2, 4.2);
        }
        drawMarigold(cr, cx, y, 8, i % 2 === 0);
    }
}

// ---------- the lamp ----------

// The lamp comes in two layers so the far-side flames can sit between them:
// 'back' is the whole basin (dish, lips, wicks, oil, swags) and the back chain;
// 'front' is the two front chains and the swan on top.
export function drawLamp(cr, w, h, layer = 'front') {
    const s = w / LAMP_W;
    cr.scale(s, s);
    const cx = LAMP_W / 2;
    cr.setLineCap(Cairo.LineCap.ROUND);
    if (layer === 'back')
        drawBasin(cr, cx);
    else
        drawCrown(cr, cx);
}

const CROWN_Y = 27;   // where the chains meet under the swan

function chainEnd(cx, a) {
    const [x, y] = circleAt(a * RAD, BASIN_R - 1);
    return [cx + x, y];
}

function drawBasin(cr, cx) {
    // back chain, behind the dish
    const [bx, by] = chainEnd(cx, BACK_CHAIN);
    drawLinks(cr, cx, CROWN_Y, bx, by + 1, 1.8);

    // the round bowl under the dish
    const R = BASIN_R + 2;
    cr.newPath();
    cr.moveTo(cx - R, RIM_Y);
    cr.curveTo(cx - R + 2, RIM_Y + 24, cx - 22, RIM_Y + 31, cx, RIM_Y + 31);
    cr.curveTo(cx + 22, RIM_Y + 31, cx + R - 2, RIM_Y + 24, cx + R, RIM_Y);
    cr.closePath();
    cr.setSource(brass(cr, cx - R, cx + R));
    cr.fillPreserve();
    // warm light from the flames on the upper bowl
    const warm = new Cairo.LinearGradient(0, RIM_Y, 0, RIM_Y + 28);
    stop(warm, 0, '#ffb347', 0.5);
    stop(warm, 1, '#ffb347', 0);
    cr.setSource(warm);
    cr.fill();

    // engraved band: a row of dots and lotus petals round the bowl
    for (let k = -4; k <= 4; k++) {
        const x = cx + k * 9.2;
        const t = (x - cx) / R;
        const y = RIM_Y + 9 + 7 * Math.sqrt(Math.max(0, 1 - t * t));
        rgba(cr, '#6b4204', 0.7);
        cr.newPath();
        cr.arc(x, y, 1.05, 0, Math.PI * 2);
        cr.fill();
        if (Math.abs(k) <= 3) {
            cr.newPath();
            cr.moveTo(x - 4, y + 8);
            cr.curveTo(x - 4, y + 3, x, y + 2, x, y + 2);
            cr.curveTo(x, y + 2, x + 4, y + 3, x + 4, y + 8);
            rgba(cr, '#6b4204', 0.5);
            cr.setLineWidth(0.9);
            cr.stroke();
        }
    }

    // knob under the bowl and the ring the bell drop hangs from
    cr.newPath();
    cr.moveTo(cx - 9, RIM_Y + 29);
    cr.curveTo(cx - 8, RIM_Y + 38, cx - 3, DROP_Y - 4, cx, DROP_Y - 3);
    cr.curveTo(cx + 3, DROP_Y - 4, cx + 8, RIM_Y + 38, cx + 9, RIM_Y + 29);
    cr.closePath();
    cr.setSource(brass(cr, cx - 9, cx + 9));
    cr.fill();
    rgba(cr, '#c99a2e');
    cr.setLineWidth(1.8);
    cr.newPath();
    cr.arc(cx, DROP_Y + 1, 2.6, 0, Math.PI * 2);
    cr.stroke();

    // garland swags across the front of the bowl
    const swag = (x0, y0, x1, y1, dip) => {
        const n = 8;
        for (let k = 0; k <= n; k++) {
            const t = k / n;
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * dip;
            if (k % 2)
                drawJasmine(cr, x, y, 3.2);
            else
                drawMarigold(cr, x, y, 4.2, k % 4 === 0);
        }
    };
    swag(cx - R + 3, RIM_Y + 6, cx, RIM_Y + 15, 9);
    swag(cx, RIM_Y + 15, cx + R - 3, RIM_Y + 6, 9);

    // the dish with its five lips: first the thick edge, seen along the front ...
    rimPath(cr, cx, 1, 3.2);
    rgba(cr, '#6e4304');
    cr.fill();
    rimPath(cr, cx, 1, 1.6);
    rgba(cr, '#a8740f');
    cr.fill();
    // ... then the flat top, lit from the flames above
    rimPath(cr, cx);
    cr.setSource(brass(cr, cx - BASIN_R - LIP, cx + BASIN_R + LIP));
    cr.fillPreserve();
    const top = new Cairo.RadialGradient(cx, RIM_Y - 4, 4, cx, RIM_Y, BASIN_R + LIP);
    stop(top, 0, '#ffe7a0', 0.55);
    stop(top, 0.6, '#ffc861', 0.18);
    stop(top, 1, '#ffc861', 0);
    cr.setSource(top);
    cr.fillPreserve();
    rgba(cr, '#4a2e02', 0.8);
    cr.setLineWidth(0.8);
    cr.stroke();
    // a bright edge along the front of the lips
    cr.newPath();
    for (let i = 0; i <= 120; i++) {
        const phi = 0.05 + (i / 120) * (Math.PI - 0.1);
        const [x, y] = rimAt(phi, 0.985);
        if (i === 0)
            cr.moveTo(cx + x, y);
        else
            cr.lineTo(cx + x, y);
    }
    rgba(cr, '#fff1c4', 0.75);
    cr.setLineWidth(0.9);
    cr.stroke();

    // an engraved ring round the dish, between the oil and the lips
    ellipsePath(cr, cx, RIM_Y, BASIN_R - 3, (BASIN_R - 3) * SQ);
    rgba(cr, '#6b4204', 0.45);
    cr.setLineWidth(0.8);
    cr.stroke();

    // the well of oil: a dark inner wall, then the oil itself, glowing
    ellipsePath(cr, cx, RIM_Y, BASIN_R - 7, (BASIN_R - 7) * SQ);
    const wall = new Cairo.LinearGradient(0, RIM_Y - (BASIN_R - 7) * SQ, 0, RIM_Y + (BASIN_R - 7) * SQ);
    stop(wall, 0, '#4a2a00');
    stop(wall, 1, '#9a6510');
    cr.setSource(wall);
    cr.fill();
    ellipsePath(cr, cx, RIM_Y + 1.6, BASIN_R - 10, (BASIN_R - 10) * SQ * 0.92);
    const oil = new Cairo.RadialGradient(cx, RIM_Y, 1, cx, RIM_Y + 1.6, BASIN_R - 10);
    stop(oil, 0, '#ffe28f');
    stop(oil, 0.5, '#d68d1c');
    stop(oil, 1, '#7a4500');
    cr.setSource(oil);
    cr.fill();
    // the flames shine in the oil
    for (const [a] of WICKS) {
        const [x, y] = circleAt(a * RAD, BASIN_R - 18);
        ellipsePath(cr, cx + x, y + 1.4, 3.2, 1.1);
        rgba(cr, '#fff6d0', isBack(a) ? 0.55 : 0.35);
        cr.fill();
    }

    // a groove down each lip with a cotton wick lying in it; the back ones first
    const order = [...WICKS].sort((p, q) => Math.sin(p[0] * RAD) - Math.sin(q[0] * RAD));
    for (const [a] of order)
        drawWick(cr, cx, a);
}

// the oil groove along a lip and the twisted cotton wick lying in it
function drawWick(cr, cx, a) {
    const line = (u0, u1, steps = 8) => {
        cr.newPath();
        for (let i = 0; i <= steps; i++) {
            const [x, y] = lipAt(a, u0 + ((u1 - u0) * i) / steps);
            if (i === 0)
                cr.moveTo(cx + x, y);
            else
                cr.lineTo(cx + x, y);
        }
    };
    // groove
    line(0.12, 0.96);
    rgba(cr, '#5c3500', 0.85);
    cr.setLineWidth(3.4);
    cr.stroke();
    line(0.12, 0.96);
    rgba(cr, '#c98a1e', 0.9);
    cr.setLineWidth(1.6);
    cr.stroke();
    // wick: soaked and golden where it dips in the oil, white cotton towards the point
    line(0.15, 0.45);
    rgba(cr, '#e0b664');
    cr.setLineWidth(2.1);
    cr.stroke();
    line(0.4, 1.0);
    rgba(cr, '#fff4dc');
    cr.setLineWidth(2.1);
    cr.stroke();
    // the twist of the cotton
    for (let u = 0.2; u < 0.95; u += 0.12) {
        const [x0, y0] = lipAt(a, u);
        const [x1, y1] = lipAt(a, u + 0.07);
        const dx = x1 - x0, dy = y1 - y0, n = Math.hypot(dx, dy) || 1;
        const nx = -dy / n, ny = dx / n;
        cr.newPath();
        cr.moveTo(cx + x0 + nx * 1.1, y0 + ny * 1.1);
        cr.lineTo(cx + x1 - nx * 1.1, y1 - ny * 1.1);
        rgba(cr, '#b08a4a', 0.75);
        cr.setLineWidth(0.6);
        cr.stroke();
    }
    // the burning end, a little raised and charred
    const [tx, ty] = spoutTip(a);
    cr.newPath();
    cr.arc(cx + tx, ty + 1, 1.9, 0, Math.PI * 2);
    rgba(cr, '#fff4dc');
    cr.fill();
    cr.newPath();
    cr.arc(cx + tx, ty + 0.2, 1.2, 0, Math.PI * 2);
    rgba(cr, '#2b1800');
    cr.fill();
}

// the front chains and the swan (annam) on top that the chains hang from
function drawCrown(cr, cx) {
    for (const a of CHAINS) {
        const [x, y] = chainEnd(cx, a);
        drawLinks(cr, cx + (x > cx ? 2.5 : -2.5), CROWN_Y, x, y, 2);
    }
    drawSwan(cr, cx, 17);
}

// a little brass swan in profile, looking left, sitting on a bead
function drawSwan(cr, cx, by) {
    // the hanging ring on its back
    rgba(cr, '#c99a2e');
    cr.setLineWidth(2.2);
    cr.newPath();
    cr.arc(cx + 1.5, 3.6, 3, 0, Math.PI * 2);
    cr.stroke();
    cr.newPath();
    cr.moveTo(cx + 1.5, 6.5);
    cr.lineTo(cx + 1.5, by - 3);
    cr.setLineWidth(1.8);
    cr.stroke();

    const fill = (x0, x1) => {
        cr.setSource(brass(cr, x0, x1));
        cr.fillPreserve();
        rgba(cr, '#4a2e02', 0.75);
        cr.setLineWidth(0.7);
        cr.stroke();
    };
    // bead and collar under the swan, where the chains meet
    ellipsePath(cr, cx, by + 8, 6, 2.6);
    fill(cx - 6, cx + 6);
    ellipsePath(cr, cx, by + 4.6, 3.2, 2.2);
    fill(cx - 3.2, cx + 3.2);
    // tail feathers sweeping up behind
    cr.newPath();
    cr.moveTo(cx + 3, by + 3);
    cr.curveTo(cx + 11, by + 3, cx + 14, by - 4, cx + 12, by - 9);
    cr.curveTo(cx + 10.5, by - 5, cx + 8, by - 2.5, cx + 3, by - 2);
    cr.closePath();
    fill(cx + 3, cx + 14);
    // plump body
    ellipsePath(cr, cx, by, 9, 4.8);
    fill(cx - 9, cx + 9);
    // curved neck and round head
    cr.newPath();
    cr.moveTo(cx - 5, by - 1);
    cr.curveTo(cx - 10.5, by - 4, cx - 3, by - 8, cx - 6.5, by - 11.5);
    cr.setSource(brass(cr, cx - 10, cx - 2));
    cr.setLineWidth(3.4);
    cr.stroke();
    cr.newPath();
    cr.arc(cx - 6.6, by - 12, 2.7, 0, Math.PI * 2);
    fill(cx - 9.3, cx - 3.9);
    // beak
    cr.newPath();
    cr.moveTo(cx - 8.8, by - 13);
    cr.lineTo(cx - 12.6, by - 11.4);
    cr.lineTo(cx - 8.6, by - 10.8);
    cr.closePath();
    rgba(cr, '#e07b12');
    cr.fill();
    // eye and a carved wing
    cr.newPath();
    cr.arc(cx - 7, by - 12.5, 0.75, 0, Math.PI * 2);
    rgba(cr, '#2b1800');
    cr.fill();
    cr.newPath();
    cr.moveTo(cx - 3, by - 0.5);
    cr.curveTo(cx + 1, by + 2.8, cx + 5, by + 1.5, cx + 7, by - 1.5);
    rgba(cr, '#6b4204', 0.7);
    cr.setLineWidth(0.8);
    cr.stroke();
    cr.newPath();
    cr.moveTo(cx - 1, by + 1);
    cr.curveTo(cx + 2, by + 2.6, cx + 4.5, by + 1.6, cx + 5.5, by);
    cr.stroke();
}

// bell drop under the bowl: a short garland ending in a bell
export function drawDrop(cr, w) {
    const s = w / DROP_W;
    cr.scale(s, s);
    const cx = DROP_W / 2;
    drawLinks(cr, cx, 2, cx, 24, 1.8);
    drawMangoLeaf(cr, cx, 27, Math.PI * 0.75, 13);
    drawMangoLeaf(cr, cx, 27, Math.PI * 0.25, 13);
    drawMarigold(cr, cx, 28, 6.5);
    drawJasmine(cr, cx, 39, 4.2);
    drawMarigold(cr, cx, 49, 5.5, false);
    drawLinks(cr, cx, 54, cx, 62, 1.6);
    // bell
    const by = 62;
    cr.newPath();
    cr.moveTo(cx - 10, by + 20);
    cr.curveTo(cx - 9, by + 4, cx - 5, by, cx, by);
    cr.curveTo(cx + 5, by, cx + 9, by + 4, cx + 10, by + 20);
    cr.curveTo(cx + 4, by + 22.5, cx - 4, by + 22.5, cx - 10, by + 20);
    cr.closePath();
    cr.setSource(brass(cr, cx - 10, cx + 10));
    cr.fill();
    rgba(cr, '#6b4204', 0.6);
    cr.setLineWidth(0.9);
    cr.moveTo(cx - 9.3, by + 15);
    cr.curveTo(cx - 3, by + 17, cx + 3, by + 17, cx + 9.3, by + 15);
    cr.stroke();
    rgba(cr, '#5c3a03');
    cr.arc(cx, by + 24, 2.6, 0, Math.PI * 2);
    cr.fill();
}

// one little oil-lamp flame: a plump teardrop with a soft round belly, a bright
// creamy heart, a hint of blue at the root and a tiny shine. bend (-1..1) tips it
// over so it can sway. f.level (0..1) grows or shrinks it; f.ember (0..1) is the
// glowing wick end; f.smoke (0..1) the wisp left after it is blown out.
export function drawFlame(cr, w, h, f) {
    const cx = w / 2, base = h - 1.5;
    if ((f.smoke ?? 0) > 0.01)
        drawSmoke(cr, w, h, f.smoke, f.t ?? 0);
    const ember = f.ember ?? 0;
    if (ember > 0.01) {
        const g = new Cairo.RadialGradient(cx, base - 1, 0, cx, base - 1, w * 0.22);
        stop(g, 0, '#ffd27a', 0.95 * ember);
        stop(g, 0.4, '#ff6a00', 0.7 * ember);
        stop(g, 1, '#ff4000', 0);
        cr.setSource(g);
        cr.newPath();
        cr.arc(cx, base - 1, w * 0.22, 0, Math.PI * 2);
        cr.fill();
    }
    const lv = f.level ?? 1;
    if (lv < 0.02)
        return;
    const fh = h * 0.92 * lv, fw = w * 0.3 * Math.sqrt(lv);
    const bend = f.bend ?? 0;
    // r: the belly's radius, so the bottom is a round bulb
    const shape = (k, lift = 0) => {
        const b = base - lift;
        const hh = fh * k - lift;
        const r = fw * k;
        const tx = cx + bend * w * 0.3 * k, ty = b - hh;
        const midY = b - r;
        cr.newPath();
        cr.moveTo(tx, ty);
        // right side: a soft shoulder curving out to the round belly
        cr.curveTo(tx + r * 0.35, ty + hh * 0.28, cx + r * 1.02, midY - r * 1.15, cx + r, midY);
        cr.curveTo(cx + r * 0.98, b - r * 0.4, cx + r * 0.58, b, cx, b);
        // and back up the left
        cr.curveTo(cx - r * 0.58, b, cx - r * 0.98, b - r * 0.4, cx - r, midY);
        cr.curveTo(cx - r * 1.02, midY - r * 1.15, tx - r * 0.35, ty + hh * 0.28, tx, ty);
        cr.closePath();
    };
    // soft halo
    shape(1.22);
    let g = new Cairo.RadialGradient(cx, base - fh * 0.32, 0, cx, base - fh * 0.32, fh * 0.75);
    stop(g, 0, '#ffb340', 0.45);
    stop(g, 1, '#ff7a1a', 0);
    cr.setSource(g);
    cr.fill();
    // body: warm orange at the tip melting into gold
    shape(1);
    g = new Cairo.LinearGradient(0, base - fh, 0, base);
    stop(g, 0, '#ff6f1a', 0.92);
    stop(g, 0.35, '#ff9d1f');
    stop(g, 0.75, '#ffc93a');
    stop(g, 1, '#ffb52a');
    cr.setSource(g);
    cr.fill();
    // creamy heart, low in the belly
    shape(0.62, fh * 0.07);
    g = new Cairo.RadialGradient(cx, base - fh * 0.24, 0, cx, base - fh * 0.26, fw * 1.15);
    stop(g, 0, '#fffef2');
    stop(g, 0.55, '#fff3b0', 0.95);
    stop(g, 1, '#ffe066', 0.2);
    cr.setSource(g);
    cr.fill();
    // a hint of blue where it sits on the wick
    ellipsePath(cr, cx, base - fw * 0.15, fw * 0.55, fw * 0.25);
    g = new Cairo.RadialGradient(cx, base - fw * 0.15, 0, cx, base - fw * 0.15, fw * 0.6);
    stop(g, 0, '#7aa0ff', 0.5);
    stop(g, 1, '#7aa0ff', 0);
    cr.setSource(g);
    cr.fill();
    // tiny shine, like a glint on a sweet
    ellipsePath(cr, cx - fw * 0.38 + bend * fw * 0.2, base - fh * 0.48, fw * 0.13, fw * 0.24);
    rgba(cr, '#ffffff', 0.55 * Math.min(1, lv * 1.5));
    cr.fill();
}

// ---------- the sky: the gust that blows the lamp out, and crackers ----------
// Both are drawn on one click-through layer the size of the whole screen.

// a tiny repeatable random, so the streak layout is the same on every run
function seeded(seed) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
}

// the first few streaks run right past the lamp; the rest fill the whole screen
const STREAKS = (() => {
    const r = seeded(7);
    return Array.from({length: 30}, (_, i) => ({
        near: i < 9,
        y: i < 9 ? (r() - 0.5) * 2 : r(),
        speed: 0.75 + r() * 0.6,
        len: 110 + r() * 190,
        amp: 3 + r() * 7,
        ph: r() * 6.28,
        off: r(),
        lw: 1.1 + r() * 1.2,
        curl: i % 4 === 0,
    }));
})();

// how strong the air is at (x, y): patches of strong and weak air that drift along
// with the wind, so some streaks blaze and others barely show. d: distance blown.
function airPatch(x, y, d, s) {
    const u = x / s - d * 520, v = y / s;
    const a = 0.5 + 0.5 * Math.sin(u * 0.0047 + v * 0.0031 + 0.7);
    const b = 0.5 + 0.5 * Math.sin(v * 0.0093 - u * 0.0012 + d * 0.9 + 2.1);
    return 0.12 + 0.88 * Math.pow(a * b, 0.6);
}

// streaks of moving air flowing across the whole screen, a few curling over.
// Drawn in screen px (W x H). g = {k: strength 0..1, t: seconds since the gust began,
// d: how far the air has moved (speeds up in the puffs), dir: +1 blows left-to-right,
// -1 right-to-left, y: height of the flames, s: scale}
export function drawGust(cr, W, H, g) {
    const k = g.k ?? 0;
    if (k < 0.01)
        return;
    const s = g.s ?? 1;
    cr.save();
    if (g.dir < 0) {
        cr.translate(W, 0);
        cr.scale(-1, 1);
    }
    cr.setLineCap(Cairo.LineCap.ROUND);
    const v = Math.max(900, W * 0.75);   // px/s: a streak crosses the screen in about 1.5 s
    for (const st of STREAKS) {
        const len = st.len * s;
        const span = W + len + 120 * s;
        const head = (((g.d ?? g.t) * st.speed * v + st.off * span) % span) - 40 * s;
        const tail = head - len;
        if (head < 0 || tail > W)
            continue;
        const y0 = st.near ? g.y + st.y * 60 * s : 30 * s + st.y * (H - 60 * s);
        // the air comes in patches; away from the lamp it is fainter, so the screen
        // stays readable
        const p = airPatch((head + tail) / 2, y0, g.d ?? g.t, s);
        const a = k * (st.near ? 0.5 + 0.5 * p : 0.85 * p);
        const pts = [];
        for (let j = 0; j <= 20; j++) {
            const x = tail + (len * j) / 20;
            pts.push([x, y0 + st.amp * s * Math.sin(x * 0.045 / s + st.ph + g.t * 4)]);
        }
        const lw = st.lw * s * (0.65 + 0.6 * p);
        const draw = (col, alpha, width, dy) => {
            cr.newPath();
            pts.forEach(([x, y], j) => (j ? cr.lineTo(x, y + dy) : cr.moveTo(x, y + dy)));
            const grad = new Cairo.LinearGradient(tail, 0, head, 0);
            stop(grad, 0, col, 0);
            stop(grad, 0.6, col, alpha * a);
            stop(grad, 1, col, 0);
            cr.setSource(grad);
            cr.setLineWidth(width);
            cr.stroke();
        };
        // a wide soft band of moving air, a faint dark edge so it shows on light
        // wallpapers too, and a bright core
        draw('#e8f0ff', 0.1, lw * 5, 0);
        draw('#3a4a66', 0.16, lw * 1.6 + 1.2 * s, 1.1 * s);
        draw('#f6f9ff', 0.75, lw * 1.5, 0);
        if (st.curl) {
            const [hx, hy] = pts[pts.length - 1];
            cr.newPath();
            for (let j = 0; j <= 24; j++) {
                const u = j / 24;
                const ang = Math.PI / 2 - u * Math.PI * 1.6;
                const r = 8 * s * (1 - u * 0.6);
                const x = hx + Math.cos(ang) * r, y = hy - 8 * s + Math.sin(ang) * r;
                if (j === 0)
                    cr.moveTo(x, y);
                else
                    cr.lineTo(x, y);
            }
            rgba(cr, '#f6f9ff', 0.5 * a);
            cr.setLineWidth(lw * 1.1);
            cr.stroke();
        }
    }
    cr.restore();
}

// bright festival colours, a few to a burst; warm ones most of the time
const BURSTS = [
    ['#ffd27a', '#fff1c9', '#ffb347'],
    ['#ff9a2e', '#ffe0a0', '#ff6a3a'],
    ['#ff6f91', '#ffd6df', '#ffb35a'],
    ['#5ff0b0', '#e4fff4', '#ffd27a'],
    ['#a98bff', '#efe9ff', '#ff8fcf'],
    ['#ff4a4a', '#ffd0a0', '#ffe66a'],
    ['#6ad1ff', '#e6f8ff', '#c9a6ff'],
];
const TEXT_COLS = ['#ffe9a8', '#ffd060', '#ffb03a', '#ff8a5a', '#ff9fc0'];
export const DOUBLE_MS = 300;   // a second click within this long is a double-click
export const SHOW_S = 10;       // a crackers show, start to last fading spark
const TEXT_S = 4.9;             // the closing rocket: climb, write the words, hold, fade
const TEXT_HOLD = 1.8;          // how long "Happy Diwali" hangs in the sky

// a little stroke font, just the letters of "Happy Diwali". Units: height 1, y down.
const arcPts = (cx, cy, rx, ry, a0, a1, n = 8) =>
    Array.from({length: n + 1}, (_, i) => {
        const a = a0 + ((a1 - a0) * i) / n;
        return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    });
const GLYPHS = {
    H: [0.62, [[[0, 0], [0, 1]], [[0.62, 0], [0.62, 1]], [[0, 0.5], [0.62, 0.5]]]],
    a: [0.56, [[...arcPts(0.28, 0.69, 0.28, 0.31, -0.1, Math.PI * 2 - 0.1, 14)], [[0.56, 0.38], [0.56, 1]]]],
    p: [0.56, [[[0, 0.38], [0, 1.32]], [...arcPts(0.28, 0.69, 0.28, 0.31, Math.PI, Math.PI * 3, 14)]]],
    y: [0.56, [[[0, 0.38], [0.28, 0.98]], [[0.56, 0.38], [0.24, 1.18], [0.1, 1.32]]]],
    D: [0.64, [[[0, 0], [0, 1]], [[0, 0], [0.2, 0], ...arcPts(0.2, 0.5, 0.44, 0.5, -Math.PI / 2, Math.PI / 2, 12), [0, 1]]]],
    i: [0.14, [[[0.07, 0.42], [0.07, 1]], [[0.07, 0.18], [0.07, 0.2]]]],
    w: [0.8, [[[0, 0.38], [0.2, 1], [0.4, 0.5], [0.6, 1], [0.8, 0.38]]]],
    l: [0.14, [[[0.07, 0], [0.07, 1]]]],
    ' ': [0.42, []],
};
const GAP = 0.2;

// dots along the strokes of `text`, centred on (0, 0), one every `step` (units)
function textDots(text, step) {
    const width = [...text].reduce((w, c) => w + GLYPHS[c][0] + GAP, -GAP);
    const dots = [];
    let x = -width / 2;
    for (const c of text) {
        const [gw, strokes] = GLYPHS[c];
        for (const st of strokes) {
            if (st.length === 2 && Math.hypot(st[1][0] - st[0][0], st[1][1] - st[0][1]) < 0.05) {
                dots.push([x + st[0][0], st[0][1] - 0.5, true]);   // the dot on an i
                continue;
            }
            let carry = 0;
            for (let k = 1; k < st.length; k++) {
                const [x0, y0] = st[k - 1], [x1, y1] = st[k];
                const len = Math.hypot(x1 - x0, y1 - y0);
                let d = carry;
                for (; d < len; d += step)
                    dots.push([x + x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len - 0.5]);
                carry = d - len;
            }
            const last = st[st.length - 1];
            dots.push([x + last[0], last[1] - 0.5]);
        }
        x += gw + GAP;
    }
    return {dots, width};
}

// Double-click the lamp: a 10 s show of big, bright rockets across the sky, closing
// with one that bursts into the words "Happy Diwali" written in sparks.
// A relight rocket bursts just above the lamp instead and drops one glowing spark onto
// each wick; the wick catches when its spark lands.
// Positions are screen px; `play(name)` plays a sound. For relighting, set
// `lamp()` -> {x, y, wicks: [{x, y}]} (live, the lamp swings) and `onWick(i)`.
export class Crackers {
    constructor(play) {
        this.play = play;
        this.queue = [];
        this.rockets = [];
        this.sparks = [];
        this.glows = [];
        this.seeds = [];
        this.words = [];     // the sparks spelling "Happy Diwali"
        this.flash = 0;      // the whole sky lights up a little on a big burst
        this.lamp = null;
        this.onWick = null;
    }

    get active() {
        return this.queue.length + this.rockets.length + this.sparks.length + this.glows.length +
            this.seeds.length + this.words.length > 0 || this.flash > 0;
    }

    // a relight rocket is on its way (queued, climbing, or its sparks still falling)
    get relighting() {
        return this.queue.some(q => q.relight) || this.rockets.some(r => r.relight) || this.seeds.length > 0;
    }

    _screen(W, H, s) {
        this.W = W;
        this.H = H;
        this.s = s;
    }

    // one rocket that bursts over the lamp and lights its wicks. Returns false if it
    // can't (no lamp to aim at).
    relight(now, W, H, s) {
        if (!this.lamp || !this.onWick)
            return false;
        if (this.relighting)
            return true;
        this._screen(W, H, s);
        this.queue.push({at: now, relight: true});
        this.queue.sort((a, b) => a.at - b.at);
        return true;
    }

    // W x H: the screen; s: scale. Returns false while a show is still going up.
    // relight: the lamp is dark, so the last of the big rockets lights it again
    launch(now, W, H, s, relight = false) {
        if (this.queue.length || this.rockets.length || this.words.length)
            return false;
        this._screen(W, H, s);
        // rockets go up for the first ~5 s; the closing word rocket needs the rest
        const window = SHOW_S - TEXT_S;
        const n = 14 + Math.round(window * 2.4);
        // spread them across the screen, in a random order
        const xs = Array.from({length: n}, (_, i) => (i + 0.5) / n + rand(-0.04, 0.04));
        xs.sort(() => Math.random() - 0.5);
        // launch times scattered over the window, a volley of five at the end
        const ats = [0, 0.12, ...Array.from({length: n - 7}, () => rand(0, window * 0.75)),
            window * 0.8, window * 0.84, window * 0.88, window * 0.92, window * 0.96].sort((p, q) => p - q);
        xs.forEach((fx, i) => this.queue.push({at: now + ats[i], fx: clamp(fx, 0.05, 0.95), last: i >= n - 5,
            relight: relight && i === n - 1 && !!this.lamp && !!this.onWick}));
        this.queue.push({at: now + window, text: true});
        this.queue.sort((a, b) => a.at - b.at);
        return true;
    }

    tick(now, dt) {
        const {W, H, s} = this;
        while (this.queue.length && this.queue[0].at <= now) {
            const {fx, last, relight, text} = this.queue.shift();
            if (relight) {
                // climb from below the lamp to just above it
                const lp = this.lamp();
                const x1 = clamp(lp.x, 30 * s, W - 30 * s);
                const x0 = clamp(x1 + rand(-140, 140) * s, 20 * s, W - 20 * s);
                this.rockets.push({
                    x0, y0: H + 10 * s, x1, y1: Math.max(40 * s, lp.y - 140 * s),
                    x: x0, y: H + 10 * s, t: 0, dur: 1.25, trail: [], relight: true,
                });
                this.play(`whoosh-${Math.floor(Math.random() * 2)}`);
                continue;
            }
            if (text) {
                // the big one: up the middle, a thick bright trail
                this.rockets.push({
                    x0: W / 2, y0: H + 10 * s, x1: W / 2, y1: H * 0.3,
                    x: W / 2, y: H + 10 * s, t: 0, dur: 1.3, trail: [], text: true,
                });
                this.play('whoosh-big');
                continue;
            }
            const x0 = fx * W;
            const kind = last ? pick(['peony', 'ring', 'peony']) :
                pick(['peony', 'peony', 'ring', 'willow', 'glitter', 'double']);
            this.rockets.push({
                x0, y0: H + 10 * s, x1: x0 + rand(-60, 60) * s, y1: H * rand(0.12, 0.42),
                x: x0, y: H + 10 * s, t: 0, dur: rand(0.95, 1.3), trail: [], kind,
            });
            this.play(`whoosh-${Math.floor(Math.random() * 2)}`);
        }
        this.rockets = this.rockets.filter(r => {
            r.t += dt;
            const u = Math.min(1, r.t / r.dur);
            const e = 1 - (1 - u) ** 2.2;   // slowing as it climbs
            r.x = r.x0 + (r.x1 - r.x0) * e + Math.sin(r.t * 9) * 1.2 * s;
            r.y = r.y0 + (r.y1 - r.y0) * e;
            r.trail.push([r.x, r.y]);
            if (r.trail.length > 18)
                r.trail.shift();
            if (u < 1)
                return true;
            if (r.relight)
                this._relightBurst(r);
            else if (r.text)
                this._textBurst(r);
            else
                this._burst(r);
            return false;
        });
        this._tickSeeds(dt);
        const born = [];
        this.sparks = this.sparks.filter(p => {
            p.age += dt;
            const drag = Math.exp(-p.drag * dt);
            p.vx *= drag;
            p.vy = p.vy * drag + p.grav * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            // glitter: near the end each spark crackles into a few tiny white flashes
            if (p.glitter && !p.popped && p.age > p.life * 0.62) {
                p.popped = true;
                for (let k = 0; k < 3; k++) {
                    born.push({x: p.x, y: p.y, vx: rand(-40, 40) * s, vy: rand(-40, 40) * s, age: 0,
                        life: rand(0.25, 0.45), drag: 3, grav: 20 * s, col: '#fffbe8', w: 1.4 * s, tw: 0});
                }
                if (Math.random() < 0.04)
                    this.play('crackle');
            }
            return p.age < p.life;
        });
        this.sparks.push(...born);
        this._tickWords(dt);
        this.glows = this.glows.filter(g => (g.age += dt) < (g.life ?? 0.7));
        this.flash = Math.max(0, this.flash - dt * 2.2);
    }

    // a small golden bloom, and one bright spark falling onto each wick in turn
    _relightBurst(r) {
        const s = this.s;
        const cols = BURSTS[0];
        for (let i = 0; i < 36; i++) {
            const ang = (i / 36) * Math.PI * 2 + rand(-0.1, 0.1);
            const sp = rand(110, 150) * s;
            this.sparks.push({
                x: r.x, y: r.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                age: 0, life: rand(1.4, 2.0), drag: 1.6, grav: 60 * s,
                col: pick(cols), w: 1.3 * s, tw: rand(0, 6.28),
            });
        }
        this.glows.push({x: r.x, y: r.y, age: 0, col: cols[0]});
        this.play(`pop-${Math.floor(Math.random() * 3)}`);
        // sweep across the lamp from one side, like the sparks are drifting over it
        const wicks = this.lamp().wicks.map((w, i) => [w.x, i]);
        const side = Math.random() < 0.5 ? 1 : -1;
        wicks.sort((a, b) => (a[0] - b[0]) * side);
        wicks.forEach(([, i], k) => this.seeds.push({
            i, x0: r.x, y0: r.y, x: r.x, y: r.y, t: 0, dur: 0.55 + k * 0.3,
            bulge: rand(25, 45) * s * (Math.random() < 0.5 ? -1 : 1), trail: [],
        }));
    }

    // falling sparks home in on their wick (wherever the swinging lamp has taken it)
    _tickSeeds(dt) {
        if (!this.seeds.length)
            return;
        const wicks = this.lamp().wicks;
        this.seeds = this.seeds.filter(p => {
            p.t += dt;
            const u = Math.min(1, p.t / p.dur);
            const w = wicks[p.i];
            // drifts out sideways first, then drops faster and faster onto the wick
            p.x = p.x0 + (w.x - p.x0) * smooth(u) + p.bulge * Math.sin(Math.PI * u);
            p.y = p.y0 + (w.y - p.y0) * u ** 1.7;
            p.trail.push([p.x, p.y]);
            if (p.trail.length > 10)
                p.trail.shift();
            if (u < 1)
                return true;
            this.onWick(p.i);
            this.glows.push({x: w.x, y: w.y, age: 0, col: '#ffd27a', r: 34});
            return false;
        });
    }

    _burst(r) {
        const s = this.s;
        const kind = r.kind ?? 'peony';
        const cols = kind === 'willow' ? BURSTS[0] : kind === 'glitter' ? ['#fff4d0', '#ffe08a', '#ffffff'] : pick(BURSTS);
        const R = rand(280, 380) * s * (kind === 'ring' ? 0.8 : 1);
        const n = 80;
        const add = (ang, sp, o) => this.sparks.push({
            x: r.x, y: r.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, age: 0, tw: rand(0, 6.28), ...o,
        });
        if (kind === 'ring') {
            // one crisp ring, tilted a little
            const tilt = rand(-0.6, 0.6), sq = rand(0.45, 1);
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2;
                const vx = Math.cos(a), vy = Math.sin(a) * sq;
                const ang = Math.atan2(vx * Math.sin(tilt) + vy * Math.cos(tilt), vx * Math.cos(tilt) - vy * Math.sin(tilt));
                add(ang, R * Math.hypot(vx, vy), {life: rand(1.5, 1.9), drag: 1.6, grav: 40 * s, col: pick(cols), w: 2.2 * s});
            }
        } else {
            // an outer shell and a brighter inner bloom, so it opens like a flower
            for (let i = 0; i < n * 1.6; i++) {
                const inner = i >= n;
                const ang = ((inner ? i - n : i) / (inner ? n * 0.6 : n)) * Math.PI * 2 + rand(-0.06, 0.06);
                const willow = kind === 'willow';
                const sp = R * (inner ? rand(0.32, 0.55) : willow ? rand(0.6, 1) : rand(0.88, 1));
                add(ang, sp, {
                    life: willow ? rand(2.4, 3.0) : rand(1.7, 2.3), drag: willow ? 1.2 : 1.45,
                    grav: (willow ? 75 : 45) * s, col: inner ? (kind === 'double' ? pick(pick(BURSTS)) : cols[1]) : pick(cols),
                    w: (inner ? 1.8 : 2.3) * s, glitter: kind === 'glitter' && !inner,
                });
            }
        }
        this.glows.push({x: r.x, y: r.y, age: 0, col: cols[0], r: 170});
        this.flash = Math.min(1, this.flash + 0.35);
        this.play(`boom-${Math.floor(Math.random() * 3)}`);
    }

    // the closing rocket: a golden burst, and its sparks fly out to spell the words
    _textBurst(r) {
        const s = this.s, W = this.W;
        const step = 0.05;
        const {dots, width} = textDots('Happy Diwali', step);
        const h = Math.min((W * 0.8) / width, 170 * s);
        dots.forEach(([dx, dy, dot], i) => {
            const u = (dx + width / 2) / width;   // left to right, for the colour sweep
            this.words.push({
                x0: r.x, y0: r.y, x: r.x, y: r.y, tx: r.x + dx * h, ty: r.y + dy * h,
                age: 0, fly: rand(0.45, 0.75), hold: TEXT_HOLD + u * 0.2, vx: 0, vy: 0,
                col: TEXT_COLS[Math.min(TEXT_COLS.length - 1, Math.floor(u * TEXT_COLS.length))],
                tw: rand(0, 6.28), w: (dot ? 5 : 4) * s * Math.min(1.25, h / (110 * s)), trail: [],
                bulge: rand(-0.25, 0.25),
            });
        });
        // and a big round bloom behind the words
        for (let i = 0; i < 90; i++) {
            const ang = (i / 90) * Math.PI * 2;
            const sp = rand(380, 460) * s;
            this.sparks.push({x: r.x, y: r.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, age: 0,
                life: rand(1.6, 2.1), drag: 1.9, grav: 40 * s, col: pick(BURSTS[0]), w: 2 * s, tw: rand(0, 6.28)});
        }
        this.glows.push({x: r.x, y: r.y, age: 0, col: '#ffd27a', r: 320, life: 1.2});
        this.flash = 1;
        this.play('boom-big');
        this.textGlow = {x: r.x, y: r.y, w: width * h, h};
    }

    _tickWords(dt) {
        if (!this.words.length)
            return;
        const s = this.s;
        this.words = this.words.filter(p => {
            p.age += dt;
            if (p.age < p.fly) {
                // out from the burst along a slight curve, easing into place
                const u = smooth(p.age / p.fly);
                const bx = -(p.ty - p.y0) * p.bulge, by = (p.tx - p.x0) * p.bulge;
                p.x = p.x0 + (p.tx - p.x0) * u + bx * Math.sin(Math.PI * u);
                p.y = p.y0 + (p.ty - p.y0) * u + by * Math.sin(Math.PI * u);
            } else if (p.age < p.fly + p.hold) {
                // hang there, shimmering, sagging the tiniest bit
                p.x = p.tx;
                p.y = p.ty + (p.age - p.fly) * 4 * s;
            } else {
                // then let go: they drift down and fade like a willow
                if (!p.falling) {
                    p.falling = true;
                    p.vx = rand(-12, 12) * s;
                    p.vy = rand(0, 20) * s;
                }
                p.vy += 70 * s * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
            }
            p.trail.push([p.x, p.y]);
            if (p.trail.length > 6)
                p.trail.shift();
            return p.age < p.fly + p.hold + 0.9;
        });
        if (!this.words.length)
            this.textGlow = null;
    }

    draw(cr) {
        const s = this.s ?? 1;
        cr.save();
        cr.setLineCap(Cairo.LineCap.ROUND);
        if (this.flash > 0 && this.W) {
            // the whole sky warms for a moment
            rgba(cr, '#ffcf8a', 0.06 * this.flash);
            cr.rectangle(0, 0, this.W, this.H);
            cr.fill();
        }
        for (const g of this.glows) {
            const life = g.life ?? 0.7;
            const a = 0.34 * (1 - g.age / life);
            const r = (g.r ?? 80) * s;
            const grad = new Cairo.RadialGradient(g.x, g.y, 0, g.x, g.y, r);
            stop(grad, 0, g.col, a);
            stop(grad, 0.4, g.col, a * 0.35);
            stop(grad, 1, g.col, 0);
            cr.setSource(grad);
            cr.newPath();
            cr.arc(g.x, g.y, r, 0, Math.PI * 2);
            cr.fill();
        }
        for (const r of this.rockets) {
            // a fading trail and a bright head
            const tr = r.trail;
            const big = r.text ? 1.8 : 1.2;
            for (let i = 1; i < tr.length; i++) {
                cr.newPath();
                cr.moveTo(tr[i - 1][0], tr[i - 1][1]);
                cr.lineTo(tr[i][0], tr[i][1]);
                rgba(cr, '#ffe2a8', 0.75 * (i / tr.length));
                cr.setLineWidth(1.6 * s * big);
                cr.stroke();
            }
            cr.newPath();
            cr.arc(r.x, r.y, 2.2 * s * big, 0, Math.PI * 2);
            rgba(cr, '#fffaf0', 1);
            cr.fill();
        }
        for (const p of this.seeds) {
            const tr = p.trail;
            for (let i = 1; i < tr.length; i++) {
                cr.newPath();
                cr.moveTo(tr[i - 1][0], tr[i - 1][1]);
                cr.lineTo(tr[i][0], tr[i][1]);
                rgba(cr, '#ffd27a', 0.7 * (i / tr.length));
                cr.setLineWidth(1.6 * s);
                cr.stroke();
            }
            const grad = new Cairo.RadialGradient(p.x, p.y, 0, p.x, p.y, 9 * s);
            stop(grad, 0, '#ffe2a8', 0.55);
            stop(grad, 1, '#ffb347', 0);
            cr.setSource(grad);
            cr.newPath();
            cr.arc(p.x, p.y, 9 * s, 0, Math.PI * 2);
            cr.fill();
            cr.newPath();
            cr.arc(p.x, p.y, 2 * s, 0, Math.PI * 2);
            rgba(cr, '#fff6dc', 0.95);
            cr.fill();
        }
        for (const p of this.sparks) {
            const u = p.age / p.life;
            // bright, then fading out, twinkling as they die
            let a = (1 - u) ** 1.1;
            if (u > 0.5)
                a *= 0.6 + 0.4 * Math.sin(p.age * 28 + p.tw);
            const tail = 0.08;
            const x0 = p.x - p.vx * tail, y0 = p.y - p.vy * tail;
            const w = p.w * (1 - 0.4 * u);
            for (const [aa, ww] of [[0.22, w * 3.4], [1, w]]) {
                cr.newPath();
                cr.moveTo(x0, y0);
                cr.lineTo(p.x, p.y + 0.01);
                rgba(cr, p.col, a * aa);
                cr.setLineWidth(ww);
                cr.stroke();
            }
        }
        this._drawWords(cr, s);
        cr.restore();
    }

    _drawWords(cr, s) {
        if (!this.words.length)
            return;
        const tg = this.textGlow;
        if (tg) {
            // a warm haze behind the letters while they hang there
            const a = clamp(Math.min(...this.words.slice(0, 1).map(p => p.age)) / 0.6, 0, 1) *
                clamp((this.words[0].fly + this.words[0].hold + 0.6 - this.words[0].age) / 0.8, 0, 1);
            cr.save();
            cr.translate(tg.x, tg.y);
            cr.scale(tg.w * 0.62, tg.h * 1.3);
            const g = new Cairo.RadialGradient(0, 0, 0, 0, 0, 1);
            stop(g, 0, '#ff9a3a', 0.3 * a);
            stop(g, 1, '#ff9a3a', 0);
            cr.setSource(g);
            cr.newPath();
            cr.arc(0, 0, 1, 0, Math.PI * 2);
            cr.fill();
            cr.restore();
        }
        for (const p of this.words) {
            const end = p.fly + p.hold;
            let a = p.age < end ? 1 : 1 - (p.age - end) / 0.9;
            if (p.age > p.fly)
                a *= 0.78 + 0.22 * Math.sin(p.age * 14 + p.tw);
            const tr = p.trail;
            // trail while flying out, or falling
            if (p.age < p.fly || p.falling) {
                for (let i = 1; i < tr.length; i++) {
                    cr.newPath();
                    cr.moveTo(tr[i - 1][0], tr[i - 1][1]);
                    cr.lineTo(tr[i][0], tr[i][1]);
                    rgba(cr, p.col, 0.5 * a * (i / tr.length));
                    cr.setLineWidth(p.w * 0.8);
                    cr.stroke();
                }
            }
            for (const [aa, ww, col] of [[0.3, p.w * 3, p.col], [1, p.w, p.col], [1, p.w * 0.5, '#fffdf2']]) {
                cr.newPath();
                cr.moveTo(p.x, p.y);
                cr.lineTo(p.x + 0.01, p.y + 0.01);
                rgba(cr, col, a * aa);
                cr.setLineWidth(ww);
                cr.stroke();
            }
        }
    }
}

// the whole sky layer, drawn on a w x h px surface covering a sky.W x sky.H screen
export function drawSky(cr, w, h, sky) {
    cr.save();
    cr.scale(w / sky.W, h / sky.H);
    drawGust(cr, sky.W, sky.H, sky.gust);
    sky.dragon?.draw(cr);
    sky.crackers.draw(cr);
    cr.restore();
}

// a thin grey curl of smoke rising from a blown-out wick
function drawSmoke(cr, w, h, a, t) {
    const cx = w / 2, base = h - 2;
    cr.setLineCap(Cairo.LineCap.ROUND);
    for (const [k, ph, lw] of [[1, 0, 0.09], [0.75, 2.1, 0.06]]) {
        cr.newPath();
        cr.moveTo(cx, base);
        for (let i = 1; i <= 14; i++) {
            const u = i / 14;
            const x = cx + Math.sin(u * 5 + t * 2.4 + ph) * w * 0.22 * u * k;
            cr.lineTo(x, base - u * h * 0.95 * k);
        }
        const g = new Cairo.LinearGradient(0, base, 0, base - h * k);
        stop(g, 0, '#c8c2b8', 0.7 * a);
        stop(g, 1, '#c8c2b8', 0);
        cr.setSource(g);
        cr.setLineWidth(w * lw);
        cr.stroke();
    }
}

export function drawGlow(cr, w, h) {
    const g = new Cairo.RadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    stop(g, 0, '#ffd27a', 0.6);
    stop(g, 0.25, '#ffa53a', 0.3);
    stop(g, 0.6, '#ff7a1a', 0.1);
    stop(g, 1, '#ff5e1a', 0);
    cr.setSource(g);
    cr.paint();
}

export function drawHook(cr, w) {
    const s = w / 24;
    cr.scale(s, s);
    const cx = 12;
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
}

// petals: marigold, rose, jasmine, sparkle
export const PETALS = [
    {kind: 'marigold', w: 3}, {kind: 'rose', w: 3}, {kind: 'jasmine', w: 2}, {kind: 'spark', w: 2},
];

export function drawPetal(cr, w, h, kind, hue) {
    const cx = w / 2, cy = h / 2;
    cr.translate(cx, cy);
    cr.scale(w / 20, h / 20);
    cr.translate(-cx, -cy);
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
        const g = new Cairo.RadialGradient(cx, cy, 0, cx, cy, 10);
        stop(g, 0, '#ffffff', 1);
        stop(g, 0.25, '#ffe066', 0.9);
        stop(g, 1, '#ff9f1a', 0);
        cr.setSource(g);
        cr.paint();
    }
}

// smooth random wobble: a few sines plus a slowly wandering offset
export class Flicker {
    constructor() {
        this.f = [rand(5, 7), rand(9, 13), rand(15, 21)];
        this.p = [rand(0, 6), rand(0, 6), rand(0, 6)];
        this.drift = 0;
        this.target = 0;
    }

    at(t, dt) {
        if (Math.random() < dt * 3)
            this.target = rand(-1, 1);
        this.drift += (this.target - this.drift) * Math.min(1, dt * 4);
        return 0.5 * Math.sin(t * this.f[0] + this.p[0]) + 0.3 * Math.sin(t * this.f[1] + this.p[1]) +
            0.2 * Math.sin(t * this.f[2] + this.p[2]) + 0.5 * this.drift;
    }
}


// ---------- oil ----------

// a drop of lamp oil: a small amber bead, pointed at the top, with a glint
export function drawOilDrop(cr, w, h) {
    const cx = w / 2;
    cr.newPath();
    cr.moveTo(cx, 0.5);
    cr.curveTo(cx + w * 0.14, h * 0.32, cx + w * 0.46, h * 0.52, cx + w * 0.46, h * 0.72);
    cr.curveTo(cx + w * 0.46, h * 0.9, cx + w * 0.24, h - 0.5, cx, h - 0.5);
    cr.curveTo(cx - w * 0.24, h - 0.5, cx - w * 0.46, h * 0.9, cx - w * 0.46, h * 0.72);
    cr.curveTo(cx - w * 0.46, h * 0.52, cx - w * 0.14, h * 0.32, cx, 0.5);
    cr.closePath();
    const g = new Cairo.RadialGradient(cx, h * 0.7, 0, cx, h * 0.7, w * 0.55);
    stop(g, 0, '#ffd66b', 0.85);
    stop(g, 0.6, '#e09a1c', 0.8);
    stop(g, 1, '#8a4e00', 0.85);
    cr.setSource(g);
    cr.fill();
    ellipsePath(cr, cx - w * 0.15, h * 0.62, w * 0.1, h * 0.09);
    rgba(cr, '#ffffff', 0.8);
    cr.fill();
}

// Oil only slops over when the lamp is swung hard: a few drops fall from the lowest
// lip each time a big swing turns round, and a thin trickle while it's tipped right
// over. tick() returns how many drops to let go of now.
export class Spill {
    constructor() {
        this.prevOmega = 0;
        this.last = 0;
        this.acc = 0;
    }

    tick(now, dt, theta, omega) {
        let n = 0;
        const a = Math.abs(theta);
        if (Math.sign(omega) !== Math.sign(this.prevOmega) && a > 0.65 && now - this.last > 0.3) {
            this.last = now;
            n += 1 + Math.floor(Math.random() * Math.min(3, (a - 0.65) * 5 + 1));
        }
        if (a > 1.1)
            this.acc += (a - 1.1) * 6 * dt;
        while (this.acc >= 1) {
            this.acc -= 1;
            n++;
        }
        this.prevOmega = omega;
        return n;
    }
}

// a lip's point in screen px, relative to the hook, for chain length len and swing theta;
// also the velocity of that point (px/s) for angular speed omega
export function spoutWorld(tx, ty, len, theta, omega, s) {
    const dx = tx * s, dy = (len + ty) * s;
    const c = Math.cos(theta), n = Math.sin(theta);
    return {
        x: dx * c + dy * n, y: -dx * n + dy * c,
        vx: omega * (-dx * n + dy * c), vy: omega * (-dx * c - dy * n),
    };
}

// how a freed drop starts off: it barely keeps the lamp's speed, so it drips
// rather than flies
export function dropStart(p, s) {
    return {
        x: p.x + rand(-1.5, 1.5) * s, y: p.y + 2 * s,
        vx: p.vx * 0.12 + rand(-8, 8) * s, vy: Math.max(0, p.vy * 0.12) + rand(10, 40) * s,
        size: rand(3.5, 5.5) * s, life: rand(0.9, 1.3),
    };
}
export const DROP_GRAVITY = 1100;   // px/s², at scale 1

// ---------- sound ----------

// What the lamp sounds like. play(name) plays sounds/<name>.wav; every file is
// already mixed at its own gentle level, so the player doesn't need a volume.
//   tink-s0..2 / tink-m0..2   the little brass bell under the lamp, soft or a bit firmer
//   chain-0..2                the chain links jingling
//   ring                      a warm temple-bell ring (for the petal shower)
//   blow                      a soft breath of air
//   catch-0..2                a wick catching alight
export class Sounds {
    constructor(play) {
        this.play = play;
        this.queue = [];
        this.recent = [];
        this.lastTink = 0;
        this.lastChain = 0;
        this.prevOmega = 0;
    }

    // never more than a few sounds at once, so it stays gentle
    _emit(now, name) {
        this.recent = this.recent.filter(t => now - t < 0.4);
        if (this.recent.length >= 3)
            return;
        this.recent.push(now);
        this.play(name);
    }

    _later(now, dt, name) {
        this.queue.push([now + dt, name]);
        this.queue.sort((a, b) => a[0] - b[0]);
    }

    tink(now, firm = false) {
        if (now - this.lastTink < 0.25)
            return;
        this.lastTink = now;
        this._emit(now, `tink-${firm ? 'm' : 's'}${Math.floor(Math.random() * 3)}`);
    }

    chain(now) {
        if (now - this.lastChain < 0.35)
            return;
        this.lastChain = now;
        this._emit(now, `chain-${Math.floor(Math.random() * 3)}`);
    }

    // picked up
    touch(now) {
        this.chain(now);
    }

    // let go after a drag; speed is the swing speed in rad/s
    release(now, speed) {
        this.chain(now);
        if (Math.abs(speed) > 1.5)
            this._later(now, 0.12, Math.abs(speed) > 5 ? 'tink-m0' : 'tink-s1');
    }

    // clicked: petals and a temple-bell ring
    shower(now) {
        this._emit(now, 'ring');
        this._later(now, 0.5, 'tink-s0');
        this._later(now, 0.85, 'tink-s2');
    }

    // Ctrl+drag set a new length: one soft ring of the little bell
    lengthSet(now) {
        this.tink(now, true);
    }

    // the hook was moved
    hook(now) {
        this.chain(now);
    }

    // a few soft bell notes, for the menu item
    ringBells(now) {
        this.tink(now);
        this._later(now, 0.35, 'tink-s1');
        this._later(now, 0.75, 'tink-m2');
    }

    tick(now, theta, omega) {
        while (this.queue.length && this.queue[0][0] <= now)
            this._emit(now, this.queue.shift()[1]);
        // each time the swing turns round the little bell knocks, louder for a big swing
        if (Math.sign(omega) !== Math.sign(this.prevOmega) && Math.abs(theta) > 0.2) {
            this.tink(now, Math.abs(theta) > 0.55);
            if (Math.abs(theta) > 0.8)
                this.chain(now);
        }
        this.prevOmega = omega;
    }
}

// ---------- blowing the lamp out ----------

export const HOLD_MS = 700;   // press and hold this long to blow the flames out
export const DARK_S = 4;      // seconds the lamp stays dark before it starts to relight
const BLOW_S = 3.2;           // how long the wind blows, in puffs
const RELIGHT_GAP = 0.85;     // seconds between one wick catching and the next
const EMBER_S = 0.7;          // a wick glows this long before its flame appears
const GROW_S = 1.8;           // and the flame takes this long to grow to full size

// Press-and-hold blows a gust across the lamp: you see the air stream past, the flames
// bend over and go out one by one (upwind first), leaving smoke and glowing wick ends.
// After DARK_S each wick glows, catches, and its flame slowly grows back.
// `play(name)` plays a sound; levels, ember and smoke are per flame, 0..1.
export class Lights {
    constructor(xs, play) {
        this.xs = xs;             // flame x offsets, to blow them out upwind first
        this.play = play;
        this.state = 'lit';
        this.t0 = 0;
        this.dir = 1;
        this.wind = 0;
        this.windT = 0;
        this.windD = 0;
        this.puffs = [];
        this.levels = xs.map(() => 1);
        this.smoke = xs.map(() => 0);
        this.ember = xs.map(() => 0);
        this.rank = xs.map((_, i) => i);
        this.lightAt = xs.map(() => Infinity);   // when each wick starts to glow (s)
        // called when the dark pause ends; returns true if it sends a rocket to relight
        // the lamp (sparks then call lightWick), false to relight on its own
        this.onDark = null;
    }

    get lit() {
        return this.state === 'lit';
    }

    // blown out and waiting to be lit again
    get dark() {
        return this.state === 'out' || this.state === 'waiting';
    }

    _startLighting(now) {
        this.state = 'lighting';
        this.t0 = now;
        this.started = this.levels.map(() => false);
        this.lightAt = this.levels.map(() => Infinity);
    }

    // a spark has landed on wick i: it glows straight away and catches
    lightWick(i, now) {
        if (this.dark)
            this._startLighting(now);
        if (this.state === 'lighting' && !this.started[i])
            this.lightAt[i] = Math.min(this.lightAt[i], now - EMBER_S * 0.7);
    }

    // average brightness, for the glow
    get glow() {
        return this.levels.reduce((a, b) => a + b, 0) / this.levels.length;
    }

    // how far the gust pushes the flames sideways (radians)
    get lean() {
        return this.wind * this.dir * 1.1;
    }

    // what drawGust needs; the air streams the way the flames lean
    get gust() {
        return {k: this.wind, t: this.windT, d: this.windD, dir: -this.dir};
    }

    blowOut(now) {
        if (this.state !== 'lit')
            return false;
        this.state = 'blowing';
        this.t0 = now;
        this.dir = Math.random() < 0.5 ? -1 : 1;
        const order = this.xs.map((x, i) => [x * -this.dir, i]).sort((a, b) => a[0] - b[0]);
        order.forEach(([, i], r) => {
            this.rank[i] = r;
        });
        // the wind comes in puffs: a strong first one, then a few more of random
        // strength with lulls between
        this.puffs = [{at: 0.35, peak: 0.85, w: 0.28}];
        for (let at = rand(0.85, 1.05); at < BLOW_S - 0.5; at += rand(0.45, 0.75))
            this.puffs.push({at, peak: rand(0.5, 1), w: rand(0.14, 0.26)});
        this.windD = 0;
        this.blown = this.levels.map(() => 0);
        this.goneAt = this.levels.map(() => -1);
        this.play('blow');
        return true;
    }

    // wind strength t seconds into the blow: puffs over a faint steady breeze
    _windAt(t) {
        let puff = 0;
        for (const p of this.puffs)
            puff = Math.max(puff, p.peak * Math.exp(-(((t - p.at) / p.w) ** 2)));
        const flutter = 0.07 * Math.sin(t * 13.7) + 0.05 * Math.sin(t * 23.1 + 1);
        const env = smooth(t / 0.15) * (1 - smooth((t - (BLOW_S - 0.6)) / 0.6));
        return env * clamp(0.16 + puff * 0.9 + flutter, 0, 1);
    }

    tick(now, dt) {
        const t = now - this.t0;
        for (let i = 0; i < this.smoke.length; i++) {
            this.smoke[i] = Math.max(0, this.smoke[i] - dt / 3);
            if (this.state !== 'lighting')
                this.ember[i] = Math.max(0, this.ember[i] - dt / 2.5);
        }
        if (this.state === 'blowing') {
            this.windT = t;
            this.wind = this._windAt(t);
            // the air rushes in the puffs and drifts in the lulls
            this.windD += dt * (0.3 + 0.95 * this.wind);
            for (let i = 0; i < this.levels.length; i++) {
                // a flame only loses ground in the strong puffs; upwind ones give up first
                this.blown[i] += dt * Math.max(0, this.wind - 0.4);
                const need = 0.08 + this.rank[i] * 0.07;
                if (this.goneAt[i] < 0 && (this.blown[i] > need || t > BLOW_S - 0.5))
                    this.goneAt[i] = t;
                let lv;
                if (this.goneAt[i] >= 0) {
                    lv = clamp(1 - (t - this.goneAt[i]) / 0.2, 0, 1);
                } else {
                    // shrink and sputter as it fights the wind, recover in the lulls
                    const f = this.blown[i] / need;
                    lv = 1 - 0.3 * f * f - 0.25 * this.wind * (0.5 + 0.5 * Math.sin(t * 55 + i));
                }
                if (lv === 0 && this.levels[i] > 0) {
                    this.smoke[i] = 1;
                    this.ember[i] = 1;
                }
                this.levels[i] = lv;
            }
            if (t > BLOW_S) {
                this.state = 'out';
                this.t0 = now;
                this.wind = 0;
            }
        } else if (this.state === 'out') {
            if (t > DARK_S) {
                if (this.onDark?.(now)) {
                    this.state = 'waiting';
                    this.t0 = now;
                } else {
                    this._relightAlone(now);
                }
            }
        } else if (this.state === 'waiting') {
            // the rocket never came (say the screen went away): light up anyway
            if (t > 6)
                this._relightAlone(now);
        } else if (this.state === 'lighting') {
            let done = true;
            for (let i = 0; i < this.levels.length; i++) {
                const on = this.lightAt[i] - this.t0;
                const e = (t - on) / EMBER_S;
                const x = (t - on - EMBER_S) / GROW_S;
                this.ember[i] = Math.max(this.ember[i], smooth(e) * (1 - smooth(x * 2)));
                if (x >= 0 && !this.started[i]) {
                    this.started[i] = true;
                    this.play(`catch-${i % 3}`);
                }
                if (x >= 1) {
                    this.levels[i] = 1;
                    continue;
                }
                done = false;
                // starts as a tiny bead, wavers, and slowly swells to full size
                const grow = 1 - Math.pow(1 - clamp(x, 0, 1), 3);
                this.levels[i] = x <= 0 ? 0 : grow * (1 + 0.08 * (1 - x) * Math.sin(t * 9 + i)) + 0.06 * Math.sin(Math.PI * x);
            }
            if (done)
                this.state = 'lit';
        }
    }

    // no rocket: the far end of the gust relights first, so it spreads back across
    _relightAlone(now) {
        this._startLighting(now);
        this.lightAt = this.rank.map(r => now + (this.levels.length - 1 - r) * RELIGHT_GAP);
    }
}
