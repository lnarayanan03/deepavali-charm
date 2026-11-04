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
export const RIM_Y = 84, RIM_RX = 58, RIM_RY = 10;   // bowl rim, inside the lamp area
export const DROP_W = 50, DROP_H = 96;
export const DROP_Y = 124;       // where the bell drop hangs, inside the lamp area
export const DEFAULT_LEN = 150;  // garland chain length, hook to lamp
export const MIN_LEN = 50;

// five spouts ("noses") spaced evenly round the rim, 72 degrees apart, with the main
// one at the front: [angle on the rim in degrees (0 = right side, 90 = nearest the
// viewer, 270 = far side), flame width, flame height]
export const WICKS = [[234, 13, 26], [306, 13, 26], [162, 14, 30], [18, 14, 30], [90, 19, 44]];
export const isBack = a => Math.sin((a * Math.PI) / 180) < 0;
export const SPOUT = 17;         // how far a spout sticks out past the rim

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

export function rimBackY(dx) {
    return RIM_Y - RIM_RY * Math.sqrt(Math.max(0, 1 - (dx / RIM_RX) ** 2));
}

// point on the rim ellipse at angle a (degrees), pushed out by `out` px
export function rimPt(a, out = 0) {
    const r = (a * Math.PI) / 180;
    return [Math.cos(r) * (RIM_RX + out), RIM_Y + Math.sin(r) * (RIM_RY + out * 0.55)];
}

// screen direction a spout points (outward from the rim, squashed by perspective)
export function spoutDir(a) {
    const r = (a * Math.PI) / 180;
    const dx = Math.cos(r), dy = Math.sin(r) * 0.6;
    const n = Math.hypot(dx, dy);
    return [dx / n, dy / n];
}

// where the wick sits: the tip of the spout, slightly upturned
export function spoutTip(a) {
    const [x, y] = rimPt(a, -3);
    const [ux, uy] = spoutDir(a);
    return [x + ux * SPOUT, y + uy * SPOUT - 3];
}

// a brass spout ("nose") jutting out of the rim: an almond-shaped lip with an
// oil groove down the middle and the wick resting at its pointed tip
function drawSpout(cr, cx, a) {
    const [bx, by] = rimPt(a, -3);
    const [ux, uy] = spoutDir(a);
    const [tx, ty] = spoutTip(a);
    // local frame: u along the spout, v across it
    const vx = -uy, vy = ux;
    const P = (along, across, lift = 0) => [cx + bx + ux * along + vx * across, by + uy * along + vy * across - lift];
    const half = 6.5;
    const shape = drop => {
        const lift = t => 3 * t * t;     // the lip curls up towards the tip
        const pts = [
            P(-4, -half, -drop), P(SPOUT * 0.45, -half * 0.95, lift(0.45) - drop),
            P(SPOUT * 0.85, -half * 0.35, lift(0.85) - drop), [cx + tx, ty + drop],
            P(SPOUT * 0.85, half * 0.35, lift(0.85) - drop), P(SPOUT * 0.45, half * 0.95, lift(0.45) - drop),
            P(-4, half, -drop),
        ];
        cr.newPath();
        cr.moveTo(...pts[0]);
        cr.curveTo(...pts[1], ...pts[2], ...pts[3]);
        cr.curveTo(...pts[4], ...pts[5], ...pts[6]);
        cr.closePath();
    };
    const x0 = cx + Math.min(bx, tx) - 8, x1 = cx + Math.max(bx, tx) + 8;
    // underside in shadow, then the top surface
    shape(2.2);
    rgba(cr, '#7a4b05');
    cr.fill();
    shape(0);
    cr.setSource(brass(cr, x0, x1));
    cr.fillPreserve();
    rgba(cr, '#4a2e02', 0.85);
    cr.setLineWidth(0.9);
    cr.stroke();
    // oil groove down the middle, with a bright edge
    const g0 = P(-2, 0), g1 = P(SPOUT * 0.8, 0, 2);
    rgba(cr, '#6b3a00', 0.9);
    cr.setLineWidth(2.6);
    cr.moveTo(...g0);
    cr.lineTo(...g1);
    cr.stroke();
    rgba(cr, '#ffcf5c', 0.9);
    cr.setLineWidth(0.9);
    cr.moveTo(g0[0], g0[1] + 1.4);
    cr.lineTo(g1[0], g1[1] + 1.4);
    cr.stroke();
    // cotton wick, charred at the top
    rgba(cr, '#fff3d6');
    cr.arc(cx + tx, ty, 2.3, 0, Math.PI * 2);
    cr.fill();
    rgba(cr, '#2b1800');
    cr.arc(cx + tx, ty - 1.2, 1.3, 0, Math.PI * 2);
    cr.fill();
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

// the lamp comes in two layers so the far-side flames can sit between them:
// 'back' is the crown, centre chain and far spouts; 'front' is everything else
export function drawLamp(cr, w, h, layer = 'front') {
    const s = w / LAMP_W;
    cr.scale(s, s);
    const cx = LAMP_W / 2;
    cr.setLineCap(Cairo.LineCap.ROUND);
    if (layer === 'back')
        drawLampBack(cr, cx);
    else
        drawLampFront(cr, cx);
}

function drawLampBack(cr, cx) {
    // back chain (behind the bowl's back rim)
    drawLinks(cr, cx, 24, cx, rimBackY(0) + 1, 1.8);

    // crown: hanging ring, bulb, collar
    rgba(cr, '#c99a2e');
    cr.setLineWidth(2.4);
    cr.arc(cx, 4, 3.4, 0, Math.PI * 2);
    cr.stroke();
    cr.save();
    cr.translate(cx, 14);
    cr.scale(9, 7.5);
    cr.arc(0, 0, 1, 0, Math.PI * 2);
    cr.restore();
    cr.setSource(brass(cr, cx - 9, cx + 9));
    cr.fill();
    cr.save();
    cr.translate(cx, 22.5);
    cr.scale(13, 3.2);
    cr.arc(0, 0, 1, 0, Math.PI * 2);
    cr.restore();
    cr.setSource(brass(cr, cx - 13, cx + 13));
    cr.fill();

    // the two spouts on the far side, behind the oil and the front of the bowl
    for (const [a] of WICKS) {
        if (isBack(a))
            drawSpout(cr, cx, a);
    }
}

function drawLampFront(cr, cx) {
    cr.setLineCap(Cairo.LineCap.ROUND);

    // oil, lit from above
    cr.save();
    cr.translate(cx, RIM_Y);
    cr.scale(RIM_RX - 4, RIM_RY - 3);
    cr.arc(0, 0, 1, 0, Math.PI * 2);
    cr.restore();
    const oil = new Cairo.RadialGradient(cx, RIM_Y - 3, 2, cx, RIM_Y, RIM_RX);
    stop(oil, 0, '#ffe08a');
    stop(oil, 0.45, '#c97a12');
    stop(oil, 1, '#5a3300');
    cr.setSource(oil);
    cr.fill();

    // bowl body
    cr.newPath();
    cr.moveTo(cx - RIM_RX, RIM_Y);
    cr.curveTo(cx - RIM_RX + 2, RIM_Y + 26, cx - 26, RIM_Y + 33, cx, RIM_Y + 33);
    cr.curveTo(cx + 26, RIM_Y + 33, cx + RIM_RX - 2, RIM_Y + 26, cx + RIM_RX, RIM_Y);
    cr.curveTo(cx + RIM_RX * 0.6, RIM_Y + RIM_RY * 1.35, cx - RIM_RX * 0.6, RIM_Y + RIM_RY * 1.35, cx - RIM_RX, RIM_Y);
    cr.closePath();
    cr.setSource(brass(cr, cx - RIM_RX, cx + RIM_RX));
    cr.fillPreserve();
    // warm light spilling onto the upper bowl
    const warm = new Cairo.LinearGradient(0, RIM_Y, 0, RIM_Y + 30);
    stop(warm, 0, '#ffb347', 0.45);
    stop(warm, 1, '#ffb347', 0);
    cr.setSource(warm);
    cr.fill();

    // engraved band: dots and a row of lotus petals
    for (let k = -5; k <= 5; k++) {
        const x = cx + k * 9.5;
        const t = (x - cx) / RIM_RX;
        const y = RIM_Y + RIM_RY * Math.sqrt(1 - t * t) + 5;
        rgba(cr, '#6b4204', 0.75);
        cr.arc(x, y, 1.1, 0, Math.PI * 2);
        cr.fill();
        if (Math.abs(k) <= 4) {
            cr.newPath();
            cr.moveTo(x - 4, y + 8);
            cr.curveTo(x - 4, y + 3, x, y + 2, x, y + 2);
            cr.curveTo(x, y + 2, x + 4, y + 3, x + 4, y + 8);
            rgba(cr, '#6b4204', 0.55);
            cr.setLineWidth(0.9);
            cr.stroke();
        }
    }

    // rim lip with a beaded edge
    cr.save();
    cr.translate(cx, RIM_Y);
    cr.scale(RIM_RX, RIM_RY);
    cr.arc(0, 0, 1, 0, Math.PI * 2);
    cr.restore();
    rgba(cr, '#ffd970');
    cr.setLineWidth(2.6);
    cr.stroke();
    for (let a = 0.15; a < Math.PI; a += Math.PI / 14) {
        rgba(cr, '#fff6d6');
        cr.arc(cx + Math.cos(a) * RIM_RX, RIM_Y + Math.sin(a) * RIM_RY, 1.2, 0, Math.PI * 2);
        cr.fill();
    }

    // knob under the bowl and the ring the bell drop hangs from
    cr.newPath();
    cr.moveTo(cx - 9, RIM_Y + 32);
    cr.curveTo(cx - 8, RIM_Y + 40, cx - 3, DROP_Y - 4, cx, DROP_Y - 3);
    cr.curveTo(cx + 3, DROP_Y - 4, cx + 8, RIM_Y + 40, cx + 9, RIM_Y + 32);
    cr.closePath();
    cr.setSource(brass(cr, cx - 9, cx + 9));
    cr.fill();
    rgba(cr, '#c99a2e');
    cr.setLineWidth(1.8);
    cr.arc(cx, DROP_Y + 1, 2.6, 0, Math.PI * 2);
    cr.stroke();

    // garland swags across the front of the bowl
    const swag = (x0, y0, x1, y1, dip) => {
        const n = 9;
        for (let k = 0; k <= n; k++) {
            const t = k / n;
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * dip;
            if (k % 2)
                drawJasmine(cr, x, y, 3.4);
            else
                drawMarigold(cr, x, y, 4.4, k % 4 === 0);
        }
    };
    swag(cx - RIM_RX + 1, RIM_Y + 2, cx, RIM_Y + RIM_RY + 2, 16);
    swag(cx, RIM_Y + RIM_RY + 2, cx + RIM_RX - 1, RIM_Y + 2, 16);

    // the two front chains, crown to rim, over everything
    drawLinks(cr, cx - 3, 24, cx - RIM_RX + 1, RIM_Y, 2);
    drawLinks(cr, cx + 3, 24, cx + RIM_RX - 1, RIM_Y, 2);

    // the main spout at the front and the two at the sides
    for (const [a] of WICKS) {
        if (!isBack(a))
            drawSpout(cr, cx, a);
    }
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

// one oil-lamp (deepam) flame: a thin blue root on the wick, a round golden belly
// low down, then a long tapering tip. bend (-1..1) curls the tip so it can wave.
// f.level (0..1) shrinks it as it goes out or catches; f.smoke (0..1) draws the
// wisp of smoke left after it is blown out.
export function drawFlame(cr, w, h, f) {
    const cx = w / 2, base = h - 1;
    if ((f.smoke ?? 0) > 0.01)
        drawSmoke(cr, w, h, f.smoke, f.t ?? 0);
    const lv = f.level ?? 1;
    if (lv < 0.02)
        return;
    const fh = h * 0.96 * lv, fw = w * 0.3 * Math.sqrt(lv);
    const tipX = cx + f.bend * w * 0.34, tipY = base - fh;
    // k scales the height, wk the width, lift raises the root off the wick
    const shape = (k, wk, lift = 0) => {
        const b = base - lift;
        const hh = fh * k - lift;
        const tx = cx + (tipX - cx) * k, ty = b - hh;
        const bw = fw * wk;
        const bellyY = b - hh * 0.24;
        const neckX = cx + (tx - cx) * 0.55;
        cr.newPath();
        cr.moveTo(cx, b);
        // right side: out to the round belly, then a long taper to a sharp tip
        cr.curveTo(cx + bw * 0.6, b, cx + bw, b - hh * 0.08, cx + bw, bellyY);
        cr.curveTo(cx + bw, b - hh * 0.42, neckX + bw * 0.14, ty + hh * 0.3, tx, ty);
        // left side back down
        cr.curveTo(neckX - bw * 0.14, ty + hh * 0.3, cx - bw, b - hh * 0.42, cx - bw, bellyY);
        cr.curveTo(cx - bw, b - hh * 0.08, cx - bw * 0.6, b, cx, b);
        cr.closePath();
    };
    // soft orange halo
    shape(1.04, 1.25);
    let g = new Cairo.LinearGradient(0, tipY, 0, base);
    stop(g, 0, '#ff5a00', 0);
    stop(g, 0.35, '#ff6d00', 0.35);
    stop(g, 1, '#ff8a00', 0.15);
    cr.setSource(g);
    cr.fill();
    // main body: deep orange edges into gold
    shape(1, 1);
    g = new Cairo.RadialGradient(cx, base - fh * 0.3, fw * 0.2, cx, base - fh * 0.42, fh * 0.75);
    stop(g, 0, '#ffd23f', 1);
    stop(g, 0.35, '#ffb21e', 0.97);
    stop(g, 0.7, '#ff7a00', 0.9);
    stop(g, 1, '#e64a00', 0.25);
    cr.setSource(g);
    cr.fill();
    // bright yellow belly, the hottest part of an oil flame
    shape(0.6, 0.62, fh * 0.06);
    g = new Cairo.RadialGradient(cx, base - fh * 0.2, 0, cx, base - fh * 0.22, fw * 1.1);
    stop(g, 0, '#fffbe0', 1);
    stop(g, 0.45, '#fff0a0', 0.95);
    stop(g, 1, '#ffd84a', 0);
    cr.setSource(g);
    cr.fill();
    // dark, see-through root with a blue rim where it sits on the wick
    cr.save();
    cr.translate(cx, base - fh * 0.05);
    cr.scale(fw * 0.42, fh * 0.06);
    cr.arc(0, 0, 1, 0, Math.PI * 2);
    cr.restore();
    g = new Cairo.RadialGradient(cx, base - fh * 0.05, 0, cx, base - fh * 0.05, fw * 0.45);
    stop(g, 0, '#ff9a2e', 0.5);
    stop(g, 0.6, '#3d6cff', 0.4);
    stop(g, 1, '#3d6cff', 0);
    cr.setSource(g);
    cr.fill();
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


// a drop of lamp oil: a golden bead, pointed at the top
export function drawOilDrop(cr, w, h) {
    const cx = w / 2;
    cr.newPath();
    cr.moveTo(cx, 0.5);
    cr.curveTo(cx + w * 0.18, h * 0.35, cx + w * 0.46, h * 0.55, cx + w * 0.46, h * 0.72);
    cr.curveTo(cx + w * 0.46, h * 0.92, cx + w * 0.2, h - 0.5, cx, h - 0.5);
    cr.curveTo(cx - w * 0.2, h - 0.5, cx - w * 0.46, h * 0.92, cx - w * 0.46, h * 0.72);
    cr.curveTo(cx - w * 0.46, h * 0.55, cx - w * 0.18, h * 0.35, cx, 0.5);
    cr.closePath();
    const g = new Cairo.RadialGradient(cx - w * 0.12, h * 0.62, 0, cx, h * 0.7, w * 0.6);
    stop(g, 0, '#fff4c2');
    stop(g, 0.35, '#f2b32a', 0.95);
    stop(g, 1, '#9a5a00', 0.9);
    cr.setSource(g);
    cr.fill();
}

// ---------- oil spilling ----------

// drops per second that slop over the spouts: a hard swing or a steep tilt spills
export function spillRate(theta, omega, len) {
    const speed = Math.abs(omega) * (len + RIM_Y);
    return Math.max(0, (speed - 360) / 45) + Math.max(0, (Math.abs(theta) - 0.55) * 25);
}

// a spout tip in screen px, relative to the hook, for chain length len and swing theta;
// also the velocity of that point (px/s) for angular speed omega
export function spoutWorld(tx, ty, len, theta, omega, s) {
    const dx = tx * s, dy = (len + ty) * s;
    const c = Math.cos(theta), n = Math.sin(theta);
    return {
        x: dx * c + dy * n, y: -dx * n + dy * c,
        vx: omega * (-dx * n + dy * c), vy: omega * (-dx * c - dy * n),
    };
}

// ---------- wind chimes ----------

// Decides when the chimes ring; `play(name)` plays sounds/<name>.wav.
// Any touch plays a short run of pentatonic notes; while it swings, each end of a
// swing knocks a chime, and a big swing rings the brass bell.
export class Chimes {
    constructor(play) {
        this.play = play;
        this.queue = [];
        this.note = 3;
        this.lastKnock = 0;
        this.lastBell = 0;
        this.prevOmega = 0;
    }

    melody(now, notes = 0) {
        let t = Math.max(now, this.queue.length ? this.queue[this.queue.length - 1][0] : now);
        const n = notes || 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
            this.note = clamp(this.note + pick([-2, -1, 1, 1, 2]), 0, 6);
            this.queue.push([t, `chime-${this.note}`]);
            t += rand(0.12, 0.24);
        }
        if (this.queue.length > 12)
            this.queue.splice(0, this.queue.length - 12);
    }

    bell(now) {
        if (now - this.lastBell > 1.2) {
            this.lastBell = now;
            this.play('bell');
        }
    }

    tick(now, theta, omega) {
        while (this.queue.length && this.queue[0][0] <= now)
            this.play(this.queue.shift()[1]);
        // the swing turns round at each end: knock a chime
        if (Math.sign(omega) !== Math.sign(this.prevOmega) && Math.abs(theta) > 0.22 &&
            now - this.lastKnock > 0.5) {
            this.lastKnock = now;
            this.note = clamp(this.note + pick([-1, 1, 2, -2]), 0, 6);
            this.play(`chime-${this.note}`);
            if (Math.abs(theta) > 0.75)
                this.bell(now);
        }
        this.prevOmega = omega;
    }
}

// ---------- blowing the lamp out ----------

export const HOLD_MS = 700;   // press and hold this long to blow the flames out
export const DARK_S = 5;      // seconds the lamp stays dark before it relights

// Press-and-hold blows a gust across the lamp: the flames bend over and go out one
// by one (upwind first), leaving smoke; after DARK_S they catch again one by one.
// `play(name)` plays sounds/<name>.wav; levels[i] and smoke[i] are per flame, 0..1.
export class Lights {
    constructor(xs, play) {
        this.xs = xs;             // flame x offsets, to blow them out upwind first
        this.play = play;
        this.state = 'lit';
        this.t0 = 0;
        this.dir = 1;
        this.wind = 0;
        this.levels = xs.map(() => 1);
        this.smoke = xs.map(() => 0);
        this.rank = xs.map((_, i) => i);
    }

    get lit() {
        return this.state === 'lit';
    }

    // average brightness, for the glow
    get glow() {
        return this.levels.reduce((a, b) => a + b, 0) / this.levels.length;
    }

    // how far the gust pushes the flames sideways (radians)
    get lean() {
        return this.wind * this.dir * 1.1;
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
        this.play('wind');
        return true;
    }

    tick(now, dt) {
        const t = now - this.t0;
        for (let i = 0; i < this.smoke.length; i++)
            this.smoke[i] = Math.max(0, this.smoke[i] - dt / 2.8);
        if (this.state === 'blowing') {
            this.wind = Math.sin(Math.PI * clamp(t / 1.6, 0, 1));
            for (let i = 0; i < this.levels.length; i++) {
                const off = 0.3 + this.rank[i] * 0.13;
                const lv = clamp(1 - (t - off) / 0.22, 0, 1);
                if (lv === 0 && this.levels[i] > 0)
                    this.smoke[i] = 1;
                // sputter a little as it fights the wind
                this.levels[i] = lv > 0 && lv < 1 ? lv * (0.8 + 0.2 * Math.sin(t * 60 + i)) : lv;
            }
            if (t > 1.6) {
                this.state = 'out';
                this.t0 = now;
                this.wind = 0;
            }
        } else if (this.state === 'out') {
            if (t > DARK_S) {
                this.state = 'lighting';
                this.t0 = now;
                this.started = this.levels.map(() => false);
            }
        } else if (this.state === 'lighting') {
            let done = true;
            for (let i = 0; i < this.levels.length; i++) {
                const on = this.rank[i] * 0.3;
                if (t >= on && !this.started[i]) {
                    this.started[i] = true;
                    this.play('ignite');
                }
                const x = clamp((t - on) / 0.5, 0, 1);
                // catches small, flares up, then settles
                this.levels[i] = x * x * (3 - 2 * x) + 0.35 * Math.sin(Math.PI * x) * (1 - x * 0.3);
                if (x < 1)
                    done = false;
                else
                    this.levels[i] = 1;
            }
            if (done)
                this.state = 'lit';
        }
    }
}
