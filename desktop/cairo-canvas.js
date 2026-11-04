// A tiny Cairo look-alike on top of the HTML canvas, just enough for draw.js.
// It lets the desktop app reuse the GNOME extension's drawing code unchanged.

const css = (r, g, b, a) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

class Gradient {
    constructor() {
        this.stops = [];
    }

    addColorStopRGBA(off, r, g, b, a = 1) {
        this.stops.push([off, css(r, g, b, a)]);
    }

    build(ctx) {
        const g = this.make(ctx);
        for (const [off, col] of this.stops)
            g.addColorStop(Math.min(1, Math.max(0, off)), col);
        return g;
    }
}

class LinearGradient extends Gradient {
    constructor(x0, y0, x1, y1) {
        super();
        this.args = [x0, y0, x1, y1];
    }

    make(ctx) {
        return ctx.createLinearGradient(...this.args);
    }
}

class RadialGradient extends Gradient {
    constructor(x0, y0, r0, x1, y1, r1) {
        super();
        this.args = [x0, y0, Math.max(0, r0), x1, y1, Math.max(0, r1)];
    }

    make(ctx) {
        return ctx.createRadialGradient(...this.args);
    }
}

export const CanvasCairo = {
    LinearGradient, RadialGradient,
    LineCap: {BUTT: 'butt', ROUND: 'round', SQUARE: 'square'},
};

// wrap a CanvasRenderingContext2D so it speaks the Cairo calls draw.js uses
export function wrap(ctx) {
    return {
        newPath: () => ctx.beginPath(),
        moveTo: (x, y) => ctx.moveTo(x, y),
        lineTo: (x, y) => ctx.lineTo(x, y),
        curveTo: (a, b, c, d, e, f) => ctx.bezierCurveTo(a, b, c, d, e, f),
        arc: (x, y, r, a0, a1) => ctx.arc(x, y, Math.max(0, r), a0, a1),
        closePath: () => ctx.closePath(),
        rectangle: (x, y, w, h) => ctx.rect(x, y, w, h),
        save: () => ctx.save(),
        restore: () => ctx.restore(),
        translate: (x, y) => ctx.translate(x, y),
        scale: (x, y) => ctx.scale(x, y),
        rotate: a => ctx.rotate(a),
        setSourceRGBA(r, g, b, a = 1) {
            ctx.fillStyle = ctx.strokeStyle = css(r, g, b, a);
        },
        setSource(p) {
            ctx.fillStyle = ctx.strokeStyle = p.build(ctx);
        },
        setLineWidth: w => {
            ctx.lineWidth = w;
        },
        setLineCap: c => {
            ctx.lineCap = c;
        },
        // like Cairo, fill and stroke use up the path; the *Preserve forms keep it
        fill() {
            ctx.fill();
            ctx.beginPath();
        },
        fillPreserve: () => ctx.fill(),
        stroke() {
            ctx.stroke();
            ctx.beginPath();
        },
        paint: () => ctx.fillRect(-1e4, -1e4, 2e4, 2e4),
        $dispose() {},
    };
}
