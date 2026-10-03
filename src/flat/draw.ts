/**
 * Canvas 2D painters for Flatland (MATH.md §11). They take the data computed
 * by src/flat/view (projection) and src/flat/slice2 (slice) and draw it; they
 * hold no state.
 *
 * Colour is data, exactly as in §10: the projection view colours a vertex by
 * its z after rotation over [−R, R], the slice view colours the slice by the
 * z of the source point, before rotation, over the solid's own z extent. On a
 * slice that z is an *affine function of the position in the plane* (the
 * source point is offset · m + q_0 u_1 + q_1 u_2, so its z is
 * offset · m_z + q_0 u_1z + q_1 u_2z), so the whole slice is painted with one
 * linear gradient and the colour at every pixel is exact, not interpolated
 * from triangle corners.
 */
import { gradient, type RGB, type WColorScale } from '../app/colors';
import type { Vec2 } from './math';
import type { Plane } from './math';
import { MAX_CORNER_DOTS, type FlatModel } from './model';
import type { ProjectedFrame } from './view';

/** Where the plane's origin is on the canvas and how many pixels a model unit is. */
export interface Viewport {
  /** Canvas position of the plane's origin (0, 0), CSS pixels. */
  cx: number;
  cy: number;
  /** Pixels per model unit. */
  k: number;
  width: number;
  height: number;
}

/** Number of colour classes for batched strokes and fills. */
export const COLOR_BUCKETS = 32;

/** Meshes with at most this many faces are filled one by one in painter's order; denser ones batched by colour class. */
export const EXACT_FACE_LIMIT = 300;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export const rgba = (c: RGB, a: number): string =>
  `rgba(${Math.round(clamp01(c.r) * 255)}, ${Math.round(clamp01(c.g) * 255)}, ${Math.round(clamp01(c.b) * 255)}, ${a})`;

const bucketOf = (t: number): number => Math.min(COLOR_BUCKETS - 1, Math.floor(clamp01(t) * COLOR_BUCKETS));
const bucketColor = (b: number): RGB => gradient((b + 0.5) / COLOR_BUCKETS);

// ---- The Flatland sheet -----------------------------------------------------

/**
 * The plane z = 0 as a faint square sheet of half-size `half` model units
 * with a grid every `step`, axes slightly brighter. The plane maps to itself
 * under projection (d / (d − 0) = 1), so the grid is a plain grid.
 */
export function drawSheet(ctx: CanvasRenderingContext2D, vp: Viewport, half: number, step: number): void {
  const x0 = vp.cx - half * vp.k;
  const x1 = vp.cx + half * vp.k;
  const y0 = vp.cy - half * vp.k;
  const y1 = vp.cy + half * vp.k;
  ctx.save();
  ctx.fillStyle = 'rgba(127, 178, 255, 0.025)';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(127, 178, 255, 0.075)';
  ctx.beginPath();
  const n = Math.round(half / step);
  for (let i = -n; i <= n; i++) {
    if (i === 0) continue;
    const gx = vp.cx + i * step * vp.k;
    const gy = vp.cy + i * step * vp.k;
    ctx.moveTo(gx, y0);
    ctx.lineTo(gx, y1);
    ctx.moveTo(x0, gy);
    ctx.lineTo(x1, gy);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(127, 178, 255, 0.2)';
  ctx.beginPath();
  ctx.moveTo(vp.cx, y0);
  ctx.lineTo(vp.cx, y1);
  ctx.moveTo(x0, vp.cy);
  ctx.lineTo(x1, vp.cy);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(127, 178, 255, 0.28)';
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

// ---- Projection view --------------------------------------------------------

/**
 * Draw the projected solid: translucent faces far to near, then edges
 * coloured by z, then corner dots. `scale` maps a rotated z to colour (§10:
 * symmetric over [−R, R]); `alpha` scales every opacity (the overlay draws
 * the projection as a faint ghost).
 */
export function drawProjection(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  model: FlatModel,
  frame: ProjectedFrame,
  scale: WColorScale,
  alpha = 1,
): void {
  const { x, y, z } = frame;
  const px = (i: number): number => vp.cx + vp.k * x[i];
  const py = (i: number): number => vp.cy - vp.k * y[i];
  const nf = model.faces.length;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Faces, back to front.
  const faceAlpha = alpha * (nf <= 40 ? 0.17 : nf <= EXACT_FACE_LIMIT ? 0.12 : 0.15);
  const tri = (f: number): void => {
    const [a, b, c] = model.faces[f];
    ctx.moveTo(px(a), py(a));
    ctx.lineTo(px(b), py(b));
    ctx.lineTo(px(c), py(c));
    ctx.closePath();
  };
  if (nf <= EXACT_FACE_LIMIT) {
    for (const f of frame.faceOrder) {
      ctx.beginPath();
      tri(f);
      ctx.fillStyle = rgba(scale.color(frame.faceZ[f]), faceAlpha);
      ctx.fill();
    }
  } else {
    // faceOrder is ascending in z and the colour class is monotone in z, so
    // consecutive faces share a class until it changes: one fill per class.
    let current = -1;
    let open = false;
    const flush = (): void => {
      if (!open) return;
      ctx.fillStyle = rgba(bucketColor(current), faceAlpha);
      ctx.fill();
      open = false;
    };
    for (const f of frame.faceOrder) {
      const b = bucketOf(scale.t(frame.faceZ[f]));
      if (b !== current) {
        flush();
        current = b;
        ctx.beginPath();
        open = true;
      }
      tri(f);
    }
    flush();
  }

  // Edges. Long edges that run through many colours get their own gradient;
  // short ones are batched by colour class, far classes first.
  const ne = frame.edges.length;
  const sparse = ne <= 120;
  ctx.lineWidth = sparse ? 1.7 : 1.1;
  ctx.globalAlpha = alpha * (sparse ? 0.95 : 0.6);
  const batches: number[][] = Array.from({ length: COLOR_BUCKETS }, () => []);
  for (let i = 0; i < ne; i++) {
    const e = model.edges[frame.edges[i]];
    const t0 = scale.t(z[e.a]);
    const t1 = scale.t(z[e.b]);
    if (Math.abs(t1 - t0) > 0.08) {
      const g = ctx.createLinearGradient(px(e.a), py(e.a), px(e.b), py(e.b));
      for (let s = 0; s <= 8; s++) g.addColorStop(s / 8, rgba(scale.color(z[e.a] + ((z[e.b] - z[e.a]) * s) / 8), 1));
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(px(e.a), py(e.a));
      ctx.lineTo(px(e.b), py(e.b));
      ctx.stroke();
    } else {
      batches[bucketOf((t0 + t1) / 2)].push(frame.edges[i]);
    }
  }
  for (let b = 0; b < COLOR_BUCKETS; b++) {
    if (batches[b].length === 0) continue;
    ctx.strokeStyle = rgba(bucketColor(b), 1);
    ctx.beginPath();
    for (const ei of batches[b]) {
      const e = model.edges[ei];
      ctx.moveTo(px(e.a), py(e.a));
      ctx.lineTo(px(e.b), py(e.b));
    }
    ctx.stroke();
  }

  // Vertices as dots, for solids with few corners.
  if (model.corners.length <= MAX_CORNER_DOTS) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(11, 14, 20, 0.85)';
    for (const v of [...model.corners].sort((p, q) => z[p] - z[q])) {
      ctx.beginPath();
      ctx.arc(px(v), py(v), 3.4, 0, 2 * Math.PI);
      ctx.fillStyle = rgba(scale.color(z[v]), 1);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---- Slice view -------------------------------------------------------------

/** z of the source point as an affine function of the chart position q: z0 + gx q_0 + gy q_1. */
export interface ZField {
  z0: number;
  gx: number;
  gy: number;
}

/**
 * The source z over a plane's chart: the source point of chart position q is
 * offset · normal + q_0 u_1 + q_1 u_2, whose z coordinate is
 * offset · normal_z + q_0 u_1z + q_1 u_2z.
 */
export const planeZField = (plane: Plane): ZField => ({
  z0: plane.offset * plane.normal[2],
  gx: plane.basis[0][2],
  gy: plane.basis[1][2],
});

/**
 * Paint style colouring a slice by source z: a canvas linear gradient whose
 * axis runs along the direction of steepest z change in the plane, with the
 * colour scale sampled along it, or a flat colour when z is constant over
 * the slice (the plane z = c of an unrotated solid). `a` is the pixels per
 * chart unit and the chart origin sits at (vp.cx, vp.cy).
 */
export function sliceStyle(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  field: ZField,
  a: number,
  scale: WColorScale,
  alpha: number,
): string | CanvasGradient {
  // In pixels: z = z0 + G · (P − origin) with G = (gx / a, −gy / a) (screen y runs down).
  const gxp = field.gx / a;
  const gyp = -field.gy / a;
  const g2 = gxp * gxp + gyp * gyp;
  const lo = scale.min;
  const hi = scale.max;
  if (g2 < 1e-12 || !(hi - lo > 1e-9)) return rgba(scale.color(field.z0), alpha);
  const at = (z: number): [number, number] => [vp.cx + (gxp * (z - field.z0)) / g2, vp.cy + (gyp * (z - field.z0)) / g2];
  const [ax, ay] = at(lo);
  const [bx, by] = at(hi);
  const grad = ctx.createLinearGradient(ax, ay, bx, by);
  const samples = 48;
  let zeroDone = !(lo < 0 && hi > 0);
  for (let i = 0; i <= samples; i++) {
    const z = lo + ((hi - lo) * i) / samples;
    if (!zeroDone && z > 0) {
      grad.addColorStop(clamp01(-lo / (hi - lo)), rgba(scale.color(0), alpha));
      zeroDone = true;
    }
    grad.addColorStop(i / samples, rgba(scale.color(z), alpha));
  }
  return grad;
}

/**
 * Draw the slice loops (chart coordinates, scaled by `sliceScale` about the
 * origin, 1 in the slice view and d / (d − c) in the overlay under
 * perspective, §11) as filled polygons with outlines, coloured by source z.
 * One mesh fills with the even–odd rule, so nested loops are holes; several
 * parts drawn together (the human) use the non-zero rule, which with outer
 * loops counter-clockwise and holes clockwise (§9.1) paints their union.
 */
export function drawSlice(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  loops: readonly (readonly Vec2[])[],
  field: ZField,
  scale: WColorScale,
  sliceScale: number,
  multiPart: boolean,
): void {
  if (loops.length === 0) return;
  const a = vp.k * sliceScale;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const loop of loops) {
    loop.forEach(([qx, qy], i) => {
      const X = vp.cx + a * qx;
      const Y = vp.cy - a * qy;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.closePath();
  }
  ctx.fillStyle = sliceStyle(ctx, vp, field, a, scale, 0.78);
  ctx.fill(multiPart ? 'nonzero' : 'evenodd');
  ctx.lineWidth = 2;
  ctx.strokeStyle = sliceStyle(ctx, vp, field, a, scale, 1);
  ctx.stroke();
  ctx.restore();
}
